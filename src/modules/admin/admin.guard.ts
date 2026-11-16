import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthService, AuthenticatedAdmin } from './admin-auth.service';

type AdminRequest = Request & { admin?: AuthenticatedAdmin };

/** Lets a request through only with a valid admin session; app users' tokens are rejected */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const admin = token
      ? await this.adminAuthService.authenticate(token)
      : null;
    if (!admin) {
      throw new UnauthorizedException('Admin session expired. Sign in again.');
    }
    request.admin = admin;
    return true;
  }
}

export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedAdmin =>
    ctx.switchToHttp().getRequest<AdminRequest>().admin!,
);
