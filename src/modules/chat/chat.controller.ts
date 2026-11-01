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
import { ThreadMessagesQueryDto } from './dto/thread-messages-query.dto';

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

  @Get(':id/participant')
  async getParticipant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') threadId: string,
  ) {
    const profile = await this.chatService.getThreadParticipantProfile(threadId, user.id);
    return {
      message: 'Contact profile retrieved',
      data: profile,
    };
  }

  @Get(':id/messages')
  async getMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') threadId: string,
    @Query() query: ThreadMessagesQueryDto,
  ) {
    const messages = await this.chatService.getThreadMessages(
      threadId,
      user.id,
      query.limit,
      query.before,
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
      const resolvedId = message.threadId || threadId;
      const socketPayload = {
        threadId: resolvedId,
        message: {
          ...message,
          senderId: message.senderId || user.id,
          isFromMe: false,
        },
      };

      const rooms = new Set([
        `chat_${resolvedId}`,
        resolvedId,
        `chat_${threadId}`,
        threadId,
      ]);

      for (const room of rooms) {
        this.chatGateway.server.to(room).emit('new_message', socketPayload);
      }

      if (message.recipientId) {
        this.chatGateway.server.to(`user_${message.recipientId}`).emit('new_message', socketPayload);
        const isRecipientInThread = this.chatGateway.isUserInThread(message.recipientId, resolvedId);
        if (!isRecipientInThread) {
          this.chatGateway.server.to(`user_${message.recipientId}`).emit('chat_notification', socketPayload);
          this.chatGateway.server.to(`user_${message.recipientId}`).emit('new_chat_thread', socketPayload);
        }
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
      const resolvedId = result.threadId || threadId;
      const socketPayload = {
        threadId: resolvedId,
        originalThreadId: threadId,
        messageId,
        id: messageId,
        isDeleted: true,
        text: 'This message was deleted',
      };

      const rooms = new Set([
        `chat_${resolvedId}`,
        resolvedId,
        `chat_${threadId}`,
        threadId,
      ]);

      for (const room of rooms) {
        this.chatGateway.server.to(room).emit('message_deleted', socketPayload);
      }

      if (result.recipientId) {
        this.chatGateway.server.to(`user_${result.recipientId}`).emit('message_deleted', socketPayload);
      }
      this.chatGateway.server.to(`user_${user.id}`).emit('message_deleted', socketPayload);
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
