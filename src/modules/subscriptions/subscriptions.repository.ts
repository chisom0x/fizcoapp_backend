import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateSubscriptionData {
  userId: string;
  bachsSubscriptionId?: string;
  bachsCustomerId?: string;
  bachsProductId?: string;
  paystackSubscriptionCode?: string;
  paystackCustomerCode?: string;
  paystackPlanCode?: string;
  paystackEmailToken?: string;
  plan: string;
  status: string;
  amount: number;
  currency: string;
  interval: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd?: boolean;
}

export interface CreateTransactionData {
  userId: string;
  subscriptionId?: string;
  bachsPaymentId?: string;
  bachsCheckoutId?: string;
  paystackReference?: string;
  paystackTransactionId?: string;
  amount: number;
  currency: string;
  status: string;
  paymentMethod?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class SubscriptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserWithSubscription(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        businessName: true,
        subscriptionPlan: true,
        bachsCustomerId: true,
        paystackCustomerId: true,
        subscription: true,
      },
    });
  }

  async findSubscriptionByUserId(userId: string) {
    return this.prisma.subscription.findUnique({
      where: { userId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
  }

  async findSubscriptionByBachsId(bachsSubscriptionId: string) {
    return this.prisma.subscription.findUnique({
      where: { bachsSubscriptionId },
      include: { user: true },
    });
  }

  async findSubscriptionByPaystackCode(paystackSubscriptionCode: string) {
    return this.prisma.subscription.findUnique({
      where: { paystackSubscriptionCode },
      include: { user: true },
    });
  }

  async upsertSubscription(userId: string, data: CreateSubscriptionData) {
    return this.prisma.subscription.upsert({
      where: { userId },
      update: {
        bachsSubscriptionId: data.bachsSubscriptionId,
        bachsCustomerId: data.bachsCustomerId,
        bachsProductId: data.bachsProductId,
        paystackSubscriptionCode: data.paystackSubscriptionCode,
        paystackCustomerCode: data.paystackCustomerCode,
        paystackPlanCode: data.paystackPlanCode,
        paystackEmailToken: data.paystackEmailToken,
        plan: data.plan,
        status: data.status,
        amount: data.amount,
        currency: data.currency,
        interval: data.interval,
        currentPeriodStart: data.currentPeriodStart,
        currentPeriodEnd: data.currentPeriodEnd,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
      },
      create: {
        userId,
        bachsSubscriptionId: data.bachsSubscriptionId,
        bachsCustomerId: data.bachsCustomerId,
        bachsProductId: data.bachsProductId,
        paystackSubscriptionCode: data.paystackSubscriptionCode,
        paystackCustomerCode: data.paystackCustomerCode,
        paystackPlanCode: data.paystackPlanCode,
        paystackEmailToken: data.paystackEmailToken,
        plan: data.plan,
        status: data.status,
        amount: data.amount,
        currency: data.currency,
        interval: data.interval,
        currentPeriodStart: data.currentPeriodStart,
        currentPeriodEnd: data.currentPeriodEnd,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
      },
    });
  }

  async updateSubscriptionStatus(
    id: string,
    status: string,
    cancelAtPeriodEnd?: boolean,
    canceledAt?: Date,
  ) {
    return this.prisma.subscription.update({
      where: { id },
      data: {
        status,
        ...(cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd } : {}),
        ...(canceledAt !== undefined ? { canceledAt } : {}),
      },
    });
  }

  async markReminderSent(id: string, sentAt: Date) {
    return this.prisma.subscription.update({
      where: { id },
      data: { reminderSentAt: sentAt },
    });
  }

  async findSubscriptionsDueForReminder(thresholdStart: Date, thresholdEnd: Date) {
    return this.prisma.subscription.findMany({
      where: {
        status: 'active',
        currentPeriodEnd: {
          gte: thresholdStart,
          lte: thresholdEnd,
        },
        OR: [
          { reminderSentAt: null },
          { reminderSentAt: { lt: thresholdStart } },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            fcmToken: true,
          },
        },
      },
    });
  }

  async findExpiredSubscriptions(now: Date) {
    return this.prisma.subscription.findMany({
      where: {
        status: 'active',
        currentPeriodEnd: {
          lt: now,
        },
      },
      include: {
        user: true,
      },
    });
  }

  async createTransaction(data: CreateTransactionData) {
    return this.prisma.subscriptionTransaction.create({
      data: {
        userId: data.userId,
        subscriptionId: data.subscriptionId,
        bachsPaymentId: data.bachsPaymentId,
        bachsCheckoutId: data.bachsCheckoutId,
        paystackReference: data.paystackReference,
        paystackTransactionId: data.paystackTransactionId,
        amount: data.amount,
        currency: data.currency,
        status: data.status,
        paymentMethod: data.paymentMethod,
        description: data.description,
        metadata: data.metadata as any,
      },
    });
  }

  async updateTransactionStatus(
    id: string,
    status: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.prisma.subscriptionTransaction.update({
      where: { id },
      data: {
        status,
        ...(metadata ? { metadata: metadata as any } : {}),
      },
    });
  }

  async findUserTransactions(userId: string, skip = 0, take = 20) {
    const [items, total] = await Promise.all([
      this.prisma.subscriptionTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.subscriptionTransaction.count({ where: { userId } }),
    ]);

    return { items, total };
  }

  async updateUserBachsCustomerId(userId: string, bachsCustomerId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { bachsCustomerId },
    });
  }

  async updateUserPaystackCustomerId(userId: string, paystackCustomerId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { paystackCustomerId },
    });
  }

  async updateUserPlan(
    userId: string,
    plan: string,
    options?: { bachsCustomerId?: string; paystackCustomerId?: string },
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionPlan: plan,
        ...(options?.bachsCustomerId ? { bachsCustomerId: options.bachsCustomerId } : {}),
        ...(options?.paystackCustomerId ? { paystackCustomerId: options.paystackCustomerId } : {}),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        subscriptionPlan: true,
        bachsCustomerId: true,
        paystackCustomerId: true,
      },
    });
  }
}
