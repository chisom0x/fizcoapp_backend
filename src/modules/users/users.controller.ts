import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyBusinessDto } from './dto/verify-business.dto';
import { VerifyCacDto } from './dto/verify-cac.dto';
import { TeamInviteDto } from './dto/team-invite.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { BlockAndReportVendorDto } from './dto/block-and-report-vendor.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.usersService.getProfile(user.id);
    return {
      message: 'User profile retrieved',
      data: profile,
    };
  }

  @Delete('me')
  async deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteAccountDto,
  ) {
    const result = await this.usersService.deleteAccount(user.id, dto);
    return {
      message: 'Account deleted',
      data: result,
    };
  }

  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    const updated = await this.usersService.updateProfile(user.id, dto);
    return {
      message: 'Profile updated successfully',
      data: updated,
    };
  }

  @Post('verify-cac')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
      },
    }),
  )
  async verifyCac(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyCacDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException(
        'CAC certificate document file is required (image or PDF, max 10MB)',
      );
    }
    const result = await this.usersService.verifyCac(user.id, dto, file);
    return {
      message: result.isVerified
        ? 'Business verified successfully'
        : (result.reason || 'CAC verification failed'),
      data: result,
    };
  }

  @Post('verify-business')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async verifyBusiness(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyBusinessDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file) {
      const result = await this.usersService.verifyCac(
        user.id,
        {
          businessName: dto.businessName || '',
          registrationNumber:
            dto.registrationNumber || dto.cacRegistrationNumber || '',
        },
        file,
      );
      return {
        message: result.isVerified
          ? 'Business verified successfully'
          : (result.reason || 'CAC verification failed'),
        data: result,
      };
    }
    const result = await this.usersService.verifyBusiness(user.id, dto);
    return {
      message: 'Business verified successfully',
      data: result,
    };
  }

  @Post('team-invites')
  async inviteTeamMember(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TeamInviteDto,
  ) {
    const result = await this.usersService.inviteTeamMember(user.id, dto);
    return {
      message: 'Team invitation sent',
      data: result,
    };
  }

  @Delete('team-invites/:email')
  async removeTeamMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('email') email: string,
  ) {
    const result = await this.usersService.removeTeamMember(user.id, email);
    return {
      message: 'Team invitation removed',
      data: result,
    };
  }

  @Patch('security/password')
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    const result = await this.usersService.changePassword(user.id, dto);
    return {
      message: 'Password changed successfully',
      data: result,
    };
  }

  @Post('block-and-report')
  async blockAndReport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BlockAndReportVendorDto,
  ) {
    const result = await this.usersService.blockAndReportVendor(user.id, dto);
    return {
      message: 'Vendor blocked and reported successfully',
      data: result,
    };
  }
}
