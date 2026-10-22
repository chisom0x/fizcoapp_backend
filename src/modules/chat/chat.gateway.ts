import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  // Presence and active thread tracking
  private readonly connectedUsers = new Map<string, Set<string>>(); // userId -> Set<socketId>
  private readonly userActiveThreads = new Map<string, Set<string>>(); // userId -> Set<threadId>
  private readonly socketUsers = new Map<string, string>(); // socketId -> userId
  private readonly socketThreads = new Map<string, Set<string>>(); // socketId -> Set<threadId>

  constructor(
    @Inject(forwardRef(() => ChatService))
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  isUserOnline(userId: string): boolean {
    return (this.connectedUsers.get(userId)?.size ?? 0) > 0;
  }

  isUserInThread(userId: string, threadId: string): boolean {
    const threads = this.userActiveThreads.get(userId);
    if (!threads || threads.size === 0) return false;
    const clean = threadId.replace('chat_', '');
    return (
      threads.has(threadId) ||
      threads.has(clean) ||
      threads.has(`chat_${clean}`)
    );
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '') ||
        (client.handshake.query?.token as string);

      if (!token) {
        client.disconnect();
        return;
      }

      const secret =
        this.configService.get<string>('JWT_ACCESS_SECRET') ||
        'fizco_jwt_access_secret_2026';
      const payload = this.jwtService.verify(token, { secret });

      const userId = payload.sub;
      client.data.userId = userId;
      client.data.email = payload.email;

      this.socketUsers.set(client.id, userId);

      let userSockets = this.connectedUsers.get(userId);
      const wasOffline = !userSockets || userSockets.size === 0;
      if (!userSockets) {
        userSockets = new Set();
        this.connectedUsers.set(userId, userSockets);
      }
      userSockets.add(client.id);

      // Join individual user room for direct alerts
      client.join(`user_${userId}`);
      this.logger.log(`Client connected: ${client.id} (User: ${userId})`);

      // Broadcast online status to all if user was previously offline
      if (wasOffline) {
        this.server.emit('user_status', {
          userId,
          isOnline: true,
        });
      }
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.socketUsers.get(client.id) || client.data.userId;
    this.socketUsers.delete(client.id);

    // Clean up active threads tracked for this socket
    const sThreads = this.socketThreads.get(client.id);
    if (sThreads && userId) {
      const uThreads = this.userActiveThreads.get(userId);
      if (uThreads) {
        for (const t of sThreads) {
          uThreads.delete(t);
        }
      }
      this.socketThreads.delete(client.id);
    }

    if (userId) {
      const userSockets = this.connectedUsers.get(userId);
      if (userSockets) {
        userSockets.delete(client.id);
        if (userSockets.size === 0) {
          this.connectedUsers.delete(userId);
          const now = new Date();
          // Update lastSeen in database and broadcast offline status
          this.chatService.updateUserLastSeen(userId, now).catch(() => {});
          this.server.emit('user_status', {
            userId,
            isOnline: false,
            lastSeenAt: now.toISOString(),
          });
        }
      }
    }

    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_thread')
  async handleJoinThread(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { threadId: string },
  ) {
    const userId = client.data.userId;
    if (data?.threadId) {
      const cleanId = data.threadId.replace('chat_', '');
      client.join(`chat_${cleanId}`);
      client.join(cleanId);
      client.join(data.threadId);

      if (userId) {
        let uThreads = this.userActiveThreads.get(userId);
        if (!uThreads) {
          uThreads = new Set();
          this.userActiveThreads.set(userId, uThreads);
        }
        uThreads.add(data.threadId);
        uThreads.add(cleanId);
        uThreads.add(`chat_${cleanId}`);

        let sThreads = this.socketThreads.get(client.id);
        if (!sThreads) {
          sThreads = new Set();
          this.socketThreads.set(client.id, sThreads);
        }
        sThreads.add(data.threadId);
        sThreads.add(cleanId);
        sThreads.add(`chat_${cleanId}`);
      }

      // Send initial participant status to joining user
      const participantStatus = await this.chatService.getThreadParticipantStatus(
        data.threadId,
        userId,
      );
      if (participantStatus) {
        client.emit('thread_participant_status', participantStatus);
      }

      // Automatically mark messages read upon joining thread
      if (userId) {
        await this.chatService.markRead(data.threadId, userId);
      }
    }
  }

  @SubscribeMessage('leave_thread')
  handleLeaveThread(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { threadId: string },
  ) {
    const userId = client.data.userId;
    if (data?.threadId) {
      const cleanId = data.threadId.replace('chat_', '');
      client.leave(`chat_${cleanId}`);
      client.leave(cleanId);
      client.leave(data.threadId);

      if (userId) {
        const uThreads = this.userActiveThreads.get(userId);
        if (uThreads) {
          uThreads.delete(data.threadId);
          uThreads.delete(cleanId);
          uThreads.delete(`chat_${cleanId}`);
        }
      }
      const sThreads = this.socketThreads.get(client.id);
      if (sThreads) {
        sThreads.delete(data.threadId);
        sThreads.delete(cleanId);
        sThreads.delete(`chat_${cleanId}`);
      }
    }
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { threadId: string; payload: SendMessageDto; senderName: string },
  ) {
    const userId = client.data.userId;
    if (!userId || !data?.threadId) return;

    const result = await this.chatService.sendMessage(
      data.threadId,
      userId,
      data.senderName || 'Contact',
      data.payload,
    );

    const resolvedId = result.threadId || data.threadId;
    const socketPayload = {
      threadId: resolvedId,
      message: {
        ...result,
        senderId: result.senderId || userId,
        isFromMe: false,
      },
    };

    const rooms = new Set([
      `chat_${resolvedId}`,
      resolvedId,
      `chat_${data.threadId}`,
      data.threadId,
    ]);

    for (const room of rooms) {
      this.server.to(room).emit('new_message', socketPayload);
    }

    // Also emit to recipient's direct room so they receive the live message
    if (result.recipientId) {
      this.server.to(`user_${result.recipientId}`).emit('new_message', socketPayload);
      const isRecipientInThread = this.isUserInThread(result.recipientId, resolvedId);
      if (!isRecipientInThread) {
        this.server.to(`user_${result.recipientId}`).emit('chat_notification', socketPayload);
        this.server.to(`user_${result.recipientId}`).emit('new_chat_thread', socketPayload);
      }
    }

    return result;
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { threadId: string; isTyping: boolean },
  ) {
    const userId = client.data.userId;
    if (!userId || !data?.threadId) return;
    const cleanId = data.threadId.replace('chat_', '');
    const payload = {
      threadId: data.threadId,
      cleanThreadId: cleanId,
      userId,
      isTyping: !!data.isTyping,
    };
    client.to(`chat_${cleanId}`).emit('user_typing', payload);
    client.to(cleanId).emit('user_typing', payload);
    client.to(`chat_${data.threadId}`).emit('user_typing', payload);
  }

  @SubscribeMessage('get_user_status')
  async handleGetUserStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    if (!data?.userId) return;
    const isOnline = this.isUserOnline(data.userId);
    const lastSeenAt = isOnline ? null : await this.chatService.getUserLastSeen(data.userId);
    client.emit('user_status', {
      userId: data.userId,
      isOnline,
      lastSeenAt: lastSeenAt ? (lastSeenAt instanceof Date ? lastSeenAt.toISOString() : String(lastSeenAt)) : null,
    });
  }

  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { threadId: string },
  ) {
    const userId = client.data.userId;
    if (!userId || !data?.threadId) return;
    await this.chatService.markRead(data.threadId, userId);
  }

  broadcastMessagesRead(threadId: string, readerId: string) {
    if (!this.server) return;
    const cleanId = threadId.replace('chat_', '');
    const socketPayload = {
      event: 'messages_read',
      threadId,
      cleanThreadId: cleanId,
      readerId,
    };
    const rooms = new Set([
      `chat_${cleanId}`,
      cleanId,
      `chat_${threadId}`,
      threadId,
    ]);
    for (const room of rooms) {
      this.server.to(room).emit('messages_read', socketPayload);
    }
  }

  @SubscribeMessage('delete_message')
  async handleDeleteMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { threadId: string; messageId: string },
  ) {
    const userId = client.data.userId;
    if (!userId || !data?.messageId) return;

    const result = await this.chatService.deleteMessage(
      data.threadId,
      data.messageId,
      userId,
    );

    const resolvedId = result.threadId || data.threadId;
    const socketPayload = {
      threadId: resolvedId,
      originalThreadId: data.threadId,
      messageId: data.messageId,
      id: data.messageId,
      isDeleted: true,
      text: 'This message was deleted',
    };

    const rooms = new Set([
      `chat_${resolvedId}`,
      resolvedId,
      `chat_${data.threadId}`,
      data.threadId,
    ]);

    for (const room of rooms) {
      this.server.to(room).emit('message_deleted', socketPayload);
    }

    if (result.recipientId) {
      this.server.to(`user_${result.recipientId}`).emit('message_deleted', socketPayload);
    }
    this.server.to(`user_${userId}`).emit('message_deleted', socketPayload);

    return result;
  }

  broadcastNewRequest(request: any) {
    if (this.server) {
      this.server.emit('new_open_request', request);
    }
  }

  broadcastDeletedRequest(requestId: string) {
    if (this.server) {
      this.server.emit('request_deleted', { requestId, id: requestId });
    }
  }
}
