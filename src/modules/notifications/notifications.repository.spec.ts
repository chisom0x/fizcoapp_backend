import { NotificationsRepository } from './notifications.repository';

describe('NotificationsRepository.saveFcmToken', () => {
  it('detaches the device from other accounts before linking it to the user', async () => {
    const prisma: any = {
      user: {
        updateMany: jest.fn((args) => ({ op: 'detach', args })),
        update: jest.fn((args) => ({ op: 'link', args })),
      },
      $transaction: jest.fn((ops) =>
        Promise.resolve([{ count: 1 }, { id: 'user_b', fcmToken: 'fid_1' }]),
      ),
    };
    const repository = new NotificationsRepository(prisma);

    const result = await repository.saveFcmToken('user_b', 'fid_1');

    const [detach, link] = prisma.$transaction.mock.calls[0][0];
    expect(detach.args).toEqual({
      where: { fcmToken: 'fid_1', id: { not: 'user_b' } },
      data: { fcmToken: null },
    });
    expect(link.args.where).toEqual({ id: 'user_b' });
    expect(link.args.data).toEqual({ fcmToken: 'fid_1' });
    expect(result).toEqual({ id: 'user_b', fcmToken: 'fid_1' });
  });
});
