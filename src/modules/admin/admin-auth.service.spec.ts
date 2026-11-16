import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AdminAuthService } from './admin-auth.service';

const SECRET = 'x'.repeat(40);

describe('AdminAuthService', () => {
  let prisma: any;
  let email: any;
  let service: AdminAuthService;
  const jwt = new JwtService({});
  const config = {
    get: (k: string) => (k === 'ADMIN_JWT_SECRET' ? SECRET : undefined),
  };

  beforeEach(() => {
    prisma = {
      admin: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
    };
    email = { sendAdminPasswordResetEmail: jest.fn().mockResolvedValue(true) };
    service = new AdminAuthService(prisma, jwt, config as any, email);
  });

  it('signs in with the right password and rejects a wrong one', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    prisma.admin.findUnique.mockResolvedValue({
      id: 'a1',
      email: 'admin@fizco.com',
      fullName: 'Admin',
      passwordHash,
    });

    const { accessToken, admin } = await service.login({
      email: 'admin@fizco.com',
      password: 'password123',
    });
    expect(admin).toEqual({
      id: 'a1',
      email: 'admin@fizco.com',
      fullName: 'Admin',
    });
    expect(accessToken).toEqual(expect.any(String));

    await expect(
      service.login({ email: 'admin@fizco.com', password: 'nope' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an app user token signed with another secret', async () => {
    const userToken = jwt.sign(
      { sub: 'u1', email: 'x@y.z' },
      { secret: 'user-secret' },
    );
    await expect(service.authenticate(userToken)).resolves.toBeNull();
  });

  it('rejects sessions issued before the last password change', async () => {
    const token = jwt.sign({ sub: 'a1', typ: 'admin' }, { secret: SECRET });
    prisma.admin.findUnique.mockResolvedValue({
      id: 'a1',
      email: 'admin@fizco.com',
      fullName: 'Admin',
      passwordChangedAt: new Date(Date.now() + 5_000),
    });
    await expect(service.authenticate(token)).resolves.toBeNull();

    prisma.admin.findUnique.mockResolvedValue({
      id: 'a1',
      email: 'admin@fizco.com',
      fullName: 'Admin',
      passwordChangedAt: new Date(Date.now() - 60_000),
    });
    await expect(service.authenticate(token)).resolves.toEqual({
      id: 'a1',
      email: 'admin@fizco.com',
      fullName: 'Admin',
    });
  });

  it('answers forgot-password the same whether or not the email is an admin', async () => {
    prisma.admin.findUnique.mockResolvedValueOnce(null);
    const unknown = await service.forgotPassword({ email: 'who@x.com' });
    prisma.admin.findUnique.mockResolvedValueOnce({
      id: 'a1',
      email: 'admin@fizco.com',
      fullName: 'Admin',
    });
    const known = await service.forgotPassword({ email: 'admin@fizco.com' });
    expect(known).toEqual(unknown);
    expect(email.sendAdminPasswordResetEmail).toHaveBeenCalledTimes(1);
    // Only the token's hash is stored
    const link: string = email.sendAdminPasswordResetEmail.mock.calls[0][2];
    const token = link.split('token=')[1];
    expect(prisma.admin.update.mock.calls[0][0].data.resetTokenHash).not.toBe(
      token,
    );
  });

  it('refuses a reset link that is unknown, used or expired', async () => {
    prisma.admin.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.resetPassword({
        token: 'a'.repeat(64),
        newPassword: 'newpassword1',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
