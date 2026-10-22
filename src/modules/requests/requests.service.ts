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
    const userPlan = await this.requestsRepository.getUserSubscriptionPlan(userId);
    const isPremium = userPlan.toLowerCase() === 'premium';
    if (!isPremium) {
      const count = await this.requestsRepository.countUserRequests(userId);
      if (count >= 1) {
        throw new ForbiddenException(
          'Free plan is limited to 1 request in total. Upgrade to Premium for unlimited requests.',
        );
      }
    }

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

  private extractGadgetBrandAndKeywords(title: string): {
    brand: string;
    keywords: string[];
  } {
    const cleanTitle = title.toLowerCase();

    // Map of common gadget brands
    const brandMap: Record<string, string[]> = {
      Apple: ['apple', 'iphone', 'ipad', 'macbook', 'imac', 'airpod', 'airpods', 'iwatch', 'apple watch'],
      Samsung: ['samsung', 'galaxy', 'z fold', 'z flip'],
      Google: ['google', 'pixel'],
      Sony: ['sony', 'playstation', 'ps5', 'ps4', 'xperia'],
      Microsoft: ['microsoft', 'surface', 'xbox'],
      Dell: ['dell', 'alienware', 'xps', 'latitude'],
      HP: ['hp', 'hewlett', 'envy', 'spectre', 'pavilion', 'omen', 'elitebook'],
      Lenovo: ['lenovo', 'thinkpad', 'legion', 'ideapad'],
      Asus: ['asus', 'rog', 'zenbook', 'tuf'],
      Acer: ['acer', 'predator', 'nitro', 'swift'],
      Xiaomi: ['xiaomi', 'redmi', 'poco'],
      Tecno: ['tecno', 'camon', 'phantom', 'spark'],
      Infinix: ['infinix', 'zero', 'note', 'hot'],
      OnePlus: ['oneplus', 'nord'],
      Huawei: ['huawei', 'mate'],
      Nintendo: ['nintendo', 'switch'],
    };

    let detectedBrand = 'Other';
    for (const [brand, triggers] of Object.entries(brandMap)) {
      if (triggers.some((t) => cleanTitle.includes(t))) {
        detectedBrand = brand;
        break;
      }
    }

    return {
      brand: detectedBrand,
      keywords: this.toMatchKeywords(cleanTitle),
    };
  }

  private toMatchKeywords(text: string): string[] {
    // Common noise words in user requests
    const noiseWords = new Set([
      'needed', 'need', 'needs', 'needing', 'urgently', 'urgent', 'looking', 'for', 'want', 'wanted',
      'pls', 'please', 'help', 'dm', 'available', 'avail', 'brand', 'new', 'clean', 'used',
      'foreign', 'nigerian', 'tokunbo', 'mint', 'receipt', 'box', 'packaged', 'fu', 'factory',
      'unlocked', 'open', 'sealed', 'original', 'cheap', 'budget', 'asap', 'today', 'ready',
      'cash', 'buyer', 'with', 'and', 'or', 'in', 'at', 'on', 'a', 'an', 'the', 'of', 'to',
      'price', 'swap', 'trade', 'condition', 'storage', 'color', 'colour', 'blue', 'black', 'white',
      'gold', 'silver', 'purple', 'grey', 'gray', 'pink', 'red', 'green', 'yellow', 'titanium',
      'gb', 'tb', 'ram', 'rom', 'battery', 'health', 'bh',
    ]);

    const rawTokens = text
      .toLowerCase()
      .replace(/\b\d+\s*(gb|tb|mb)\b/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    return rawTokens.filter((token) => {
      if (noiseWords.has(token)) return false;
      // Bare storage sizes; 16 stays because it is also a model number (iPhone 16, MacBook Pro 16)
      if (/^(32|64|128|256|512|1024)$/.test(token)) return false;
      // Single digits are model numbers (Pixel 7, PlayStation 5); single letters are noise
      return token.length > 1 || /^\d$/.test(token);
    });
  }

  private async matchAndNotifyVendors(
    requestId: string,
    title: string,
    requesterId: string,
  ) {
    try {
      const localExtracted = this.extractGadgetBrandAndKeywords(title);
      let brand = localExtracted.brand;
      // Alternative phrasings of the gadget; a vendor matches if any one is fully in stock
      const keywordSets = [localExtracted.keywords];

      // Attempt AI enrichment if available, but never fail if unreachable
      try {
        const parsed = await this.aiService.parseProductInput(title);
        if (parsed.brand && parsed.brand !== 'Other') {
          brand = parsed.brand;
        }
        if (parsed.model) {
          keywordSets.push(this.toMatchKeywords(parsed.model));
        }
      } catch {
        // AI service is optional; fallback to deterministic local heuristic
      }

      // notifyUser already emits 'new_notification' to the vendor's room
      await this.notificationsService.notifyMatchingVendors(
        requestId,
        title,
        brand,
        requesterId,
        keywordSets,
        (vendorUserId, payload) => {
          this.chatGateway.server
            ?.to(`user_${vendorUserId}`)
            .emit('request_match', payload);
        },
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
      requesterId: r.requester.id,
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
        const unreadCount = (thread as any)?._count?.messages || 0;

        return {
          id: i.vendor.id,
          fullName: i.vendor.fullName,
          isVerified: i.vendor.isVerified,
          lastMessage: lastMsg?.text || 'Interest shown',
          lastMessageTime: lastMsg?.createdAt || r.createdAt,
          lastMessageSentByMe: lastMsg?.senderId === userId,
          unreadCount,
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
    const vendorPlan = await this.requestsRepository.getUserSubscriptionPlan(vendorId);
    const isPremium = vendorPlan.toLowerCase() === 'premium';
    if (!isPremium) {
      const interestsCount = await this.requestsRepository.countUserInterests(vendorId);
      if (interestsCount >= 1) {
        throw new ForbiddenException(
          'You have reached your 1 free request interest limit. Upgrade to Fizco Premium to show interest in unlimited requests.',
        );
      }
    }

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

    // Notify requester via push notification and real-time socket
    this.chatGateway.server?.to(`user_${request.requesterId}`).emit('new_chat_thread', {
      threadId: chatThread.id,
      requestId,
      vendorId,
      vendorName,
    });
    this.chatGateway.server?.to(`user_${request.requesterId}`).emit('vendor_interest', {
      threadId: chatThread.id,
      requestId,
      vendorId,
      vendorName,
    });
    this.chatGateway.server?.to(`user_${request.requesterId}`).emit('new_notification', {
      title: '🤝 New Vendor Interest!',
      body: `${vendorName} is interested in supplying your request for "${request.title}".`,
      data: { requestId, chatThreadId: chatThread.id, type: 'VENDOR_INTEREST' },
    });

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
    throw new BadRequestException('Vendors cannot edit requests; requests can only be deleted.');
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

    // Broadcast deletion in real-time to all connected mobile clients
    this.chatGateway.broadcastDeletedRequest(requestId);

    return {
      deleted: true,
      id: requestId,
    };
  }

  async getRequestById(requestId: string) {
    const request = await this.requestsRepository.findById(requestId);
    if (!request || request.isDeleted) {
      throw new NotFoundException('Request not found or has been deleted');
    }
    return request;
  }
}
