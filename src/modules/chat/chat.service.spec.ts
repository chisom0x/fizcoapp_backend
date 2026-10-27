import { ChatService } from './chat.service';

// A thread between buyer_1 (who created req_1) and vendor_1
const thread = { id: 'thread_1', creatorId: 'buyer_1', vendorId: 'vendor_1' };
const request = { id: 'req_1', title: 'iPhone 13', requesterId: 'buyer_1' };

describe('ChatService interest via tagged messages', () => {
  let chatRepository: Record<string, jest.Mock>;
  let requestsService: Record<string, jest.Mock>;
  let service: ChatService;

  beforeEach(() => {
    chatRepository = {
      findThreadByIdOrContext: jest.fn().mockResolvedValue(thread),
      createMessage: jest.fn(async (data) => ({ id: 'msg_1', createdAt: new Date(), ...data })),
      markMessagesRead: jest.fn(),
    };
    requestsService = {
      assertCanShowInterest: jest.fn().mockResolvedValue(request),
      recordInterest: jest.fn().mockResolvedValue(undefined),
    };
    const notificationsService = { notifyUser: jest.fn().mockResolvedValue(undefined) };
    const chatGateway = { isUserInThread: jest.fn().mockReturnValue(false) };
    service = new ChatService(
      chatRepository as any,
      notificationsService as any,
      chatGateway as any,
      requestsService as any,
    );
  });

  it('records interest only after the tagged message is saved', async () => {
    const order: string[] = [];
    chatRepository.createMessage.mockImplementation(async (data) => {
      order.push('message');
      return { id: 'msg_1', createdAt: new Date(), ...data };
    });
    requestsService.recordInterest.mockImplementation(async () => {
      order.push('interest');
    });

    await service.sendMessage('thread_1', 'vendor_1', 'Vendor One', {
      text: 'I have it',
      taggedRequestId: 'req_1',
    });

    expect(order).toEqual(['message', 'interest']);
    expect(requestsService.recordInterest).toHaveBeenCalledWith(
      request,
      'vendor_1',
      'Vendor One',
      'thread_1',
    );
  });

  it('saves neither message nor interest when the vendor may not show interest', async () => {
    requestsService.assertCanShowInterest.mockRejectedValue(new Error('limit reached'));

    await expect(
      service.sendMessage('thread_1', 'vendor_1', 'Vendor One', { taggedRequestId: 'req_1' }),
    ).rejects.toThrow('limit reached');
    expect(chatRepository.createMessage).not.toHaveBeenCalled();
    expect(requestsService.recordInterest).not.toHaveBeenCalled();
  });

  it('refuses a request tagged in a chat with someone other than its creator', async () => {
    chatRepository.findThreadByIdOrContext.mockResolvedValue({
      id: 'thread_2',
      creatorId: 'someone_else',
      vendorId: 'vendor_1',
    });

    await expect(
      service.sendMessage('thread_2', 'vendor_1', 'Vendor One', { taggedRequestId: 'req_1' }),
    ).rejects.toThrow('A request can only be tagged in a chat with its creator');
    expect(requestsService.recordInterest).not.toHaveBeenCalled();
  });

  it('records no interest for a plain message', async () => {
    await service.sendMessage('thread_1', 'vendor_1', 'Vendor One', { text: 'hi' });

    expect(requestsService.assertCanShowInterest).not.toHaveBeenCalled();
    expect(requestsService.recordInterest).not.toHaveBeenCalled();
  });
});
