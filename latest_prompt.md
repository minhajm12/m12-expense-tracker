<USER_REQUEST>
# M12 Expense Tracker — EMI/Dashboard Synchronization, Investment Transactions, Authentication Improvements & Full Regression Testing

You are working on my existing **M12 Expense Tracker** full-stack application. First inspect the existing codebase, architecture, database models, APIs, and UI before making changes. Implement the following requirements in the correct order, with independent testing after each phase.

**Important:** Do not rebuild the application from scratch. Preserve existing user data, financial records, transaction history, account balances, EMI payment history, recurring schedules, and existing design conventions unless a requirement explicitly calls for removing a record. Do not introduce duplicate accounting entries or change existing balances unexpectedly.

## Phase 1 — Fix EMI Status and Upcoming Monthly Payments

### 1. Understand and fix the current bug

Refer to the two supplied screenshots of the **Upcoming Monthly Payments** dashboard section.

The problem is that the EMI module already shows an EMI as paid for October 2026 and shows November 2026 as the next due installment. However, the dashboard's October 2026 view still displays that October EMI as due and offers a **Pay EMI** button.

The dashboard must use the actual payment records and installment status from the EMI module. It must not independently guess whether an EMI has been paid based only on its due date or schedule.

### 2. Establish one source of truth for EMI payments

Inspect the existing EMI model, installment schedule, payment API, and dashboard calculations.

Implement a consistent relationship between:

- EMI configuration and schedule.
- Individual installment records.
- Actual EMI payment transactions.
- Previously paid installments imported during EMI setup.
- Current and future unpaid installments.
- Completed EMI agreements.

Every installment should have a stable identity, including its EMI ID and scheduled installment period or sequence number.

Use the actual payment record and installment status to determine whether an installment is paid. Do not rely solely on a transaction description, display label, or the current date.

If an installment was marked as previously paid during EMI creation, it must be treated as paid for the relevant month without creating a new bank debit or expense transaction.

### 3. Correct month selection and display

The Upcoming Monthly Payments section must correctly distinguish between the selected month, the actual current month, and the next month.

Expected behavior for the example:

- **October 2026 — Current Month:** The October EMI is already paid. Show it as `Paid`, with no `Pay EMI` button.
- **November 2026 — Next Month:** The November EMI is unpaid and upcoming. Show it as `Due` or `Upcoming`, with the `Pay EMI` action available when appropriate.
- When the user selects **Next Month**, display November's obligations, not October's.
- When the user navigates to another month, show the obligations for that selected month.
- When a payment is recorded for November, November must become paid immediately, and the dashboard totals and status must update.

Do not display the same installment as unpaid in one section and paid in another.

### 4. Dashboard obligation calculations

Calculate the following values from actual records for the selected month:

- Total Expected.
- Recurring Remaining.
- EMI Remaining.
- Total Paid.
- Remaining Needed.

Use these definitions consistently:

- **Total Expected:** The expected recurring payments and EMI installments applicable to the selected month.
- **Recurring Remaining:** Expected recurring amounts that have not been paid for that month.
- **EMI Remaining:** Expected EMI installments that have not been paid for that month.
- **Total Paid:** Actual confirmed payments for the selected month, based on the relevant payment records.
- **Remaining Needed:** Recurring Remaining + EMI Remaining.

Do not double-count payments, and do not treat the scheduled amount as the actual amount paid when the actual amount differs.

If a user paid a different amount due to bank charges or another adjustment, display the actual payment amount as paid while retaining the expected installment amount for planning.

Ensure all summary cards, status tabs, obligation counts, and individual payment rows use the same underlying calculation rules.

### 5. EMI payment action rules

- A paid installment must not display `Pay EMI`.
- A future unpaid installment may display `Pay EMI` when it is eligible for payment.
- A previously paid installment must not be offered for payment again.
- Paying an installment must create or update its actual payment record exactly once.
- Deleting the corresponding payment transaction must restore the installment to unpaid only when the application's existing transaction-deletion and reconciliation rules confirm that the payment was genuinely reversed.
- Do not reset an installment to unpaid merely because a dashboard refresh or API request fails.
- Prevent duplicate payment submissions and concurrent requests from recording the same installment twice.

Keep the EMI schedule popup consistent with the EMI details page and the dashboard.

### 6. Fix EMI deletion and completion

Correct the EMI module's **All EMI** section.

**When an EMI is deleted:**
- Permanently delete the EMI agreement and its associated EMI-specific schedule/configuration records where appropriate.
- Do not merely archive it or leave it displayed in All EMI.
- Ask for confirmation before deleting.
- Clearly explain the consequences for associated payment history.
- Never silently delete linked financial transactions or alter bank balances. If financial records must be preserved for accounting integrity, retain the necessary historical records and references while removing the EMI agreement from active EMI management.
- Ensure no orphaned installment schedules remain visible in the dashboard or Upcoming Monthly Payments.
- Ensure deletion does not accidentally remove unrelated transactions.

**When an EMI is completed:**
- Keep it visible in the EMI module as a `Completed EMI`.
- Show it in the existing completed tab or a dedicated Completed EMI section.
- Do not treat a completed EMI as an active upcoming obligation.
- Preserve all installment and payment history.
- Do not confuse deletion with completion.

### 7. EMI regression tests

Test all of these scenarios:

1. October EMI paid; October dashboard shows Paid.
2. October EMI paid; November dashboard shows the November installment as due.
3. Switch between Current Month and Next Month.
4. Previously paid installments are not charged again.
5. Pay a current eligible installment; dashboard totals update immediately.
6. Pay a future installment where the existing rules allow it; the correct installment period is recorded.
7. Delete an EMI and verify it disappears from active All EMI and upcoming obligations.
8. Complete an EMI and verify it appears in Completed EMI.
9. Delete a legitimate payment transaction and verify installment status is recalculated correctly.
10. Refresh the page and verify statuses and totals remain consistent.
11. Verify that no duplicate expense or bank debit is created.

**Finish Phase 1 completely and report the test results before proceeding to Phase 2.**

---

## Phase 2 — Add Investment as a Transaction Type

Add **Investment** as a first-class transaction type in the existing Transactions module and Recurring Transactions module.

Investment is money allocated to an investment, not an ordinary expense or income.

### 1. Manual investment transactions

Add `Investment` to the transaction-type selector.

When a user records an investment:

- Record the investment amount, date, description, category if applicable, and payment source.
- Support the existing supported payment methods and account-selection rules.
- If paid from a bank account through UPI or another supported bank-debit method, reduce that selected bank account balance by the actual investment amount.
- If paid using a credit card, follow the application's existing credit-card accounting rules without incorrectly reducing a bank account immediately.
- If paid from Personal Cash in Hand, reduce Personal Cash in Hand instead of a bank balance.
- Use the existing cash/card/bank validation rules.
- Record the investment exactly once.

Investment must be visible in the transaction history, but it must **not** be classified as an ordinary expense or income.

### 2. Correct accounting treatment

Investment is an allocation of money, not ordinary consumption.

- Track total invested separately from total expenses and income.
- Reduce the relevant available cash or bank balance when the investment is funded.
- Do not classify the investment as an expense merely to make the balance decrease.
- Do not increase income or expense totals because of an investment entry.
- Do not count the same investment in both Investment and Expense totals.
- Preserve the distinction between investment contributions and investment returns.

If the existing application does not support tracking investment assets or investment returns, do not invent their values. Track investment contributions separately and leave investment valuation and returns outside the feature unless already supported.

### 3. Investment in recurring transactions

Add `Investment` to the recurring rule transaction-type selector.

When a user creates a recurring investment rule:

- Preserve the recurring schedule, payment method, selected account/card, and existing rule-editing functionality.
- Add an Investment-specific `Log Now` confirmation popup.
- Allow the user to confirm the actual amount before recording the payment.
- If the actual amount differs from the scheduled amount, record the confirmed actual amount according to existing recurring-payment logic.
- Support the same supported payment-method switching rules already required by the recurring module.
- Enforce the existing one-payment-per-rule-per-period rule.
- A recurring investment payment must create an Investment transaction, not an Expense or Income transaction.
- The investment amount must reduce the selected funding source according to the correct payment method.
- If the payment transaction is deleted, recalculate that period's payment status consistently with the existing recurring transaction deletion rules.
- Prevent duplicate investment records when the user clicks `Log Now` repeatedly or submits concurrent requests.

### 4. Main Reports integration

Add investment metrics to the Main Reports module.

Show at least:

- Total Invested.
- Monthly Investment Contributions.
- Investment breakdown by category or investment purpose when supported by recorded data.
- Investment transaction history and date-range filtering.
- Investment contributions by funding source, where supported.

The Main Reports module must separately display:

- Income.
- Ordinary Expenses.
- Investments.
- Credit-card repayment reporting according to existing accounting rules.
- Recurring payment reporting.
- EMI payment reporting.

Do not double-count the same payment in multiple financial totals. Credit-card repayments must continue to follow the app's existing debt-settlement logic and must not be counted as a second expense if the underlying purchases have already been counted.

### 5. Investment regression tests

Verify:

1. A manual bank-funded investment reduces the correct bank balance.
2. A cash-funded investment reduces Personal Cash in Hand.
3. A credit-card-funded investment follows existing credit-card accounting rules.
4. An investment does not appear in ordinary Expense or Income totals.
5. A recurring investment creates an Investment transaction.
6. Recurring investment payments cannot be duplicated for the same period.
7. Deleting an investment transaction updates balances and recurring status correctly.
8. Main Reports totals and date filters are correct.
9. Existing Expense and Income workflows remain unchanged.

**Finish Phase 2 completely and report the test results before proceeding to Phase 3.**

---

## Phase 3 — Forgot Password and Authentication Page Redesign

Implement a secure **Forgot Password** workflow and improve the Login and Create Account pages without changing the layout of authenticated application pages.

### 1. Forgot Password flow

Add a `Forgot Password?` link to the login page.

Recommended user flow:

1. User opens Forgot Password.
2. User enters their registered email address.
3. The backend generates a cryptographically secure, short-lived, single-use verification code.
4. Send the code to that email using the application's configured email service.
5. User enters the verification code.
6. After successful verification, display the new-password and confirm-password fields.
7. User submits a new password.
8. Backend securely updates the password and invalidates the reset code.
9. Redirect the user to the login page with a neutral success message.

The code should expire after a short period, such as 10 minutes. It must be single-use, rate-limited, and invalidated after successful password reset.

Do not send the new password by email. Never store verification codes in plaintext if they are persisted in the database; store a secure hash and compare it safely.

### 2. Email service

Inspect the existing email verification implementation from registration before adding another system.

Reuse a secure, shared email verification utility where appropriate, while keeping the signup verification and password reset workflows separate.

Use a free-tier email service, such as Resend, only after confirming its current free-tier eligibility and the requirements for sending from a verified domain or address. Do not assume unrestricted free delivery or hardcode secrets.

Requirements:

- Use environment variables for API keys and email sender configuration.
- Keep secrets on the backend only.
- Provide a branded email template matching the M12 Expense Tracker visual identity.
- Include the verification code, expiry information, and a brief security warning.
- Handle invalid email addresses, expired codes, incorrect codes, rate limits, delivery failures, and server errors.
- Avoid revealing whether an email address has an account through the user-facing response.
- Do not log OTPs, reset tokens, passwords, or API keys.

If an external email service requires domain verification or user configuration, implement the integration and document the setup steps. Do not claim delivery works until it has been tested with valid configuration.

### 3. Password security

- Reuse the existing secure password-hashing approach.
- Never store passwords in plaintext.
- Enforce the existing password policy or a consistent minimum policy.
- Invalidate the reset token after use and prevent reuse.
- Apply rate limits to reset requests and code verification.
- Do not change account roles or user ownership during password reset.
- If sessions or refresh tokens are already implemented, follow the existing security policy for invalidating sessions after a password reset.
- Ensure password-reset APIs cannot be used to reset another user's password without proof of email ownership.

### 4. Login and registration page UI

Redesign only the unauthenticated authentication pages:

- Login.
- Create Account / Registration.
- Forgot Password.
- OTP Verification.
- Set New Password.

Requirements:

- Do not render the authenticated application's sidebar or main header on authentication pages.
- Center the authentication form in a clean, responsive layout.
- Make the M12 Expense Tracker logo slightly larger than it currently appears.
- Add the dark/light theme toggle on the right side of the authentication layout.
- Preserve the app's black/white theme and existing accent colors.
- Keep forms compact, accessible, and responsive on mobile, tablet, and desktop.
- Include clear validation messages, loading states, disabled submit states, and success/error feedback.
- Password visibility toggles should work correctly.
- Do not expose authenticated navigation or dashboard components on authentication screens.
- Keep all existing authenticated pages and their header/sidebar unchanged.

Use the existing theme system instead of creating an unrelated authentication-only theme.

### 5. Authentication regression tests

Verify:

1. Existing users can log in.
2. New users can register and verify their email.
3. A valid reset code permits a password reset.
4. Incorrect and expired codes are rejected.
5. A used code cannot be reused.
6. Reset requests are rate-limited.
7. Password-reset responses do not disclose whether an email exists.
8. The new password works, and the old password no longer works.
9. Secrets are not exposed to the frontend.
10. Login, registration, OTP, and password-reset pages have no authenticated sidebar/header.
11. The theme toggle works on authentication pages.
12. Authenticated application pages retain their existing layout.

**Finish Phase 3 completely and report the test results before proceeding to Phase 4.**

---

## Phase 4 — Full Application Audit and Regression Verification

After all three phases are complete, perform a final integrated audit.

### 1. EMI and dashboard consistency

Verify that the EMI module, installment schedule, Upcoming Monthly Payments, transaction history, and Main Reports all agree about which installments are paid and unpaid.

Use a consistent timezone and month-period convention across the application. Do not introduce off-by-one-month errors through UTC/local date conversion.

### 2. Investment accounting consistency

Verify that investments are tracked separately from ordinary expenses and income, while correctly reducing the funding source.

Check manual and recurring investments, payment methods, transaction deletion, recurring status, and report totals.

### 3. Authentication and email security

Verify registration, email verification, forgot password, OTP expiry, password updates, rate limiting, and environment-variable handling.

Do not expose credentials, reset codes, or user-specific information in frontend bundles or logs.

### 4. Existing modules must remain intact

Regression-test the following existing features:

- Accounts and bank balances.
- Personal Cash in Hand.
- Credit-card management and repayment.
- Recurring Transactions & Bills.
- Lending and Borrowing.
- Budget module.
- Chit Fund module and its separate accounting rules.
- EMI management.
- Upcoming Monthly Payments.
- Main Reports.
- User settings and module toggles.
- User authentication, authorization, and data isolation.

Do not change chit accounting or other unrelated modules while fixing EMI or investment logic.

### 5. Database and API integrity

- Inspect existing models and migrations before changing schemas.
- Use backward-compatible schema updates where possible.
- Preserve existing users' data.
- Enforce user ownership on every relevant API.
- Validate input on the backend.
- Use atomic updates or transactions where necessary to prevent duplicate payments and inconsistent balances.
- Avoid introducing duplicate transaction records when retrying a request.
- Revalidate dashboard and report data after successful changes.
- Handle loading and error states correctly.
- Do not display fake zero/default amounts for a brief period if the real data has not loaded; use the application's established loading or skeleton pattern where appropriate.

### 6. Required final report

At completion, provide:

1. Files and components changed.
2. Backend APIs and database models changed.
3. Any database migrations or environment variables required.
4. Tests executed and their actual results.
5. Confirmation of the October/November EMI scenario.
6. Confirmation that investments are not double-counted as ordinary expenses or income.
7. Confirmation that forgot-password and OTP verification work with valid email-service configuration.
8. Any manual setup still required.
9. Any unresolved issues.

**Do not mark a feature as tested or complete unless it has actually been verified. Do not stop after making UI-only changes. Complete the backend logic, database handling, UI integration, and regression tests for each phase before moving to the next.**
</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-10-21T15:11:32+05:30.
</ADDITIONAL_METADATA>