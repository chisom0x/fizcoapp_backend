import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MarketsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.market.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  /** With how many live accounts are in each, for the admin panel */
  findAllWithUserCounts() {
    return this.prisma.market.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { users: { where: { deletedAt: null } } } },
      },
    });
  }

  findById(id: string) {
    return this.prisma.market.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
  }

  /** Names are unique regardless of case, so "Ikeja" and "ikeja" can't both exist */
  findByName(name: string) {
    return this.prisma.market.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
  }

  create(name: string) {
    return this.prisma.market.create({ data: { name }, select: { id: true, name: true } });
  }

  rename(id: string, name: string) {
    return this.prisma.market.update({
      where: { id },
      data: { name },
      select: { id: true, name: true },
    });
  }

  countUsers(id: string) {
    return this.prisma.user.count({ where: { marketId: id, deletedAt: null } });
  }

  delete(id: string) {
    return this.prisma.market.delete({ where: { id } });
  }
}
