import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    title: string;
    body: string;
    data?: any;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: data.userId,
        title: data.title,
        body: data.body,
        data: data.data ?? {},
      },
      select: {
        id: true,
        title: true,
        body: true,
        isRead: true,
        createdAt: true,
      },
    });
  }

  async findByUserId(userId: string, skip = 0, take = 20) {
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          title: true,
          body: true,
          data: true,
          isRead: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    return { items, total };
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId },
      data: { isRead: true },
    });
  }

  async saveFcmToken(userId: string, fcmToken: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken },
      select: { id: true, fcmToken: true },
    });
  }

  async getUserFcmToken(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });
    return user?.fcmToken ?? null;
  }

  async findVendorsWithMatchingInventory(brand: string, model: string, excludeUserId: string) {
    return this.prisma.inventoryItem.findMany({
      where: {
        userId: { not: excludeUserId },
        OR: [
          {
            AND: [
              { brand: { equals: brand, mode: 'insensitive' } },
              { model: { contains: model, mode: 'insensitive' } },
            ],
          },
          {
            title: { contains: model, mode: 'insensitive' },
          },
        ],
      },
      select: {
        userId: true,
        user: {
          select: {
            id: true,
            fcmToken: true,
            fullName: true,
          },
        },
      },
      distinct: ['userId'],
    });
  }
}
