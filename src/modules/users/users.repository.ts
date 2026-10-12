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
        email: true,
        phoneNumber: true,
        subscriptionPlan: true,
        isVerified: true,
        verificationStatus: true,
        cacRegistrationNumber: true,
        avatarUrl: true,
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
    avatarUrl?: string;
  }) {
    return this.prisma.user.update({
      where: { id },
      data,
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
        avatarUrl: true,
        createdAt: true,
      },
    });
  }

  async setBusinessVerified(id: string, cacNumber: string) {
    return this.prisma.user.update({
      where: { id },
      data: {
        isVerified: true,
        verificationStatus: 'VERIFIED',
        cacRegistrationNumber: cacNumber,
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
}
