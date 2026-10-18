import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { ProcessCardPaymentDto } from './dto/process-payment.dto';
import { ConfirmCheckoutDto } from './dto/confirm-checkout.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('plans')
  getPlans() {
    const plansData = this.subscriptionsService.getPlans();
    return {
      success: true,
      message: 'Subscription plans retrieved',
      data: plansData,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-subscription')
  async getMySubscription(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.subscriptionsService.getMySubscription(user.id);
    return {
      success: true,
      message: 'Subscription details retrieved',
      data,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('checkout-session')
  async createCheckoutSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCheckoutDto,
  ) {
    const session = await this.subscriptionsService.createCheckoutSession(
      user.id,
      dto,
    );
    return {
      success: true,
      message: 'Checkout session created',
      data: session,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('confirm-checkout')
  async confirmCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmCheckoutDto,
  ) {
    const result = await this.subscriptionsService.confirmCheckoutSession(
      user.id,
      dto,
    );
    return {
      success: true,
      message: 'Subscription activated successfully',
      data: result,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('pay')
  async processCardPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ProcessCardPaymentDto,
  ) {
    const result = await this.subscriptionsService.processCardPayment(
      user.id,
      dto,
    );
    return {
      success: true,
      message: 'Payment processed successfully. Subscription active.',
      data: result,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('portal-session')
  async createPortalSession(@CurrentUser() user: AuthenticatedUser) {
    const portal = await this.subscriptionsService.createPortalSession(user.id);
    return {
      success: true,
      message: 'Customer portal session generated',
      data: portal,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('cancel')
  async cancelSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CancelSubscriptionDto,
  ) {
    const result = await this.subscriptionsService.cancelSubscription(
      user.id,
      dto,
    );
    return {
      success: true,
      message: result.message,
      data: result,
    };
  }

  @Post('webhook')
  async handleWebhook(
    @Headers('x-paystack-signature') paystackSig: string,
    @Headers('x-bachs-signature-v2') bachsSig: string,
    @Body() event: any,
  ) {
    const signature = paystackSig || bachsSig;
    const isValid = this.subscriptionsService.verifyWebhookSignature(
      signature,
      JSON.stringify(event),
    );
    if (!isValid) {
      throw new BadRequestException('Invalid webhook signature');
    }
    return this.subscriptionsService.handleWebhook(event);
  }

  @Post('cron/trigger-reminder')
  async triggerReminderCron() {
    const sent = await this.subscriptionsService.runDailyReminderCron();
    return {
      success: true,
      message: `Triggered daily renewal reminder cron. Dispatched ${sent} notice(s).`,
      count: sent,
    };
  }
}
