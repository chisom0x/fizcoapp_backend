import { ForbiddenException } from '@nestjs/common';
import { ChatRepository } from './chat.repository';

describe('ChatRepository.softDeleteMessage', () => {
  const setup = () => {
    const prisma: any = {
      message: {
        findUnique: jest.fn().mockResolvedValue({ id: 'm1', senderId: 'user_a', threadId: 't1' }),
        update: jest.fn().mockResolvedValue({ id: 'm1', threadId: 't1', thread: { id: 't1' } }),
        findFirst: jest.fn().mockResolvedValue({ id: 'm2' }),
      },
      chatThread: { update: jest.fn() },
    };
    return { prisma, repository: new ChatRepository(prisma) };
  };

  it("refuses to delete someone else's message", async () => {
    const { prisma, repository } = setup();

    await expect(repository.softDeleteMessage('m1', 'user_b')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('deletes a message the caller sent', async () => {
    const { prisma, repository } = setup();

    await repository.softDeleteMessage('m1', 'user_a');

    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
        data: expect.objectContaining({ isDeleted: true }),
      }),
    );
  });
});

describe('ChatRepository.markMessagesRead', () => {
  it('marks every unread message in one statement', async () => {
    const prisma: any = {
      message: {
        updateMany: jest.fn().mockResolvedValue({ count: 250 }),
        update: jest.fn(),
      },
    };
    const repository = new ChatRepository(prisma);

    await expect(repository.markMessagesRead('t1', 'user_a')).resolves.toBe(250);

    expect(prisma.message.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.message.updateMany).toHaveBeenCalledWith({
      where: { threadId: 't1', NOT: { readBy: { has: 'user_a' } } },
      data: { readBy: { push: 'user_a' } },
    });
    expect(prisma.message.update).not.toHaveBeenCalled();
  });
});

describe('ChatRepository.findMessagesByThread', () => {
  const setup = () => {
    const prisma: any = {
      message: {
        findMany: jest.fn().mockResolvedValue([{ id: 'm3' }, { id: 'm2' }]),
      },
    };
    return { prisma, repository: new ChatRepository(prisma) };
  };

  it('returns the newest page oldest first', async () => {
    const { prisma, repository } = setup();

    await expect(repository.findMessagesByThread('t1', 50)).resolves.toEqual([
      { id: 'm2' },
      { id: 'm3' },
    ]);

    const args = prisma.message.findMany.mock.calls[0][0];
    expect(args).toEqual(
      expect.objectContaining({
        where: { threadId: 't1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
    );
    expect(args.cursor).toBeUndefined();
  });

  it('pages back from the oldest message the client has', async () => {
    const { prisma, repository } = setup();

    await repository.findMessagesByThread('t1', 50, 'm4');

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'm4' }, skip: 1, take: 50 }),
    );
  });
});
