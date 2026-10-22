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
].map((item, i) => ({
  id: `item_${i}`,
  ...item,
  user: { id: item.userId, fcmToken: null, fullName: item.userId },
}));

describe('RequestsService vendor matching', () => {
  let service: RequestsService;
  let prisma: any;
  let aiService: { parseProductInput: jest.Mock };
  let roomEmit: jest.Mock;
  let server: { emit: jest.Mock; to: jest.Mock };

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
        { provide: RequestsRepository, useValue: {} },
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

  it('skips vendors in a block relationship with the requester', async () => {
    await notifiedFor('iPhone 13');
    expect(prisma.inventoryItem.findMany.mock.calls[0][0].where.user).toEqual({
      blocksReceived: { none: { userId: 'buyer_1' } },
      blocksInitiated: { none: { vendorId: 'buyer_1' } },
    });
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
