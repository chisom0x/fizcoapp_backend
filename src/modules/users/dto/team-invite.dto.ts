import { IsEmail, IsNotEmpty } from 'class-validator';

export class TeamInviteDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;
}
