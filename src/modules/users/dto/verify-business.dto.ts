import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyBusinessDto {
  @IsNotEmpty()
  @IsString()
  registrationNumber: string;
}
