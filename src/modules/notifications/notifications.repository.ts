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

  async countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
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

  async getUserNotificationSettings(userId: string): Promise<{ fcmToken: string | null; notificationsEnabled: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true, notificationsEnabled: true },
    });
    return {
      fcmToken: user?.fcmToken ?? null,
      notificationsEnabled: user?.notificationsEnabled ?? true,
    };
  }

  async updateNotificationPreferences(userId: string, enabled: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { notificationsEnabled: enabled },
      select: { id: true, notificationsEnabled: true },
    });
  }

  async findVendorsWithMatchingInventory(
    brand: string,
    model: string,
    excludeUserId: string,
    keywords: string[] = [],
  ) {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        userId: { not: excludeUserId },
      },
      select: {
        id: true,
        title: true,
        brand: true,
        model: true,
        userId: true,
        user: {
          select: {
            id: true,
            fcmToken: true,
            fullName: true,
          },
        },
      },
    });

    const matchingVendors = new Map<string, { userId: string; user: { id: string; fcmToken: string | null; fullName: string } }>();
    const targetBrand = (brand || '').toLowerCase().trim();
    const cleanModel = (model || '').toLowerCase().trim();

    for (const item of items) {
      const itemTitle = (item.title || '').toLowerCase();
      const itemBrand = (item.brand || '').toLowerCase();
      const itemModel = (item.model || '').toLowerCase();

      // 1. Brand match check
      const brandMatches =
        targetBrand === 'other' ||
        targetBrand === '' ||
        itemBrand.includes(targetBrand) ||
        targetBrand.includes(itemBrand) ||
        itemTitle.includes(targetBrand);

      if (!brandMatches) continue;

      // 2. Gadget name / model keywords check
      let matchesGadget = false;

      if (keywords.length > 0) {
        // Count how many keywords appear in item title or model
        const matchCount = keywords.filter(
          (kw) => itemTitle.includes(kw) || itemModel.includes(kw),
        ).length;
        const required = Math.max(1, Math.min(2, Math.ceil(keywords.length * 0.4)));
        matchesGadget = matchCount >= required;
      }

      if (!matchesGadget && cleanModel.length > 0) {
        matchesGadget =
          itemTitle.includes(cleanModel) ||
          cleanModel.includes(itemTitle) ||
          itemModel.includes(cleanModel) ||
          cleanModel.includes(itemModel);
      }

      if (matchesGadget) {
        matchingVendors.set(item.userId, {
          userId: item.userId,
          user: item.user,
        });
      }
    }

    return Array.from(matchingVendors.values());
  }
}
