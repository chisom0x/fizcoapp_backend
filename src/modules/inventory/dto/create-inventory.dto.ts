import { IsNotEmpty, IsString, IsArray, IsOptional } from 'class-validator';

export class CreateInventoryDto {
  @IsNotEmpty()
  @IsString()
  rawInput: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];
}
