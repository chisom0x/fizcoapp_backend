import { Module } from '@nestjs/common';
import { MarketsController } from './markets.controller';
import { MarketsRepository } from './markets.repository';
import { MarketsService } from './markets.service';

@Module({
  controllers: [MarketsController],
  providers: [MarketsRepository, MarketsService],
  exports: [MarketsService],
})
export class MarketsModule {}
