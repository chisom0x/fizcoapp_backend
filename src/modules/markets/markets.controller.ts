import { Controller, Get } from '@nestjs/common';
import { MarketsService } from './markets.service';

/** Public: the signup screen lists markets before the user has an account */
@Controller('markets')
export class MarketsController {
  constructor(private readonly marketsService: MarketsService) {}

  @Get()
  async list() {
    return { message: 'Markets retrieved', data: await this.marketsService.list() };
  }
}
