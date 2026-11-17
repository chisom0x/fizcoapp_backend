import { Injectable, Logger, OnModuleInit, Inject, forwardRef, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, cert, App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';
import { NotificationsRepository } from './notifications.repository';
import { ChatGateway } from '../chat/chat.gateway';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private firebaseApp: App | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationsRepository: NotificationsRepository,
    @Optional()
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway?: ChatGateway,
  ) {}

  onModuleInit() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    try {
      const credPath =
        this.configService.get<string>('FIREBASE_CREDENTIALS_PATH') ||
        './firebase-service-account.json';
      const resolvedPath = path.resolve(process.cwd(), credPath);

      if (fs.existsSync(resolvedPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
        this.firebaseApp = initializeApp({
          credential: cert(serviceAccount),
        });
        this.logger.log('Firebase Admin SDK initialized successfully');
      } else {
        this.logger.warn(`Firebase service account file not found at: ${resolvedPath}`);
      }
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error instanceof Error ? error.message : String(error));
    }
  }

  async saveToken(userId: string, fcmToken: string) {
    return this.notificationsRepository.saveFcmToken(userId, fcmToken);
  }

  async updatePreferences(userId: string, enabled: boolean) {
    return this.notificationsRepository.updateNotificationPreferences(userId, enabled);
  }

  async getPreferences(userId: string) {
    return this.notificationsRepository.getUserNotificationSettings(userId);
  }

  async sendPushNotification(
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<boolean> {
    if (!this.firebaseApp || !fcmToken) return false;

    try {
      // Ensure all data values are strictly strings for FCM compatibility
      const sanitizedData: Record<string, string> = {};
      if (data) {
        for (const [key, val] of Object.entries(data)) {
          if (val !== undefined && val !== null) {
            sanitizedData[key] = typeof val === 'string' ? val : JSON.stringify(val);
          }
        }
      }

      // The app registers with FCM and stores its Firebase Installation ID (FID) as fcmToken
      await getMessaging(this.firebaseApp).send({
        fid: fcmToken,
        notification: {
          title,
          body,
        },
        data: sanitizedData,
        android: {
          priority: 'high',
          notification: {
            channelId: 'fizco_channel',
            sound: 'default',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
            // No clickAction: Android then launches the app's main activity on tap, and
            // firebase_messaging hands the message to onMessageOpenedApp / getInitialMessage
          },
        },
        apns: {
          headers: {
            'apns-priority': '10',
          },
          payload: {
            aps: {
              alert: {
                title,
                body,
              },
              sound: 'default',
              badge: 1,
              contentAvailable: true,
            },
          },
        },
      });
      return true;
    } catch (error) {
      this.logger.error(`Error sending FCM push notification: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Stores, pushes and emits a notification. When it's caused by another user ([fromUserId]),
   * it's dropped unless both are in the same market; returns null then
   */
  async notifyUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, any>,
    options?: { fromUserId?: string },
  ) {
    if (
      options?.fromUserId &&
      !(await this.notificationsRepository.inSameMarket(userId, options.fromUserId))
    ) {
      return null;
    }

    // 1. Create in-app notification in DB
    const created = await this.notificationsRepository.create({
      userId,
      title,
      body,
      data,
    });

    // 2. Dispatch FCM push notification if user has enabled notifications and has a registered token
    const settings = await this.notificationsRepository.getUserNotificationSettings(userId);
    if (settings.notificationsEnabled && settings.fcmToken) {
      await this.sendPushNotification(settings.fcmToken, title, body, data);
    }

    // 3. Emit real-time notification to user's personal socket room
    try {
      if (this.chatGateway?.server) {
        this.chatGateway.server.to(`user_${userId}`).emit('new_notification', {
          id: created.id,
          title,
          body,
          data,
          createdAt: (created as any).createdAt || new Date().toISOString(),
        });
        if (data?.type === 'TEAM_INVITE_ACCEPTED') {
          this.chatGateway.server.to(`user_${userId}`).emit('team_member_signed_up', data);
        }
      }
    } catch (err) {
      this.logger.debug(`Socket notification emit error: ${err}`);
    }

    return created;
  }

  /**
   * Tell vendors whose inventory matches a newly posted request that they can respond to it
   */
  async notifyMatchingVendors(
    requestId: string,
    requestTitle: string,
    vendorIds: string[],
    onNotify?: (userId: string, payload: any) => void,
  ) {
    const payload = {
      title: '🔥 New Request Matching Your Inventory!',
      body: `A buyer just requested "${requestTitle}". You have this in stock—tap to respond!`,
      data: { requestId, type: 'REQUEST_MATCH' },
    };
    // One vendor's failed delivery must not stop the others from hearing about the request
    const results = await Promise.allSettled(
      vendorIds.map(async (vendorId) => {
        await this.notifyUser(vendorId, payload.title, payload.body, payload.data);
        onNotify?.(vendorId, payload);
      }),
    );
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        this.logger.error(
          `Failed to notify vendor ${vendorIds[i]} of request ${requestId}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
        );
      }
    });
  }

  async getUserNotifications(userId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [{ items, total }, unreadCount] = await Promise.all([
      this.notificationsRepository.findByUserId(userId, skip, limit),
      this.notificationsRepository.countUnread(userId),
    ]);
    return {
      data: items,
      unreadCount,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUnreadCount(userId: string) {
    return this.notificationsRepository.countUnread(userId);
  }

  async markAsRead(id: string, userId: string) {
    return this.notificationsRepository.markAsRead(id, userId);
  }

  async markAllAsRead(userId: string) {
    return this.notificationsRepository.markAllAsRead(userId);
  }
}
