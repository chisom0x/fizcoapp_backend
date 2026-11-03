import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCheckoutDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(['monthly', 'yearly'], {
    message: 'Plan must be one of: monthly, yearly',
  })
  plan: 'monthly' | 'yearly';

  @IsOptional()
  @IsString()
  successUrl?: string;

  @IsOptional()
  @IsString()
  cancelUrl?: string;
}
