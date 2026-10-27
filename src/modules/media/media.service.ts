import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import * as streamifier from 'streamifier';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME') || 'dsqlfpmz8',
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY') || '921546745149967',
      api_secret:
        this.configService.get<string>('CLOUDINARY_API_SECRET') ||
        'yl0DWLC6ESIb9avLM3H-jlAb84o',
      secure: true,
    });
  }

  /**
   * Signs a direct upload from the app to Cloudinary, so image bytes skip this server. The
   * signature covers the folder and formats, so it can't be reused to upload anything else,
   * and Cloudinary rejects it an hour after the timestamp
   */
  createUploadSignature(folder = 'fizco/uploads') {
    const { cloud_name, api_key, api_secret } = cloudinary.config();
    const params = {
      timestamp: Math.round(Date.now() / 1000),
      folder,
      allowed_formats: 'jpg,jpeg,png,webp,heic',
    };
    return {
      cloudName: cloud_name,
      apiKey: api_key,
      ...params,
      signature: cloudinary.utils.api_sign_request(params, api_secret as string),
    };
  }

  /**
   * Upload single buffer file to Cloudinary
   */
  async uploadFile(
    file: Express.Multer.File,
    folder = 'fizco/uploads',
  ): Promise<string> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }

    const ext = file.originalname ? file.originalname.toLowerCase() : '';
    const isImage =
      (file.mimetype && file.mimetype.startsWith('image/')) ||
      /\.(jpe?g|png|webp|heic)$/i.test(ext);
    const isPdf =
      file.mimetype === 'application/pdf' ||
      ext.endsWith('.pdf');
    if (!isImage && !isPdf) {
      throw new BadRequestException('Only image and PDF files are allowed');
    }

    return new Promise((resolve, reject) => {
      const uploadOptions: Record<string, any> = {
        folder,
        resource_type: isPdf ? 'auto' : 'image',
      };
      if (isImage) {
        uploadOptions.transformation = [
          { quality: 'auto', fetch_format: 'auto' },
          { width: 1400, crop: 'limit' },
        ];
      }

      const uploadStream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result: UploadApiResponse | undefined) => {
          if (error) {
            this.logger.error(`Cloudinary upload failed: ${error.message}`);
            return reject(new BadRequestException('Failed to upload file to Cloudinary'));
          }
          if (!result) {
            return reject(new BadRequestException('Empty response from Cloudinary'));
          }
          resolve(result.secure_url);
        },
      );

      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
  }

  /**
   * Upload multiple files concurrently
   */
  async uploadMultipleFiles(
    files: Express.Multer.File[],
    folder = 'fizco/uploads',
  ): Promise<string[]> {
    if (!files || files.length === 0) {
      return [];
    }

    const uploadPromises = files.map((f) => this.uploadFile(f, folder));
    return Promise.all(uploadPromises);
  }
}
