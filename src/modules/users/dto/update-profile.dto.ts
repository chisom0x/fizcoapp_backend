import { IsOptional, IsString, IsEmail, MaxLength, IsUrl } from 'class-validator';

/** Photos are uploaded by the app to Cloudinary first; other vendors load them, so nothing else is accepted */
const UPLOADED_PHOTO_URL = {
  protocols: ['https'],
  require_protocol: true,
  host_whitelist: ['res.cloudinary.com'],
};

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  shopAddress?: string;

  @IsOptional()
  @IsUrl(UPLOADED_PHOTO_URL, { message: 'Profile picture must be an uploaded photo' })
  avatarUrl?: string;

  @IsOptional()
  @IsUrl(UPLOADED_PHOTO_URL, { message: 'Plaza/office picture must be an uploaded photo' })
  plazaImageUrl?: string;
}
