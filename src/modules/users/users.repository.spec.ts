import { UsersRepository } from './users.repository';

describe('UsersRepository deleteAccount', () => {
  let tx: Record<string, Record<string, jest.Mock>>;
  let repository: UsersRepository;

  beforeEach(() => {
    tx = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ email: 'Ada@Example.com' }),
        update: jest.fn().mockResolvedValue({ id: 'usr_1' }),
      },
      request: {
        findMany: jest.fn().mockResolvedValue([{ id: 'req_1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryItem: { deleteMany: jest.fn() },
      notification: { deleteMany: jest.fn() },
      teamInvite: { deleteMany: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((run) => run(tx)) };
    repository = new UsersRepository(prisma as any);
  });

  it('removes invites sent to its email, so a new signup with it must verify CAC again', async () => {
    await expect(repository.deleteAccount('usr_1')).resolves.toEqual(['req_1']);

    expect(tx.teamInvite.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ inviterId: 'usr_1' }, { inviteeEmail: 'ada@example.com' }] },
    });
    // Looked up before the email is replaced with a placeholder
    expect(tx.user.findUniqueOrThrow.mock.invocationCallOrder[0]).toBeLessThan(
      tx.user.update.mock.invocationCallOrder[0],
    );
  });
});
