import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { VerificationStatus } from '@prisma/client';
import type { RangeKey } from '../time-range';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class AdminLoginDto {
  @Transform(lowerTrim)
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string;
}

export class AdminForgotPasswordDto {
  @Transform(lowerTrim)
  @IsEmail()
  email: string;
}

export class AdminResetPasswordDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, { message: 'Reset link is invalid' })
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword: string;
}

export class AdminChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword: string;
}

export class RangeQueryDto {
  @IsOptional()
  @IsIn(['today', '7d', '30d', 'month', 'year'])
  range?: RangeKey;

  /** YYYY-MM, with range=month */
  @IsOptional()
  @IsString()
  month?: string;

  /** YYYY, with range=year */
  @IsOptional()
  @IsString()
  year?: string;
}

export class AdminListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class UsersQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsIn(['Free', 'Premium'])
  plan?: string;

  @IsOptional()
  @IsIn(Object.values(VerificationStatus))
  verification?: VerificationStatus;

  /** Deleted accounts are scrubbed rows; they're hidden unless asked for */
  @IsOptional()
  @IsIn(['active', 'deleted', 'all'])
  status?: 'active' | 'deleted' | 'all';
}

export class RequestsQueryDto extends AdminListQueryDto {
  /** DELETED lists requests taken down; the others leave them out */
  @IsOptional()
  @IsIn(['ACTIVE', 'DONE', 'DELETED'])
  status?: 'ACTIVE' | 'DONE' | 'DELETED';
}

export class TransactionsQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsIn(['SUCCESS', 'PENDING', 'FAILED'])
  status?: string;
}

export class SubscriptionsQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsIn(['active', 'past_due', 'canceled', 'expired'])
  status?: string;
}

export class AdminUpdateUserDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName?: string;

  /** An empty value clears it */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  businessName?: string;

  /** An empty value clears it */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  shopAddress?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Choose a market from the list' })
  marketId?: string;

  @IsOptional()
  @Transform(lowerTrim)
  @IsEmail()
  email?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^\+?[0-9]{7,15}$/, {
    message: 'Phone number must be digits, optionally starting with +',
  })
  phoneNumber?: string;
}

export class MarketNameDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter a market name' })
  @MaxLength(80)
  name: string;
}
