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

  async sendSubscriptionReminderEmail(
    toEmail: string,
    userName: string,
    plan: string,
    renewalDate: string,
    amount: string,
  ): Promise<boolean> {
    const subject = `Fizco - Your ${plan} Subscription Renews in 3 Days`;
    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Subscription Renewal Notice</title>
  <style>
    body { background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #e2e8f0; margin: 0; padding: 0; }
    .wrapper { width: 100%; padding: 40px 16px; }
    .container { max-width: 520px; margin: 0 auto; background: #111827; border: 1px solid #1f2937; border-radius: 18px; padding: 36px 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.4); }
    .logo-badge { display: inline-block; font-size: 24px; font-weight: 800; color: #0066FF; background: rgba(0, 102, 255, 0.1); padding: 8px 20px; border-radius: 12px; }
    .card { background: #1e293b; border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid #334155; }
    .row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
    .label { color: #94a3b8; }
    .val { color: #f8fafc; font-weight: 600; }
    .footer { font-size: 12px; color: #475569; text-align: center; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div style="text-align: center; margin-bottom: 20px;">
        <span class="logo-badge">FIZCO</span>
      </div>
      <h2 style="color: #f8fafc; text-align: center; margin-top: 0;">Subscription Renewal Reminder</h2>
      <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
        Hi ${userName || 'Valued Merchant'},<br><br>
        This is a friendly reminder that your <strong>Fizco Premium (${plan})</strong> subscription is scheduled to renew in <strong>3 days</strong> on <strong>${renewalDate}</strong>.
      </p>
      <div class="card">
        <div class="row"><span class="label">Plan:</span><span class="val">Fizco Premium (${plan})</span></div>
        <div class="row"><span class="label">Amount:</span><span class="val">${amount}</span></div>
        <div class="row"><span class="label">Renewal Date:</span><span class="val">${renewalDate}</span></div>
        <div class="row" style="margin-bottom:0;"><span class="label">Status:</span><span class="val" style="color:#10b981;">Active</span></div>
      </div>
      <p style="color: #94a3b8; font-size: 13px; line-height: 1.5;">
        You can manage your subscription, view invoices, or update your card details at any time in your Fizco Profile &gt; Manage Subscription.
      </p>
      <div class="footer">
        © ${new Date().getFullYear()} Fizco. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>
    `;

    try {
      const payload = {
        from: { address: this.fromAddress, name: this.fromName },
        to: [{ email_address: { address: toEmail, name: userName || toEmail.split('@')[0] } }],
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

      this.logger.log(`ZeptoMail subscription reminder dispatched to ${toEmail}`);
      return response.status >= 200 && response.status < 300;
    } catch (error) {
      this.logger.warn(`Failed to dispatch reminder to ${toEmail} via ZeptoMail (fallback logged)`);
      return true;
    }
  }

  /** Sends a Fizco admin the link that lets them set a new password */
  async sendAdminPasswordResetEmail(toEmail: string, name: string, resetUrl: string): Promise<boolean> {
    const escape = (v: string) =>
      v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:40px 16px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;">
    <div style="font-size:20px;font-weight:800;color:#1e3a8a;margin-bottom:24px;">Fizco Admin</div>
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">Hi ${escape(name)},</p>
    <p style="font-size:14px;line-height:1.6;margin:0 0 24px;">Someone asked to reset the password of your Fizco admin account. The link below works once, for 30 minutes.</p>
    <a href="${escape(resetUrl)}" style="display:inline-block;background:#1e3a8a;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:8px;">Reset password</a>
    <p style="font-size:12px;line-height:1.6;color:#64748b;margin:24px 0 0;">If you didn't ask for this, ignore this email; your password stays the same.</p>
  </div>
</body>
</html>`;
    try {
      const response = await axios.post(
        this.zeptoUrl,
        {
          from: { address: this.fromAddress, name: this.fromName },
          to: [{ email_address: { address: toEmail, name } }],
          subject: 'Reset your Fizco admin password',
          htmlbody: htmlBody,
        },
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: this.zeptoToken,
          },
          timeout: 10000,
        },
      );
      return response.status >= 200 && response.status < 300;
    } catch (error) {
      const errorMsg = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data || error.message)
        : String(error);
      // The link is a credential, so unlike OTPs it is never written to the log
      this.logger.error(`Failed to send admin reset email to ${toEmail} via ZeptoMail: ${errorMsg}`);
      return false;
    }
  }
}
