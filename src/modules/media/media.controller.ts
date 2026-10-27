import {
  Controller,
  Get,
  Post,
  UseGuards,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get('upload-signature')
  getUploadSignature() {
    return {
      message: 'Upload signature created',
      data: this.mediaService.createUploadSignature(),
    };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSingle(@UploadedFile() file: Express.Multer.File) {
    const url = await this.mediaService.uploadFile(file);
    return {
      message: 'Image uploaded successfully',
      data: { url, urls: [url] },
      url,
    };
  }

  @Post('upload-multiple')
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadMultiple(@UploadedFiles() files: Express.Multer.File[]) {
    const urls = await this.mediaService.uploadMultipleFiles(files);
    return {
      message: 'Images uploaded successfully',
      data: { urls },
    };
  }
}
