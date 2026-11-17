import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MarketsRepository } from './markets.repository';

@Injectable()
export class MarketsService {
  constructor(private readonly repo: MarketsRepository) {}

  list() {
    return this.repo.findAll();
  }

  async listForAdmin() {
    const markets = await this.repo.findAllWithUserCounts();
    return markets.map(({ _count, ...m }) => ({ ...m, userCount: _count.users }));
  }

  /** For signup and settings: the chosen market has to exist */
  async assertExists(id: string) {
    const market = await this.repo.findById(id);
    if (!market) {
      throw new BadRequestException('That market is no longer available. Please pick another.');
    }
    return market;
  }

  async create(name: string) {
    await this.assertNameFree(name);
    return this.withUniqueName(() => this.repo.create(name));
  }

  async rename(id: string, name: string) {
    if (!(await this.repo.findById(id))) throw new NotFoundException('Market not found');
    await this.assertNameFree(name, id);
    return this.withUniqueName(() => this.repo.rename(id, name));
  }

  async remove(id: string) {
    if (!(await this.repo.findById(id))) throw new NotFoundException('Market not found');
    const users = await this.repo.countUsers(id);
    if (users > 0) {
      throw new ConflictException(
        `${users} user${users === 1 ? ' is' : 's are'} in this market. Move them to another market before deleting it.`,
      );
    }
    try {
      await this.repo.delete(id);
    } catch (err) {
      // Someone joined between the count and the delete; the foreign key refuses it
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException('Users joined this market just now. Try again.');
      }
      throw err;
    }
    return { deleted: true, id };
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const existing = await this.repo.findByName(name);
    if (existing && existing.id !== exceptId) {
      throw new ConflictException(`A market called "${existing.name}" already exists`);
    }
  }

  private async withUniqueName<T>(write: () => Promise<T>) {
    try {
      return await write();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A market with that name already exists');
      }
      throw err;
    }
  }
}
