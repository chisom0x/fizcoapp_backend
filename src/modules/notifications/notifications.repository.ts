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
    // A device belongs to whoever signed in on it last, so earlier accounts stop receiving its pushes
    const [, user] = await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { fcmToken, id: { not: userId } },
        data: { fcmToken: null },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { fcmToken },
        select: { id: true, fcmToken: true },
      }),
    ]);
    return user;
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

  /** Whether two users are in the same market; two users with no market count as the same */
  async inSameMarket(userId: string, otherUserId: string): Promise<boolean> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [userId, otherUserId] } },
      select: { marketId: true },
    });
    if (users.length < 2) return userId === otherUserId;
    return users[0].marketId === users[1].marketId;
  }

  async updateNotificationPreferences(userId: string, enabled: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { notificationsEnabled: enabled },
      select: { id: true, notificationsEnabled: true },
    });
  }

  /**
   * A vendor matches when one of their inventory items contains every keyword of at
   * least one phrasing of the request, compared as whole tokens of the item's
   * title, model and brand. Vendors in a block relationship with the requester are
   * skipped, mirroring the open-requests feed. Each vendor comes back once, with their
   * cheapest matching item (priced items before unpriced ones). Only vendors in the
   * requester's market (null: those with no market yet) are considered.
   */
  async findVendorsWithMatchingInventory(
    brand: string,
    excludeUserId: string,
    marketId: string | null,
    keywordSets: string[][],
  ) {
    const phrasings = keywordSets.filter((set) => set.length > 0);
    if (phrasings.length === 0) return [];

    const items = await this.prisma.inventoryItem.findMany({
      where: {
        userId: { not: excludeUserId },
        user: {
          marketId,
          blocksReceived: { none: { userId: excludeUserId } },
          blocksInitiated: { none: { vendorId: excludeUserId } },
        },
      },
      select: {
        id: true,
        title: true,
        description: true,
        rawInput: true,
        imageUrls: true,
        price: true,
        brand: true,
        model: true,
        userId: true,
        user: {
          select: {
            id: true,
            fcmToken: true,
            fullName: true,
            subscriptionPlan: true,
          },
        },
      },
    });

    type Item = (typeof items)[number];
    const matchingVendors = new Map<string, { userId: string; user: Item['user']; item: Omit<Item, 'user'> }>();
    const priceOf = (item: { price: number | null }) => item.price ?? Infinity;
    const targetBrand = (brand || '').toLowerCase().trim();
    const unknownBrands = new Set(['', 'other', 'unknown']);

    for (const item of items) {
      // The AI rewrites titles ("MTN WiFi 4G" -> "MTN 4G Wi-Fi Router"), so the vendor's own
      // words count as much as the parsed fields
      const itemText = `${item.title} ${item.rawInput} ${item.model ?? ''} ${item.brand ?? ''}`.toLowerCase();
      const itemBrand = (item.brand || '').toLowerCase().trim();

      // 1. Brand gate: only applies when both sides have a known brand
      const brandMatches =
        unknownBrands.has(targetBrand) ||
        unknownBrands.has(itemBrand) ||
        itemBrand.includes(targetBrand) ||
        targetBrand.includes(itemBrand) ||
        itemText.includes(targetBrand);

      if (!brandMatches) continue;

      // 2. Gadget check: every keyword of some phrasing must be a whole token of the item
      // Adjacent pairs are joined too, so "Wi-Fi" / "Wi Fi" also yield "wifi" and "PS 5" yields "ps5"
      const words = itemText.split(/[^a-z0-9]+/).filter(Boolean);
      const itemTokens = new Set(words);
      for (let i = 1; i < words.length; i++) itemTokens.add(words[i - 1] + words[i]);
      const matchesGadget = phrasings.some((set) =>
        set.every((kw) => itemTokens.has(kw)),
      );

      const current = matchingVendors.get(item.userId);
      if (matchesGadget && (!current || priceOf(item) < priceOf(current.item))) {
        const { user, ...offered } = item;
        matchingVendors.set(item.userId, { userId: item.userId, user, item: offered });
      }
    }

    return Array.from(matchingVendors.values());
  }
}
