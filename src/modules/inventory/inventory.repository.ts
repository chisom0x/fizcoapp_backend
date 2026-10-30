import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    title: string;
    description: string;
    rawInput: string;
    imageUrls: string[];
    price: number;
    brand?: string;
    model?: string;
    storage?: string;
    condition?: string;
    color?: string;
    others?: string;
  }) {
    return this.prisma.inventoryItem.create({
      data,
      select: {
        id: true,
        title: true,
        description: true,
        rawInput: true,
        imageUrls: true,
        price: true,
        createdAt: true,
      },
    });
  }

  async findByUserId(userId: string, skip = 0, take = 20, search?: string) {
    const whereClause: any = { userId };

    if (search && search.trim()) {
      whereClause.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
        { rawInput: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          title: true,
          description: true,
          rawInput: true,
          imageUrls: true,
          price: true,
          createdAt: true,
        },
      }),
      this.prisma.inventoryItem.count({ where: whereClause }),
    ]);

    return { items, total };
  }

  async findById(id: string, userId: string) {
    return this.prisma.inventoryItem.findFirst({
      where: { id, userId },
      select: {
        id: true,
        title: true,
        description: true,
        rawInput: true,
        imageUrls: true,
        price: true,
        brand: true,
        model: true,
        storage: true,
        condition: true,
        color: true,
        others: true,
        createdAt: true,
      },
    });
  }

  async update(
    id: string,
    userId: string,
    data: {
      title?: string;
      description?: string;
      rawInput?: string;
      imageUrls?: string[];
      price?: number;
      brand?: string;
      model?: string;
      storage?: string;
      condition?: string;
      color?: string;
      others?: string;
    },
  ) {
    return this.prisma.inventoryItem.updateMany({
      where: { id, userId },
      data,
    });
  }

  async delete(id: string, userId: string) {
    return this.prisma.inventoryItem.deleteMany({
      where: { id, userId },
    });
  }
}
