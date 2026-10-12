import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsRepository } from './requests.repository';
import { RequestsController } from './requests.controller';

import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [ChatModule],
  controllers: [RequestsController],
  providers: [RequestsService, RequestsRepository],
  exports: [RequestsService, RequestsRepository],
})
export class RequestsModule {}
