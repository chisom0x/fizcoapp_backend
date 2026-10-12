import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersRepository } from './users.repository';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyBusinessDto } from './dto/verify-business.dto';
import { TeamInviteDto } from './dto/team-invite.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async getProfile(userId: string) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    const invitedEmails = user.teamInvitesSent.map((t) => t.inviteeEmail);
    const { teamInvitesSent: _, ...userSafe } = user;

    return {
      ...userSafe,
      invitedEmails,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const updated = await this.usersRepository.updateProfile(userId, dto);
    return updated;
  }

  /**
   * CAC Verification endpoint - always returns success as requested
   */
  async verifyBusiness(userId: string, dto: VerifyBusinessDto) {
    const cleanNumber = dto.registrationNumber.trim().toUpperCase();
    if (!cleanNumber) {
      throw new BadRequestException('Please provide a valid CAC registration number');
    }

    const updatedUser = await this.usersRepository.setBusinessVerified(
      userId,
      cleanNumber,
    );

    return {
      isVerified: true,
      verificationStatus: updatedUser.verificationStatus,
      cacRegistrationNumber: updatedUser.cacRegistrationNumber,
    };
  }

  async inviteTeamMember(userId: string, dto: TeamInviteDto) {
    const invite = await this.usersRepository.createTeamInvite(userId, dto.email);
    return {
      invitedEmail: invite.inviteeEmail,
    };
  }

  async removeTeamMember(userId: string, email: string) {
    await this.usersRepository.deleteTeamInvite(userId, email);
    return {
      removedEmail: email,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.usersRepository.findWithPassword(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isMatch = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Current password does not match');
    }

    const saltRounds = 12;
    const newHash = await bcrypt.hash(dto.newPassword, saltRounds);
    await this.usersRepository.updatePassword(userId, newHash);

    return {
      updated: true,
    };
  }
}
