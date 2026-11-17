import { Injectable } from '@nestjs/common';
import { MessageType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LAGOS_OFFSET_HOURS, SQL_BUCKET_FORMAT, TimeRange } from './time-range';
import {
  RequestsQueryDto,
  SubscriptionsQueryDto,
  TransactionsQueryDto,
  UsersQueryDto,
} from './dto/admin.dto';

/** Notification types the app sends about requests (see RequestsService / NotificationsService) */
export const REQUEST_NOTIFICATION_TYPES = [
  'REQUEST_MATCH',
  'OFFER_SENT',
  'VENDOR_OFFERS',
  'VENDOR_INTEREST',
  'REQUEST_FULFILLED',
];

/**
 * Timestamps are stored as UTC without a zone; comparing against an explicit UTC value keeps the
 * result independent of the database session's time zone
 */
const at = (d: Date) =>
  Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
const NOW = Prisma.raw(`(now() AT TIME ZONE 'UTC')`);
const between = (column: string, r: TimeRange) =>
  Prisma.sql`${Prisma.raw(column)} >= ${at(r.from)} AND ${Prisma.raw(column)} < ${at(r.to)}`;

const isRequestNotification = Prisma.sql`"data"->>'type' = ANY(${REQUEST_NOTIFICATION_TYPES})`;
/** An inventory item a vendor sent into a request's chat, automatically or by hand */
const isOffer = Prisma.sql`"type" = 'INVENTORY_ATTACHMENT' AND "taggedRequestId" IS NOT NULL`;

/** Event streams charted over time: where each one lives and what is summed per bucket */
const SERIES = {
  users: {
    table: 'User',
    at: '"createdAt"',
    where: Prisma.sql`TRUE`,
    value: 'count(*)',
  },
  requests: {
    table: 'Request',
    at: '"createdAt"',
    where: Prisma.sql`TRUE`,
    value: 'count(*)',
  },
  fulfilled: {
    table: 'Request',
    at: '"fulfilledAt"',
    where: Prisma.sql`"status" = 'DONE'`,
    value: 'count(*)',
  },
  interests: {
    table: 'RequestInterest',
    at: '"createdAt"',
    where: Prisma.sql`TRUE`,
    value: 'count(*)',
  },
  offers: {
    table: 'Message',
    at: '"createdAt"',
    where: isOffer,
    value: 'count(*)',
  },
  inventory: {
    table: 'InventoryItem',
    at: '"createdAt"',
    where: Prisma.sql`TRUE`,
    value: 'count(*)',
  },
  chats: {
    table: 'ChatThread',
    at: '"createdAt"',
    where: Prisma.sql`TRUE`,
    value: 'count(*)',
  },
  messages: {
    table: 'Message',
    at: '"createdAt"',
    where: Prisma.sql`NOT "isSystem"`,
    value: 'count(*)',
  },
  requestNotifications: {
    table: 'Notification',
    at: '"createdAt"',
    where: isRequestNotification,
    value: 'count(*)',
  },
  revenue: {
    table: 'SubscriptionTransaction',
    at: '"createdAt"',
    where: Prisma.sql`"status" = 'SUCCESS'`,
    value: 'sum("amount")',
  },
} as const;
export type SeriesMetric = keyof typeof SERIES;

const userSummarySelect = {
  id: true,
  fullName: true,
  businessName: true,
  email: true,
  phoneNumber: true,
  avatarUrl: true,
  subscriptionPlan: true,
  isVerified: true,
  verificationStatus: true,
  deletedAt: true,
  lastSeenAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const personSelect = {
  id: true,
  fullName: true,
  businessName: true,
  email: true,
  avatarUrl: true,
  isVerified: true,
  subscriptionPlan: true,
} satisfies Prisma.UserSelect;

const transactionListSelect = {
  id: true,
  amount: true,
  currency: true,
  status: true,
  paymentMethod: true,
  description: true,
  paystackReference: true,
  createdAt: true,
} satisfies Prisma.SubscriptionTransactionSelect;

const offerCount = { where: { type: MessageType.INVENTORY_ATTACHMENT } };

const page = (q: { page: number; limit: number }) => ({
  skip: (q.page - 1) * q.limit,
  take: q.limit,
});

const containsText = (search: string) => ({
  contains: search,
  mode: 'insensitive' as const,
});

@Injectable()
export class AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- dashboard & analytics

  /** Headline numbers for the dashboard: all-time totals plus counts within the range */
  async dashboardTotals(r: TimeRange) {
    const [row] = await this.prisma.$queryRaw<Array<Record<string, number>>>`
      SELECT
        (SELECT count(*) FROM "User" WHERE "deletedAt" IS NULL)::int AS "totalUsers",
        (SELECT count(*) FROM "User" WHERE ${between('"createdAt"', r)})::int AS "newUsers",
        (SELECT count(*) FROM "Request" WHERE NOT "isDeleted")::int AS "totalRequests",
        (SELECT count(*) FROM "Request" WHERE NOT "isDeleted" AND "status" = 'ACTIVE')::int AS "activeRequests",
        (SELECT count(*) FROM "Request" WHERE ${between('"createdAt"', r)})::int AS "newRequests",
        (SELECT count(*) FROM "Request" WHERE "status" = 'DONE' AND ${between('"fulfilledAt"', r)})::int AS "fulfilledRequests",
        (SELECT count(*) FROM "Notification" WHERE ${isRequestNotification})::int AS "requestNotificationsTotal",
        (SELECT count(*) FROM "Notification" WHERE ${isRequestNotification} AND ${between('"createdAt"', r)})::int AS "requestNotifications",
        (SELECT count(*) FROM "RequestInterest" WHERE ${between('"createdAt"', r)})::int AS "interests",
        (SELECT count(*) FROM "Message" WHERE ${isOffer} AND ${between('"createdAt"', r)})::int AS "offers",
        (SELECT count(*) FROM "InventoryItem" WHERE ${between('"createdAt"', r)})::int AS "newInventory",
        (SELECT coalesce(sum("amount"), 0) FROM "SubscriptionTransaction" WHERE "status" = 'SUCCESS' AND ${between('"createdAt"', r)})::float AS "revenue",
        (SELECT count(*) FROM "Subscription" WHERE "status" = 'active' AND "currentPeriodEnd" > ${NOW})::int AS "activeSubscribers"
    `;
    return row;
  }

  /** Every metric bucketed by hour, day or month in Lagos time, in one round trip */
  async series(metrics: SeriesMetric[], r: TimeRange) {
    const local = Prisma.raw(`interval '${LAGOS_OFFSET_HOURS} hour'`);
    const parts = metrics.map((metric) => {
      const s = SERIES[metric];
      const column = Prisma.raw(s.at);
      return Prisma.sql`
        SELECT ${metric}::text AS m, to_char(${column} + ${local}, ${SQL_BUCKET_FORMAT[r.bucket]}::text) AS k,
               (${Prisma.raw(s.value)})::float AS v
        FROM ${Prisma.raw(`"${s.table}"`)}
        WHERE ${s.where} AND ${between(s.at, r)}
        GROUP BY 2`;
    });
    return this.prisma.$queryRaw<
      Array<{ m: SeriesMetric; k: string; v: number }>
    >`${Prisma.join(parts, ' UNION ALL ')}`;
  }

  /** All-time totals across every part of the app */
  async analyticsTotals() {
    const [row] = await this.prisma.$queryRaw<Array<Record<string, number>>>`
      SELECT
        (SELECT count(*) FROM "User")::int AS "usersEver",
        (SELECT count(*) FROM "User" WHERE "deletedAt" IS NULL)::int AS "users",
        (SELECT count(*) FROM "User" WHERE "deletedAt" IS NOT NULL)::int AS "deletedUsers",
        (SELECT count(*) FROM "User" WHERE "deletedAt" IS NULL AND "isVerified")::int AS "verifiedUsers",
        (SELECT count(*) FROM "User" WHERE "deletedAt" IS NULL AND "verificationStatus" = 'PENDING')::int AS "pendingVerification",
        (SELECT count(*) FROM "User" WHERE "deletedAt" IS NULL AND "teamOwnerId" IS NOT NULL)::int AS "teamMembers",
        (SELECT count(*) FROM "User" WHERE "deletedAt" IS NULL AND "lastSeenAt" >= ${NOW} - interval '1 day')::int AS "activeToday",
        (SELECT count(*) FROM "User" WHERE "deletedAt" IS NULL AND "lastSeenAt" >= ${NOW} - interval '7 days')::int AS "active7d",
        (SELECT count(*) FROM "User" WHERE "deletedAt" IS NULL AND "lastSeenAt" >= ${NOW} - interval '30 days')::int AS "active30d",
        (SELECT count(*) FROM "User" WHERE "deletedAt" IS NULL AND "notificationsEnabled" AND "fcmToken" IS NOT NULL)::int AS "pushReachable",
        (SELECT count(*) FROM "Request")::int AS "requestsEver",
        (SELECT count(*) FROM "Request" WHERE NOT "isDeleted" AND "status" = 'ACTIVE')::int AS "activeRequests",
        (SELECT count(*) FROM "Request" WHERE NOT "isDeleted" AND "status" = 'DONE')::int AS "fulfilledRequests",
        (SELECT count(*) FROM "Request" WHERE "isDeleted")::int AS "deletedRequests",
        (SELECT count(*) FROM "Request" r WHERE EXISTS (SELECT 1 FROM "RequestInterest" i WHERE i."requestId" = r.id))::int AS "requestsWithInterest",
        (SELECT count(*) FROM "RequestInterest")::int AS "interests",
        (SELECT count(*) FROM "Message" WHERE ${isOffer})::int AS "offers",
        (SELECT count(*) FROM "InventoryItem")::int AS "inventoryItems",
        (SELECT count(DISTINCT "userId") FROM "InventoryItem")::int AS "vendorsWithInventory",
        (SELECT coalesce(avg("price"), 0) FROM "InventoryItem" WHERE "price" IS NOT NULL)::float AS "avgItemPrice",
        (SELECT coalesce(sum("price"), 0) FROM "InventoryItem")::float AS "inventoryValue",
        (SELECT count(*) FROM "ChatThread")::int AS "chats",
        (SELECT count(*) FROM "Message" WHERE NOT "isSystem")::int AS "messages",
        (SELECT count(*) FROM "Notification")::int AS "notifications",
        (SELECT count(*) FROM "Notification" WHERE ${isRequestNotification})::int AS "requestNotifications",
        (SELECT count(*) FROM "Feedback")::int AS "feedbacks",
        (SELECT coalesce(avg("rating"), 0) FROM "Feedback")::float AS "avgRating",
        (SELECT count(*) FROM "BlockedVendor")::int AS "blocks",
        (SELECT count(*) FROM "Subscription" WHERE "status" = 'active' AND "currentPeriodEnd" > ${NOW})::int AS "activeSubscribers",
        (SELECT coalesce(sum("amount"), 0) FROM "SubscriptionTransaction" WHERE "status" = 'SUCCESS')::float AS "revenue"
    `;
    return row;
  }

  /** Group/label/value rows for the distribution charts */
  async analyticsBreakdowns(r: TimeRange) {
    return this.prisma.$queryRaw<
      Array<{ g: string; label: string; v: number }>
    >`
      SELECT 'notificationType' AS g, coalesce("data"->>'type', 'OTHER') AS label, count(*)::float AS v
        FROM "Notification" WHERE ${between('"createdAt"', r)} GROUP BY 2
      UNION ALL
      SELECT 'brand', initcap(lower(trim("brand"))), count(*)::float
        FROM "InventoryItem" WHERE coalesce(trim("brand"), '') <> '' GROUP BY 2
      UNION ALL
      SELECT 'verification', "verificationStatus"::text, count(*)::float
        FROM "User" WHERE "deletedAt" IS NULL GROUP BY 2
      UNION ALL
      SELECT 'plan', "subscriptionPlan", count(*)::float
        FROM "User" WHERE "deletedAt" IS NULL GROUP BY 2
      UNION ALL
      SELECT 'subscriptionPlan', "plan", count(*)::float
        FROM "Subscription" WHERE "status" = 'active' AND "currentPeriodEnd" > ${NOW} GROUP BY 2
      UNION ALL
      SELECT 'rating', "rating"::text, count(*)::float FROM "Feedback" GROUP BY 2
    `;
  }

  /** The most active requesters and vendors within the range */
  async analyticsLeaders(r: TimeRange) {
    return this.prisma.$queryRaw<
      Array<{
        g: 'requesters' | 'vendors';
        id: string;
        fullName: string;
        businessName: string | null;
        v: number;
      }>
    >`
      (SELECT 'requesters' AS g, u."id", u."fullName", u."businessName", count(*)::int AS v
        FROM "Request" x JOIN "User" u ON u."id" = x."requesterId"
        WHERE ${between('x."createdAt"', r)}
        GROUP BY u."id" ORDER BY v DESC LIMIT 5)
      UNION ALL
      (SELECT 'vendors', u."id", u."fullName", u."businessName", count(*)::int
        FROM "RequestInterest" x JOIN "User" u ON u."id" = x."vendorId"
        WHERE ${between('x."createdAt"', r)}
        GROUP BY u."id" ORDER BY 5 DESC LIMIT 5)
    `;
  }

  recentUsers(take = 6) {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take,
      select: userSummarySelect,
    });
  }

  recentRequests(take = 6) {
    return this.prisma.request.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        requester: { select: { id: true, fullName: true } },
        _count: { select: { interests: true } },
      },
    });
  }

  // ---------------------------------------------------------------- users

  async listUsers(q: UsersQueryDto) {
    const status = q.status ?? 'active';
    const where: Prisma.UserWhereInput = {
      ...(status === 'active'
        ? { deletedAt: null }
        : status === 'deleted'
          ? { deletedAt: { not: null } }
          : {}),
      ...(q.plan ? { subscriptionPlan: q.plan } : {}),
      ...(q.verification ? { verificationStatus: q.verification } : {}),
      ...(q.search
        ? {
            OR: [
              { fullName: containsText(q.search) },
              { businessName: containsText(q.search) },
              { email: containsText(q.search) },
              { phoneNumber: { contains: q.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...page(q),
        select: {
          ...userSummarySelect,
          _count: {
            select: {
              requests: { where: { isDeleted: false } },
              inventoryItems: true,
              interests: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total };
  }

  findUser(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        businessName: true,
        shopAddress: true,
        market: { select: { id: true, name: true } },
        email: true,
        phoneNumber: true,
        avatarUrl: true,
        plazaImageUrl: true,
        officeImageUrl: true,
        subscriptionPlan: true,
        paystackCustomerId: true,
        isVerified: true,
        verificationStatus: true,
        cacRegistrationNumber: true,
        cacSharedByOwnerName: true,
        cacSharedByBusinessName: true,
        notificationsEnabled: true,
        lastSeenAt: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        teamOwner: { select: personSelect },
        teamMembers: {
          select: { ...personSelect, verificationStatus: true },
          take: 50,
        },
        teamInvitesSent: {
          select: { inviteeEmail: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        subscription: true,
      },
    });
  }

  /** Activity counts for one user, in one round trip */
  async userStats(id: string) {
    const [row] = await this.prisma.$queryRaw<Array<Record<string, number>>>`
      SELECT
        (SELECT count(*) FROM "Request" WHERE "requesterId" = ${id})::int AS "requestsTotal",
        (SELECT count(*) FROM "Request" WHERE "requesterId" = ${id} AND NOT "isDeleted" AND "status" = 'ACTIVE')::int AS "requestsActive",
        (SELECT count(*) FROM "Request" WHERE "requesterId" = ${id} AND NOT "isDeleted" AND "status" = 'DONE')::int AS "requestsFulfilled",
        (SELECT count(*) FROM "Request" WHERE "requesterId" = ${id} AND "isDeleted")::int AS "requestsDeleted",
        (SELECT count(*) FROM "RequestInterest" WHERE "vendorId" = ${id})::int AS "interests",
        (SELECT count(*) FROM "Request" WHERE "fulfilledByVendorId" = ${id})::int AS "salesClosed",
        (SELECT count(*) FROM "Message" WHERE "senderId" = ${id} AND ${isOffer})::int AS "offersSent",
        (SELECT count(*) FROM "InventoryItem" WHERE "userId" = ${id})::int AS "inventoryItems",
        (SELECT coalesce(sum("price"), 0) FROM "InventoryItem" WHERE "userId" = ${id})::float AS "inventoryValue",
        (SELECT count(*) FROM "ChatThread" WHERE "creatorId" = ${id} OR "vendorId" = ${id})::int AS "chats",
        (SELECT coalesce(sum("amount"), 0) FROM "SubscriptionTransaction" WHERE "userId" = ${id} AND "status" = 'SUCCESS')::float AS "totalSpent",
        (SELECT count(*) FROM "BlockedVendor" WHERE "vendorId" = ${id})::int AS "timesBlocked"
    `;
    return row;
  }

  /** Requests posted and inventory added per Lagos month over the last 12 months */
  async userMonthlyActivity(id: string, since: Date) {
    const local = Prisma.raw(`interval '${LAGOS_OFFSET_HOURS} hour'`);
    return this.prisma.$queryRaw<
      Array<{ m: 'requests' | 'inventory' | 'interests'; k: string; v: number }>
    >`
      SELECT 'requests' AS m, to_char("createdAt" + ${local}, 'YYYY-MM') AS k, count(*)::int AS v
        FROM "Request" WHERE "requesterId" = ${id} AND "createdAt" >= ${at(since)} GROUP BY 2
      UNION ALL
      SELECT 'inventory', to_char("createdAt" + ${local}, 'YYYY-MM'), count(*)::int
        FROM "InventoryItem" WHERE "userId" = ${id} AND "createdAt" >= ${at(since)} GROUP BY 2
      UNION ALL
      SELECT 'interests', to_char("createdAt" + ${local}, 'YYYY-MM'), count(*)::int
        FROM "RequestInterest" WHERE "vendorId" = ${id} AND "createdAt" >= ${at(since)} GROUP BY 2
    `;
  }

  async userRequests(userId: string, q: { page: number; limit: number }) {
    const where = { requesterId: userId };
    const [items, total] = await Promise.all([
      this.prisma.request.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...page(q),
        select: {
          id: true,
          title: true,
          status: true,
          isDeleted: true,
          createdAt: true,
          fulfilledAt: true,
          _count: {
            select: { interests: true, messagesAsAttachment: offerCount },
          },
        },
      }),
      this.prisma.request.count({ where }),
    ]);
    return { items, total };
  }

  async userInterests(userId: string, q: { page: number; limit: number }) {
    const where = { vendorId: userId };
    const [items, total] = await Promise.all([
      this.prisma.requestInterest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...page(q),
        select: {
          id: true,
          createdAt: true,
          request: {
            select: {
              id: true,
              title: true,
              status: true,
              isDeleted: true,
              createdAt: true,
              fulfilledByVendorId: true,
              requester: { select: { id: true, fullName: true } },
            },
          },
        },
      }),
      this.prisma.requestInterest.count({ where }),
    ]);
    return { items, total };
  }

  async userInventory(
    userId: string,
    q: { page: number; limit: number; search?: string },
  ) {
    const where: Prisma.InventoryItemWhereInput = {
      userId,
      ...(q.search
        ? {
            OR: [
              { title: containsText(q.search) },
              { brand: containsText(q.search) },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...page(q),
        select: {
          id: true,
          title: true,
          description: true,
          imageUrls: true,
          price: true,
          brand: true,
          model: true,
          storage: true,
          condition: true,
          color: true,
          createdAt: true,
        },
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);
    return { items, total };
  }

  async userTransactions(userId: string, q: { page: number; limit: number }) {
    const where = { userId };
    const [items, total] = await Promise.all([
      this.prisma.subscriptionTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...page(q),
        select: transactionListSelect,
      }),
      this.prisma.subscriptionTransaction.count({ where }),
    ]);
    return { items, total };
  }

  updateUser(id: string, data: Prisma.UserUpdateInput) {
    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true },
    });
  }

  // ---------------------------------------------------------------- requests

  async listRequests(q: RequestsQueryDto) {
    const where: Prisma.RequestWhereInput = {
      ...(q.status === 'DELETED' ? { isDeleted: true } : { isDeleted: false }),
      ...(q.status === 'ACTIVE' || q.status === 'DONE'
        ? { status: q.status }
        : {}),
      ...(q.search
        ? {
            OR: [
              { title: containsText(q.search) },
              { requester: { fullName: containsText(q.search) } },
              { requester: { businessName: containsText(q.search) } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.request.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...page(q),
        select: {
          id: true,
          title: true,
          status: true,
          isDeleted: true,
          createdAt: true,
          fulfilledAt: true,
          requester: {
            select: {
              id: true,
              fullName: true,
              businessName: true,
              avatarUrl: true,
            },
          },
          _count: {
            select: {
              interests: true,
              chatThreads: true,
              messagesAsAttachment: offerCount,
            },
          },
        },
      }),
      this.prisma.request.count({ where }),
    ]);
    return { items, total };
  }

  findRequest(id: string) {
    return this.prisma.request.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        isDeleted: true,
        createdAt: true,
        updatedAt: true,
        fulfilledAt: true,
        requester: {
          select: { ...personSelect, phoneNumber: true, shopAddress: true },
        },
        fulfilledByVendor: { select: personSelect },
        interests: {
          orderBy: { createdAt: 'asc' },
          take: 100,
          select: { createdAt: true, vendor: { select: personSelect } },
        },
        // Offers are few per request (automatic ones are capped), so they're all fetched and
        // ranked by price in the service
        messagesAsAttachment: {
          where: { type: MessageType.INVENTORY_ATTACHMENT },
          orderBy: { createdAt: 'asc' },
          take: 200,
          select: {
            id: true,
            createdAt: true,
            inventoryItem: true,
            sender: { select: personSelect },
          },
        },
        _count: { select: { interests: true, chatThreads: true } },
      },
    });
  }

  // ---------------------------------------------------------------- finance

  async financeTotals(r: TimeRange) {
    const [row] = await this.prisma.$queryRaw<Array<Record<string, number>>>`
      SELECT
        (SELECT coalesce(sum("amount"), 0) FROM "SubscriptionTransaction" WHERE "status" = 'SUCCESS')::float AS "revenueAllTime",
        (SELECT coalesce(sum("amount"), 0) FROM "SubscriptionTransaction" WHERE "status" = 'SUCCESS' AND ${between('"createdAt"', r)})::float AS "revenue",
        (SELECT count(*) FROM "SubscriptionTransaction" WHERE "status" = 'SUCCESS' AND ${between('"createdAt"', r)})::int AS "successful",
        (SELECT count(*) FROM "SubscriptionTransaction" WHERE "status" = 'FAILED' AND ${between('"createdAt"', r)})::int AS "failed",
        (SELECT count(*) FROM "SubscriptionTransaction" WHERE "status" = 'PENDING' AND ${between('"createdAt"', r)})::int AS "pending",
        (SELECT count(DISTINCT "userId") FROM "SubscriptionTransaction" WHERE "status" = 'SUCCESS' AND ${between('"createdAt"', r)})::int AS "payingUsers",
        (SELECT count(*) FROM "Subscription" WHERE "status" = 'active' AND "currentPeriodEnd" > ${NOW})::int AS "activeSubscribers",
        (SELECT count(*) FROM "Subscription" WHERE "status" = 'active' AND "currentPeriodEnd" > ${NOW} AND "cancelAtPeriodEnd")::int AS "cancelingAtPeriodEnd",
        (SELECT count(*) FROM "Subscription" WHERE ${between('"createdAt"', r)})::int AS "newSubscriptions",
        (SELECT count(*) FROM "Subscription" WHERE ${between('"canceledAt"', r)})::int AS "cancellations",
        (SELECT coalesce(sum(CASE "interval" WHEN 'year' THEN "amount" / 12 WHEN 'quarter' THEN "amount" / 3 ELSE "amount" END), 0)
           FROM "Subscription" WHERE "status" = 'active' AND "currentPeriodEnd" > ${NOW})::float AS "mrr"
    `;
    return row;
  }

  async listTransactions(q: TransactionsQueryDto) {
    const where: Prisma.SubscriptionTransactionWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { paystackReference: { contains: q.search } },
              { user: { fullName: containsText(q.search) } },
              { user: { email: containsText(q.search) } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.subscriptionTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...page(q),
        select: {
          ...transactionListSelect,
          user: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.subscriptionTransaction.count({ where }),
    ]);
    return { items, total };
  }

  findTransaction(id: string) {
    return this.prisma.subscriptionTransaction.findUnique({
      where: { id },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        paymentMethod: true,
        description: true,
        metadata: true,
        paystackReference: true,
        paystackTransactionId: true,
        bachsPaymentId: true,
        bachsCheckoutId: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { ...personSelect, phoneNumber: true } },
        subscription: {
          select: {
            id: true,
            plan: true,
            status: true,
            amount: true,
            interval: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
          },
        },
      },
    });
  }

  async listSubscriptions(q: SubscriptionsQueryDto) {
    const where: Prisma.SubscriptionWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { user: { fullName: containsText(q.search) } },
              { user: { email: containsText(q.search) } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...page(q),
        select: {
          id: true,
          plan: true,
          status: true,
          amount: true,
          currency: true,
          interval: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          canceledAt: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              businessName: true,
            },
          },
          _count: { select: { transactions: true } },
        },
      }),
      this.prisma.subscription.count({ where }),
    ]);
    return { items, total };
  }
}
