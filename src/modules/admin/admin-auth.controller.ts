import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AdminAuthService } from './admin-auth.service';
import type { AuthenticatedAdmin } from './admin-auth.service';
import { AdminGuard, CurrentAdmin } from './admin.guard';
import {
  AdminChangePasswordDto,
  AdminForgotPasswordDto,
  AdminLoginDto,
  AdminResetPasswordDto,
} from './dto/admin.dto';

/** Sign-in for the admin panel. There is no signup: admins are created by prisma/seed-admin.ts */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: AdminLoginDto) {
    return this.adminAuthService.login(dto);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  forgotPassword(@Body() dto: AdminForgotPasswordDto) {
    return this.adminAuthService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resetPassword(@Body() dto: AdminResetPasswordDto) {
    return this.adminAuthService.resetPassword(dto);
  }

  @Get('me')
  @UseGuards(AdminGuard)
  me(@CurrentAdmin() admin: AuthenticatedAdmin) {
    return admin;
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  changePassword(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: AdminChangePasswordDto,
  ) {
    return this.adminAuthService.changePassword(admin.id, dto);
  }
}
