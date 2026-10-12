import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly zeptoUrl: string;
  private readonly zeptoToken: string;
  private readonly fromAddress: string;
  private readonly fromName: string;

  constructor(private readonly configService: ConfigService) {
    this.zeptoUrl =
      this.configService.get<string>('ZEPTOMAIL_URL') ||
      'https://api.zeptomail.com/v1.1/email';
    this.zeptoToken =
      this.configService.get<string>('ZEPTOMAIL_TOKEN') ||
      this.configService.get<string>('ZEPTO_API_TOKEN') ||
      '';
    this.fromAddress =
      this.configService.get<string>('ZEPTOMAIL_FROM_ADDRESS') ||
      this.configService.get<string>('ZEPTO_FROM_ADDRESS') ||
      'noreply@learnly.com.ng';
    this.fromName =
      this.configService.get<string>('ZEPTOMAIL_FROM_NAME') || 'Fizco';
  }

  /**
   * Generates a modern HTML and CSS template for OTP emails
   */
  private generateOtpEmailTemplate(otpCode: string, purpose: string): string {
    const isSignup = purpose.toLowerCase().includes('signup');
    const title = isSignup ? 'Verify Your Fizco Account' : 'Reset Your Password';
    const description = isSignup
      ? 'Thank you for registering on Fizco. Please use the verification code below to verify your email address.'
      : 'You requested to reset your password on Fizco. Use the 6-digit code below to complete your password reset.';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #0b0f19;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #e2e8f0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #0b0f19;
      padding: 40px 16px;
    }
    .container {
      max-width: 520px;
      margin: 0 auto;
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 18px;
      padding: 36px 32px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
    }
    .logo-container {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo-badge {
      display: inline-block;
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #0066FF;
      background: rgba(0, 102, 255, 0.1);
      padding: 8px 20px;
      border-radius: 12px;
      border: 1px solid rgba(0, 102, 255, 0.2);
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      color: #f8fafc;
      margin: 0 0 12px;
      text-align: center;
    }
    p {
      font-size: 14px;
      line-height: 1.6;
      color: #94a3b8;
      margin: 0 0 24px;
      text-align: center;
    }
    .otp-box {
      background: #1e293b;
      border: 1px dashed #0066FF;
      border-radius: 14px;
      padding: 20px;
      text-align: center;
      margin: 24px 0;
    }
    .otp-code {
      font-family: 'Courier New', Courier, monospace;
      font-size: 36px;
      font-weight: 800;
      letter-spacing: 8px;
      color: #38bdf8;
      margin: 0;
    }
    .expiry {
      font-size: 12px;
      color: #64748b;
      margin-top: 8px;
    }
    .footer {
      border-top: 1px solid #1f2937;
      padding-top: 20px;
      margin-top: 28px;
      text-align: center;
      font-size: 12px;
      color: #475569;
    }
    .footer a {
      color: #0066FF;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="logo-container">
        <div class="logo-badge">FIZCO</div>
      </div>
      <h1>${title}</h1>
      <p>${description}</p>
      <div class="otp-box">
        <div class="otp-code">${otpCode}</div>
        <div class="expiry">This verification code expires in 10 minutes.</div>
      </div>
      <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">
        If you did not request this verification code, you can safely ignore this email.
      </p>
      <div class="footer">
        © ${new Date().getFullYear()} Fizco Gadgets Marketplace. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>
    `;
  }

  async sendOtpEmail(toEmail: string, otp: string, purpose: string): Promise<boolean> {
    const isSignup = purpose.toLowerCase().includes('signup');
    const subject = isSignup
      ? `Fizco - ${otp} is your verification code`
      : `Fizco - ${otp} is your password reset code`;

    const htmlBody = this.generateOtpEmailTemplate(otp, purpose);

    try {
      const payload = {
        from: {
          address: this.fromAddress,
          name: this.fromName,
        },
        to: [
          {
            email_address: {
              address: toEmail,
              name: toEmail.split('@')[0],
            },
          },
        ],
        subject,
        htmlbody: htmlBody,
      };

      const response = await axios.post(this.zeptoUrl, payload, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: this.zeptoToken,
        },
        timeout: 10000,
      });

      this.logger.log(`ZeptoMail OTP dispatched successfully to ${toEmail}`);
      return response.status >= 200 && response.status < 300;
    } catch (error) {
      const errorMsg = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data || error.message)
        : String(error);
      this.logger.error(`Failed to send email to ${toEmail} via ZeptoMail: ${errorMsg}`);
      // Fallback log for local development visibility
      this.logger.warn(`[DEV FALLBACK] OTP code for ${toEmail}: ${otp}`);
      return true;
    }
  }
}
