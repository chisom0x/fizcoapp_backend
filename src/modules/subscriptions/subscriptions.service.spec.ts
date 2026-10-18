import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let subscriptionsRepository: jest.Mocked<Partial<SubscriptionsRepository>>;
  let notificationsService: jest.Mocked<Partial<NotificationsService>>;
  let emailService: jest.Mocked<Partial<EmailService>>;
  let configService: jest.Mocked<Partial<ConfigService>>;

  beforeEach(async () => {
    subscriptionsRepository = {
      findUserWithSubscription: jest.fn().mockResolvedValue({
        id: 'usr_1',
        email: 'trader@fizco.app',
        fullName: 'Kelvin Trader',
        subscriptionPlan: 'Free',
        paystackCustomerId: 'CUS_123',
      }),
      findSubscriptionByUserId: jest.fn().mockResolvedValue({
        id: 'sub_1',
        userId: 'usr_1',
        paystackSubscriptionCode: 'SUB_123',
        paystackCustomerCode: 'CUS_123',
        paystackPlanCode: 'PLN_fizco_monthly',
        paystackEmailToken: 'tok_123',
        plan: 'monthly',
        status: 'active',
        amount: 5000,
        currency: 'NGN',
        interval: 'month',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        cancelAtPeriodEnd: false,
      }),
      findSubscriptionByBachsId: jest.fn().mockResolvedValue({
        id: 'sub_1',
        userId: 'usr_1',
        plan: 'monthly',
        status: 'active',
        amount: 5000,
        currency: 'NGN',
      }),
      findSubscriptionByPaystackCode: jest.fn().mockResolvedValue({
        id: 'sub_1',
        userId: 'usr_1',
        plan: 'monthly',
        status: 'active',
        amount: 5000,
        currency: 'NGN',
      }),
      findSubscriptionsDueForReminder: jest.fn().mockResolvedValue([
        {
          id: 'sub_1',
          userId: 'usr_1',
          plan: 'monthly',
          amount: 5000,
          currentPeriodEnd: new Date(Date.now() + 3 * 86400000),
          user: {
            id: 'usr_1',
            email: 'trader@fizco.app',
            fullName: 'Kelvin Trader',
          },
        },
      ]),
      createTransaction: jest.fn().mockResolvedValue({
        id: 'tx_1',
        amount: 5000,
        currency: 'NGN',
        status: 'SUCCESS',
        createdAt: new Date(),
      }),
      upsertSubscription: jest.fn().mockResolvedValue({
        id: 'sub_1',
        userId: 'usr_1',
        plan: 'monthly',
        status: 'active',
        amount: 5000,
        currency: 'NGN',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      }),
      updateUserPlan: jest.fn().mockResolvedValue({
        id: 'usr_1',
        subscriptionPlan: 'Premium',
      }),
      updateSubscriptionStatus: jest.fn().mockResolvedValue({
        id: 'sub_1',
        status: 'canceled',
      }),
      markReminderSent: jest.fn().mockResolvedValue({
        id: 'sub_1',
      }),
      findUserTransactions: jest.fn().mockResolvedValue({
        items: [],
        total: 0,
      }),
    };

    notificationsService = {
      notifyUser: jest.fn().mockResolvedValue({}),
    };

    emailService = {
      sendSubscriptionReminderEmail: jest.fn().mockResolvedValue(true),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'PAYSTACK_SECRET_KEY') return 'test_secret_key';
        if (key === 'SUBSCRIPTION_CURRENCY') return 'NGN';
        if (key === 'SUBSCRIPTION_MONTHLY_PRICE') return 5000;
        if (key === 'SUBSCRIPTION_QUARTERLY_PRICE') return 12000;
        if (key === 'SUBSCRIPTION_YEARLY_PRICE') return 36000;
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: SubscriptionsRepository, useValue: subscriptionsRepository },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EmailService, useValue: emailService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
  });

  describe('getPlans', () => {
    it('should return exactly 3 pricing plans (monthly, quarterly, yearly)', () => {
      const { plans, currency } = service.getPlans();
      expect(currency).toBe('NGN');
      expect(plans).toHaveLength(3);
      expect(plans.map((p) => p.id)).toEqual(['monthly', 'quarterly', 'yearly']);
      expect(plans[0].amount).toBe(5000);
      expect(plans[1].amount).toBe(12000);
      expect(plans[2].amount).toBe(36000);
    });
  });

  describe('createCheckoutSession', () => {
    it('should create pending transaction and return Paystack checkout details', async () => {
      const result = await service.createCheckoutSession('usr_1', { plan: 'monthly' });
      expect(result).toHaveProperty('checkoutId');
      expect(result).toHaveProperty('checkoutUrl');
      expect(result).toHaveProperty('reference');
      expect(result.plan.id).toBe('monthly');
      expect(subscriptionsRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'usr_1',
          amount: 5000,
          status: 'PENDING',
        }),
      );
    });

    it('should throw NotFoundException if user is not found', async () => {
      (subscriptionsRepository.findUserWithSubscription as jest.Mock).mockResolvedValueOnce(null);
      await expect(
        service.createCheckoutSession('non_existent', { plan: 'monthly' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmCheckoutSession', () => {
    it('should activate Premium subscription using reference or checkoutId', async () => {
      const result = await service.confirmCheckoutSession('usr_1', {
        checkoutId: 'ref_12345',
        plan: 'monthly',
      });

      expect(result.userPlan).toBe('Premium');
      expect(subscriptionsRepository.upsertSubscription).toHaveBeenCalledWith(
        'usr_1',
        expect.objectContaining({
          plan: 'monthly',
          status: 'active',
          amount: 5000,
        }),
      );
      expect(subscriptionsRepository.updateUserPlan).toHaveBeenCalledWith(
        'usr_1',
        'Premium',
        expect.any(Object),
      );
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'usr_1',
        expect.stringContaining('Welcome to Fizco Premium'),
        expect.any(String),
      );
    });
  });

  describe('createPortalSession', () => {
    it('should return a customer portal session link for self-service subscription management', async () => {
      const result = await service.createPortalSession('usr_1');
      expect(result).toHaveProperty('url');
      expect(result.url).toContain('paystack.com/manage/subscription');
    });
  });

  describe('processCardPayment', () => {
    it('should upgrade user to Premium and create active subscription', async () => {
      const result = await service.processCardPayment('usr_1', {
        plan: 'monthly',
        cardNumber: '4242 4242 4242 4242',
        expiryMonth: '12',
        expiryYear: '28',
        cvv: '123',
        cardHolderName: 'Kelvin Trader',
      });

      expect(result.success).toBe(true);
      expect(result.subscriptionPlan).toBe('Premium');
      expect(subscriptionsRepository.updateUserPlan).toHaveBeenCalledWith(
        'usr_1',
        'Premium',
        expect.any(Object),
      );
      expect(subscriptionsRepository.upsertSubscription).toHaveBeenCalledWith(
        'usr_1',
        expect.objectContaining({
          plan: 'monthly',
          status: 'active',
          amount: 5000,
        }),
      );
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'usr_1',
        expect.stringContaining('Welcome to Fizco Premium'),
        expect.any(String),
        expect.objectContaining({ type: 'SUBSCRIPTION_ACTIVATED' }),
      );
    });

    it('should reject invalid card number format', async () => {
      await expect(
        service.processCardPayment('usr_1', {
          plan: 'monthly',
          cardNumber: '1234', // too short
          expiryMonth: '12',
          expiryYear: '28',
          cvv: '123',
          cardHolderName: 'Kelvin',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel subscription at period end by default', async () => {
      const result = await service.cancelSubscription('usr_1', { cancelAtPeriodEnd: true });
      expect(result.success).toBe(true);
      expect(result.cancelAtPeriodEnd).toBe(true);
      expect(subscriptionsRepository.updateSubscriptionStatus).toHaveBeenCalledWith(
        'sub_1',
        'active',
        true,
        expect.any(Date),
      );
    });

    it('should cancel immediately and revert to Free when cancelAtPeriodEnd is false', async () => {
      const result = await service.cancelSubscription('usr_1', { cancelAtPeriodEnd: false });
      expect(result.success).toBe(true);
      expect(result.cancelAtPeriodEnd).toBe(false);
      expect(subscriptionsRepository.updateSubscriptionStatus).toHaveBeenCalledWith(
        'sub_1',
        'canceled',
        false,
        expect.any(Date),
      );
      expect(subscriptionsRepository.updateUserPlan).toHaveBeenCalledWith('usr_1', 'Free');
    });
  });

  describe('Webhook & Cron', () => {
    it('should handle subscription.disable event by canceling and setting Free', async () => {
      await service.handleWebhook({
        event: 'subscription.disable',
        data: { subscription_code: 'SUB_123' },
      });

      expect(subscriptionsRepository.updateSubscriptionStatus).toHaveBeenCalledWith(
        'sub_1',
        'canceled',
        true,
        expect.any(Date),
      );
      expect(subscriptionsRepository.updateUserPlan).toHaveBeenCalledWith('usr_1', 'Free');
    });

    it('should dispatch renewal reminder via notifications and email', async () => {
      const count = await service.runDailyReminderCron();
      expect(count).toBe(1);
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'usr_1',
        expect.stringContaining('Subscription Renewal in 3 Days'),
        expect.any(String),
        expect.objectContaining({ type: 'SUBSCRIPTION_RENEWAL_REMINDER' }),
      );
      expect(emailService.sendSubscriptionReminderEmail).toHaveBeenCalledWith(
        'trader@fizco.app',
        'Kelvin Trader',
        'MONTHLY',
        expect.any(String),
        expect.any(String),
      );
      expect(subscriptionsRepository.markReminderSent).toHaveBeenCalledWith(
        'sub_1',
        expect.any(Date),
      );
    });
  });
});
