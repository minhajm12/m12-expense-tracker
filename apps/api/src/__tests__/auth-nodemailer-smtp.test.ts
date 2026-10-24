import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Transporter } from 'nodemailer';
import {
  classifySmtpError,
  getFromAddress,
  setMailTransporter,
  resetMailTransporter,
  sendVerificationOtpEmail,
  sendPasswordResetOtpEmail,
  testEmailOtpStore,
} from '../services/email';
import { env } from '../config/env';

describe('Gmail SMTP & Nodemailer Email Service', () => {
  beforeEach(() => {
    testEmailOtpStore.clear();
    resetMailTransporter();
  });

  afterEach(() => {
    resetMailTransporter();
    vi.restoreAllMocks();
  });

  describe('Sender Address Resolution', () => {
    it('uses OTP_FROM_EMAIL when set', () => {
      const origOtpFrom = env.OTP_FROM_EMAIL;
      const origMailUser = env.MAIL_USER;
      try {
        (env as any).OTP_FROM_EMAIL = 'support@m12expense.com';
        (env as any).MAIL_USER = 'backup@gmail.com';

        const sender = getFromAddress();
        expect(sender).toBe('"M12 Expense Tracker" <support@m12expense.com>');
      } finally {
        (env as any).OTP_FROM_EMAIL = origOtpFrom;
        (env as any).MAIL_USER = origMailUser;
      }
    });

    it('falls back to MAIL_USER when OTP_FROM_EMAIL is empty', () => {
      const origOtpFrom = env.OTP_FROM_EMAIL;
      const origMailUser = env.MAIL_USER;
      try {
        (env as any).OTP_FROM_EMAIL = undefined;
        (env as any).MAIL_USER = 'finance.app@gmail.com';

        const sender = getFromAddress();
        expect(sender).toBe('"M12 Expense Tracker" <finance.app@gmail.com>');
      } finally {
        (env as any).OTP_FROM_EMAIL = origOtpFrom;
        (env as any).MAIL_USER = origMailUser;
      }
    });

    it('never sets recipient email as the sender', () => {
      const recipient = 'recipient.user@example.com';
      const sender = getFromAddress();
      expect(sender).not.toContain(recipient);
      expect(sender).toContain('M12 Expense Tracker');
    });
  });

  describe('SMTP Error Classification', () => {
    it('classifies EAUTH / response 535 as SMTP_AUTH_FAILED and sanitizes error', () => {
      const authErr = {
        code: 'EAUTH',
        responseCode: 535,
        message: '535-5.7.8 Username and Password not accepted with pass=secret_app_password_1234',
      };
      const result = classifySmtpError(authErr);

      expect(result.code).toBe('SMTP_AUTH_FAILED');
      expect(result.userMessage).toContain('authentication failed');
      expect(result.logDetails).not.toContain('secret_app_password_1234');
      expect(result.logDetails).toContain('ResponseCode: 535');
    });

    it('classifies connection timeout and socket errors as SMTP_CONNECTION_FAILED', () => {
      const connErr = {
        code: 'ETIMEDOUT',
        message: 'Connection to smtp.gmail.com:465 timed out',
      };
      const result = classifySmtpError(connErr);

      expect(result.code).toBe('SMTP_CONNECTION_FAILED');
      expect(result.userMessage).toContain('Unable to connect to the email delivery service');
    });

    it('classifies ECONNREFUSED as SMTP_CONNECTION_FAILED', () => {
      const connErr = {
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED 127.0.0.1:465',
      };
      const result = classifySmtpError(connErr);

      expect(result.code).toBe('SMTP_CONNECTION_FAILED');
    });

    it('classifies recipient rejection (550 / 553 / EENVELOPE) as INVALID_RECIPIENT', () => {
      const recipientErr = {
        responseCode: 550,
        message: '5.1.1 The email account that you tried to reach does not exist',
      };
      const result = classifySmtpError(recipientErr);

      expect(result.code).toBe('INVALID_RECIPIENT');
      expect(result.userMessage).toContain('could not receive messages');
    });

    it('classifies rate limit / quota exceeded as EMAIL_RATE_LIMITED', () => {
      const rateErr = {
        responseCode: 421,
        message: '4.7.0 Try again later, closing connection (quota exceeded)',
      };
      const result = classifySmtpError(rateErr);

      expect(result.code).toBe('EMAIL_RATE_LIMITED');
      expect(result.userMessage).toContain('rate limit reached');
    });

    it('classifies unknown errors as EMAIL_DELIVERY_FAILED', () => {
      const genericErr = new Error('Unexpected network reset');
      const result = classifySmtpError(genericErr);

      expect(result.code).toBe('EMAIL_DELIVERY_FAILED');
      expect(result.userMessage).toContain('Unable to deliver verification code');
    });
  });

  describe('Mocked Nodemailer Transporter Dispatch', () => {
    it('dispatches verification OTP via mocked transporter without real network calls', async () => {
      const sendMailMock = vi.fn().mockResolvedValue({
        messageId: '<test-msg-12345@gmail.com>',
      });

      const mockTransporter = {
        sendMail: sendMailMock,
      } as unknown as Transporter;

      setMailTransporter(mockTransporter);

      const targetEmail = 'newuser@example.com';
      const otp = '849201';
      const result = await sendVerificationOtpEmail(targetEmail, otp, 'New User');

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('<test-msg-12345@gmail.com>');
      expect(testEmailOtpStore.get(targetEmail)).toBe(otp);

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const callArgs = sendMailMock.mock.calls[0][0];
      expect(callArgs.to).toBe(targetEmail);
      expect(callArgs.from).toContain('M12 Expense Tracker');
      expect(callArgs.subject).toContain(otp);
      expect(callArgs.html).toContain(otp);
      expect(callArgs.html).toContain('Verify your email');
      expect(callArgs.text).toContain(otp);
    });

    it('dispatches password reset OTP via mocked transporter', async () => {
      const sendMailMock = vi.fn().mockResolvedValue({
        messageId: '<reset-msg-67890@gmail.com>',
      });

      const mockTransporter = {
        sendMail: sendMailMock,
      } as unknown as Transporter;

      setMailTransporter(mockTransporter);

      const targetEmail = 'resetuser@example.com';
      const otp = '193852';
      const result = await sendPasswordResetOtpEmail(targetEmail, otp, 'Reset User');

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('<reset-msg-67890@gmail.com>');
      expect(testEmailOtpStore.get(`reset:${targetEmail}`)).toBe(otp);

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const callArgs = sendMailMock.mock.calls[0][0];
      expect(callArgs.to).toBe(targetEmail);
      expect(callArgs.from).toContain('M12 Expense Tracker');
      expect(callArgs.subject).toContain('password reset code');
      expect(callArgs.html).toContain(otp);
      expect(callArgs.text).toContain(otp);
    });

    it('handles SMTP rejection gracefully and returns structured error', async () => {
      const sendMailMock = vi.fn().mockRejectedValue({
        code: 'EAUTH',
        responseCode: 535,
        message: 'Invalid login or bad credentials',
      });

      const mockTransporter = {
        sendMail: sendMailMock,
      } as unknown as Transporter;

      setMailTransporter(mockTransporter);

      const result = await sendVerificationOtpEmail('authfail@example.com', '123456');

      expect(result.success).toBe(false);
      expect(result.code).toBe('SMTP_AUTH_FAILED');
      expect(result.error).toContain('authentication failed');
    });

    it('returns EMAIL_SERVICE_NOT_CONFIGURED in production mode if credentials are missing', async () => {
      const origNodeEnv = env.NODE_ENV;
      const origMailUser = env.MAIL_USER;
      const origMailPass = env.MAIL_PASS;

      try {
        (env as any).NODE_ENV = 'production';
        (env as any).MAIL_USER = '';
        (env as any).MAIL_PASS = '';
        resetMailTransporter();

        const result = await sendVerificationOtpEmail('prod@example.com', '654321');

        expect(result.success).toBe(false);
        expect(result.code).toBe('EMAIL_SERVICE_NOT_CONFIGURED');
        expect(result.error).toContain('Email delivery service is not configured');
      } finally {
        (env as any).NODE_ENV = origNodeEnv;
        (env as any).MAIL_USER = origMailUser;
        (env as any).MAIL_PASS = origMailPass;
        resetMailTransporter();
      }
    });
  });
});
