import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  code?: string;
}

// In-memory registry for automated tests and non-production inspection
export const testEmailOtpStore = new Map<string, string>();

// Lazy-initialized Nodemailer transporter singleton
let mailTransporter: Transporter | null = null;

/**
 * Creates a standard Gmail SMTP transporter.
 * Uses Gmail's secure SMTP configuration via TLS/SSL.
 */
export function createGmailTransporter(user: string, pass: string): Transporter {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: user.trim(),
      pass: pass.trim(),
    },
  });
}

/**
 * Retrieves the active mail transporter, initializing if credentials exist.
 */
export function getMailTransporter(): Transporter | null {
  if (mailTransporter) {
    return mailTransporter;
  }

  const user = env.MAIL_USER?.trim();
  const pass = env.MAIL_PASS?.trim();

  if (user && pass) {
    mailTransporter = createGmailTransporter(user, pass);
  }

  return mailTransporter;
}

/**
 * Sets a custom or mock mail transporter (primarily for testing and dependency injection).
 */
export function setMailTransporter(transporter: Transporter | null): void {
  mailTransporter = transporter;
}

/**
 * Resets the active mail transporter singleton.
 */
export function resetMailTransporter(): void {
  mailTransporter = null;
}

/**
 * Resolves the canonical sender header for authentication emails.
 * Uses: "M12 Expense Tracker" <${OTP_FROM_EMAIL || MAIL_USER}>
 */
export function getFromAddress(): string {
  const fromEmail = (env.OTP_FROM_EMAIL || env.MAIL_USER || 'no-reply@m12expensetracker.com').trim();
  return `"M12 Expense Tracker" <${fromEmail}>`;
}

/**
 * Sanitizes log messages to ensure credentials, tokens, or passwords are never written to logs.
 */
function sanitizeErrorMessage(msg: string): string {
  if (!msg) return '';
  // Redact potential passwords or app passwords if ever reflected in an error string
  return msg
    .replace(/[a-z]{4}\s+[a-z]{4}\s+[a-z]{4}\s+[a-z]{4}/gi, '[REDACTED_APP_PASS]')
    .replace(/(?:password|pass|secret)=([^\s&]+)/gi, 'password=[REDACTED]');
}

/**
 * Classifies Nodemailer / SMTP errors into clear, actionable, non-sensitive categories.
 */
export function classifySmtpError(err: any): { code: string; userMessage: string; logDetails: string } {
  const rawMsg = err?.message || (typeof err === 'string' ? err : 'Unknown SMTP provider error');
  const sanitizedMsg = sanitizeErrorMessage(rawMsg);
  const errCode = (err?.code || '').toString().toUpperCase();
  const responseCode = err?.responseCode;

  // 1. Authentication failure (Invalid credentials, invalid App Password)
  if (
    errCode === 'EAUTH' ||
    responseCode === 535 ||
    sanitizedMsg.toLowerCase().includes('invalid login') ||
    sanitizedMsg.toLowerCase().includes('username and password not accepted') ||
    sanitizedMsg.toLowerCase().includes('badcredentials')
  ) {
    return {
      code: 'SMTP_AUTH_FAILED',
      userMessage: 'Email delivery authentication failed. Please verify the Gmail configuration or Google App Password.',
      logDetails: `[SMTP Auth Error] ResponseCode: ${responseCode || 'N/A'}, Code: ${errCode}`,
    };
  }

  // 2. Connection, DNS, or socket timeout
  if (
    errCode === 'ECONNREFUSED' ||
    errCode === 'ETIMEDOUT' ||
    errCode === 'ESOCKET' ||
    errCode === 'ENOTFOUND' ||
    errCode === 'EAI_AGAIN' ||
    sanitizedMsg.toLowerCase().includes('connection closed') ||
    sanitizedMsg.toLowerCase().includes('timeout')
  ) {
    return {
      code: 'SMTP_CONNECTION_FAILED',
      userMessage: 'Unable to connect to the email delivery service. Please try again later.',
      logDetails: `[SMTP Connection Error] Code: ${errCode}, Details: ${sanitizedMsg}`,
    };
  }

  // 3. Recipient mailbox error (invalid email address, rejected recipient)
  if (
    responseCode === 550 ||
    responseCode === 551 ||
    responseCode === 553 ||
    errCode === 'EENVELOPE' ||
    sanitizedMsg.toLowerCase().includes('recipient address rejected')
  ) {
    return {
      code: 'INVALID_RECIPIENT',
      userMessage: 'The provided email address could not receive messages.',
      logDetails: `[SMTP Recipient Rejected] ResponseCode: ${responseCode || 'N/A'}, Code: ${errCode}`,
    };
  }

  // 4. Rate limiting or quota exceeded
  if (
    responseCode === 421 ||
    responseCode === 452 ||
    sanitizedMsg.toLowerCase().includes('quota') ||
    sanitizedMsg.toLowerCase().includes('rate limit')
  ) {
    return {
      code: 'EMAIL_RATE_LIMITED',
      userMessage: 'Email delivery rate limit reached. Please wait a few moments before requesting another code.',
      logDetails: `[SMTP Rate Limit] ResponseCode: ${responseCode || 'N/A'}: ${sanitizedMsg}`,
    };
  }

  // 5. Generic delivery failure
  return {
    code: 'EMAIL_DELIVERY_FAILED',
    userMessage: 'Unable to deliver verification code. Please check your connection and retry.',
    logDetails: `[SMTP Dispatch Failed] Code: ${errCode || 'UNKNOWN'}: ${sanitizedMsg}`,
  };
}

/**
 * Unified email dispatcher using Nodemailer with Gmail SMTP.
 */
async function dispatchEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailSendResult> {
  const normalizedTo = params.to.toLowerCase().trim();
  const isProd = env.NODE_ENV === 'production';
  const isTestEnv = (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') && !isProd;

  // If a mock or custom transporter has been injected, prioritize using it
  const activeTransporter = getMailTransporter();

  // If running in automated tests without a custom transporter injected and not in production simulation, mock success safely
  if (isTestEnv && !activeTransporter) {
    return {
      success: true,
      messageId: `test-mock-${Date.now()}`,
    };
  }

  // Check if Gmail SMTP credentials are configured
  const hasCredentials = Boolean(env.MAIL_USER?.trim() && env.MAIL_PASS?.trim());

  if (!hasCredentials && !activeTransporter) {
    if (env.NODE_ENV === 'production') {
      console.error('❌ [EmailService] Fatal: MAIL_USER and MAIL_PASS are not configured in production environment.');
      return {
        success: false,
        code: 'EMAIL_SERVICE_NOT_CONFIGURED',
        error: 'Email delivery service is not configured. Please contact support.',
      };
    }

    // Development or test environment without live credentials
    console.info(`ℹ️ [EmailService Mock] Dispatching simulated email to ${normalizedTo} in ${env.NODE_ENV} mode.`);
    return {
      success: true,
      messageId: `mock-${Date.now()}`,
    };
  }

  const transporter = activeTransporter || getMailTransporter();
  if (!transporter) {
    return {
      success: false,
      code: 'EMAIL_SERVICE_NOT_CONFIGURED',
      error: 'Email delivery service transporter could not be initialized.',
    };
  }

  try {
    const from = getFromAddress();
    const info = await transporter.sendMail({
      from,
      to: normalizedTo,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    return {
      success: true,
      messageId: info.messageId || `smtp-${Date.now()}`,
    };
  } catch (err: any) {
    const classified = classifySmtpError(err);
    console.error(`❌ [EmailService] ${classified.logDetails}`);
    return {
      success: false,
      code: classified.code,
      error: classified.userMessage,
    };
  }
}

/**
 * Sends a branded 6-digit verification OTP email using Gmail SMTP via Nodemailer.
 */
export async function sendVerificationOtpEmail(
  to: string,
  otp: string,
  fullName?: string
): Promise<EmailSendResult> {
  const normalizedTo = to.toLowerCase().trim();
  testEmailOtpStore.set(normalizedTo, otp);

  const subject = `${otp} is your M12 Expense Tracker verification code`;

  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your email</title>
</head>
<body style="margin: 0; padding: 0; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #090d16; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 20px 32px; border-bottom: 1px solid #1f2937; text-align: left;">
              <span style="font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">M12 Expense Tracker</span>
              <p style="margin: 4px 0 0 0; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Personal Finance System</p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 12px 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Verify your email</h1>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 22px; color: #94a3b8;">
                ${fullName ? `Hello ${fullName},<br>` : ''}
                Welcome to M12 Expense Tracker. Please enter the following 6-digit verification code on your screen to complete your registration.
              </p>

              <!-- OTP Code Display -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
                <tr>
                  <td align="center" style="background-color: #030712; border: 1px solid #374151; border-radius: 12px; padding: 24px 16px;">
                    <span style="font-family: 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #10b981; display: inline-block;">
                      ${otp}
                    </span>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 16px 0; font-size: 12px; line-height: 18px; color: #cbd5e1;">
                <strong>⏱ Valid for 10 minutes:</strong> This one-time code will expire in 10 minutes. If you did not request this email, no further action is required and you can safely ignore it.
              </p>

              <div style="background-color: #1e1b4b; border: 1px solid #3730a3; border-radius: 8px; padding: 12px 16px; margin-top: 20px;">
                <p style="margin: 0; font-size: 12px; line-height: 18px; color: #c7d2fe;">
                  <strong>🔒 Security Notice:</strong> Never share this code with anyone. M12 Expense Tracker support will never ask for your verification code.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #030712; border-top: 1px solid #1f2937; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 16px;">
                &copy; ${new Date().getFullYear()} M12 Expense Tracker. Personal Finance Operating System.<br>
                Operating timezone: Asia/Kolkata
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const textBody = `
M12 Expense Tracker — Verify your email

Hello ${fullName || 'there'},

Your 6-digit email verification code is: ${otp}

This one-time passcode expires in 10 minutes.
Enter this code in your registration screen to activate your account.

Security Notice: Never share this code with anyone. M12 Expense Tracker will never ask for your code.
  `.trim();

  return dispatchEmail({
    to: normalizedTo,
    subject,
    html: htmlBody,
    text: textBody,
  });
}

/**
 * Sends a branded 6-digit password reset verification OTP email using Gmail SMTP via Nodemailer.
 */
export async function sendPasswordResetOtpEmail(
  to: string,
  otp: string,
  fullName?: string
): Promise<EmailSendResult> {
  const normalizedTo = to.toLowerCase().trim();
  testEmailOtpStore.set(`reset:${normalizedTo}`, otp);
  testEmailOtpStore.set(normalizedTo, otp);

  const subject = `${otp} is your M12 Expense Tracker password reset code`;

  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #090d16; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 20px 32px; border-bottom: 1px solid #1f2937; text-align: left;">
              <span style="font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">M12 Expense Tracker</span>
              <p style="margin: 4px 0 0 0; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Security Center</p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 12px 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Reset your password</h1>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 22px; color: #94a3b8;">
                ${fullName ? `Hello ${fullName},<br>` : ''}
                We received a request to reset your password for your M12 Expense Tracker account. Use the 6-digit verification code below to set a new password.
              </p>

              <!-- OTP Code Display -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
                <tr>
                  <td align="center" style="background-color: #030712; border: 1px solid #374151; border-radius: 12px; padding: 24px 16px;">
                    <span style="font-family: 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #6366f1; display: inline-block;">
                      ${otp}
                    </span>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 16px 0; font-size: 12px; line-height: 18px; color: #cbd5e1;">
                <strong>⏱ Valid for 10 minutes:</strong> This single-use code expires in 10 minutes. If you did not request a password reset, you can safely ignore this email — your existing password remains secure.
              </p>

              <div style="background-color: #1e1b4b; border: 1px solid #3730a3; border-radius: 8px; padding: 12px 16px; margin-top: 20px;">
                <p style="margin: 0; font-size: 12px; line-height: 18px; color: #c7d2fe;">
                  <strong>🔒 Security Warning:</strong> Never give this code to anyone. M12 Expense Tracker staff will never ask for your verification code.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #030712; border-top: 1px solid #1f2937; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 16px;">
                &copy; ${new Date().getFullYear()} M12 Expense Tracker. Personal Finance Operating System.<br>
                Operating timezone: Asia/Kolkata
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const textBody = `
M12 Expense Tracker — Reset your password

Hello ${fullName || 'there'},

Your 6-digit password reset verification code is: ${otp}

This single-use code expires in 10 minutes.
Enter this code in your browser to set a new password.

If you did not request this reset, your account is still safe and you can ignore this email.
Never share this code with anyone.
  `.trim();

  return dispatchEmail({
    to: normalizedTo,
    subject,
    html: htmlBody,
    text: textBody,
  });
}
