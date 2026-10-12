import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateRequestDto {
  @IsNotEmpty()
  @IsString()
  title: string;
}

export class FulfillRequestDto {
  @IsNotEmpty()
  @IsString()
  vendorId: string;

  @IsNotEmpty()
  @IsString()
  vendorName: string;
}
