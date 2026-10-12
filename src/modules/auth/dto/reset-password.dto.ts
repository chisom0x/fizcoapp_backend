import { IsNotEmpty, IsString, MinLength, Length } from 'class-validator';

export class ResetPasswordDto {
  @IsNotEmpty()
  @IsString()
  emailOrPhone: string;

  @IsNotEmpty()
  @IsString()
  @Length(6, 6, { message: 'OTP must be 6 digits' })
  otp: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  newPassword: string;
}
