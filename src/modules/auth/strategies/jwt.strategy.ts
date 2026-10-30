import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthRepository } from '../auth.repository';

export interface JwtPayload {
  sub: string;
  email: string;
}

type CachedUser = NonNullable<Awaited<ReturnType<AuthRepository['findById']>>>;

/** How long a looked-up user is reused. Requests only read id and fullName from it */
const USER_CACHE_TTL_MS = 30_000;
const USER_CACHE_MAX_ENTRIES = 10_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  // Every authenticated request passes through here, so without this each one waits on a
  // database round trip before its own queries start
  private readonly userCache = new Map<string, { user: CachedUser; expiresAt: number }>();

  constructor(
    private readonly configService: ConfigService,
    private readonly authRepository: AuthRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_ACCESS_SECRET') ||
        'fizco_jwt_access_secret_2026',
    });
  }

  async validate(payload: JwtPayload) {
    const now = Date.now();
    const cached = this.userCache.get(payload.sub);
    if (cached && cached.expiresAt > now) {
      return cached.user;
    }

    const user = await this.authRepository.findById(payload.sub);
    if (!user) {
      this.userCache.delete(payload.sub);
      throw new UnauthorizedException('User account no longer exists');
    }
    if (this.userCache.size >= USER_CACHE_MAX_ENTRIES) {
      this.userCache.clear();
    }
    this.userCache.set(payload.sub, { user, expiresAt: now + USER_CACHE_TTL_MS });
    return user;
  }
}
