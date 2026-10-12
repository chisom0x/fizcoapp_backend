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
import { Logger } from '@nestjs/common';
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

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

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

      client.data.userId = payload.sub;
      client.data.email = payload.email;

      // Join individual user room for direct alerts
      client.join(`user_${payload.sub}`);
      this.logger.log(`Client connected: ${client.id} (User: ${payload.sub})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_thread')
  handleJoinThread(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { threadId: string },
  ) {
    if (data?.threadId) {
      client.join(`chat_${data.threadId}`);
    }
  }

  @SubscribeMessage('leave_thread')
  handleLeaveThread(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { threadId: string },
  ) {
    if (data?.threadId) {
      client.leave(`chat_${data.threadId}`);
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

    // Broadcast to everyone in the chat room
    this.server.to(`chat_${data.threadId}`).emit('new_message', {
      threadId: data.threadId,
      message: result,
    });

    // Also emit to recipient's direct room in case they aren't actively in this thread screen
    if (result.recipientId) {
      this.server.to(`user_${result.recipientId}`).emit('chat_notification', {
        threadId: data.threadId,
        message: result,
      });
    }

    return result;
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { threadId: string; isTyping: boolean },
  ) {
    const userId = client.data.userId;
    client.to(`chat_${data.threadId}`).emit('user_typing', {
      threadId: data.threadId,
      userId,
      isTyping: data.isTyping,
    });
  }

  @SubscribeMessage('delete_message')
  async handleDeleteMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { threadId: string; messageId: string },
  ) {
    const userId = client.data.userId;
    if (!userId) return;

    const result = await this.chatService.deleteMessage(
      data.threadId,
      data.messageId,
      userId,
    );

    this.server.to(`chat_${data.threadId}`).emit('message_deleted', {
      threadId: data.threadId,
      messageId: data.messageId,
    });

    return result;
  }

  broadcastNewRequest(request: any) {
    if (this.server) {
      this.server.emit('new_open_request', request);
    }
  }
}
