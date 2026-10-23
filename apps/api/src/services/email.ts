import { env } from '../config/env';

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// In-memory registry for automated tests and non-production inspection
export const testEmailOtpStore = new Map<string, string>();

/**
 * Sends a branded 6-digit verification OTP email using Resend.
 * Uses inline email-safe CSS compatible with major email clients.
 */
export async function sendVerificationOtpEmail(
  to: string,
  otp: string,
  fullName?: string
): Promise<EmailSendResult> {
  const normalizedTo = to.toLowerCase().trim();
  testEmailOtpStore.set(normalizedTo, otp);

  const subject = `${otp} is your M12 Expense Tracker verification code`;
  const fromEmail = env.OTP_FROM_EMAIL || 'onboarding@resend.dev';

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

  // If no RESEND_API_KEY is configured, handle safely
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === 'production') {
      console.error('[EmailService] Fatal: RESEND_API_KEY is not configured in production environment.');
      return {
        success: false,
        error: 'Email delivery service is not configured. Please contact support.',
      };
    }

    // Development or test environment without live credentials
    return {
      success: true,
      messageId: `mock-${Date.now()}`,
    };
  }

  // Live dispatch via Resend REST API
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [normalizedTo],
        subject,
        html: htmlBody,
        text: textBody,
      }),
    });

    const json = (await res.json()) as any;

    if (!res.ok) {
      const errMsg = json?.message || json?.error?.message || `Resend HTTP error ${res.status}`;
      console.error('[EmailService] Resend email dispatch failed safely:', errMsg);
      return {
        success: false,
        error: errMsg,
      };
    }

    return {
      success: true,
      messageId: json?.id,
    };
  } catch (err: any) {
    console.error('[EmailService] Network or provider exception dispatching email:', err?.message || err);
    return {
      success: false,
      error: 'Unable to deliver verification code. Please check your connection and retry.',
    };
  }
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
  const fromEmail = env.OTP_FROM_EMAIL || 'onboarding@resend.dev';

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

  // If no RESEND_API_KEY is configured, handle safely
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === 'production') {
      console.error('[EmailService] Fatal: RESEND_API_KEY is not configured in production environment.');
      return {
        success: false,
        error: 'Email delivery service is not configured. Please contact support.',
      };
    }

    return {
      success: true,
      messageId: `mock-reset-${Date.now()}`,
    };
  }

  // Live dispatch via Resend REST API
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [normalizedTo],
        subject,
        html: htmlBody,
        text: textBody,
      }),
    });

    const json = (await res.json()) as any;

    if (!res.ok) {
      const errMsg = json?.message || json?.error?.message || `Resend HTTP error ${res.status}`;
      console.error('[EmailService] Resend email dispatch failed safely:', errMsg);
      return {
        success: false,
        error: errMsg,
      };
    }

    return {
      success: true,
      messageId: json?.id,
    };
  } catch (err: any) {
    console.error('[EmailService] Network or provider exception dispatching reset email:', err?.message || err);
    return {
      success: false,
      error: 'Unable to deliver verification code. Please check your connection and retry.',
    };
  }
}
