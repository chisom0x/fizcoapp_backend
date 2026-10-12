import { IsNotEmpty, IsString, Length, IsIn } from 'class-validator';

export class VerifyOtpDto {
  @IsNotEmpty()
  @IsString()
  destination: string;

  @IsNotEmpty()
  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  code: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['signup', 'password_reset'])
  purpose: string;
}
