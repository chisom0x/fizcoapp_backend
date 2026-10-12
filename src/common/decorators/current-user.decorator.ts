import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export class AuthenticatedUser {
  id: string;
  email: string;
  phoneNumber?: string;
  fullName: string;
  businessName?: string | null;
  subscriptionPlan: string;
  isVerified: boolean;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    return data && user ? user[data] : user;
  },
);
