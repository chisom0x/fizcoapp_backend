import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        businessName: true,
        shopAddress: true,
        email: true,
        phoneNumber: true,
        subscriptionPlan: true,
        isVerified: true,
        verificationStatus: true,
        cacRegistrationNumber: true,
        teamOwnerId: true,
        cacSharedByOwnerName: true,
        cacSharedByBusinessName: true,
        avatarUrl: true,
        notificationsEnabled: true,
        lastSeenAt: true,
        createdAt: true,
        teamInvitesSent: {
          select: {
            id: true,
            inviteeEmail: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async findWithPassword(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        passwordHash: true,
      },
    });
  }

  async updateProfile(id: string, data: {
    fullName?: string;
    email?: string;
    phoneNumber?: string;
    businessName?: string;
    shopAddress?: string | null;
    avatarUrl?: string;
  }) {
    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        fullName: true,
        businessName: true,
        shopAddress: true,
        email: true,
        phoneNumber: true,
        subscriptionPlan: true,
        isVerified: true,
        verificationStatus: true,
        cacRegistrationNumber: true,
        avatarUrl: true,
        notificationsEnabled: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });
  }

  async setBusinessVerified(
    id: string,
    cacNumber: string,
    businessName?: string,
  ) {
    return this.prisma.user.update({
      where: { id },
      data: {
        isVerified: true,
        verificationStatus: 'VERIFIED',
        cacRegistrationNumber: cacNumber,
        ...(businessName ? { businessName } : {}),
      },
      select: {
        id: true,
        fullName: true,
        businessName: true,
        isVerified: true,
        verificationStatus: true,
        cacRegistrationNumber: true,
      },
    });
  }

  async setBusinessRejected(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: {
        isVerified: false,
        verificationStatus: 'REJECTED',
      },
      select: {
        id: true,
        fullName: true,
        businessName: true,
        isVerified: true,
        verificationStatus: true,
        cacRegistrationNumber: true,
      },
    });
  }

  async createTeamInvite(inviterId: string, email: string) {
    return this.prisma.teamInvite.upsert({
      where: {
        inviterId_inviteeEmail: {
          inviterId,
          inviteeEmail: email.toLowerCase(),
        },
      },
      update: {},
      create: {
        inviterId,
        inviteeEmail: email.toLowerCase(),
      },
    });
  }

  async findUsersByEmails(emails: string[]) {
    if (!emails.length) return [];
    return this.prisma.user.findMany({
      where: {
        email: {
          in: emails.map((e) => e.toLowerCase()),
        },
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        teamOwnerId: true,
        isVerified: true,
      },
    });
  }

  async deleteTeamInvite(inviterId: string, email: string) {
    return this.prisma.teamInvite.deleteMany({
      where: {
        inviterId,
        inviteeEmail: email.toLowerCase(),
      },
    });
  }

  async updatePassword(id: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash },
      select: { id: true },
    });
  }

  async blockAndReportVendor(userId: string, vendorId: string, reason?: string) {
    return this.prisma.blockedVendor.upsert({
      where: {
        userId_vendorId: {
          userId,
          vendorId,
        },
      },
      update: {
        reason: reason || undefined,
      },
      create: {
        userId,
        vendorId,
        reason,
      },
    });
  }

  async getBlockedVendorIds(userId: string): Promise<string[]> {
    const blocks = await this.prisma.blockedVendor.findMany({
      where: { userId },
      select: { vendorId: true },
    });
    return blocks.map((b) => b.vendorId);
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        fullName: true,
        businessName: true,
        email: true,
        isVerified: true,
        verificationStatus: true,
        cacRegistrationNumber: true,
        teamOwnerId: true,
      },
    });
  }

  async setUserTeamSharing(
    userId: string,
    ownerId: string,
    ownerName: string,
    businessName?: string | null,
    cacNumber?: string | null,
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isVerified: true,
        verificationStatus: 'VERIFIED',
        teamOwnerId: ownerId,
        cacSharedByOwnerName: ownerName,
        cacSharedByBusinessName: businessName || null,
        cacRegistrationNumber: cacNumber || null,
      },
      select: {
        id: true,
        fullName: true,
        businessName: true,
        isVerified: true,
        verificationStatus: true,
        cacRegistrationNumber: true,
        teamOwnerId: true,
        cacSharedByOwnerName: true,
        cacSharedByBusinessName: true,
      },
    });
  }

  async clearUserTeamSharing(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isVerified: false,
        verificationStatus: 'UNVERIFIED',
        teamOwnerId: null,
        cacSharedByOwnerName: null,
        cacSharedByBusinessName: null,
        cacRegistrationNumber: null,
      },
      select: {
        id: true,
        fullName: true,
        isVerified: true,
        verificationStatus: true,
      },
    });
  }
}

