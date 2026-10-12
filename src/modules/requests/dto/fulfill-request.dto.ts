import { IsNotEmpty, IsString } from 'class-validator';

export class FulfillRequestDto {
  @IsNotEmpty()
  @IsString()
  vendorId: string;

  @IsNotEmpty()
  @IsString()
  vendorName: string;
}
