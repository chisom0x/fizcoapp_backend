import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageType } from '@prisma/client';

@Injectable()
export class ChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findThreadsByUser(userId: string) {
    return this.prisma.chatThread.findMany({
      where: {
        OR: [{ creatorId: userId }, { vendorId: userId }],
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        requestId: true,
        creatorId: true,
        vendorId: true,
        lastMessageText: true,
        lastMessageAt: true,
        createdAt: true,
        updatedAt: true,
        request: {
          select: {
            id: true,
            title: true,
            status: true,
            requesterId: true,
            fulfilledByVendorId: true,
            fulfilledByVendor: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
        },
        creator: {
          select: {
            id: true,
            fullName: true,
            isVerified: true,
          },
        },
        vendor: {
          select: {
            id: true,
            fullName: true,
            isVerified: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            text: true,
            imageUrl: true,
            senderId: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async findThreadById(id: string) {
    return this.prisma.chatThread.findUnique({
      where: { id },
      select: {
        id: true,
        requestId: true,
        creatorId: true,
        vendorId: true,
        creator: {
          select: {
            id: true,
            fullName: true,
            isVerified: true,
          },
        },
        vendor: {
          select: {
            id: true,
            fullName: true,
            isVerified: true,
          },
        },
        request: {
          select: {
            id: true,
            title: true,
            status: true,
            createdAt: true,
            fulfilledByVendorId: true,
            fulfilledByVendor: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
        },
      },
    });
  }

  async findMessagesByThread(threadId: string, skip = 0, take = 50) {
    return this.prisma.message.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
      skip,
      take,
      select: {
        id: true,
        text: true,
        imageUrl: true,
        type: true,
        isSystem: true,
        isDeleted: true,
        senderId: true,
        taggedRequestId: true,
        taggedRequest: {
          select: {
            id: true,
            title: true,
            status: true,
            requester: {
              select: {
                fullName: true,
                isVerified: true,
              },
            },
          },
        },
        replyToMessageId: true,
        replyToSenderName: true,
        replyToMessage: {
          select: {
            id: true,
            text: true,
            senderId: true,
          },
        },
        readBy: true,
        createdAt: true,
      },
    });
  }

  async createMessage(data: {
    threadId: string;
    senderId: string;
    text: string;
    imageUrl?: string;
    type?: MessageType;
    isSystem?: boolean;
    taggedRequestId?: string;
    replyToMessageId?: string;
    replyToSenderName?: string;
  }) {
    const message = await this.prisma.message.create({
      data: {
        threadId: data.threadId,
        senderId: data.senderId,
        text: data.text,
        imageUrl: data.imageUrl,
        type: data.type || MessageType.TEXT,
        isSystem: data.isSystem || false,
        taggedRequestId: data.taggedRequestId,
        replyToMessageId: data.replyToMessageId,
        replyToSenderName: data.replyToSenderName,
        readBy: [data.senderId],
      },
      select: {
        id: true,
        text: true,
        imageUrl: true,
        type: true,
        isSystem: true,
        isDeleted: true,
        senderId: true,
        taggedRequestId: true,
        taggedRequest: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
        replyToMessageId: true,
        replyToSenderName: true,
        readBy: true,
        createdAt: true,
      },
    });

    // Update parent thread's preview
    await this.prisma.chatThread.update({
      where: { id: data.threadId },
      data: {
        lastMessageText: data.text || (data.imageUrl ? 'Photo' : 'Attachment'),
        lastMessageAt: message.createdAt,
      },
    });

    return message;
  }

  async softDeleteMessage(messageId: string, senderId: string) {
    return this.prisma.message.updateMany({
      where: {
        id: messageId,
        senderId,
      },
      data: {
        isDeleted: true,
        text: 'This message was deleted',
        imageUrl: null,
      },
    });
  }

  async markMessagesRead(threadId: string, userId: string) {
    const unread = await this.prisma.message.findMany({
      where: {
        threadId,
        NOT: {
          readBy: { has: userId },
        },
      },
      select: { id: true, readBy: true },
    });

    for (const msg of unread) {
      await this.prisma.message.update({
        where: { id: msg.id },
        data: {
          readBy: { push: userId },
        },
      });
    }

    return unread.length;
  }
}
