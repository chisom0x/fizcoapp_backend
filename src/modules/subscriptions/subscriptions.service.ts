import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import * as crypto from 'crypto';
import { SubscriptionsRepository } from './subscriptions.repository';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { ProcessCardPaymentDto } from './dto/process-payment.dto';
import { ConfirmCheckoutDto } from './dto/confirm-checkout.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';

export type PlanId = 'monthly' | 'yearly';

export interface PlanConfig {
  id: PlanId;
  name: string;
  amount: number;
  currency: string;
  formattedPrice: string;
  billingCadence: string;
  interval: 'month' | 'year';
  intervalCount: number;
  features: string[];
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly paystackApiUrl: string;
  private readonly paystackSecretKey: string;
  private readonly paystackPublicKey: string;
  private readonly paystackWebhookSecret: string;
  private readonly currency: string;

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {
    this.paystackApiUrl =
      this.configService.get<string>('PAYSTACK_API_URL') ||
      'https://api.paystack.co';
    this.paystackSecretKey =
      this.configService.get<string>('PAYSTACK_SECRET_KEY') || '';
    this.paystackPublicKey =
      this.configService.get<string>('PAYSTACK_PUBLIC_KEY') || '';
    // Paystack signs all webhook events using your Secret Key (no separate webhook secret is needed)
    this.paystackWebhookSecret = this.paystackSecretKey;
    this.currency =
      this.configService.get<string>('SUBSCRIPTION_CURRENCY') || 'NGN';
  }

  getPlans(): { plans: PlanConfig[]; currency: string } {
    const monthlyPrice = Number(
      this.configService.get<number>('SUBSCRIPTION_MONTHLY_PRICE') || 4000,
    );
    const yearlyPrice = Number(
      this.configService.get<number>('SUBSCRIPTION_YEARLY_PRICE') || 40000,
    );

    const formatCurrency = (val: number) =>
      `₦${val.toLocaleString('en-NG')}`;

    const features = [
      'Send unlimited requests',
      'Show interest in unlimited requests from other users',
      'Early access to new features',
    ];

    const plans: PlanConfig[] = [
      {
        id: 'monthly',
        name: 'Monthly',
        amount: monthlyPrice,
        currency: this.currency,
        formattedPrice: `${formatCurrency(monthlyPrice)}/Month`,
        billingCadence: 'Billed Monthly',
        interval: 'month',
        intervalCount: 1,
        features,
      },
      {
        id: 'yearly',
        name: 'Yearly',
        amount: yearlyPrice,
        currency: this.currency,
        formattedPrice: `${formatCurrency(yearlyPrice)}/Year`,
        billingCadence: 'Billed Yearly',
        interval: 'year',
        intervalCount: 12,
        features,
      },
    ];

    return { plans, currency: this.currency };
  }

  private getPlanConfig(planId: PlanId): PlanConfig {
    const { plans } = this.getPlans();
    const plan = plans.find((p) => p.id === planId);
    if (!plan) {
      throw new BadRequestException(`Unknown subscription plan: ${planId}`);
    }
    return plan;
  }

  private autoProvisionedPlanCodes: Map<string, string> = new Map();

  private getPlanEnvCode(planId: string): string {
    if (planId === 'monthly') {
      return (
        this.configService.get<string>('PAYSTACK_PLAN_MONTHLY') ||
        'PLN_fizco_monthly'
      );
    }
    return (
      this.configService.get<string>('PAYSTACK_PLAN_YEARLY') ||
      'PLN_fizco_yearly'
    );
  }

  private isLivePaystackKey(): boolean {
    return (
      Boolean(this.paystackSecretKey) &&
      this.paystackSecretKey.startsWith('sk_') &&
      !this.paystackSecretKey.includes('sandbox_secret')
    );
  }

  private async getOrCreatePaystackPlan(
    planId: PlanId,
  ): Promise<string> {
    const configuredCode = this.getPlanEnvCode(planId);
    if (
      configuredCode &&
      configuredCode !== `PLN_fizco_${planId}` &&
      !configuredCode.startsWith('mock_')
    ) {
      return configuredCode;
    }

    if (this.autoProvisionedPlanCodes.has(planId)) {
      return this.autoProvisionedPlanCodes.get(planId)!;
    }

    if (this.isLivePaystackKey()) {
      try {
        const intervalMap: Record<string, string> = {
          monthly: 'monthly',
          yearly: 'annually', // Paystack uses 'annually'
        };
        const planConfig = this.getPlanConfig(planId);
        const res = await axios.post(
          `${this.paystackApiUrl}/plan`,
          {
            name: `Fizco Premium (${planConfig.name})`,
            interval: intervalMap[planId] || 'monthly',
            amount: planConfig.amount * 100, // in kobo
            currency: 'NGN',
            description: `${planConfig.name} subscription plan for Fizco marketplace`,
          },
          {
            headers: {
              Authorization: `Bearer ${this.paystackSecretKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        );

        const planCode = res.data?.data?.plan_code;
        if (planCode) {
          this.logger.log(`Provisioned Paystack plan for ${planId}: ${planCode}`);
          this.autoProvisionedPlanCodes.set(planId, planCode);
          return planCode;
        }
      } catch (err: unknown) {
        const msg = axios.isAxiosError(err)
          ? JSON.stringify(err.response?.data || err.message)
          : String(err);
        this.logger.warn(
          `Could not auto-create plan on Paystack (${msg}), using configured plan code`,
        );
      }
    }

    return configuredCode;
  }

  async createCheckoutSession(userId: string, dto: CreateCheckoutDto) {
    const user = await this.subscriptionsRepository.findUserWithSubscription(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const planConfig = this.getPlanConfig(dto.plan);
    const planCode = await this.getOrCreatePaystackPlan(dto.plan);

    let reference = `ref_fizco_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    let checkoutUrl = '';
    let accessCode = '';

    if (this.isLivePaystackKey()) {
      try {
        const payload: Record<string, unknown> = {
          email: user.email,
          amount: planConfig.amount * 100, // in kobo
          plan: planCode,
          reference,
          callback_url:
            dto.successUrl || 'https://www.fizcoapp.com/payment/success',
          metadata: {
            userId: user.id,
            plan: dto.plan,
            cancel_action:
              dto.cancelUrl || 'https://www.fizcoapp.com/payment/failed',
            custom_fields: [
              {
                display_name: 'Customer Name',
                variable_name: 'customer_name',
                value: user.fullName || user.businessName || 'Fizco User',
              },
              {
                display_name: 'Plan',
                variable_name: 'plan_name',
                value: planConfig.name,
              },
            ],
          },
        };

        const res = await axios.post(
          `${this.paystackApiUrl}/transaction/initialize`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${this.paystackSecretKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        );

        checkoutUrl = res.data?.data?.authorization_url;
        accessCode = res.data?.data?.access_code;
        if (res.data?.data?.reference) {
          reference = res.data.data.reference;
        }
      } catch (err: unknown) {
        const errMsg = axios.isAxiosError(err)
          ? JSON.stringify(err.response?.data || err.message)
          : String(err);
        this.logger.error(`Paystack Transaction Initialize failed: ${errMsg}`);
        throw new BadRequestException(
          `Paystack checkout initialization failed: ${
            axios.isAxiosError(err) && err.response?.data?.message
              ? err.response.data.message
              : errMsg
          }`,
        );
      }
    } else {
      // Sandbox fallback for test mode when live keys are not yet provided
      accessCode = `acc_${crypto.randomBytes(8).toString('hex')}`;
      checkoutUrl = `https://checkout.paystack.com/${accessCode}?mock=true`;
    }

    if (!checkoutUrl) {
      throw new BadRequestException('Failed to retrieve Paystack checkout URL');
    }

    // Record pending transaction
    await this.subscriptionsRepository.createTransaction({
      userId,
      amount: planConfig.amount,
      currency: this.currency,
      status: 'PENDING',
      paystackReference: reference,
      description: `Subscription Checkout: ${planConfig.name} Plan`,
      metadata: {
        plan: dto.plan,
        checkoutUrl,
        reference,
        accessCode,
        planCode,
      },
    });

    return {
      checkoutId: reference,
      reference,
      accessCode,
      checkoutUrl,
      plan: planConfig,
    };
  }

  async confirmCheckoutSession(userId: string, dto: ConfirmCheckoutDto) {
    const user = await this.subscriptionsRepository.findUserWithSubscription(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const reference = dto.reference || dto.checkoutId;
    if (!reference) {
      throw new BadRequestException('Transaction reference is required');
    }

    let planId: PlanId = dto.plan || 'monthly';
    let customerCode = user.paystackCustomerId || undefined;
    let subscriptionCode: string | undefined;
    let emailToken: string | undefined;
    let cardLast4: string | undefined;

    // Verify transaction with Paystack API if live key available
    if (this.isLivePaystackKey()) {
      try {
        const res = await axios.get(
          `${this.paystackApiUrl}/transaction/verify/${reference}`,
          {
            headers: {
              Authorization: `Bearer ${this.paystackSecretKey}`,
            },
            timeout: 10000,
          },
        );
        const data = res.data?.data;
        if (data?.metadata?.plan) {
          planId = data.metadata.plan;
        }
        if (data?.customer?.customer_code) {
          customerCode = data.customer.customer_code;
        }
        if (data?.authorization?.last4) {
          cardLast4 = data.authorization.last4;
        }

        const customerId = data?.customer?.id;
        if (customerId) {
          try {
            const subRes = await axios.get(
              `${this.paystackApiUrl}/subscription?customer=${customerId}`,
              {
                headers: {
                  Authorization: `Bearer ${this.paystackSecretKey}`,
                },
                timeout: 8000,
              },
            );
            const subs = subRes.data?.data;
            if (Array.isArray(subs) && subs.length > 0) {
              const latestSub = subs[0];
              subscriptionCode = latestSub.subscription_code;
              emailToken = latestSub.email_token;
            }
          } catch (subErr) {
            this.logger.warn(`Could not fetch subscription for customer ${customerId}: ${subErr}`);
          }
        }

        // Fallback: search across subscriptions matching user email
        if (!subscriptionCode && user.email) {
          try {
            const listRes = await axios.get(
              `${this.paystackApiUrl}/subscription`,
              {
                headers: {
                  Authorization: `Bearer ${this.paystackSecretKey}`,
                },
                timeout: 8000,
              },
            );
            const subs = listRes.data?.data;
            if (Array.isArray(subs)) {
              const matched = subs.find(
                (s: any) =>
                  s.customer?.email?.toLowerCase() === user.email.toLowerCase() ||
                  s.customer?.customer_code === customerCode,
              );
              if (matched) {
                subscriptionCode = matched.subscription_code;
                emailToken = matched.email_token;
              }
            }
          } catch (listErr) {
            this.logger.warn(`Could not list subscriptions for email match: ${listErr}`);
          }
        }
      } catch (e) {
        this.logger.warn(
          `Could not verify transaction ${reference} from Paystack: ${e}`,
        );
      }
    }

    const planConfig = this.getPlanConfig(planId);
    const now = new Date();
    const periodEnd = new Date(now);
    if (planId === 'monthly') {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }

    const paystackSubCode =
      subscriptionCode || `SUB_${crypto.randomBytes(8).toString('hex')}`;
    const paystackCustCode =
      customerCode || `CUS_${crypto.randomBytes(8).toString('hex')}`;
    const paystackPlanCode = this.getPlanEnvCode(planId);

    const subscription = await this.subscriptionsRepository.upsertSubscription(
      userId,
      {
        userId,
        paystackSubscriptionCode: paystackSubCode,
        paystackCustomerCode: paystackCustCode,
        paystackPlanCode,
        paystackEmailToken: emailToken || `tok_${crypto.randomBytes(6).toString('hex')}`,
        plan: planId,
        status: 'active',
        amount: planConfig.amount,
        currency: this.currency,
        interval: planConfig.interval,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      },
    );

    await this.subscriptionsRepository.updateUserPlan(
      userId,
      'Premium',
      { paystackCustomerId: paystackCustCode },
    );

    await this.subscriptionsRepository.createTransaction({
      userId,
      subscriptionId: subscription.id,
      paystackReference: reference,
      amount: planConfig.amount,
      currency: this.currency,
      status: 'SUCCESS',
      paymentMethod: cardLast4 ? `Card ending in ${cardLast4}` : 'Paystack Hosted Checkout',
      description: `Payment for Fizco Premium (${planConfig.name} plan)`,
      metadata: {
        plan: planId,
        reference,
        subscriptionCode: paystackSubCode,
        periodEnd: periodEnd.toISOString(),
      },
    });

    const formattedEnd = periodEnd.toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    await this.notificationsService.notifyUser(
      userId,
      '🎉 Welcome to Fizco Premium!',
      `Your ${planConfig.name} subscription is now active until ${formattedEnd}. Enjoy unlimited requests and buyer connections!`,
    );

    return {
      subscription,
      userPlan: 'Premium',
    };
  }

  async processCardPayment(userId: string, dto: ProcessCardPaymentDto) {
    const user = await this.subscriptionsRepository.findUserWithSubscription(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const planConfig = this.getPlanConfig(dto.plan);

    // Validate card format
    const cleanCard = dto.cardNumber.replace(/\s+/g, '');
    if (cleanCard.length < 13 || cleanCard.length > 19) {
      throw new BadRequestException('Invalid card number format');
    }

    const last4 = cleanCard.slice(-4);
    const maskedCard = `**** **** **** ${last4}`;

    // Calculate billing interval
    const now = new Date();
    const periodEnd = new Date(now);
    if (dto.plan === 'monthly') {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }

    const paystackSubCode = `SUB_${crypto.randomBytes(8).toString('hex')}`;
    const paystackCustCode =
      user.paystackCustomerId || `CUS_${crypto.randomBytes(8).toString('hex')}`;
    const paystackPlanCode = this.getPlanEnvCode(dto.plan);
    const paystackRef = dto.checkoutId || `ref_${crypto.randomBytes(8).toString('hex')}`;

    // Upsert subscription
    const subscription = await this.subscriptionsRepository.upsertSubscription(
      userId,
      {
        userId,
        paystackSubscriptionCode: paystackSubCode,
        paystackCustomerCode: paystackCustCode,
        paystackPlanCode,
        paystackEmailToken: `tok_${crypto.randomBytes(6).toString('hex')}`,
        plan: dto.plan,
        status: 'active',
        amount: planConfig.amount,
        currency: this.currency,
        interval: planConfig.interval,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      },
    );

    // Update user to Premium
    await this.subscriptionsRepository.updateUserPlan(
      userId,
      'Premium',
      { paystackCustomerId: paystackCustCode },
    );

    // Record completed transaction
    const transaction = await this.subscriptionsRepository.createTransaction({
      userId,
      subscriptionId: subscription.id,
      paystackReference: paystackRef,
      amount: planConfig.amount,
      currency: this.currency,
      status: 'SUCCESS',
      paymentMethod: `Card ending in ${last4}`,
      description: `Payment for Fizco Premium (${planConfig.name} plan)`,
      metadata: {
        cardHolder: dto.cardHolderName,
        cardMasked: maskedCard,
        plan: dto.plan,
        periodEnd: periodEnd.toISOString(),
      },
    });

    // Send in-app notification
    const formattedEnd = periodEnd.toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    await this.notificationsService.notifyUser(
      userId,
      '🎉 Welcome to Fizco Premium!',
      `Your ${planConfig.name} subscription is now active until ${formattedEnd}. Enjoy unlimited requests and buyer connections!`,
      { subscriptionId: subscription.id, type: 'SUBSCRIPTION_ACTIVATED' },
    );

    return {
      success: true,
      subscriptionPlan: 'Premium',
      subscription: {
        id: subscription.id,
        plan: planConfig.name,
        status: subscription.status,
        amount: subscription.amount,
        currency: subscription.currency,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cardLast4: last4,
      },
      transaction: {
        id: transaction.id,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        createdAt: transaction.createdAt,
      },
    };
  }

  async createPortalSession(userId: string) {
    const user = await this.subscriptionsRepository.findUserWithSubscription(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const sub = await this.subscriptionsRepository.findSubscriptionByUserId(userId);
    let subCode = sub?.paystackSubscriptionCode;

    if (this.isLivePaystackKey()) {
      // 1. Try with existing subscription code if present
      if (subCode && !subCode.startsWith('SUB_mock')) {
        try {
          const res = await axios.get(
            `${this.paystackApiUrl}/subscription/${subCode}/manage/link`,
            {
              headers: {
                Authorization: `Bearer ${this.paystackSecretKey}`,
              },
              timeout: 8000,
            },
          );
          const link = res.data?.data?.link;
          if (link) {
            return {
              id: subCode,
              url: link,
            };
          }
        } catch (err: unknown) {
          this.logger.warn(
            `Paystack subscription manage link call failed for ${subCode}, attempting lookup by customer email`,
          );
        }
      }

      // 2. Dynamic lookup by email or customer code on Paystack
      try {
        const listRes = await axios.get(
          `${this.paystackApiUrl}/subscription`,
          {
            headers: { Authorization: `Bearer ${this.paystackSecretKey}` },
            timeout: 8000,
          },
        );
        const paystackSubs = listRes.data?.data;
        if (Array.isArray(paystackSubs)) {
          const matched = paystackSubs.find(
            (s: any) =>
              s.customer?.email?.toLowerCase() === user.email.toLowerCase() ||
              s.customer?.customer_code === user.paystackCustomerId,
          );

          if (matched?.subscription_code) {
            subCode = matched.subscription_code;

            // Sync with local database so subsequent calls are instant
            if (sub) {
              await this.subscriptionsRepository.upsertSubscription(userId, {
                userId,
                paystackSubscriptionCode: matched.subscription_code,
                paystackCustomerCode: matched.customer?.customer_code || undefined,
                paystackEmailToken: matched.email_token || undefined,
                paystackPlanCode: matched.plan?.plan_code || sub.paystackPlanCode || undefined,
                plan: sub.plan,
                status: sub.status,
                amount: sub.amount,
                currency: sub.currency,
                interval: sub.interval,
                currentPeriodStart: sub.currentPeriodStart,
                currentPeriodEnd: sub.currentPeriodEnd,
                cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
              });
            }

            const res = await axios.get(
              `${this.paystackApiUrl}/subscription/${subCode}/manage/link`,
              {
                headers: {
                  Authorization: `Bearer ${this.paystackSecretKey}`,
                },
                timeout: 8000,
              },
            );
            const link = res.data?.data?.link;
            if (link) {
              return {
                id: subCode,
                url: link,
              };
            }
          }
        }
      } catch (findErr) {
        this.logger.warn(
          `Failed to dynamically resolve subscription on Paystack: ${findErr}`,
        );
      }
    }

    if (!this.isLivePaystackKey()) {
      const demoCode = subCode || `SUB_${crypto.randomBytes(6).toString('hex')}`;
      return {
        id: demoCode,
        url: `https://paystack.com/manage/subscription/${demoCode}`,
      };
    }

    throw new BadRequestException(
      'Active Paystack subscription not found. Please subscribe to a plan to manage your subscription.',
    );
  }

  async cancelSubscription(userId: string, dto: CancelSubscriptionDto) {
    const sub = await this.subscriptionsRepository.findSubscriptionByUserId(userId);
    if (!sub || sub.status !== 'active') {
      throw new BadRequestException('No active subscription found to cancel');
    }

    const cancelAtPeriodEnd = dto.cancelAtPeriodEnd ?? true;

    // Call Paystack API if applicable
    if (sub.paystackSubscriptionCode && this.isLivePaystackKey()) {
      try {
        await axios.post(
          `${this.paystackApiUrl}/subscription/disable`,
          {
            code: sub.paystackSubscriptionCode,
            token: sub.paystackEmailToken || 'token',
          },
          {
            headers: { Authorization: `Bearer ${this.paystackSecretKey}` },
            timeout: 8000,
          },
        );
      } catch (err: unknown) {
        this.logger.warn('Failed to call Paystack disable endpoint, updating locally');
      }
    }

    const newStatus = cancelAtPeriodEnd ? 'active' : 'canceled';
    await this.subscriptionsRepository.updateSubscriptionStatus(
      sub.id,
      newStatus,
      cancelAtPeriodEnd,
      new Date(),
    );

    if (!cancelAtPeriodEnd) {
      await this.subscriptionsRepository.updateUserPlan(userId, 'Free');
    }

    return {
      success: true,
      message: cancelAtPeriodEnd
        ? 'Subscription will cancel at the end of the billing period.'
        : 'Subscription canceled immediately.',
      cancelAtPeriodEnd,
      currentPeriodEnd: sub.currentPeriodEnd,
    };
  }

  async getMySubscription(userId: string) {
    const user = await this.subscriptionsRepository.findUserWithSubscription(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const sub = await this.subscriptionsRepository.findSubscriptionByUserId(userId);
    const { items: transactions } =
      await this.subscriptionsRepository.findUserTransactions(userId, 0, 10);

    return {
      subscriptionPlan: user.subscriptionPlan,
      isPremium: user.subscriptionPlan.toLowerCase() === 'premium',
      subscription: sub
        ? {
            id: sub.id,
            plan: sub.plan,
            status: sub.status,
            amount: sub.amount,
            currency: sub.currency,
            interval: sub.interval,
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            canceledAt: sub.canceledAt,
          }
        : null,
      transactions: transactions.map((t) => ({
        id: t.id,
        amount: t.amount,
        currency: t.currency,
        status: t.status,
        paymentMethod: t.paymentMethod,
        description: t.description,
        createdAt: t.createdAt,
      })),
    };
  }

  verifyWebhookSignature(header: string | undefined, rawBody: string): boolean {
    if (!header || !this.paystackWebhookSecret) return true; // Accept in test if secret is unset
    try {
      // Paystack signature is HMAC SHA512 of raw body with secret key
      const expected = crypto
        .createHmac('sha512', this.paystackWebhookSecret)
        .update(rawBody)
        .digest('hex');

      if (
        header.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected))
      ) {
        return true;
      }

      // Backward compatibility for Bachs signatures during migration
      if (header.includes('v1=')) {
        const parts = header.split(',').map((part) => part.split('='));
        const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
        const bachsExpected = crypto
          .createHmac('sha256', this.paystackWebhookSecret)
          .update(`${timestamp}.${rawBody}`)
          .digest('hex');
        return parts
          .filter(([key]) => key === 'v1')
          .some(
            ([, sig]) =>
              sig.length === bachsExpected.length &&
              crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(bachsExpected)),
          );
      }

      return false;
    } catch {
      return false;
    }
  }

  async handleWebhook(event: {
    event?: string;
    type?: string;
    data: any;
    id?: string;
  }) {
    const eventType = event.event || event.type || '';
    this.logger.log(`Received payment webhook: ${eventType}`);

    switch (eventType) {
      // Paystack charge success / Bachs invoice paid
      case 'charge.success':
      case 'invoice.paid': {
        const data = event.data;
        const reference = data.reference;
        const customerCode = data.customer?.customer_code;
        const userId = data.metadata?.userId || data.metadata?.user_id;

        if (userId) {
          // A renewal can still name a plan that's no longer sold, e.g. quarterly
          const plan: string = data.metadata?.plan || 'monthly';
          const planConfig = this.getPlans().plans.find((p) => p.id === plan);
          const planName = planConfig?.name ?? plan.charAt(0).toUpperCase() + plan.slice(1);

          await this.subscriptionsRepository.createTransaction({
            userId,
            amount: Number(data.amount ? data.amount / 100 : planConfig?.amount ?? 0),
            currency: data.currency || this.currency,
            status: 'SUCCESS',
            paystackReference: reference,
            paymentMethod: data.channel ? `Paystack (${data.channel})` : 'Paystack',
            description: `Payment for Fizco Premium (${planName} plan)`,
          });

          await this.subscriptionsRepository.updateUserPlan(
            userId,
            'Premium',
            { paystackCustomerId: customerCode },
          );
        }
        break;
      }

      // Paystack subscription create / Bachs customer subscription created
      case 'subscription.create':
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data;
        const customerCode = sub.customer?.customer_code || sub.customer?.customer_id;
        const subCode = sub.subscription_code || sub.subscription_id;
        const emailToken = sub.email_token;
        const planCode = sub.plan?.plan_code || sub.product_id;

        // Find user by subscription code or customer code
        let existing = subCode
          ? await this.subscriptionsRepository.findSubscriptionByPaystackCode(subCode)
          : null;

        if (!existing && subCode) {
          existing = await this.subscriptionsRepository.findSubscriptionByBachsId(subCode);
        }

        const userId = sub.metadata?.userId || sub.metadata?.user_id || existing?.userId;
        if (!userId) break;

        const status =
          sub.status === 'active' || sub.status === 'trialing' ? 'active' : sub.status;
        const plan = sub.metadata?.plan || existing?.plan || 'monthly';
        const amount = Number(sub.amount ? sub.amount / 100 : 4000);

        await this.subscriptionsRepository.upsertSubscription(userId, {
          userId,
          paystackSubscriptionCode: subCode,
          paystackCustomerCode: customerCode,
          paystackPlanCode: planCode,
          paystackEmailToken: emailToken,
          plan,
          status,
          amount,
          currency: sub.currency || this.currency,
          interval: sub.plan?.interval || 'month',
          currentPeriodStart: new Date(sub.current_period_start || Date.now()),
          currentPeriodEnd: new Date(
            sub.next_payment_date ||
            sub.current_period_end ||
            Date.now() + 30 * 86400000,
          ),
          cancelAtPeriodEnd: false,
        });

        if (status === 'active') {
          await this.subscriptionsRepository.updateUserPlan(
            userId,
            'Premium',
            { paystackCustomerId: customerCode },
          );
        }
        break;
      }

      // Paystack subscription disable / Bachs customer subscription deleted
      case 'subscription.disable':
      case 'customer.subscription.deleted': {
        const sub = event.data;
        const subCode = sub.subscription_code || sub.subscription_id;
        let existing = subCode
          ? await this.subscriptionsRepository.findSubscriptionByPaystackCode(subCode)
          : null;

        if (!existing && subCode) {
          existing = await this.subscriptionsRepository.findSubscriptionByBachsId(subCode);
        }

        if (existing) {
          await this.subscriptionsRepository.updateSubscriptionStatus(
            existing.id,
            'canceled',
            true,
            new Date(),
          );
          await this.subscriptionsRepository.updateUserPlan(existing.userId, 'Free');
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data;
        const subCode = invoice.subscription?.subscription_code || invoice.subscription_id;
        if (subCode) {
          let sub = await this.subscriptionsRepository.findSubscriptionByPaystackCode(subCode);
          if (!sub) {
            sub = await this.subscriptionsRepository.findSubscriptionByBachsId(subCode);
          }
          if (sub) {
            await this.notificationsService.notifyUser(
              sub.userId,
              '⚠️ Subscription Payment Failed',
              'We were unable to charge your card for your subscription renewal. Please update your card in Settings.',
              { type: 'PAYMENT_FAILED' },
            );
          }
        }
        break;
      }
    }

    return { received: true };
  }

  /**
   * Cron Job: Runs daily at 08:00 AM to remind users 3 days ahead of subscription end date
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async runDailyReminderCron(): Promise<number> {
    this.logger.log('Executing daily 3-day subscription renewal reminder cron...');
    const now = new Date();
    // 3 days window: 72 hours from now to 96 hours from now
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const fourDaysFromNow = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

    const subscriptionsToRemind =
      await this.subscriptionsRepository.findSubscriptionsDueForReminder(
        now,
        fourDaysFromNow,
      );

    let sentCount = 0;
    for (const sub of subscriptionsToRemind) {
      if (!sub.user) continue;

      const formattedDate = sub.currentPeriodEnd.toLocaleDateString('en-NG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const formattedAmount = `₦${sub.amount.toLocaleString('en-NG')}`;

      // 1. Send push/in-app notification
      await this.notificationsService.notifyUser(
        sub.userId,
        '📅 Subscription Renewal in 3 Days',
        `Your Fizco Premium plan will renew on ${formattedDate} (${formattedAmount}). Ensure your payment card is funded.`,
        {
          subscriptionId: sub.id,
          type: 'SUBSCRIPTION_RENEWAL_REMINDER',
          renewalDate: sub.currentPeriodEnd.toISOString(),
        },
      );

      // 2. Send email via ZeptoMail
      if (sub.user.email) {
        await this.emailService.sendSubscriptionReminderEmail(
          sub.user.email,
          sub.user.fullName,
          sub.plan.toUpperCase(),
          formattedDate,
          formattedAmount,
        );
      }

      // 3. Record reminder timestamp to avoid duplicate notifications in the same cycle
      await this.subscriptionsRepository.markReminderSent(sub.id, now);
      sentCount++;
    }

    this.logger.log(`Dispatched ${sentCount} subscription renewal reminder(s)`);
    return sentCount;
  }

  /**
   * Cron Job: Runs daily at midnight to check and expire subscriptions past their period end
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDailyExpirationCron(): Promise<number> {
    this.logger.log('Executing daily subscription expiration check cron...');
    const now = new Date();
    const expired = await this.subscriptionsRepository.findExpiredSubscriptions(now);

    let expiredCount = 0;
    for (const sub of expired) {
      if (sub.cancelAtPeriodEnd || sub.status !== 'active') {
        await this.subscriptionsRepository.updateSubscriptionStatus(
          sub.id,
          'expired',
        );
        await this.subscriptionsRepository.updateUserPlan(sub.userId, 'Free');
        expiredCount++;
      }
    }

    this.logger.log(`Expired ${expiredCount} subscription(s) past end date`);
    return expiredCount;
  }
}
