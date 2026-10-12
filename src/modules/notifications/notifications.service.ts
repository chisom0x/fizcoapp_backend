import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, cert, App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';
import { NotificationsRepository } from './notifications.repository';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private firebaseApp: App | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationsRepository: NotificationsRepository,
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

  async sendPushNotification(
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<boolean> {
    if (!this.firebaseApp || !fcmToken) return false;

    try {
      await getMessaging(this.firebaseApp).send({
        token: fcmToken,
        notification: {
          title,
          body,
        },
        data: data || {},
      });
      return true;
    } catch (error) {
      this.logger.error(`Error sending FCM push notification: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async notifyUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    // 1. Create in-app notification in DB
    const created = await this.notificationsRepository.create({
      userId,
      title,
      body,
      data,
    });

    // 2. Dispatch FCM push notification if user has a registered token
    const token = await this.notificationsRepository.getUserFcmToken(userId);
    if (token) {
      await this.sendPushNotification(token, title, body, data);
    }

    return created;
  }

  /**
   * Broadcast notification to vendors whose inventory matches a newly posted request
   */
  async notifyMatchingVendors(
    requestId: string,
    requestTitle: string,
    brand: string,
    model: string,
    creatorId: string,
  ) {
    try {
      const matches = await this.notificationsRepository.findVendorsWithMatchingInventory(
        brand,
        model,
        creatorId,
      );

      for (const item of matches) {
        await this.notifyUser(
          item.userId,
          '🔥 New Request Matching Your Inventory!',
          `A buyer just requested "${requestTitle}". You have this in stock—tap to respond!`,
          { requestId, type: 'REQUEST_MATCH' },
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to notify matching vendors for request ${requestId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getUserNotifications(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.notificationsRepository.findByUserId(userId, skip, limit);
    return {
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async markAsRead(id: string, userId: string) {
    return this.notificationsRepository.markAsRead(id, userId);
  }

  async markAllAsRead(userId: string) {
    return this.notificationsRepository.markAllAsRead(userId);
  }
}
