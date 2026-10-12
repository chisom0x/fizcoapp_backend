import { IsNotEmpty, IsString } from 'class-validator';

export class SaveFcmTokenDto {
  @IsNotEmpty()
  @IsString()
  token: string;
}
