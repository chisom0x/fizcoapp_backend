import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersRepository } from './users.repository';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyBusinessDto } from './dto/verify-business.dto';
import { VerifyCacDto } from './dto/verify-cac.dto';
import { TeamInviteDto } from './dto/team-invite.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { BlockAndReportVendorDto } from './dto/block-and-report-vendor.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { ChatGateway } from '../chat/chat.gateway';
import { AiService } from '../ai/ai.service';
import { MediaService } from '../media/media.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly chatGateway: ChatGateway,
    private readonly aiService: AiService,
    private readonly mediaService: MediaService,
    private readonly notificationsService: NotificationsService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    const invitedEmails = (user.teamInvitesSent || []).map((t) => t.inviteeEmail);
    const signedUpUsers = await this.usersRepository.findUsersByEmails(invitedEmails);
    const signedUpMap = new Map<string, (typeof signedUpUsers)[0]>();
    for (const u of signedUpUsers) {
      signedUpMap.set(u.email.toLowerCase(), u);
    }

    // Auto-link any signed up user that hasn't had their teamOwnerId set yet if inviter is verified
    if (user.isVerified) {
      for (const invite of user.teamInvitesSent || []) {
        const u = signedUpMap.get(invite.inviteeEmail.toLowerCase());
        if (u && !u.teamOwnerId && !u.isVerified) {
          await this.usersRepository.setUserTeamSharing(
            u.id,
            user.id,
            user.fullName,
            user.businessName,
            user.cacRegistrationNumber,
          );
          u.teamOwnerId = user.id;
        }
      }
    }

    const invitedMembers = (user.teamInvitesSent || []).map((t) => {
      const u = signedUpMap.get(t.inviteeEmail.toLowerCase());
      const isSignedUp = Boolean(u);
      return {
        email: t.inviteeEmail,
        fullName: u?.fullName || null,
        avatarUrl: u?.avatarUrl || null,
        isSignedUp,
        status: isSignedUp ? 'Signed up' : 'Pending signup',
        createdAt: t.createdAt,
      };
    });

    const { teamInvitesSent: _, ...userSafe } = user;

    return {
      ...userSafe,
      isSharingCac: Boolean(user.teamOwnerId),
      invitedEmails,
      invitedMembers,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // The shop address is optional, so an empty one clears it
    const shopAddress =
      dto.shopAddress === undefined ? undefined : dto.shopAddress.trim() || null;
    const updated = await this.usersRepository.updateProfile(userId, {
      ...dto,
      shopAddress,
    });
    return updated;
  }

  /**
   * AI-powered CAC Verification endpoint using GPT-4o and Lao Zhang API
   */
  async verifyCac(
    userId: string,
    dto: VerifyCacDto,
    file: Express.Multer.File,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('CAC certificate document file is required');
    }

    // 10MB limit check (10 * 1024 * 1024 bytes)
    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('Document file size exceeds the 10MB limit');
    }

    // Mimetype & file extension validation
    const ext = file.originalname ? file.originalname.toLowerCase() : '';
    const isImage =
      (file.mimetype && file.mimetype.startsWith('image/')) ||
      /\.(jpe?g|png|webp|heic)$/i.test(ext);
    const isPdf =
      file.mimetype === 'application/pdf' ||
      ext.endsWith('.pdf');
    if (!isImage && !isPdf) {
      throw new BadRequestException(
        'Only images (JPEG, PNG, WEBP) and PDF files up to 10MB are accepted for CAC verification',
      );
    }

    const businessName = dto.businessName.trim();
    const registrationNumber = dto.registrationNumber.trim();
    if (!businessName) {
      throw new BadRequestException('Business name is required');
    }
    if (!registrationNumber) {
      throw new BadRequestException('Business registration number is required');
    }

    // Call AiService to validate document with GPT-4o
    const aiResult = await this.aiService.verifyCacDocument({
      fileBuffer: file.buffer,
      mimetype: file.mimetype,
      filename: file.originalname,
      businessName,
      registrationNumber,
    });

    if (aiResult.isValid) {
      const cleanNumber = registrationNumber.toUpperCase();
      let documentUrl: string | undefined;
      try {
        documentUrl = await this.mediaService.uploadFile(
          file,
          'fizco/cac_documents',
        );
      } catch (uploadErr) {
        // Log Cloudinary upload error but proceed with successful verification
      }

      const updatedUser = await this.usersRepository.setBusinessVerified(
        userId,
        cleanNumber,
        businessName,
      );

      // Broadcast real-time verification badge update
      this.chatGateway.server?.emit('user_verified', {
        userId,
        isVerified: true,
        businessName: updatedUser.businessName,
        cacRegistrationNumber: updatedUser.cacRegistrationNumber,
      });

      return {
        isVerified: true,
        verificationStatus: updatedUser.verificationStatus,
        businessName: updatedUser.businessName,
        cacRegistrationNumber: updatedUser.cacRegistrationNumber,
        documentUrl,
        reason: aiResult.reason,
        confidence: aiResult.confidence,
        message:
          'Business verified successfully! You have received the verification badge.',
      };
    } else {
      // Mark verification as rejected
      await this.usersRepository.setBusinessRejected(userId);

      return {
        isVerified: false,
        verificationStatus: 'REJECTED',
        reason: aiResult.reason,
        extractedBusinessName: aiResult.extractedBusinessName,
        extractedRegistrationNumber: aiResult.extractedRegistrationNumber,
        message:
          aiResult.reason ||
          'CAC verification failed. Document details do not match the entered information.',
      };
    }
  }

  /**
   * CAC Verification endpoint - legacy fallback
   */
  async verifyBusiness(userId: string, dto: VerifyBusinessDto) {
    const rawNumber =
      dto.registrationNumber || dto.cacRegistrationNumber || 'RC-2020202';
    const cleanNumber = rawNumber.trim().toUpperCase();

    const updatedUser = await this.usersRepository.setBusinessVerified(
      userId,
      cleanNumber,
      dto.businessName,
    );

    // Broadcast verification in real-time to all connected mobile clients
    this.chatGateway.server?.emit('user_verified', {
      userId,
      isVerified: true,
      businessName: updatedUser.businessName,
      cacRegistrationNumber: updatedUser.cacRegistrationNumber,
    });

    return {
      isVerified: true,
      verificationStatus: updatedUser.verificationStatus,
      businessName: updatedUser.businessName,
      cacRegistrationNumber: updatedUser.cacRegistrationNumber,
    };
  }

  async inviteTeamMember(userId: string, dto: TeamInviteDto) {
    const inviter = await this.usersRepository.findById(userId);
    if (!inviter) {
      throw new NotFoundException('User not found');
    }

    if (!inviter.isVerified) {
      throw new BadRequestException('Only verified merchants can invite team members.');
    }

    const email = dto.email.trim().toLowerCase();
    if (email === inviter.email.toLowerCase()) {
      throw new BadRequestException('You cannot invite yourself to your team.');
    }

    const invite = await this.usersRepository.createTeamInvite(userId, email);

    // If the invitee already has an account, immediately grant team CAC verification if not independently verified
    const invitee = await this.usersRepository.findByEmail(email);
    if (invitee) {
      const isIndependentlyVerified = invitee.isVerified && !invitee.teamOwnerId;
      if (!isIndependentlyVerified) {
        await this.usersRepository.setUserTeamSharing(
          invitee.id,
          inviter.id,
          inviter.fullName,
          inviter.businessName,
          inviter.cacRegistrationNumber,
        );

        const notifBody = `You were just added to a team to use ${inviter.fullName}'s CAC verification.`;
        await this.notificationsService.notifyUser(
          invitee.id,
          '🎉 CAC Team Verification',
          notifBody,
          {
            type: 'TEAM_INVITE_ACCEPTED',
            teamOwnerId: inviter.id,
            ownerName: inviter.fullName,
          },
        );

        // Real-time socket events to invitee
        this.chatGateway.server?.to(`user_${invitee.id}`).emit('user_verified', {
          userId: invitee.id,
          isVerified: true,
          isSharingCac: true,
          cacSharedByOwnerName: inviter.fullName,
          cacSharedByBusinessName: inviter.businessName,
          cacRegistrationNumber: inviter.cacRegistrationNumber,
        });
      }
    }

    return {
      invitedEmail: invite.inviteeEmail,
    };
  }

  async removeTeamMember(userId: string, email: string) {
    const inviter = await this.usersRepository.findById(userId);
    const cleanEmail = email.trim().toLowerCase();
    await this.usersRepository.deleteTeamInvite(userId, cleanEmail);

    const member = await this.usersRepository.findByEmail(cleanEmail);
    if (member && member.teamOwnerId === userId) {
      await this.usersRepository.clearUserTeamSharing(member.id);

      const ownerName = inviter?.fullName || 'the business owner';
      const notifBody = `You were removed from ${ownerName}'s team.`;
      await this.notificationsService.notifyUser(
        member.id,
        'Team Update',
        notifBody,
        {
          type: 'TEAM_MEMBER_REMOVED',
          teamOwnerId: userId,
        },
      );

      // Real-time socket events to removed member
      this.chatGateway.server?.to(`user_${member.id}`).emit('user_unverified', {
        userId: member.id,
        isVerified: false,
        isSharingCac: false,
      });
    }

    return {
      removedEmail: cleanEmail,
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

  async deleteAccount(userId: string, dto: DeleteAccountDto) {
    const user = await this.usersRepository.findWithPassword(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Password is incorrect');
    }

    // A paid plan would otherwise keep renewing on the card of an account that's gone
    try {
      await this.subscriptionsService.cancelSubscription(userId, { cancelAtPeriodEnd: false });
    } catch (err) {
      // Thrown when there's no active subscription, the usual case
      if (!(err instanceof BadRequestException)) throw err;
    }

    const { removedRequestIds, formerTeamMemberIds } =
      await this.usersRepository.deleteAccount(userId);
    for (const requestId of removedRequestIds) {
      this.chatGateway.broadcastDeletedRequest(requestId);
    }

    // The members verified through this account's CAC are back to verifying their own business.
    // The account is already gone, so a failed notification is logged rather than failing the delete
    for (const memberId of formerTeamMemberIds) {
      this.chatGateway.server?.to(`user_${memberId}`).emit('user_unverified', {
        userId: memberId,
        isVerified: false,
        isSharingCac: false,
      });
      await this.notificationsService
        .notifyUser(
          memberId,
          'CAC Verification Removed',
          `${user.fullName} deleted their account, so you can no longer use their CAC verification. Verify your business to keep using Fizco.`,
          { type: 'TEAM_MEMBER_REMOVED', teamOwnerId: userId },
        )
        .catch((err) =>
          this.logger.error(`Failed to notify ${memberId} of lost team CAC: ${err}`),
        );
    }

    return { deleted: true };
  }

  async blockAndReportVendor(userId: string, dto: BlockAndReportVendorDto) {
    if (userId === dto.vendorId) {
      throw new BadRequestException('You cannot block yourself');
    }

    const block = await this.usersRepository.blockAndReportVendor(
      userId,
      dto.vendorId,
      dto.reason,
    );

    return {
      blocked: true,
      vendorId: dto.vendorId,
      reason: dto.reason || null,
      createdAt: block.createdAt,
    };
  }
}
