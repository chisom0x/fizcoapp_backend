import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService signup checks', () => {
  let authRepository: Record<string, jest.Mock>;
  let emailService: Record<string, jest.Mock>;
  let service: AuthService;

  beforeEach(() => {
    authRepository = {
      findByEmail: jest.fn().mockResolvedValue(null),
      findByPhone: jest.fn().mockResolvedValue(null),
      saveOtp: jest.fn().mockResolvedValue(undefined),
      findValidOtp: jest.fn(),
      createUser: jest.fn(),
    };
    emailService = { sendOtpEmail: jest.fn().mockResolvedValue(undefined) };
    service = new AuthService(
      authRepository as any,
      emailService as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
      {} as any,
    );
  });

  it('refuses a taken phone number before sending the signup code', async () => {
    authRepository.findByPhone.mockResolvedValue({ id: 'usr_1' });

    await expect(
      service.sendOtp({ destination: 'new@x.com', purpose: 'signup', phoneNumber: ' 0812 ' }),
    ).rejects.toThrow(ConflictException);
    expect(authRepository.findByPhone).toHaveBeenCalledWith('0812');
    expect(authRepository.saveOtp).not.toHaveBeenCalled();
    expect(emailService.sendOtpEmail).not.toHaveBeenCalled();
  });

  it('refuses a taken email before sending the signup code', async () => {
    authRepository.findByEmail.mockResolvedValue({ id: 'usr_1' });

    await expect(
      service.sendOtp({ destination: 'taken@x.com', purpose: 'signup', phoneNumber: '0812' }),
    ).rejects.toThrow('An account with this email address already exists');
    expect(emailService.sendOtpEmail).not.toHaveBeenCalled();
  });

  it('sends the signup code when the email and phone number are free', async () => {
    await service.sendOtp({ destination: 'new@x.com', purpose: 'signup', phoneNumber: '0812' });
    expect(emailService.sendOtpEmail).toHaveBeenCalledWith('new@x.com', expect.any(String), 'signup');
  });

  it('does not check availability for a password reset code', async () => {
    authRepository.findByEmail.mockResolvedValue({ id: 'usr_1' });
    await service.sendOtp({ destination: 'taken@x.com', purpose: 'password_reset' });
    expect(emailService.sendOtpEmail).toHaveBeenCalled();
  });

  it('refuses a signup whose passwords do not match', async () => {
    await expect(
      service.signup({
        fullName: 'Ada',
        email: 'new@x.com',
        phoneNumber: '0812',
        password: 'secret123',
        confirmPassword: 'secret124',
        otp: '654321',
      }),
    ).rejects.toThrow(new BadRequestException('Passwords do not match'));
    expect(authRepository.createUser).not.toHaveBeenCalled();
  });
});
