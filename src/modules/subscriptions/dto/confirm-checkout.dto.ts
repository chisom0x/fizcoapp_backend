import { IsNotEmpty, IsString, IsOptional, IsIn } from 'class-validator';

export class ConfirmCheckoutDto {
  @IsOptional()
  @IsString()
  checkoutId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsIn(['monthly', 'quarterly', 'yearly'])
  plan?: 'monthly' | 'quarterly' | 'yearly';
}
