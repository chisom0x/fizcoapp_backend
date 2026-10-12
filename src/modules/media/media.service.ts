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
   * Upload single buffer file to Cloudinary
   */
  async uploadFile(
    file: Express.Multer.File,
    folder = 'fizco/uploads',
  ): Promise<string> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No image file provided');
    }

    // Validate mime type
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed');
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          transformation: [
            { quality: 'auto', fetch_format: 'auto' },
            { width: 1400, crop: 'limit' },
          ],
        },
        (error, result: UploadApiResponse | undefined) => {
          if (error) {
            this.logger.error(`Cloudinary upload failed: ${error.message}`);
            return reject(new BadRequestException('Failed to upload image to Cloudinary'));
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
