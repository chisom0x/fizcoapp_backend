import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyBusinessDto } from './dto/verify-business.dto';
import { TeamInviteDto } from './dto/team-invite.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
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

  @Post('verify-business')
  async verifyBusiness(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyBusinessDto,
  ) {
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
}
