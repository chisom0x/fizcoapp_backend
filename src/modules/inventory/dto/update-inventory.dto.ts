import { IsOptional, IsString, IsArray } from 'class-validator';

export class UpdateInventoryDto {
  @IsOptional()
  @IsString()
  rawInput?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];
}
