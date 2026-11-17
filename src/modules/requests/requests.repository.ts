import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestStatus } from '@prisma/client';

@Injectable()
export class RequestsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(requesterId: string, title: string) {
    return this.prisma.request.create({
      data: {
        title: title.trim(),
        requesterId,
        status: RequestStatus.ACTIVE,
      },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        requester: {
          select: {
            id: true,
            fullName: true,
            isVerified: true,
            marketId: true,
          },
        },
      },
    });
  }

  /** Everyone else in a market (null: the accounts with no market yet), for live feed updates */
  async findMarketMemberIds(marketId: string | null, excludeUserId: string) {
    const users = await this.prisma.user.findMany({
      where: { marketId, deletedAt: null, id: { not: excludeUserId } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /** Only requests from people in the viewer's own market are listed */
  async findOpenRequests(currentUserId: string, skip = 0, take = 20, search?: string) {
    const [viewer, blocked] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: currentUserId },
        select: { marketId: true },
      }),
      this.prisma.blockedVendor.findMany({
        where: {
          OR: [
            { userId: currentUserId },
            { vendorId: currentUserId },
          ],
        },
        select: { userId: true, vendorId: true },
      }),
    ]);
    const excludedUserIds = new Set<string>([currentUserId]);
    for (const b of blocked) {
      if (b.userId === currentUserId) excludedUserIds.add(b.vendorId);
      if (b.vendorId === currentUserId) excludedUserIds.add(b.userId);
    }

    const whereClause: any = {
      status: RequestStatus.ACTIVE,
      isDeleted: false,
      requesterId: { notIn: Array.from(excludedUserIds) },
      requester: { marketId: viewer?.marketId ?? null },
    };

    if (search && search.trim()) {
      whereClause.title = { contains: search, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      this.prisma.request.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          requester: {
            select: {
              id: true,
              fullName: true,
              isVerified: true,
            },
          },
          interests: {
            where: { vendorId: currentUserId },
            select: { id: true },
          },
        },
      }),
      this.prisma.request.count({ where: whereClause }),
    ]);

    return { items, total };
  }

  async findMyRequests(userId: string, skip = 0, take = 20) {
    const [items, total] = await Promise.all([
      this.prisma.request.findMany({
        where: { requesterId: userId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          title: true,
          status: true,
          chosenVendorId: true,
          fulfilledByVendorId: true,
          fulfilledAt: true,
          createdAt: true,
          fulfilledByVendor: {
            select: {
              id: true,
              fullName: true,
            },
          },
          interests: {
            select: {
              id: true,
              vendor: {
                select: {
                  id: true,
                  fullName: true,
                  isVerified: true,
                },
              },
            },
          },
          chatThreads: {
            select: {
              id: true,
              vendorId: true,
              lastMessageText: true,
              lastMessageAt: true,
              messages: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                  id: true,
                  text: true,
                  createdAt: true,
                  senderId: true,
                },
              },
              _count: {
                select: {
                  messages: {
                    where: {
                      senderId: { not: userId },
                      NOT: {
                        readBy: {
                          has: userId,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.request.count({ where: { requesterId: userId } }),
    ]);

    return { items, total };
  }

  async findById(id: string) {
    return this.prisma.request.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        isDeleted: true,
        requesterId: true,
        chosenVendorId: true,
        fulfilledByVendorId: true,
        fulfilledAt: true,
        createdAt: true,
        requester: {
          select: {
            id: true,
            fullName: true,
            isVerified: true,
            marketId: true,
          },
        },
        fulfilledByVendor: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
    });
  }

  async updateTitle(id: string, requesterId: string, title: string) {
    return this.prisma.request.updateMany({
      where: { id, requesterId },
      data: { title: title.trim() },
    });
  }

  async markFulfilled(
    id: string,
    requesterId: string,
    vendorId: string,
    fulfilledAt: Date,
  ) {
    return this.prisma.request.updateMany({
      where: { id, requesterId },
      data: {
        status: RequestStatus.DONE,
        chosenVendorId: vendorId,
        fulfilledByVendorId: vendorId,
        fulfilledAt,
      },
    });
  }

  async delete(id: string, requesterId: string) {
    return this.prisma.request.updateMany({
      where: { id, requesterId },
      data: { isDeleted: true },
    });
  }

  /** Whether the interest is new; an existing one is left as it was */
  async addInterest(requestId: string, vendorId: string): Promise<boolean> {
    const { count } = await this.prisma.requestInterest.createMany({
      data: [{ requestId, vendorId }],
      skipDuplicates: true,
    });
    return count > 0;
  }

  async getOrCreateChatThread(requestId: string, creatorId: string, vendorId: string) {
    // 1. Check if ANY thread already exists between these two users (either direction)
    const existing = await this.prisma.chatThread.findFirst({
      where: {
        OR: [
          { creatorId, vendorId },
          { creatorId: vendorId, vendorId: creatorId },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        requestId: true,
        creatorId: true,
        vendorId: true,
      },
    });

    if (existing) {
      await this.prisma.chatThread.update({
        where: { id: existing.id },
        data: { requestId, updatedAt: new Date() },
      });
      return {
        ...existing,
        requestId,
      };
    }

    return this.prisma.chatThread.create({
      data: {
        requestId,
        creatorId,
        vendorId,
      },
      select: {
        id: true,
        requestId: true,
        creatorId: true,
        vendorId: true,
      },
    });
  }

  async countUserRequests(requesterId: string): Promise<number> {
    return this.prisma.request.count({
      where: { requesterId },
    });
  }

  async countUserInterests(vendorId: string): Promise<number> {
    return this.prisma.requestInterest.count({
      where: { vendorId },
    });
  }

  async getUserSubscriptionPlan(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionPlan: true },
    });
    return user?.subscriptionPlan || 'Free';
  }

  async getUserMarketId(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { marketId: true },
    });
    return user?.marketId ?? null;
  }
}

