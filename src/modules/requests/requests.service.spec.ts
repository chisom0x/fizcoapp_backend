import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RequestsService } from './requests.service';
import { RequestsRepository } from './requests.repository';
import { AiService } from '../ai/ai.service';
import { ChatGateway } from '../chat/chat.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { PrismaService } from '../../prisma/prisma.service';

// Inventory as InventoryService stores it after AI parsing, one item per vendor
const inventory = [
  {
    userId: 'v_iphone13',
    title: 'iPhone 13',
    brand: 'Apple',
    model: 'iPhone 13',
  },
  {
    userId: 'v_iphone11',
    title: 'iPhone 11',
    brand: 'Apple',
    model: 'iPhone 11',
  },
  {
    userId: 'v_iphone15promax',
    title: 'iPhone 15 Pro Max',
    brand: 'Apple',
    model: 'iPhone 15 Pro Max',
  },
  {
    userId: 'v_iphone16pro',
    title: 'iPhone 16 Pro',
    brand: 'Apple',
    model: 'iPhone 16 Pro',
  },
  {
    userId: 'v_s23ultra',
    title: 'Galaxy S23 Ultra',
    brand: 'Samsung',
    model: 'Galaxy S23 Ultra',
  },
  {
    userId: 'v_a13',
    title: 'Samsung Galaxy A13',
    brand: 'Samsung',
    model: 'Galaxy A13',
  },
  {
    userId: 'v_macbook',
    title: 'MacBook Pro 13 M2',
    brand: 'Apple',
    model: 'MacBook Pro 13 M2',
  },
  {
    userId: 'v_ps5',
    title: 'PlayStation 5',
    brand: 'Sony',
    model: 'PlayStation 5',
  },
  {
    userId: 'v_ps4',
    title: 'PlayStation 4 Slim',
    brand: 'Sony',
    model: 'PlayStation 4 Slim',
  },
  { userId: 'v_legacy', title: 'Tecno Camon 20', brand: null, model: null },
  // The AI rewrote the vendor's "MTN WiFi 4G" into its own spelling
  {
    userId: 'v_mtn_wifi',
    title: 'MTN 4G Wi-Fi Router',
    brand: 'MTN',
    model: '4G Router',
    rawInput: 'MTN WiFi 4G hotspot',
  },
].map((item, i) => ({
  id: `item_${i}`,
  rawInput: item.title,
  ...item,
  user: { id: item.userId, fcmToken: null, fullName: item.userId },
}));

describe('RequestsService vendor matching', () => {
  let service: RequestsService;
  let prisma: any;
  let aiService: { parseProductInput: jest.Mock };
  let roomEmit: jest.Mock;
  let server: { emit: jest.Mock; to: jest.Mock };
  let requestsRepository: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = {
      inventoryItem: {
        findMany: jest.fn(async ({ where }) =>
          inventory.filter((i) => i.userId !== where.userId.not),
        ),
      },
      notification: {
        create: jest.fn(async ({ data }) => ({
          id: `n_${data.userId}`,
          createdAt: new Date(),
        })),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ fcmToken: null, notificationsEnabled: true }),
      },
    };
    aiService = {
      parseProductInput: jest.fn().mockRejectedValue(new Error('offline')),
    };
    requestsRepository = {};
    roomEmit = jest.fn();
    server = {
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: roomEmit }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestsService,
        NotificationsService,
        NotificationsRepository,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: RequestsRepository, useValue: requestsRepository },
        { provide: AiService, useValue: aiService },
        { provide: ChatGateway, useValue: { server } },
      ],
    }).compile();

    service = module.get<RequestsService>(RequestsService);
  });

  const notifiedFor = async (title: string) => {
    prisma.notification.create.mockClear();
    await (service as any).matchAndNotifyVendors('req_1', title, 'buyer_1');
    return prisma.notification.create.mock.calls
      .map(([{ data }]) => data.userId)
      .sort();
  };

  it.each([
    ['iPhone 13 needed urgently', ['v_iphone13']],
    ['iPhone 13 Pro Max', []],
    ['iPhone 16 Pro 256 gb', ['v_iphone16pro']],
    ['Samsung S23 ultra 256gb', ['v_s23ultra']],
    ['Galaxy A13', ['v_a13']],
    ['Tecno Camon 20', ['v_legacy']],
    ['JBL speaker', []],
    ['Mtn WiFi needed', ['v_mtn_wifi']],
    ['MTN wi-fi router', ['v_mtn_wifi']],
    ['Nintendo Switch', []],
  ])('"%s" notifies only vendors stocking it', async (title, expected) => {
    expect(await notifiedFor(title)).toEqual(expected);
  });

  it('matches on the AI-parsed model when the buyer uses shorthand', async () => {
    aiService.parseProductInput.mockResolvedValue({
      brand: 'Sony',
      model: 'PlayStation 5',
    });
    expect(await notifiedFor('PS5 needed')).toEqual(['v_ps5']);
  });

  it('matches on what the vendor typed even when the AI renames the item', async () => {
    aiService.parseProductInput.mockResolvedValue({
      brand: 'MTN',
      model: 'MiFi',
    });
    expect(await notifiedFor('Mtn WiFi needed')).toEqual(['v_mtn_wifi']);
  });

  it('does not read brands out of longer words', async () => {
    // "hot" (Infinix) inside "hotspot" must not gate out the MTN vendor
    expect(await notifiedFor('MTN hotspot')).toEqual(['v_mtn_wifi']);
  });

  it('skips vendors in a block relationship with the requester', async () => {
    await notifiedFor('iPhone 13');
    expect(prisma.inventoryItem.findMany.mock.calls[0][0].where.user).toEqual({
      blocksReceived: { none: { userId: 'buyer_1' } },
      blocksInitiated: { none: { vendorId: 'buyer_1' } },
    });
  });

  it('sends the requester one in-app notification when a vendor shows interest', async () => {
    Object.assign(requestsRepository, {
      addInterest: jest.fn().mockResolvedValue(true),
    });

    await service.recordInterest(
      { id: 'req_1', title: 'iPhone 13', requesterId: 'buyer_1' },
      'vendor_1',
      'Vendor One',
      'thread_1',
    );
    await new Promise((resolve) => setImmediate(resolve));

    const notificationEmits = server.to.mock.calls.filter(
      (_, i) => roomEmit.mock.calls[i]?.[0] === 'new_notification',
    );
    expect(notificationEmits).toEqual([['user_buyer_1']]);
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it('does not notify the requester again for a vendor already interested', async () => {
    Object.assign(requestsRepository, {
      addInterest: jest.fn().mockResolvedValue(false),
    });

    await service.recordInterest(
      { id: 'req_1', title: 'iPhone 13', requesterId: 'buyer_1' },
      'vendor_1',
      'Vendor One',
      'thread_1',
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(server.to).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('opens the chat without recording interest or notifying the requester', async () => {
    const addInterest = jest.fn();
    Object.assign(requestsRepository, {
      getUserSubscriptionPlan: jest.fn().mockResolvedValue('Premium'),
      countUserInterests: jest.fn().mockResolvedValue(0),
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'req_1', title: 'iPhone 13', requesterId: 'buyer_1' }),
      addInterest,
      getOrCreateChatThread: jest.fn().mockResolvedValue({ id: 'thread_1' }),
    });

    const result = await service.openChat('req_1', 'vendor_1');
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.chatThreadId).toBe('thread_1');
    expect(addInterest).not.toHaveBeenCalled();
    expect(server.to).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('emits match events only to the matched vendor room, never globally', async () => {
    await notifiedFor('iPhone 13');
    expect(server.emit).not.toHaveBeenCalled();
    expect(server.to.mock.calls.map(([room]) => room)).toEqual([
      'user_v_iphone13',
      'user_v_iphone13',
    ]);
    expect(roomEmit.mock.calls.map(([event]) => event)).toEqual([
      'new_notification',
      'request_match',
    ]);
  });
});
