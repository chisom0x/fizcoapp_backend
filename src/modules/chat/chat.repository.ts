import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageType, Prisma } from '@prisma/client';

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
            avatarUrl: true,
            deletedAt: true,
            lastSeenAt: true,
            updatedAt: true,
            createdAt: true,
          },
        },
        vendor: {
          select: {
            id: true,
            fullName: true,
            isVerified: true,
            avatarUrl: true,
            deletedAt: true,
            lastSeenAt: true,
            updatedAt: true,
            createdAt: true,
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
        _count: {
          select: {
            messages: {
              where: {
                senderId: { not: userId },
                NOT: {
                  readBy: {
                    has: userId,
                  },
                },
              },
            },
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
            avatarUrl: true,
            deletedAt: true,
            lastSeenAt: true,
            updatedAt: true,
            createdAt: true,
          },
        },
        vendor: {
          select: {
            id: true,
            fullName: true,
            isVerified: true,
            avatarUrl: true,
            deletedAt: true,
            lastSeenAt: true,
            updatedAt: true,
            createdAt: true,
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

  async findThreadByIdOrContext(
    id: string,
    currentUserId?: string,
    taggedRequestId?: string,
  ) {
    // 1. Direct UUID lookup
    const direct = await this.findThreadById(id);
    if (direct) return direct;

    // 2. Parse compound format: chat_<requestId>_<vendorId>
    if (id.startsWith('chat_')) {
      const stripped = id.replace('chat_', '');
      const parts = stripped.split('_');
      if (parts.length >= 2) {
        // First check if thread exists between the two users
        if (currentUserId) {
          const peerId = parts[1] === currentUserId ? parts[0] : parts[1];
          const existingBetweenUsers = await this.prisma.chatThread.findFirst({
            where: {
              OR: [
                { creatorId: currentUserId, vendorId: peerId },
                { creatorId: peerId, vendorId: currentUserId },
              ],
            },
            orderBy: { updatedAt: 'desc' },
            select: { id: true },
          });
          if (existingBetweenUsers) {
            return this.findThreadById(existingBetweenUsers.id);
          }
        }

        const byReqAndUser = await this.prisma.chatThread.findFirst({
          where: {
            requestId: parts[0],
            OR: [{ creatorId: parts[1] }, { vendorId: parts[1] }],
          },
          select: { id: true },
        });
        if (byReqAndUser) return this.findThreadById(byReqAndUser.id);
      }
    }

    // 3. Auto-resolve by taggedRequestId if present
    if (taggedRequestId && currentUserId) {
      const request = await this.prisma.request.findUnique({
        where: { id: taggedRequestId },
        select: {
          id: true,
          requesterId: true,
        },
      });

      if (request) {
        const vendorId = request.requesterId === currentUserId ? null : currentUserId;
        if (vendorId) {
          // Check if a thread already exists between these two users!
          let thread = await this.prisma.chatThread.findFirst({
            where: {
              OR: [
                { creatorId: request.requesterId, vendorId },
                { creatorId: vendorId, vendorId: request.requesterId },
              ],
            },
            orderBy: { updatedAt: 'desc' },
          });

          if (!thread) {
            thread = await this.prisma.chatThread.create({
              data: {
                requestId: request.id,
                creatorId: request.requesterId,
                vendorId,
              },
            });
          }

          return this.findThreadById(thread.id);
        }
      }
    }

    return null;
  }

  /** The newest `take` messages, or those just older than message `before`, oldest first */
  async findMessagesByThread(threadId: string, take = 50, before?: string) {
    const messages = await this.prisma.message.findMany({
      where: { threadId },
      // id breaks createdAt ties so the cursor walks a stable order
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(before ? { cursor: { id: before }, skip: 1 } : {}),
      take,
      select: {
        id: true,
        text: true,
        imageUrl: true,
        videoUrl: true,
        type: true,
        isSystem: true,
        isDeleted: true,
        senderId: true,
        taggedRequestId: true,
        inventoryItem: true,
        taggedRequest: {
          select: {
            id: true,
            title: true,
            status: true,
            isDeleted: true,
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
        replyToText: true,
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

    return messages.reverse();
  }

  async createMessage(data: {
    threadId: string;
    senderId: string;
    text: string;
    imageUrl?: string;
    videoUrl?: string;
    type?: MessageType;
    isSystem?: boolean;
    taggedRequestId?: string;
    inventoryItem?: Prisma.InputJsonValue;
    replyToMessageId?: string;
    replyToSenderName?: string;
    replyToText?: string;
  }) {
    const message = await this.prisma.message.create({
      data: {
        threadId: data.threadId,
        senderId: data.senderId,
        text: data.text,
        imageUrl: data.imageUrl,
        videoUrl: data.videoUrl,
        type: data.type || MessageType.TEXT,
        isSystem: data.isSystem || false,
        taggedRequestId: data.taggedRequestId,
        inventoryItem: data.inventoryItem,
        replyToMessageId: data.replyToMessageId,
        replyToSenderName: data.replyToSenderName,
        replyToText: data.replyToText,
        readBy: [data.senderId],
      },
      select: {
        id: true,
        text: true,
        imageUrl: true,
        videoUrl: true,
        type: true,
        isSystem: true,
        isDeleted: true,
        senderId: true,
        taggedRequestId: true,
        inventoryItem: true,
        taggedRequest: {
          select: {
            id: true,
            title: true,
            status: true,
            isDeleted: true,
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
        replyToText: true,
        readBy: true,
        createdAt: true,
      },
    });

    // Update parent thread's preview
    await this.prisma.chatThread.update({
      where: { id: data.threadId },
      data: {
        lastMessageText: data.text || (data.videoUrl ? 'Video' : data.imageUrl ? 'Photo' : 'Attachment'),
        lastMessageAt: message.createdAt,
      },
    });

    return message;
  }

  async softDeleteMessage(messageId: string, senderId: string) {
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { thread: true },
    });

    if (!msg) {
      return null;
    }
    // Covers both the REST and socket delete paths, which share this method
    if (msg.senderId !== senderId) {
      throw new ForbiddenException('You can only delete messages you sent');
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        text: 'This message was deleted',
        imageUrl: null,
        videoUrl: null,
      },
      include: {
        thread: {
          select: {
            id: true,
            creatorId: true,
            vendorId: true,
            lastMessageAt: true,
          },
        },
      },
    });

    // Check if this was the latest message in the thread
    const latestMsg = await this.prisma.message.findFirst({
      where: { threadId: updated.threadId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, text: true, isDeleted: true },
    });

    if (latestMsg && latestMsg.id === messageId) {
      await this.prisma.chatThread.update({
        where: { id: updated.threadId },
        data: {
          lastMessageText: 'This message was deleted',
        },
      });
    }

    return updated;
  }

  async markMessagesRead(threadId: string, userId: string) {
    // One statement however long the history is: opening a chat waits on this, and the
    // row-level WHERE recheck keeps concurrent calls from pushing the same id twice
    const { count } = await this.prisma.message.updateMany({
      where: {
        threadId,
        NOT: {
          readBy: { has: userId },
        },
      },
      data: {
        readBy: { push: userId },
      },
    });

    return count;
  }

  async updateUserLastSeen(userId: string, date: Date) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt: date },
      select: { id: true, lastSeenAt: true },
    });
  }

  async findParticipantProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        businessName: true,
        shopAddress: true,
        email: true,
        phoneNumber: true,
        avatarUrl: true,
        plazaImageUrl: true,
        isVerified: true,
        deletedAt: true,
      },
    });
  }

  async getUserLastSeen(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, lastSeenAt: true, updatedAt: true, createdAt: true },
    });
    return user?.lastSeenAt ?? user?.updatedAt ?? user?.createdAt ?? null;
  }
}
