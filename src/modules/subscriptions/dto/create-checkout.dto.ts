import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCheckoutDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(['monthly', 'quarterly', 'yearly'], {
    message: 'Plan must be one of: monthly, quarterly, yearly',
  })
  plan: 'monthly' | 'quarterly' | 'yearly';

  @IsOptional()
  @IsString()
  successUrl?: string;

  @IsOptional()
  @IsString()
  cancelUrl?: string;
}
