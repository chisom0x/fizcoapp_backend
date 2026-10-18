import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class BlockAndReportVendorDto {
  @IsNotEmpty()
  @IsString()
  vendorId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
