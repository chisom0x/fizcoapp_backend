import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ChatRepository } from './chat.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageType } from '@prisma/client';
import { ChatGateway } from './chat.gateway';
import { RequestsService } from '../requests/requests.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly chatRepository: ChatRepository,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
    @Inject(forwardRef(() => RequestsService))
    private readonly requestsService: RequestsService,
  ) {}

  async getUserThreads(userId: string) {
    const rawThreads = await this.chatRepository.findThreadsByUser(userId);

    const seenParticipants = new Set<string>();
    const uniqueThreads: any[] = [];

    for (const t of rawThreads) {
      const isCreator = t.creatorId === userId;
      // A vendor who opened the chat but never sent anything hasn't reached the requester yet
      if (isCreator && !t.lastMessageAt) {
        continue;
      }
      const participant = isCreator ? t.vendor : t.creator;
      if (seenParticipants.has(participant.id)) {
        continue;
      }
      seenParticipants.add(participant.id);
      const lastMsg = t.messages?.[0];
      const unreadCount = (t as any)._count?.messages || 0;
      const isParticipantOnline = this.chatGateway ? this.chatGateway.isUserOnline(participant.id) : false;
      const lastSeenAt = (participant as any)?.lastSeenAt ?? (participant as any)?.updatedAt ?? (participant as any)?.createdAt;

      uniqueThreads.push({
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
        participantOnline: isParticipantOnline,
        participantLastSeenAt: lastSeenAt ? (lastSeenAt instanceof Date ? lastSeenAt.toISOString() : String(lastSeenAt)) : null,
        participantLastSeen: isParticipantOnline ? 'Online' : 'Offline',
        isUserRequest: isCreator,
        isParticipantVerified: participant.isVerified,
        lastMessage: t.lastMessageText || 'Chat started',
        lastMessageTime: t.lastMessageAt || t.createdAt,
        unreadCount,
        lastMessageSentByMe: lastMsg?.senderId === userId,
      });
    }

    return uniqueThreads;
  }

  async getThreadMessages(threadId: string, userId: string, take = 50, before?: string) {
    const thread = await this.chatRepository.findThreadByIdOrContext(threadId, userId);
    if (!thread) {
      throw new NotFoundException('Chat thread not found');
    }

    if (thread.creatorId !== userId && thread.vendorId !== userId) {
      throw new ForbiddenException('Not authorized to access this conversation');
    }

    const messages = await this.chatRepository.findMessagesByThread(
      thread.id,
      take,
      before,
    );

    // Auto mark read for current user; older pages hold nothing new to mark
    if (!before) {
      await this.chatRepository.markMessagesRead(thread.id, userId);
      if (this.chatGateway) {
        this.chatGateway.broadcastMessagesRead(thread.id, userId);
      }
    }

    const otherParticipantId =
      thread.creatorId === userId ? thread.vendorId : thread.creatorId;

    return messages.map((m) => {
      const isFromMe = m.senderId === userId;
      const isRead = isFromMe
        ? (Array.isArray(m.readBy) &&
            (m.readBy.includes(otherParticipantId) ||
              m.readBy.some((id: string) => id !== userId)))
        : true;

      return {
        id: m.id,
        text: m.isDeleted ? 'This message was deleted' : m.text,
        imageUrl: m.isDeleted ? null : m.imageUrl,
        timestamp: m.createdAt,
        isFromMe,
        isSystem: m.isSystem,
        isDeleted: m.isDeleted,
        taggedRequestId: m.taggedRequestId,
        taggedRequest: m.taggedRequest,
        replyToMessageId: m.replyToMessageId,
        replyToSenderName: m.replyToSenderName,
        replyToText: (m as any).replyToText || m.replyToMessage?.text || null,
        isRead,
      };
    });
  }

  async sendMessage(
    threadId: string,
    senderId: string,
    senderName: string,
    dto: SendMessageDto,
  ) {
    const thread = await this.chatRepository.findThreadByIdOrContext(
      threadId,
      senderId,
      dto.taggedRequestId,
    );
    if (!thread) {
      throw new NotFoundException('Chat thread not found');
    }

    if (thread.creatorId !== senderId && thread.vendorId !== senderId) {
      throw new ForbiddenException('Not authorized to send messages to this conversation');
    }

    const resolvedThreadId = thread.id;
    const recipientId = thread.creatorId === senderId ? thread.vendorId : thread.creatorId;

    // Tagging a request is how a vendor shows interest in it, so it's checked before the message
    // is saved and recorded after, never on its own
    const interestRequest = dto.taggedRequestId
      ? await this.requestsService.assertCanShowInterest(dto.taggedRequestId, senderId)
      : null;
    if (interestRequest && interestRequest.requesterId !== recipientId) {
      throw new BadRequestException('A request can only be tagged in a chat with its creator');
    }

    let type: MessageType = MessageType.TEXT;
    if (dto.imageUrl) type = MessageType.IMAGE;
    if (dto.taggedRequestId) type = MessageType.REQUEST_ATTACHMENT;

    const message = await this.chatRepository.createMessage({
      threadId: resolvedThreadId,
      senderId,
      text: dto.text || (dto.imageUrl ? 'Photo' : 'Request attachment'),
      imageUrl: dto.imageUrl,
      type,
      taggedRequestId: dto.taggedRequestId,
      replyToMessageId: dto.replyToMessageId,
      replyToSenderName: dto.replyToSenderName,
      replyToText: dto.replyToText,
    });

    if (interestRequest) {
      await this.requestsService.recordInterest(
        interestRequest,
        senderId,
        senderName,
        resolvedThreadId,
      );
    }

    // Check if recipient is actively on this chat thread screen right now
    const isRecipientInThread = this.chatGateway
      ? this.chatGateway.isUserInThread(recipientId, resolvedThreadId)
      : false;

    // If NOT actively on this chat screen, dispatch push and in-app notification to save on notifications page
    if (!isRecipientInThread) {
      const notifText = dto.imageUrl ? '📷 Sent a photo' : (dto.text || 'Sent an attachment');
      this.notificationsService
        .notifyUser(recipientId, senderName, notifText, {
          type: 'NEW_MESSAGE',
          chatThreadId: resolvedThreadId,
          senderId,
          senderName,
        })
        .catch(() => {});
    } else {
      // Recipient is already in thread viewing the conversation
      await this.chatRepository.markMessagesRead(resolvedThreadId, recipientId);
      if (this.chatGateway) {
        this.chatGateway.broadcastMessagesRead(resolvedThreadId, recipientId);
      }
    }

    return {
      id: message.id,
      threadId: resolvedThreadId,
      senderId: message.senderId,
      text: message.text,
      imageUrl: message.imageUrl,
      timestamp: message.createdAt,
      isFromMe: true,
      isSystem: message.isSystem,
      isDeleted: message.isDeleted,
      taggedRequestId: message.taggedRequestId,
      taggedRequest: message.taggedRequest,
      replyToMessageId: message.replyToMessageId,
      replyToSenderName: message.replyToSenderName,
      replyToText: message.replyToText || dto.replyToText || null,
      recipientId,
      isRead: isRecipientInThread,
    };
  }

  async deleteMessage(threadId: string, messageId: string, senderId: string) {
    const deleted = await this.chatRepository.softDeleteMessage(messageId, senderId);
    const resolvedThreadId = deleted?.threadId || threadId;
    const recipientId = deleted?.thread
      ? (deleted.thread.creatorId === senderId ? deleted.thread.vendorId : deleted.thread.creatorId)
      : null;

    return {
      id: messageId,
      threadId: resolvedThreadId,
      isDeleted: true,
      text: 'This message was deleted',
      recipientId,
    };
  }

  async markRead(threadId: string, userId: string) {
    const count = await this.chatRepository.markMessagesRead(threadId, userId);
    if (this.chatGateway) {
      this.chatGateway.broadcastMessagesRead(threadId, userId);
    }
    return { count };
  }

  async updateUserLastSeen(userId: string, date: Date) {
    return this.chatRepository.updateUserLastSeen(userId, date);
  }

  async getUserLastSeen(userId: string) {
    return this.chatRepository.getUserLastSeen(userId);
  }

  async getThreadParticipantStatus(threadId: string, currentUserId: string) {
    const thread = await this.chatRepository.findThreadByIdOrContext(threadId, currentUserId);
    if (!thread) return null;
    const participantId = thread.creatorId === currentUserId ? thread.vendorId : thread.creatorId;
    const participant = thread.creatorId === currentUserId ? thread.vendor : thread.creator;
    const isOnline = this.chatGateway ? this.chatGateway.isUserOnline(participantId) : false;
    const lastSeenAt = (participant as any)?.lastSeenAt ?? (participant as any)?.updatedAt ?? (participant as any)?.createdAt;
    return {
      threadId,
      participantId,
      isOnline,
      lastSeenAt: lastSeenAt ? (lastSeenAt instanceof Date ? lastSeenAt.toISOString() : String(lastSeenAt)) : null,
    };
  }
}
