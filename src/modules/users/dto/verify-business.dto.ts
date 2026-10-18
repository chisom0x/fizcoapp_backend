import { IsOptional, IsString } from 'class-validator';

export class VerifyBusinessDto {
  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  cacRegistrationNumber?: string;

  @IsOptional()
  @IsString()
  businessName?: string;
}
