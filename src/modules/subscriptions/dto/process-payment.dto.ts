import {
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class ProcessCardPaymentDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(['monthly', 'yearly'], {
    message: 'Plan must be one of: monthly, yearly',
  })
  plan: 'monthly' | 'yearly';

  @IsNotEmpty()
  @IsString()
  cardNumber: string;

  @IsNotEmpty()
  @IsString()
  cardHolderName: string;

  @IsNotEmpty()
  @IsString()
  expiryMonth: string;

  @IsNotEmpty()
  @IsString()
  expiryYear: string;

  @IsNotEmpty()
  @IsNumberString()
  @Length(3, 4)
  cvv: string;

  @IsOptional()
  @IsString()
  checkoutId?: string;
}
