import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { RequestsRepository } from './requests.repository';
import { AiService } from '../ai/ai.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { CreateRequestDto } from './dto/create-request.dto';
import { UpdateRequestDto } from './dto/update-request.dto';
import { FulfillRequestDto } from './dto/fulfill-request.dto';
import { MessageType } from '@prisma/client';

import { ChatGateway } from '../chat/chat.gateway';
import { ChatRepository } from '../chat/chat.repository';
import { formatNaira } from '../inventory/price';

type VendorMatch = Awaited<
  ReturnType<NotificationsRepository['findVendorsWithMatchingInventory']>
>[number];

// How many of the cheapest matching Premium vendors get their item sent to the requester
const AUTO_OFFER_LIMIT = 10;

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    private readonly requestsRepository: RequestsRepository,
    private readonly notificationsRepository: NotificationsRepository,
    private readonly chatRepository: ChatRepository,
    private readonly aiService: AiService,
    // Both import ChatService, which imports this file, so they're undefined while it loads
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => ChatGateway))
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

    // Triggers must stand alone as words ("hot" is Infinix, "hotspot" is not); digits may touch
    // them so "iphone13" and "ps5" still count
    const hasWord = (t: string) => new RegExp(`(?<![a-z])${t}(?![a-z])`).test(cleanTitle);

    let detectedBrand = 'Other';
    for (const [brand, triggers] of Object.entries(brandMap)) {
      if (triggers.some(hasWord)) {
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
      // "Wi-Fi" is one word; inventory tokens carry the joined form too
      .replace(/([a-z0-9])-(?=[a-z0-9])/g, '$1')
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

      const matches = await this.notificationsRepository.findVendorsWithMatchingInventory(
        brand,
        requesterId,
        keywordSets,
      );
      this.logger.log(`Request ${requestId} ("${title}") matched ${matches.length} vendor(s)`);

      const offered = await this.sendCheapestOffers(
        { id: requestId, title, requesterId },
        matches,
      );

      // Vendors whose item wasn't sent are told about the request so they can respond themselves;
      // notifyUser already emits 'new_notification' to the vendor's room
      await this.notificationsService.notifyMatchingVendors(
        requestId,
        title,
        matches.map((m) => m.userId).filter((id) => !offered.has(id)),
        (vendorUserId, payload) => {
          this.chatGateway.server
            ?.to(`user_${vendorUserId}`)
            .emit('request_match', payload);
        },
      );
    } catch (error) {
      // Background matching doesn't interrupt request creation
      this.logger.error(
        `Vendor matching failed for request ${requestId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Premium vendors with the cheapest priced matches have their item posted into a chat with the
   * requester and are marked interested, without waiting for them to respond. Returns the ids of
   * the vendors whose offer went out
   */
  private async sendCheapestOffers(
    request: { id: string; title: string; requesterId: string },
    matches: VendorMatch[],
  ): Promise<Set<string>> {
    const offers = matches
      .filter(
        (m) => m.item.price !== null && m.user.subscriptionPlan.toLowerCase() === 'premium',
      )
      .sort((a, b) => a.item.price! - b.item.price!)
      .slice(0, AUTO_OFFER_LIMIT);

    const results = await Promise.allSettled(offers.map((offer) => this.sendOffer(request, offer)));
    const sent = new Set<string>();
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        sent.add(offers[i].userId);
      } else {
        this.logger.error(
          `Failed to send vendor ${offers[i].userId}'s offer for request ${request.id}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
        );
      }
    });
    if (sent.size === 0) return sent;

    // One refresh and one notification for the whole batch rather than one per vendor
    this.chatGateway.server
      ?.to(`user_${request.requesterId}`)
      .emit('new_chat_thread', { requestId: request.id });
    this.notificationsService
      .notifyUser(
        request.requesterId,
        `🛍️ ${sent.size} vendor${sent.size === 1 ? '' : 's'} sent you offers`,
        `Vendors with "${request.title}" in stock have sent their best prices to your chats.`,
        { requestId: request.id, type: 'VENDOR_OFFERS' },
      )
      .catch((err) =>
        this.logger.error(
          `Failed to notify requester of offers for ${request.id}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    return sent;
  }

  private async sendOffer(
    request: { id: string; title: string; requesterId: string },
    { userId: vendorId, item }: VendorMatch,
  ) {
    const thread = await this.requestsRepository.getOrCreateChatThread(
      request.id,
      request.requesterId,
      vendorId,
    );
    const price = formatNaira(item.price!);
    await this.chatRepository.createMessage({
      threadId: thread.id,
      senderId: vendorId,
      text: `${item.title} · ${price}`,
      type: MessageType.INVENTORY_ATTACHMENT,
      taggedRequestId: request.id,
      // The fields the vendor sees on their own inventory, as they were when offered
      inventoryItem: {
        id: item.id,
        title: item.title,
        description: item.description,
        rawInput: item.rawInput,
        imageUrls: item.imageUrls,
        price: item.price,
      },
    });
    await this.requestsRepository.addInterest(request.id, vendorId);

    this.chatGateway.server
      ?.to(`user_${vendorId}`)
      .emit('new_chat_thread', { threadId: thread.id, requestId: request.id });
    this.notificationsService
      .notifyUser(
        vendorId,
        '📦 Your item was sent to a buyer',
        `A buyer requested "${request.title}". We sent them your ${item.title} at ${price}. Reply in the chat to close the deal.`,
        { requestId: request.id, chatThreadId: thread.id, type: 'OFFER_SENT' },
      )
      .catch((err) =>
        this.logger.error(
          `Failed to tell vendor ${vendorId} their offer was sent: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
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

  // Opens the vendor's chat with the requester without recording interest or telling the
  // requester anything; interest is recorded once the vendor sends a message tagging the request
  async openChat(requestId: string, vendorId: string) {
    const request = await this.assertCanShowInterest(requestId, vendorId);
    const chatThread = await this.requestsRepository.getOrCreateChatThread(
      requestId,
      request.requesterId,
      vendorId,
    );
    return {
      chatThreadId: chatThread.id,
      requestId,
      vendorId,
    };
  }

  // Called by ChatService once the vendor's message tagging the request is saved, so nobody is
  // listed as interested without having messaged the requester. The requester is told only once
  async recordInterest(
    request: { id: string; title: string; requesterId: string },
    vendorId: string,
    vendorName: string,
    chatThreadId: string,
  ) {
    const isNew = await this.requestsRepository.addInterest(request.id, vendorId);
    if (!isNew) return;

    const requestId = request.id;
    this.chatGateway.server?.to(`user_${request.requesterId}`).emit('new_chat_thread', {
      threadId: chatThreadId,
      requestId,
      vendorId,
      vendorName,
    });
    this.chatGateway.server?.to(`user_${request.requesterId}`).emit('vendor_interest', {
      threadId: chatThreadId,
      requestId,
      vendorId,
      vendorName,
    });

    // notifyUser stores the notification and emits 'new_notification'; the push round-trip to
    // FCM shouldn't hold up the vendor's message
    this.notificationsService
      .notifyUser(
        request.requesterId,
        '🤝 New Vendor Interest!',
        `${vendorName} is interested in supplying your request for "${request.title}".`,
        { requestId, chatThreadId, type: 'VENDOR_INTEREST' },
      )
      .catch((err) =>
        this.logger.error(
          `Failed to notify requester of interest in ${requestId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  async assertCanShowInterest(requestId: string, vendorId: string) {
    // The vendor is waiting on this to open the chat, so independent lookups run together
    const [vendorPlan, interestsCount, request] = await Promise.all([
      this.requestsRepository.getUserSubscriptionPlan(vendorId),
      this.requestsRepository.countUserInterests(vendorId),
      this.requestsRepository.findById(requestId),
    ]);
    const isPremium = vendorPlan.toLowerCase() === 'premium';
    if (!isPremium && interestsCount >= 1) {
      throw new ForbiddenException(
        'You have reached your 1 free request interest limit. Upgrade to Fizco Premium to show interest in unlimited requests.',
      );
    }

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.requesterId === vendorId) {
      throw new BadRequestException('You cannot show interest in your own request');
    }

    return request;
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

    return this.takeDown(requestId, requesterId);
  }

  /** Deletes a request whoever posted it; for the admin panel */
  async removeAsAdmin(requestId: string) {
    const request = await this.requestsRepository.findById(requestId);
    if (!request || request.isDeleted) {
      throw new NotFoundException('Request not found');
    }
    return this.takeDown(requestId, request.requesterId);
  }

  private async takeDown(requestId: string, requesterId: string) {
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
