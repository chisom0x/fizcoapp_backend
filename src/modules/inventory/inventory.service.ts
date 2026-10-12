import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryRepository } from './inventory.repository';
import { AiService } from '../ai/ai.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';

@Injectable()
export class InventoryService {
  constructor(
    private readonly inventoryRepository: InventoryRepository,
    private readonly aiService: AiService,
  ) {}

  async create(userId: string, dto: CreateInventoryDto) {
    // 1. Process natural language entry through Lao Zhang GPT-4o
    const parsed = await this.aiService.parseProductInput(dto.rawInput);

    // 2. Persist in database with structured hidden attributes
    const item = await this.inventoryRepository.create({
      userId,
      title: parsed.title,
      description: parsed.description,
      rawInput: dto.rawInput,
      imageUrls: dto.imageUrls || [],
      brand: parsed.brand,
      model: parsed.model,
      storage: parsed.storage,
      condition: parsed.condition,
      color: parsed.color,
      others: parsed.others,
    });

    return item;
  }

  async findAll(userId: string, page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.inventoryRepository.findByUserId(
      userId,
      skip,
      limit,
      search,
    );

    return {
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(userId: string, id: string) {
    const item = await this.inventoryRepository.findById(id, userId);
    if (!item) {
      throw new NotFoundException('Inventory item not found');
    }

    // Expose only title, description, rawInput, imageUrls, createdAt to the user
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      rawInput: item.rawInput,
      imageUrls: item.imageUrls,
      createdAt: item.createdAt,
    };
  }

  async update(userId: string, id: string, dto: UpdateInventoryDto) {
    const existing = await this.inventoryRepository.findById(id, userId);
    if (!existing) {
      throw new NotFoundException('Inventory item not found');
    }

    let updateData: any = {};

    // If user edited their rawInput, re-run AI parsing system!
    if (dto.rawInput && dto.rawInput.trim() !== existing.rawInput.trim()) {
      const parsed = await this.aiService.parseProductInput(dto.rawInput);
      updateData = {
        title: parsed.title,
        description: parsed.description,
        rawInput: dto.rawInput,
        brand: parsed.brand,
        model: parsed.model,
        storage: parsed.storage,
        condition: parsed.condition,
        color: parsed.color,
        others: parsed.others,
      };
    } else {
      if (dto.title) updateData.title = dto.title.trim();
      if (dto.description) updateData.description = dto.description.trim();
    }

    if (dto.imageUrls !== undefined) {
      updateData.imageUrls = dto.imageUrls;
    }

    await this.inventoryRepository.update(id, userId, updateData);

    const updated = await this.inventoryRepository.findById(id, userId);
    return {
      id: updated!.id,
      title: updated!.title,
      description: updated!.description,
      rawInput: updated!.rawInput,
      imageUrls: updated!.imageUrls,
      createdAt: updated!.createdAt,
    };
  }

  async remove(userId: string, id: string) {
    const existing = await this.inventoryRepository.findById(id, userId);
    if (!existing) {
      throw new NotFoundException('Inventory item not found');
    }

    await this.inventoryRepository.delete(id, userId);
    return {
      deleted: true,
      id,
    };
  }
}
