import { IsOptional, IsString, IsUrl } from 'class-validator';

export class SendMessageDto {
  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  /** The recipient's app downloads it, so only an https link is accepted */
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  videoUrl?: string;

  @IsOptional()
  @IsString()
  taggedRequestId?: string;

  @IsOptional()
  @IsString()
  replyToMessageId?: string;

  @IsOptional()
  @IsString()
  replyToSenderName?: string;

  @IsOptional()
  @IsString()
  replyToText?: string;
}
