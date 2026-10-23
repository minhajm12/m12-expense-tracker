import { Resend } from 'resend';
import { env } from '../config/env';

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  code?: string;
}

// In-memory registry for automated tests and non-production inspection
export const testEmailOtpStore = new Map<string, string>();

// Lazy-initialized Resend client singleton
let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (!resendClient && env.RESEND_API_KEY) {
    resendClient = new Resend(env.RESEND_API_KEY.trim());
  }
  return resendClient;
}

/**
 * Classifies Resend provider errors into clear, actionable categories.
 */
function classifyEmailError(err: any): { code: string; userMessage: string; logDetails: string } {
  const errMsg = err?.message || (typeof err === 'string' ? err : 'Unknown email provider error');
  const statusCode = err?.statusCode || err?.status;

  // 1. Resend sandbox recipient restriction (403 validation_error)
  if (
    statusCode === 403 ||
    errMsg.includes('only send testing emails') ||
    errMsg.includes('verify a domain')
  ) {
    return {
      code: 'RESEND_SANDBOX_RESTRICTION',
      userMessage:
        'Email delivery restricted by provider sandbox: to send to this email address, a custom domain must be verified at resend.com/domains. In sandbox mode, only the Resend account owner can receive emails.',
      logDetails: `[Resend Sandbox Restriction] ${errMsg}`,
    };
  }

  // 2. Unauthorized / invalid API key (401)
  if (statusCode === 401 || errMsg.toLowerCase().includes('api key') || errMsg.toLowerCase().includes('unauthorized')) {
    return {
      code: 'EMAIL_PROVIDER_UNAUTHORIZED',
      userMessage: 'Email delivery service is unauthorized. Please verify the RESEND_API_KEY configuration.',
      logDetails: `[Resend Auth Error] Status 401: ${errMsg}`,
    };
  }

  // 3. Rate limiting (429)
  if (statusCode === 429 || errMsg.toLowerCase().includes('rate limit')) {
    return {
      code: 'EMAIL_RATE_LIMITED',
      userMessage: 'Email delivery rate limit reached. Please wait a few moments before requesting another code.',
      logDetails: `[Resend Rate Limit] Status 429: ${errMsg}`,
    };
  }

  // 4. Domain not verified or validation failure (422)
  if (statusCode === 422 || errMsg.toLowerCase().includes('domain')) {
    return {
      code: 'EMAIL_DOMAIN_UNVERIFIED',
      userMessage: 'Sender domain is not verified with the email service provider.',
      logDetails: `[Resend Domain Validation] Status 422: ${errMsg}`,
    };
  }

  // 5. Generic / network error
  return {
    code: 'EMAIL_DELIVERY_FAILED',
    userMessage: 'Unable to deliver verification code. Please check your connection and retry.',
    logDetails: `[Resend Dispatch Failed] ${errMsg}`,
  };
}

/**
 * Unified email dispatcher using the Resend SDK.
 */
async function dispatchEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailSendResult> {
  const normalizedTo = params.to.toLowerCase().trim();
  const fromEmail = env.OTP_FROM_EMAIL || 'onboarding@resend.dev';

  // In automated test environment, always mock successfully to store OTP in testEmailOtpStore
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true' || env.NODE_ENV === 'test') {
    return {
      success: true,
      messageId: `test-mock-${Date.now()}`,
    };
  }

  // Check if RESEND_API_KEY is configured
  if (!env.RESEND_API_KEY || !env.RESEND_API_KEY.trim()) {
    if (env.NODE_ENV === 'production') {
      console.error('❌ [EmailService] Fatal: RESEND_API_KEY is not configured in production environment.');
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

  const client = getResendClient();
  if (!client) {
    return {
      success: false,
      code: 'EMAIL_SERVICE_NOT_CONFIGURED',
      error: 'Email delivery service client could not be initialized.',
    };
  }

  try {
    const { data, error } = await client.emails.send({
      from: fromEmail,
      to: [normalizedTo],
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    if (error) {
      const classified = classifyEmailError(error);
      console.error(`⚠️ [EmailService] ${classified.logDetails}`);
      return {
        success: false,
        code: classified.code,
        error: classified.userMessage,
      };
    }

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (err: any) {
    const classified = classifyEmailError(err);
    console.error(`❌ [EmailService] Exception dispatching email: ${classified.logDetails}`);
    return {
      success: false,
      code: classified.code,
      error: classified.userMessage,
    };
  }
}

/**
 * Sends a branded 6-digit verification OTP email using Resend.
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
 * Sends a branded 6-digit password reset verification OTP email using Resend.
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
