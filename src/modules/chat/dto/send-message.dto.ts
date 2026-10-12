import { IsOptional, IsString } from 'class-validator';

export class SendMessageDto {
  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  taggedRequestId?: string;

  @IsOptional()
  @IsString()
  replyToMessageId?: string;

  @IsOptional()
  @IsString()
  replyToSenderName?: string;
}
