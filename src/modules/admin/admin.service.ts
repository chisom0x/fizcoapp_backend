import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { RequestsService } from '../requests/requests.service';
import { MarketsService } from '../markets/markets.service';
import { AdminRepository, SeriesMetric } from './admin.repository';
import {
  fillSeries,
  lastTwelveMonths,
  resolveRange,
  TimeRange,
} from './time-range';
import {
  AdminListQueryDto,
  AdminUpdateUserDto,
  RangeQueryDto,
  RequestsQueryDto,
  SubscriptionsQueryDto,
  TransactionsQueryDto,
  UsersQueryDto,
} from './dto/admin.dto';

const paged = <T>(
  result: { items: T[]; total: number },
  q: { page: number; limit: number },
) => ({
  data: result.items,
  meta: {
    page: q.page,
    limit: q.limit,
    total: result.total,
    totalPages: Math.ceil(result.total / q.limit),
  },
});

const rangeMeta = (r: TimeRange) => ({
  range: r.range,
  from: r.from,
  to: r.to,
  bucket: r.bucket,
});

@Injectable()
export class AdminService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly usersService: UsersService,
    private readonly requestsService: RequestsService,
    private readonly marketsService: MarketsService,
  ) {}

  private async seriesFor(metrics: SeriesMetric[], r: TimeRange) {
    const rows = await this.repo.series(metrics, r);
    return Object.fromEntries(
      metrics.map((m) => [
        m,
        fillSeries(
          r.keys,
          rows.filter((row) => row.m === m),
        ),
      ]),
    ) as Record<SeriesMetric, Array<{ key: string; value: number }>>;
  }

  async dashboard(q: RangeQueryDto) {
    const r = resolveRange(q);
    const [totals, series, recentUsers, recentRequests] = await Promise.all([
      this.repo.dashboardTotals(r),
      this.seriesFor(
        ['users', 'requests', 'requestNotifications', 'revenue'],
        r,
      ),
      this.repo.recentUsers(),
      this.repo.recentRequests(),
    ]);
    return { range: rangeMeta(r), totals, series, recentUsers, recentRequests };
  }

  async analytics(q: RangeQueryDto) {
    const r = resolveRange(q);
    const metrics: SeriesMetric[] = [
      'users',
      'requests',
      'fulfilled',
      'interests',
      'offers',
      'inventory',
      'chats',
      'messages',
      'requestNotifications',
      'revenue',
    ];
    const [totals, series, breakdownRows, leaderRows] = await Promise.all([
      this.repo.analyticsTotals(),
      this.seriesFor(metrics, r),
      this.repo.analyticsBreakdowns(r),
      this.repo.analyticsLeaders(r),
    ]);
    const inRange = Object.fromEntries(
      metrics.map((m) => [m, series[m].reduce((sum, p) => sum + p.value, 0)]),
    );
    const breakdowns: Record<
      string,
      Array<{ label: string; value: number }>
    > = {};
    for (const row of breakdownRows) {
      (breakdowns[row.g] ??= []).push({
        label: row.label,
        value: Number(row.v),
      });
    }
    for (const list of Object.values(breakdowns))
      list.sort((a, b) => b.value - a.value);
    breakdowns.brand = (breakdowns.brand ?? []).slice(0, 10);
    return {
      range: rangeMeta(r),
      totals,
      inRange,
      series,
      breakdowns,
      leaders: {
        requesters: leaderRows.filter((l) => l.g === 'requesters'),
        vendors: leaderRows.filter((l) => l.g === 'vendors'),
      },
    };
  }

  // ---------------------------------------------------------------- users

  async listUsers(q: UsersQueryDto) {
    return paged(await this.repo.listUsers(q), q);
  }

  async getUser(id: string) {
    const months = lastTwelveMonths();
    const [user, stats, monthlyRows] = await Promise.all([
      this.repo.findUser(id),
      this.repo.userStats(id),
      this.repo.userMonthlyActivity(id, months.from),
    ]);
    if (!user) throw new NotFoundException('User not found');
    const monthly = Object.fromEntries(
      (['requests', 'inventory', 'interests'] as const).map((m) => [
        m,
        fillSeries(
          months.keys,
          monthlyRows.filter((row) => row.m === m),
        ),
      ]),
    );
    return { ...user, stats, monthly };
  }

  async userRequests(id: string, q: AdminListQueryDto) {
    return paged(await this.repo.userRequests(id, q), q);
  }

  async userInterests(id: string, q: AdminListQueryDto) {
    return paged(await this.repo.userInterests(id, q), q);
  }

  async userInventory(id: string, q: AdminListQueryDto) {
    return paged(await this.repo.userInventory(id, q), q);
  }

  async userTransactions(id: string, q: AdminListQueryDto) {
    return paged(await this.repo.userTransactions(id, q), q);
  }

  async updateUser(id: string, dto: AdminUpdateUserDto) {
    const user = await this.repo.findUser(id);
    if (!user) throw new NotFoundException('User not found');
    if (user.deletedAt)
      throw new ConflictException('Deleted accounts cannot be edited');
    const data: Prisma.UserUpdateInput = {
      ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
      ...(dto.businessName !== undefined
        ? { businessName: dto.businessName || null }
        : {}),
      ...(dto.shopAddress !== undefined
        ? { shopAddress: dto.shopAddress || null }
        : {}),
      ...(dto.email !== undefined ? { email: dto.email } : {}),
      ...(dto.phoneNumber !== undefined
        ? { phoneNumber: dto.phoneNumber }
        : {}),
      ...(dto.marketId !== undefined
        ? { market: { connect: { id: dto.marketId } } }
        : {}),
    };
    if (dto.marketId) await this.marketsService.assertExists(dto.marketId);
    try {
      await this.repo.updateUser(id, data);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Another account already uses that email or phone number',
        );
      }
      throw err;
    }
    return this.getUser(id);
  }

  /** Same as the user deleting their own account: the row is scrubbed, chats are kept */
  async deleteUser(id: string) {
    const user = await this.repo.findUser(id);
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    await this.usersService.removeAccount(id, user.fullName);
    return { deleted: true, id };
  }

  // ---------------------------------------------------------------- requests

  async listRequests(q: RequestsQueryDto) {
    return paged(await this.repo.listRequests(q), q);
  }

  async getRequest(id: string) {
    const request = await this.repo.findRequest(id);
    if (!request) throw new NotFoundException('Request not found');
    const { messagesAsAttachment, ...rest } = request;
    const priceOf = (o: { item: { price?: number | null } | null }) =>
      o.item?.price ?? Infinity;
    const offers = messagesAsAttachment
      .map((m) => ({
        id: m.id,
        createdAt: m.createdAt,
        vendor: m.sender,
        item: m.inventoryItem as {
          id?: string;
          title?: string;
          description?: string;
          imageUrls?: string[];
          price?: number | null;
        } | null,
      }))
      .sort((a, b) => priceOf(a) - priceOf(b));
    return { ...rest, offers };
  }

  deleteRequest(id: string) {
    return this.requestsService.removeAsAdmin(id);
  }

  // ---------------------------------------------------------------- finance

  async finance(q: RangeQueryDto) {
    const r = resolveRange(q);
    const [totals, series] = await Promise.all([
      this.repo.financeTotals(r),
      this.seriesFor(['revenue'], r),
    ]);
    return { range: rangeMeta(r), totals, series };
  }

  async listTransactions(q: TransactionsQueryDto) {
    return paged(await this.repo.listTransactions(q), q);
  }

  async getTransaction(id: string) {
    const tx = await this.repo.findTransaction(id);
    if (!tx) throw new NotFoundException('Transaction not found');
    return tx;
  }

  async listSubscriptions(q: SubscriptionsQueryDto) {
    return paged(await this.repo.listSubscriptions(q), q);
  }
}
