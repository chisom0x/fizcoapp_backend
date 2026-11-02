import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteAccountDto {
  @IsNotEmpty({ message: 'Enter your password to delete your account' })
  @IsString()
  password: string;
}
