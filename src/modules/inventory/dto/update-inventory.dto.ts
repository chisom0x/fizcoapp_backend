import { IsOptional, IsString, IsArray, IsInt, Min, Max } from 'class-validator';

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

  /** Whole naira */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  price?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];
}
