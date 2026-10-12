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
          },
        },
      },
    });
  }

  async findOpenRequests(currentUserId: string, skip = 0, take = 20, search?: string) {
    const whereClause: any = {
      status: RequestStatus.ACTIVE,
      requesterId: { not: currentUserId },
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
        where: { requesterId: userId },
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
    return this.prisma.request.deleteMany({
      where: { id, requesterId },
    });
  }

  async addInterest(requestId: string, vendorId: string) {
    return this.prisma.requestInterest.upsert({
      where: {
        requestId_vendorId: {
          requestId,
          vendorId,
        },
      },
      update: {},
      create: {
        requestId,
        vendorId,
      },
    });
  }

  async getOrCreateChatThread(requestId: string, creatorId: string, vendorId: string) {
    const existing = await this.prisma.chatThread.findUnique({
      where: {
        requestId_vendorId: {
          requestId,
          vendorId,
        },
      },
      select: {
        id: true,
        requestId: true,
        creatorId: true,
        vendorId: true,
      },
    });

    if (existing) return existing;

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
}
