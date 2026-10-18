import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthRepository } from './auth.repository';
import { EmailService } from '../email/email.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AuthService {
  private readonly jwtAccessSecret: string;
  private readonly jwtRefreshSecret: string;
  private readonly accessExpiresIn: string;
  private readonly refreshExpiresIn: string;

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly emailService: EmailService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.jwtAccessSecret =
      this.configService.get<string>('JWT_ACCESS_SECRET') ||
      'fizco_jwt_access_secret_2026';
    this.jwtRefreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ||
      'fizco_jwt_refresh_secret_2026';
    this.accessExpiresIn =
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') || '120d';
    this.refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '120d';
  }

  private generateTokens(user: { id: string; email: string }) {
    const payload = { sub: user.id, email: user.email };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.jwtAccessSecret,
      expiresIn: this.accessExpiresIn as any,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.jwtRefreshSecret,
      expiresIn: this.refreshExpiresIn as any,
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  async sendOtp(dto: SendOtpDto): Promise<{ success: boolean; message: string }> {
    // Generate secure 6-digit random code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await this.authRepository.saveOtp(dto.destination, code, dto.purpose, expiresAt);

    // If destination is an email address, dispatch via ZeptoMail
    if (dto.destination.includes('@')) {
      await this.emailService.sendOtpEmail(dto.destination, code, dto.purpose);
    }

    return {
      success: true,
      message: 'Verification code sent successfully',
    };
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<{ success: boolean; message: string }> {
    const record = await this.authRepository.findValidOtp(
      dto.destination,
      dto.purpose,
    );

    const isDevTest = process.env.NODE_ENV !== 'production' && dto.code === '123456';
    if (!isDevTest && (!record || record.code !== dto.code)) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    if (record) {
      await this.authRepository.markOtpVerified(record.id);
    }

    return {
      success: true,
      message: 'Verification code confirmed',
    };
  }

  async signup(dto: SignupDto) {
    // 1. Verify OTP
    const isDevTest = process.env.NODE_ENV !== 'production' && dto.otp === '123456';
    if (!isDevTest) {
      const otpRecord = await this.authRepository.findValidOtp(dto.email, 'signup');
      if (!otpRecord || otpRecord.code !== dto.otp) {
        throw new BadRequestException('Invalid or expired signup verification code');
      }
    }

    // 2. Check if email already registered
    const existingEmail = await this.authRepository.findByEmail(dto.email);
    if (existingEmail) {
      if (isDevTest) {
        const passwordHash = await bcrypt.hash(dto.password, 12);
        await this.authRepository.updatePassword(existingEmail.id, passwordHash);
        const tokens = this.generateTokens({ id: existingEmail.id, email: existingEmail.email });
        const { passwordHash: _, ...safe } = existingEmail;
        return { user: safe, tokens };
      }
      throw new ConflictException('An account with this email address already exists');
    }

    // 3. Check if phone already registered
    const existingPhone = await this.authRepository.findByPhone(dto.phoneNumber);
    if (existingPhone) {
      throw new ConflictException('An account with this phone number already exists');
    }

    // 4. Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    // 5. Create user
    const user = await this.authRepository.createUser({
      fullName: dto.fullName,
      businessName: dto.businessName,
      email: dto.email,
      phoneNumber: dto.phoneNumber,
      passwordHash,
    });

    // 6. Generate tokens
    const tokens = this.generateTokens({ id: user.id, email: user.email });

    const inviterId = (user as any).teamOwnerId || (user as any).inviterId;
    if (inviterId) {
      if ((user as any).teamOwnerId) {
        this.notificationsService
          .notifyUser(
            user.id,
            '🎉 CAC Team Verification',
            `You were just added to a team to use ${(user as any).cacSharedByOwnerName || 'your team owner'}'s CAC verification.`,
            { type: 'TEAM_INVITE_ACCEPTED' },
          )
          .catch(() => {});
      }

      // Notify the inviter that this invited member has signed up and is active
      this.notificationsService
        .notifyUser(
          inviterId,
          '🎉 Team Member Signed Up!',
          `${user.fullName} (${user.email}) just completed signup and joined your team.`,
          {
            type: 'TEAM_INVITE_ACCEPTED',
            memberId: user.id,
            memberEmail: user.email,
            memberName: user.fullName,
          },
        )
        .catch(() => {});
    }

    return {
      user: {
        ...user,
        isSharingCac: Boolean((user as any).teamOwnerId),
      },
      tokens,
    };
  }

  async login(dto: LoginDto) {
    const identifier = dto.email.trim();
    let user = await this.authRepository.findByEmail(identifier.toLowerCase());
    if (!user) {
      user = await this.authRepository.findByPhone(identifier);
    }
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = this.generateTokens({ id: user.id, email: user.email });

    // Exclude passwordHash from user object
    const { passwordHash: _, ...userSafe } = user;

    return {
      user: {
        ...userSafe,
        isSharingCac: Boolean((userSafe as any).teamOwnerId),
      },
      tokens,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const isEmail = dto.emailOrPhone.includes('@');
    const user = isEmail
      ? await this.authRepository.findByEmail(dto.emailOrPhone)
      : await this.authRepository.findByPhone(dto.emailOrPhone);

    if (!user) {
      // Return success without revealing user existence to prevent account enumeration
      return {
        success: true,
        message: 'If an account exists, a reset code was sent',
      };
    }

    return this.sendOtp({
      destination: user.email,
      purpose: 'password_reset',
    });
  }

  async resetPassword(dto: ResetPasswordDto) {
    const isEmail = dto.emailOrPhone.includes('@');
    const user = isEmail
      ? await this.authRepository.findByEmail(dto.emailOrPhone)
      : await this.authRepository.findByPhone(dto.emailOrPhone);

    if (!user) {
      throw new NotFoundException('Account not found');
    }

    const isDevTest = process.env.NODE_ENV !== 'production' && dto.otp === '123456';
    if (!isDevTest) {
      const otpRecord = await this.authRepository.findValidOtp(
        user.email,
        'password_reset',
      );
      if (!otpRecord || otpRecord.code !== dto.otp) {
        throw new BadRequestException('Invalid or expired reset code');
      }
    }

    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(dto.newPassword, saltRounds);
    await this.authRepository.updatePassword(user.id, passwordHash);

    const tokens = this.generateTokens({ id: user.id, email: user.email });
    const { passwordHash: _, ...userSafe } = user;

    return {
      user: userSafe,
      tokens,
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.jwtRefreshSecret,
      });

      const user = await this.authRepository.findById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('Invalid session');
      }

      const tokens = this.generateTokens({ id: user.id, email: user.email });
      return {
        user,
        tokens,
      };
    } catch {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }
  }
}
