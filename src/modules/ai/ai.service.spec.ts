import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AiService verifyCacDocument', () => {
  let service: AiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'LAOZHANG_API_URL') return 'https://api.laozhang.ai/v1/chat/completions';
              if (key === 'LAOZHANG_API_KEY') return 'test_key';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return isValid: false if businessName or registrationNumber is empty', async () => {
    const result = await service.verifyCacDocument({
      fileBuffer: Buffer.from('data'),
      mimetype: 'image/png',
      businessName: '',
      registrationNumber: 'RC 123456',
    });

    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('Both business name and registration number must be provided');
  });

  it('should call Lao Zhang GPT-4o API with multimodal payload and parse successful response', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                isValid: true,
                confidence: 0.96,
                extractedBusinessName: 'Gadget Hub Ltd',
                extractedRegistrationNumber: 'RC-998877',
                reason: 'Business name and registration number match the CAC certificate.',
              }),
            },
          },
        ],
      },
    });

    const result = await service.verifyCacDocument({
      fileBuffer: Buffer.from('fake image buffer'),
      mimetype: 'image/jpeg',
      businessName: 'Gadget Hub Ltd',
      registrationNumber: 'RC-998877',
    });

    expect(result.isValid).toBe(true);
    expect(result.confidence).toBe(0.96);
    expect(result.extractedBusinessName).toBe('Gadget Hub Ltd');
    expect(result.extractedRegistrationNumber).toBe('RC-998877');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.laozhang.ai/v1/chat/completions',
      expect.objectContaining({
        model: 'gpt-4o',
      }),
      expect.any(Object),
    );
  });

  it('should return isValid: false when AI responds with mismatch reason', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                isValid: false,
                confidence: 0.15,
                extractedBusinessName: 'Completely Different Ventures',
                extractedRegistrationNumber: 'RC-111111',
                reason: 'The business name on the certificate does not match the entered name.',
              }),
            },
          },
        ],
      },
    });

    const result = await service.verifyCacDocument({
      fileBuffer: Buffer.from('fake image buffer'),
      mimetype: 'image/jpeg',
      businessName: 'My Dream Shop Ltd',
      registrationNumber: 'RC-998877',
    });

    expect(result.isValid).toBe(false);
    expect(result.reason).toBe(
      'The business name on the certificate does not match the entered name.',
    );
  });

  it('should cleanly parse GPT-4o output even when wrapped in markdown code fence', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content:
                '```json\n{\n  "isValid": true,\n  "confidence": 0.99,\n  "extractedBusinessName": "Apex Ltd",\n  "extractedRegistrationNumber": "RC 123",\n  "reason": "Verified successfully."\n}\n```',
            },
          },
        ],
      },
    });

    const result = await service.verifyCacDocument({
      fileBuffer: Buffer.from('image bytes'),
      mimetype: 'image/png',
      businessName: 'Apex Ltd',
      registrationNumber: 'RC 123',
    });

    expect(result.isValid).toBe(true);
    expect(result.confidence).toBe(0.99);
    expect(result.reason).toBe('Verified successfully.');
  });

  it('should return isValid: false and clear reason when Lao Zhang API encounters network error', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('Connection timeout to api.laozhang.ai'));

    const result = await service.verifyCacDocument({
      fileBuffer: Buffer.from('image bytes'),
      mimetype: 'image/png',
      businessName: 'Apex Ltd',
      registrationNumber: 'RC 123',
    });

    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('Verification service encountered an issue analyzing the document');
  });
});
