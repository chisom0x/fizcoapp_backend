import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FeedbackRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, rating: number, comment?: string) {
    return this.prisma.feedback.create({
      data: {
        userId,
        rating,
        comment,
      },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
      },
    });
  }
}
