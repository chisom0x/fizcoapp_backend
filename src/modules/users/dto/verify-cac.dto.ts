import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifyCacDto {
  @IsNotEmpty({ message: 'Business name is required' })
  @IsString()
  @MaxLength(150)
  businessName: string;

  @IsNotEmpty({ message: 'Business registration number is required' })
  @IsString()
  @MaxLength(50)
  registrationNumber: string;
}
