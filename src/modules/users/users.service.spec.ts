import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { ChatGateway } from '../chat/chat.gateway';
import { AiService } from '../ai/ai.service';
import { MediaService } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('UsersService CAC Verification', () => {
  let service: UsersService;
  let usersRepository: jest.Mocked<Partial<UsersRepository>>;
  let chatGateway: jest.Mocked<Partial<ChatGateway>>;
  let aiService: jest.Mocked<Partial<AiService>>;
  let mediaService: jest.Mocked<Partial<MediaService>>;
  let notificationsService: jest.Mocked<Partial<NotificationsService>>;

  beforeEach(async () => {
    usersRepository = {
      setBusinessVerified: jest.fn().mockResolvedValue({
        id: 'usr_1',
        fullName: 'Jane Doe',
        businessName: 'Ace Technologies Ltd',
        isVerified: true,
        verificationStatus: 'VERIFIED',
        cacRegistrationNumber: 'RC-1234567',
      }),
      setBusinessRejected: jest.fn().mockResolvedValue({
        id: 'usr_1',
        fullName: 'Jane Doe',
        businessName: null,
        isVerified: false,
        verificationStatus: 'REJECTED',
        cacRegistrationNumber: null,
      }),
    };

    chatGateway = {
      server: {
        emit: jest.fn(),
        to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      } as any,
    };

    aiService = {
      verifyCacDocument: jest.fn(),
    };

    mediaService = {
      uploadFile: jest.fn().mockResolvedValue('https://cloudinary.com/cac_doc.jpg'),
    };

    notificationsService = {
      notifyUser: jest.fn().mockResolvedValue({ id: 'notif_1' } as any),
      notifyMatchingVendors: jest.fn().mockResolvedValue(undefined as any),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: usersRepository },
        { provide: ChatGateway, useValue: chatGateway },
        { provide: AiService, useValue: aiService },
        { provide: MediaService, useValue: mediaService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should reject files exceeding 10MB limit', async () => {
    const hugeFile = {
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
      size: 10 * 1024 * 1024 + 1,
      mimetype: 'image/jpeg',
      originalname: 'huge_cert.jpg',
    } as Express.Multer.File;

    await expect(
      service.verifyCac('usr_1', {
        businessName: 'Ace Technologies Ltd',
        registrationNumber: 'RC-1234567',
      }, hugeFile),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject unsupported file types', async () => {
    const invalidFile = {
      buffer: Buffer.from('plain text'),
      size: 100,
      mimetype: 'text/plain',
      originalname: 'cert.txt',
    } as Express.Multer.File;

    await expect(
      service.verifyCac('usr_1', {
        businessName: 'Ace Technologies Ltd',
        registrationNumber: 'RC-1234567',
      }, invalidFile),
    ).rejects.toThrow(BadRequestException);
  });

  it('should succeed and award verification badge when AI confirms matching CAC document', async () => {
    (aiService.verifyCacDocument as jest.Mock).mockResolvedValue({
      isValid: true,
      confidence: 0.98,
      extractedBusinessName: 'Ace Technologies Ltd',
      extractedRegistrationNumber: 'RC-1234567',
      reason: 'Business name and registration number match the CAC certificate.',
    });

    const validFile = {
      buffer: Buffer.from('fake image content'),
      size: 5000,
      mimetype: 'image/png',
      originalname: 'cac_cert.png',
    } as Express.Multer.File;

    const result = await service.verifyCac('usr_1', {
      businessName: 'Ace Technologies Ltd',
      registrationNumber: 'RC-1234567',
    }, validFile);

    expect(result.isVerified).toBe(true);
    expect(result.verificationStatus).toBe('VERIFIED');
    expect(result.cacRegistrationNumber).toBe('RC-1234567');
    expect(usersRepository.setBusinessVerified).toHaveBeenCalledWith(
      'usr_1',
      'RC-1234567',
      'Ace Technologies Ltd',
    );
    expect(chatGateway.server?.emit).toHaveBeenCalledWith(
      'user_verified',
      expect.objectContaining({
        userId: 'usr_1',
        isVerified: true,
      }),
    );
  });

  it('should fail with reason and mark REJECTED when AI validation fails', async () => {
    (aiService.verifyCacDocument as jest.Mock).mockResolvedValue({
      isValid: false,
      confidence: 0.1,
      reason: 'The registration number on the certificate (RC 999999) does not match the entered number (RC-1234567).',
    });

    const validFile = {
      buffer: Buffer.from('fake pdf content'),
      size: 8000,
      mimetype: 'application/pdf',
      originalname: 'cac_cert.pdf',
    } as Express.Multer.File;

    const result = await service.verifyCac('usr_1', {
      businessName: 'Ace Technologies Ltd',
      registrationNumber: 'RC-1234567',
    }, validFile);

    expect(result.isVerified).toBe(false);
    expect(result.verificationStatus).toBe('REJECTED');
    expect(result.reason).toContain('does not match the entered number');
    expect(usersRepository.setBusinessRejected).toHaveBeenCalledWith('usr_1');
  });

  it('should accept image files uploaded with generic application/octet-stream if filename extension is valid', async () => {
    (aiService.verifyCacDocument as jest.Mock).mockResolvedValue({
      isValid: true,
      confidence: 0.95,
      extractedBusinessName: 'Ace Technologies Ltd',
      extractedRegistrationNumber: 'RC-1234567',
      reason: 'Valid certificate.',
    });

    const fileWithGenericMime = {
      buffer: Buffer.from('generic bytes'),
      size: 4000,
      mimetype: 'application/octet-stream',
      originalname: 'scanned_cac.jpg',
    } as Express.Multer.File;

    const result = await service.verifyCac('usr_1', {
      businessName: 'Ace Technologies Ltd',
      registrationNumber: 'RC-1234567',
    }, fileWithGenericMime);

    expect(result.isVerified).toBe(true);
    expect(aiService.verifyCacDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'scanned_cac.jpg',
      }),
    );
  });
});
