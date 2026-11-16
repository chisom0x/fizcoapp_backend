import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import {
  AdminChangePasswordDto,
  AdminForgotPasswordDto,
  AdminLoginDto,
  AdminResetPasswordDto,
} from './dto/admin.dto';

export interface AdminJwtPayload {
  sub: string;
  typ: 'admin';
  iat: number;
}

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  fullName: string;
}

const BCRYPT_ROUNDS = 12;
const SESSION_TTL = '12h';
const RESET_TOKEN_TTL_MS = 30 * 60_000;
/** Compared against when the email is unknown, so a wrong email takes as long as a wrong password */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const adminSelect = { id: true, email: true, fullName: true } as const;

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Admin sessions are signed with their own secret, so an app user's token can never pass as an
   * admin's or the other way round. Without one configured the panel stays locked
   */
  private get secret(): string {
    const secret = this.configService.get<string>('ADMIN_JWT_SECRET');
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException('Admin sign-in is not configured');
    }
    return secret;
  }

  private issueToken(adminId: string) {
    return this.jwtService.sign(
      { sub: adminId, typ: 'admin' },
      { secret: this.secret, expiresIn: SESSION_TTL },
    );
  }

  async login(dto: AdminLoginDto) {
    const admin = await this.prisma.admin.findUnique({
      where: { email: dto.email },
      select: { ...adminSelect, passwordHash: true },
    });
    const ok = await bcrypt.compare(
      dto.password,
      admin?.passwordHash || DUMMY_HASH,
    );
    if (!admin || !ok) {
      throw new UnauthorizedException('Email or password is incorrect');
    }
    const accessToken = this.issueToken(admin.id);
    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });
    return {
      accessToken,
      admin: { id: admin.id, email: admin.email, fullName: admin.fullName },
    };
  }

  /** Resolves the admin a session token belongs to, or null when it is invalid or revoked */
  async authenticate(token: string): Promise<AuthenticatedAdmin | null> {
    let payload: AdminJwtPayload;
    try {
      payload = this.jwtService.verify<AdminJwtPayload>(token, {
        secret: this.secret,
      });
    } catch {
      return null;
    }
    if (payload.typ !== 'admin') return null;
    const admin = await this.prisma.admin.findUnique({
      where: { id: payload.sub },
      select: { ...adminSelect, passwordChangedAt: true },
    });
    // Tokens from before the last password change are revoked
    if (
      !admin ||
      payload.iat < Math.floor(admin.passwordChangedAt.getTime() / 1000)
    )
      return null;
    return { id: admin.id, email: admin.email, fullName: admin.fullName };
  }

  /** Always answers the same way, so it can't be used to find out which emails are admins */
  async forgotPassword(dto: AdminForgotPasswordDto) {
    const admin = await this.prisma.admin.findUnique({
      where: { email: dto.email },
      select: adminSelect,
    });
    if (admin) {
      const token = randomBytes(32).toString('hex');
      await this.prisma.admin.update({
        where: { id: admin.id },
        data: {
          resetTokenHash: sha256(token),
          resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      const appUrl = (
        this.configService.get<string>('ADMIN_APP_URL') ||
        'http://localhost:3001'
      ).replace(/\/$/, '');
      // Not awaited, so a known email doesn't answer slower than an unknown one
      this.emailService
        .sendAdminPasswordResetEmail(
          admin.email,
          admin.fullName,
          `${appUrl}/reset-password?token=${token}`,
        )
        .catch((err) =>
          this.logger.error(`Failed to send admin reset email: ${err}`),
        );
    }
    return {
      message: 'If that email belongs to an admin, a reset link is on its way.',
    };
  }

  async resetPassword(dto: AdminResetPasswordDto) {
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    // One conditional update, so a link can't be used twice even by concurrent requests
    const { count } = await this.prisma.admin.updateMany({
      where: {
        resetTokenHash: sha256(dto.token),
        resetTokenExpiresAt: { gt: new Date() },
      },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });
    if (count === 0) {
      throw new BadRequestException(
        'This reset link is invalid or has expired',
      );
    }
    return { message: 'Password updated. Sign in with your new password.' };
  }

  /** Signs out every other session; returns a fresh token for the current one */
  async changePassword(adminId: string, dto: AdminChangePasswordDto) {
    const admin = await this.prisma.admin.findUniqueOrThrow({
      where: { id: adminId },
      select: { passwordHash: true },
    });
    if (!(await bcrypt.compare(dto.currentPassword, admin.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.prisma.admin.update({
      where: { id: adminId },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS),
        passwordChangedAt: new Date(),
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });
    return { accessToken: this.issueToken(adminId) };
  }
}
