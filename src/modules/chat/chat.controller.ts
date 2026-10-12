import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

import { ChatGateway } from './chat.gateway';

@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
  ) {}

  @Get()
  async getThreads(@CurrentUser() user: AuthenticatedUser) {
    const threads = await this.chatService.getUserThreads(user.id);
    return {
      message: 'Conversations retrieved',
      data: threads,
    };
  }

  @Get(':id/messages')
  async getMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') threadId: string,
    @Query() query: PaginationQueryDto,
  ) {
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const messages = await this.chatService.getThreadMessages(
      threadId,
      user.id,
      skip,
      limit,
    );

    return {
      message: 'Messages retrieved',
      data: messages,
    };
  }

  @Post(':id/messages')
  async sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') threadId: string,
    @Body() dto: SendMessageDto,
  ) {
    const message = await this.chatService.sendMessage(
      threadId,
      user.id,
      user.fullName,
      dto,
    );

    // Broadcast in real-time to active socket room and recipient
    if (this.chatGateway.server) {
      this.chatGateway.server.to(`chat_${threadId}`).emit('new_message', {
        threadId,
        message,
      });
      if (message.recipientId) {
        this.chatGateway.server.to(`user_${message.recipientId}`).emit('chat_notification', {
          threadId,
          message,
        });
      }
    }

    return {
      message: 'Message sent',
      data: message,
    };
  }

  @Delete(':threadId/messages/:messageId')
  async deleteMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('threadId') threadId: string,
    @Param('messageId') messageId: string,
  ) {
    const result = await this.chatService.deleteMessage(
      threadId,
      messageId,
      user.id,
    );

    if (this.chatGateway.server) {
      this.chatGateway.server.to(`chat_${threadId}`).emit('message_deleted', {
        threadId,
        messageId,
      });
    }

    return {
      message: 'Message deleted',
      data: result,
    };
  }

  @Patch(':id/read')
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') threadId: string,
  ) {
    const result = await this.chatService.markRead(threadId, user.id);
    return {
      message: 'Messages marked as read',
      data: result,
    };
  }
}
