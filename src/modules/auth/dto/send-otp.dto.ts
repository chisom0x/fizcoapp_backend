import { IsNotEmpty, IsString, IsIn, IsOptional } from 'class-validator';

export class SendOtpDto {
  @IsNotEmpty()
  @IsString()
  destination: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['signup', 'password_reset'])
  purpose: string;

  /** For a signup code: checked along with the email, so a taken number is caught before the code is sent */
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}
