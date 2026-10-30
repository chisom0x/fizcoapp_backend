import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthRepository } from '../auth.repository';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const user = { id: 'user-1', fullName: 'Ada' };
  let findById: jest.Mock;
  let strategy: JwtStrategy;

  beforeEach(() => {
    findById = jest.fn().mockResolvedValue(user);
    strategy = new JwtStrategy(
      { get: () => 'secret' } as unknown as ConfigService,
      { findById } as unknown as AuthRepository,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('reuses a looked-up user for later requests instead of querying again', async () => {
    await expect(strategy.validate({ sub: 'user-1', email: 'a@b.c' })).resolves.toBe(user);
    await expect(strategy.validate({ sub: 'user-1', email: 'a@b.c' })).resolves.toBe(user);
    expect(findById).toHaveBeenCalledTimes(1);
  });

  it('looks the user up again once the cached copy is stale', async () => {
    jest.useFakeTimers({ now: 0 });
    await strategy.validate({ sub: 'user-1', email: 'a@b.c' });
    jest.setSystemTime(31_000);
    await strategy.validate({ sub: 'user-1', email: 'a@b.c' });
    expect(findById).toHaveBeenCalledTimes(2);
  });

  it('rejects a token whose user no longer exists', async () => {
    findById.mockResolvedValue(null);
    await expect(strategy.validate({ sub: 'gone', email: 'a@b.c' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
