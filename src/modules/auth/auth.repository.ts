import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        fullName: true,
        businessName: true,
        email: true,
        phoneNumber: true,
        passwordHash: true,
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
      },
    });
  }

  async findByPhone(phoneNumber: string) {
    return this.prisma.user.findUnique({
      where: { phoneNumber },
      select: {
        id: true,
        fullName: true,
        businessName: true,
        email: true,
        phoneNumber: true,
        passwordHash: true,
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
      },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        businessName: true,
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
      },
    });
  }

  async createUser(data: {
    fullName: string;
    businessName?: string;
    email: string;
    phoneNumber: string;
    passwordHash: string;
  }) {
    const cleanEmail = data.email.toLowerCase();
    // Check if there is an active team invite from a verified user
    const pendingInvite = await this.prisma.teamInvite.findFirst({
      where: { inviteeEmail: cleanEmail },
      include: {
        inviter: {
          select: {
            id: true,
            fullName: true,
            businessName: true,
            isVerified: true,
            cacRegistrationNumber: true,
          },
        },
      },
    });

    const isShared = pendingInvite?.inviter?.isVerified === true;

    const newUser = await this.prisma.user.create({
      data: {
        fullName: data.fullName,
        businessName: data.businessName,
        email: cleanEmail,
        phoneNumber: data.phoneNumber,
        passwordHash: data.passwordHash,
        isVerified: isShared,
        verificationStatus: isShared ? 'VERIFIED' : 'UNVERIFIED',
        teamOwnerId: isShared ? pendingInvite.inviter.id : null,
        cacSharedByOwnerName: isShared ? pendingInvite.inviter.fullName : null,
        cacSharedByBusinessName: isShared ? pendingInvite.inviter.businessName : null,
        cacRegistrationNumber: isShared ? pendingInvite.inviter.cacRegistrationNumber : null,
      },
      select: {
        id: true,
        fullName: true,
        businessName: true,
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
      },
    });

    return {
      ...newUser,
      inviterId: pendingInvite?.inviterId || pendingInvite?.inviter?.id || null,
    };
  }

  async saveOtp(destination: string, code: string, purpose: string, expiresAt: Date) {
    // Invalidate prior OTPs for same destination & purpose
    await this.prisma.otpVerification.deleteMany({
      where: {
        destination: destination.toLowerCase(),
        purpose,
      },
    });

    return this.prisma.otpVerification.create({
      data: {
        destination: destination.toLowerCase(),
        code,
        purpose,
        expiresAt,
      },
    });
  }

  async findValidOtp(destination: string, purpose: string) {
    return this.prisma.otpVerification.findFirst({
      where: {
        destination: destination.toLowerCase(),
        purpose,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markOtpVerified(id: string) {
    return this.prisma.otpVerification.update({
      where: { id },
      data: { verified: true },
    });
  }

  async updatePassword(userId: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
      select: { id: true },
    });
  }
}
