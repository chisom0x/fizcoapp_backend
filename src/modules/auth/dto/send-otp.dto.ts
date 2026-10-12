import { IsNotEmpty, IsString, IsIn } from 'class-validator';

export class SendOtpDto {
  @IsNotEmpty()
  @IsString()
  destination: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['signup', 'password_reset'])
  purpose: string;
}
