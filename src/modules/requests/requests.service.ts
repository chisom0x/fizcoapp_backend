import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { RequestsRepository } from './requests.repository';
import { AiService } from '../ai/ai.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { UpdateRequestDto } from './dto/update-request.dto';
import { FulfillRequestDto } from './dto/fulfill-request.dto';

import { ChatGateway } from '../chat/chat.gateway';

@Injectable()
export class RequestsService {
  constructor(
    private readonly requestsRepository: RequestsRepository,
    private readonly aiService: AiService,
    private readonly notificationsService: NotificationsService,
    private readonly chatGateway: ChatGateway,
  ) {}

  async create(userId: string, dto: CreateRequestDto) {
    const request = await this.requestsRepository.create(userId, dto.title);

    const formatted = {
      id: request.id,
      title: request.title,
      status: request.status.toLowerCase(),
      requesterName: request.requester.fullName,
      isRequesterVerified: request.requester.isVerified,
      isUserRequest: false,
      hasShownInterest: false,
      createdAt: request.createdAt,
    };

    // Broadcast in real-time to all connected mobile clients
    this.chatGateway.broadcastNewRequest(formatted);

    // Asynchronously extract gadget brand/model and notify matching vendors
    this.matchAndNotifyVendors(request.id, request.title, userId).catch(() => {});

    return formatted;
  }

  private async matchAndNotifyVendors(
    requestId: string,
    title: string,
    requesterId: string,
  ) {
    try {
      const parsed = await this.aiService.parseProductInput(title);
      await this.notificationsService.notifyMatchingVendors(
        requestId,
        title,
        parsed.brand,
        parsed.model,
        requesterId,
      );
    } catch {
      // Background notifications don't interrupt request creation
    }
  }

  async getOpenRequests(userId: string, page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.requestsRepository.findOpenRequests(
      userId,
      skip,
      limit,
      search,
    );

    const formatted = items.map((r) => ({
      id: r.id,
      title: r.title,
      requesterName: r.requester.fullName,
      isRequesterVerified: r.requester.isVerified,
      isUserRequest: false,
      hasShownInterest: r.interests.length > 0,
      status: r.status.toLowerCase(),
      createdAt: r.createdAt,
    }));

    return {
      data: formatted,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getMyRequests(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const { items, total } = await this.requestsRepository.findMyRequests(
      userId,
      skip,
      limit,
    );

    const formatted = items.map((r) => {
      const interestedVendors = r.interests.map((i) => {
        const thread = r.chatThreads.find((t) => t.vendorId === i.vendor.id);
        const lastMsg = thread?.messages?.[0];

        return {
          id: i.vendor.id,
          fullName: i.vendor.fullName,
          isVerified: i.vendor.isVerified,
          lastMessage: lastMsg?.text || 'Interest shown',
          lastMessageTime: lastMsg?.createdAt || r.createdAt,
          lastMessageSentByMe: lastMsg?.senderId === userId,
          unreadCount: 0,
        };
      });

      return {
        id: r.id,
        title: r.title,
        requesterName: 'You',
        isUserRequest: true,
        status: r.status.toLowerCase(),
        chosenVendorId: r.chosenVendorId,
        fulfilledByVendorId: r.fulfilledByVendorId,
        fulfilledByVendorName: r.fulfilledByVendor?.fullName || null,
        fulfilledAt: r.fulfilledAt,
        interestedVendors,
        createdAt: r.createdAt,
      };
    });

    return {
      data: formatted,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async showInterest(requestId: string, vendorId: string, vendorName: string) {
    const request = await this.requestsRepository.findById(requestId);
    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.requesterId === vendorId) {
      throw new BadRequestException('You cannot show interest in your own request');
    }

    await this.requestsRepository.addInterest(requestId, vendorId);
    const chatThread = await this.requestsRepository.getOrCreateChatThread(
      requestId,
      request.requesterId,
      vendorId,
    );

    // Notify requester
    await this.notificationsService.notifyUser(
      request.requesterId,
      '🤝 New Vendor Interest!',
      `${vendorName} is interested in supplying your request for "${request.title}".`,
      { requestId, chatThreadId: chatThread.id, type: 'VENDOR_INTEREST' },
    );

    return {
      chatThreadId: chatThread.id,
      requestId,
      vendorId,
    };
  }

  async fulfill(requestId: string, requesterId: string, dto: FulfillRequestDto) {
    const request = await this.requestsRepository.findById(requestId);
    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.requesterId !== requesterId) {
      throw new ForbiddenException('Only the request creator can mark it as fulfilled');
    }

    const now = new Date();
    await this.requestsRepository.markFulfilled(
      requestId,
      requesterId,
      dto.vendorId,
      now,
    );

    // Notify chosen vendor
    await this.notificationsService.notifyUser(
      dto.vendorId,
      '🎉 Request Fulfilled by You!',
      `You were chosen to fulfill the request "${request.title}".`,
      { requestId, type: 'REQUEST_FULFILLED' },
    );

    return {
      requestId,
      status: 'done',
      fulfilledByVendorId: dto.vendorId,
      fulfilledByVendorName: dto.vendorName,
      fulfilledAt: now,
    };
  }

  async update(requestId: string, requesterId: string, dto: UpdateRequestDto) {
    const request = await this.requestsRepository.findById(requestId);
    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.requesterId !== requesterId) {
      throw new ForbiddenException('Only the requester can edit this request');
    }

    await this.requestsRepository.updateTitle(requestId, requesterId, dto.title);
    return {
      id: requestId,
      title: dto.title,
    };
  }

  async remove(requestId: string, requesterId: string) {
    const request = await this.requestsRepository.findById(requestId);
    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.requesterId !== requesterId) {
      throw new ForbiddenException('Only the requester can delete this request');
    }

    await this.requestsRepository.delete(requestId, requesterId);
    return {
      deleted: true,
      id: requestId,
    };
  }
}
