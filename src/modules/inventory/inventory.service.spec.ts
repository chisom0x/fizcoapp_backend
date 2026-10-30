import { BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

describe('InventoryService price requirement', () => {
  const parsed = { title: 'iPhone 13', description: '128GB', brand: 'Apple', model: 'iPhone 13' };
  let aiService: { parseProductInput: jest.Mock };
  let repository: Record<string, jest.Mock>;
  let service: InventoryService;

  beforeEach(() => {
    aiService = { parseProductInput: jest.fn().mockResolvedValue(parsed) };
    repository = {
      create: jest.fn(async (data) => data),
      findById: jest.fn().mockResolvedValue({ id: 'item_1', rawInput: 'iPhone 13 ₦450,000', price: 450_000 }),
      update: jest.fn(),
    };
    service = new InventoryService(repository as any, aiService as any);
  });

  it('refuses a listing without a price before calling the AI or saving it', async () => {
    await expect(
      service.create('vendor_1', { rawInput: 'iPhone 13, 128GB, UK used' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(aiService.parseProductInput).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('stores the price read from the listing', async () => {
    await service.create('vendor_1', { rawInput: 'iPhone 13, 128GB, UK used, ₦450,000' });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ price: 450_000 }));
  });

  it('refuses an edit that drops the price from the listing', async () => {
    await expect(
      service.update('vendor_1', 'item_1', { rawInput: 'iPhone 13, 128GB' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });
});
