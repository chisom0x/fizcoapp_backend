import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ChatRepository } from './chat.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageType } from '@prisma/client';

@Injectable()
export class ChatService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getUserThreads(userId: string) {
    const rawThreads = await this.chatRepository.findThreadsByUser(userId);

    return rawThreads.map((t) => {
      const isCreator = t.creatorId === userId;
      const participant = isCreator ? t.vendor : t.creator;
      const lastMsg = t.messages?.[0];

      return {
        id: t.id,
        requestId: t.requestId,
        requestTitle: t.request.title,
        requestCreatorName: t.creator.fullName,
        requestCreatedAt: t.createdAt,
        requestStatus: t.request.status.toLowerCase(),
        fulfilledByVendorId: t.request.fulfilledByVendorId,
        fulfilledByVendorName: t.request.fulfilledByVendor?.fullName || null,
        participantId: participant.id,
        participantName: participant.fullName,
        participantLastSeen: 'Online',
        isUserRequest: isCreator,
        isParticipantVerified: participant.isVerified,
        lastMessage: t.lastMessageText || 'Chat started',
        lastMessageTime: t.lastMessageAt || t.createdAt,
        unreadCount: 0,
        lastMessageSentByMe: lastMsg?.senderId === userId,
      };
    });
  }

  async getThreadMessages(threadId: string, userId: string, skip = 0, take = 50) {
    const thread = await this.chatRepository.findThreadById(threadId);
    if (!thread) {
      throw new NotFoundException('Chat thread not found');
    }

    if (thread.creatorId !== userId && thread.vendorId !== userId) {
      throw new ForbiddenException('Not authorized to access this conversation');
    }

    const messages = await this.chatRepository.findMessagesByThread(
      threadId,
      skip,
      take,
    );

    // Auto mark read for current user
    await this.chatRepository.markMessagesRead(threadId, userId);

    return messages.map((m) => ({
      id: m.id,
      text: m.text,
      imageUrl: m.imageUrl,
      timestamp: m.createdAt,
      isFromMe: m.senderId === userId,
      isSystem: m.isSystem,
      isDeleted: m.isDeleted,
      taggedRequestId: m.taggedRequestId,
      taggedRequest: m.taggedRequest,
      replyToMessageId: m.replyToMessageId,
      replyToSenderName: m.replyToSenderName,
      replyToText: m.replyToMessage?.text || null,
    }));
  }

  async sendMessage(
    threadId: string,
    senderId: string,
    senderName: string,
    dto: SendMessageDto,
  ) {
    const thread = await this.chatRepository.findThreadById(threadId);
    if (!thread) {
      throw new NotFoundException('Chat thread not found');
    }

    if (thread.creatorId !== senderId && thread.vendorId !== senderId) {
      throw new ForbiddenException('Not authorized to send messages to this conversation');
    }

    let type: MessageType = MessageType.TEXT;
    if (dto.imageUrl) type = MessageType.IMAGE;
    if (dto.taggedRequestId) type = MessageType.REQUEST_ATTACHMENT;

    const message = await this.chatRepository.createMessage({
      threadId,
      senderId,
      text: dto.text || (dto.imageUrl ? 'Photo' : 'Request attachment'),
      imageUrl: dto.imageUrl,
      type,
      taggedRequestId: dto.taggedRequestId,
      replyToMessageId: dto.replyToMessageId,
      replyToSenderName: dto.replyToSenderName,
    });

    // Notify recipient
    const recipientId = thread.creatorId === senderId ? thread.vendorId : thread.creatorId;
    await this.notificationsService.notifyUser(
      recipientId,
      `💬 Message from ${senderName}`,
      message.text,
      {
        chatThreadId: threadId,
        type: 'CHAT_MESSAGE',
      },
    );

    return {
      id: message.id,
      text: message.text,
      imageUrl: message.imageUrl,
      timestamp: message.createdAt,
      isFromMe: true,
      isSystem: message.isSystem,
      isDeleted: message.isDeleted,
      taggedRequestId: message.taggedRequestId,
      replyToMessageId: message.replyToMessageId,
      replyToSenderName: message.replyToSenderName,
      recipientId,
    };
  }

  async deleteMessage(threadId: string, messageId: string, senderId: string) {
    await this.chatRepository.softDeleteMessage(messageId, senderId);
    return {
      id: messageId,
      isDeleted: true,
      text: 'This message was deleted',
    };
  }

  async markRead(threadId: string, userId: string) {
    const count = await this.chatRepository.markMessagesRead(threadId, userId);
    return { count };
  }
}
