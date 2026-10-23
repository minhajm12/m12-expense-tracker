# Finora Architecture & Technical Specifications

Finora is an enterprise-grade multi-user personal finance and double-entry accounting application engineered with Next.js, Express.js, TypeScript, Tailwind CSS, and MongoDB/Mongoose.

---

## 1. Monorepo Project Structure

```
finora/
├── apps/
│   ├── api/                     # Express.js REST API with TypeScript & Mongoose
│   │   ├── src/
│   │   │   ├── config/          # Environment validation & MongoDB connection
│   │   │   ├── middleware/      # Auth, CORS, Helmet, error handling, rate limiting
│   │   │   ├── models/          # Mongoose schemas with strict multi-user indexing
│   │   │   ├── routes/          # RESTful endpoints (Auth, Accounts, Transactions, Cards, etc.)
│   │   │   ├── services/        # Business logic & atomic ledger calculations
│   │   │   ├── utils/           # Standardized API response formatters & error wrappers
│   │   │   ├── app.ts           # Express application composition
│   │   │   └── index.ts         # Server bootstrap & lifecycle manager
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── web/                     # Next.js App Router Frontend
│       ├── src/
│       │   ├── app/             # App Router pages and layouts
│       │   ├── components/      # UI components (shadcn-inspired, fintech badges, charts)
│       │   ├── hooks/           # Custom React hooks
│       │   └── lib/             # API client & utility functions
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   └── shared/                  # Universal types, Zod validation schemas, & math utils
│       ├── src/
│       │   ├── constants/       # Financial enums, categories, payment methods
│       │   ├── schemas/         # Shared Zod validation schemas
│       │   ├── types/           # TypeScript interfaces & API contracts
│       │   └── utils/           # Decimal-safe integer arithmetic & formatters
│       └── package.json
├── docs/
│   ├── ARCHITECTURE.md          # Architecture & system design document
│   └── IMPLEMENTATION_PROGRESS.md # 7-phase progress tracker
├── .gitignore
├── package.json                 # Monorepo root workspaces configuration
└── README.md                    # Quickstart & local development manual
```

---

## 2. API Architecture & Error Conventions

### Standardized API Envelope
All responses return a consistent envelope defined in `@finora/shared`:

```typescript
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}
```

### HTTP Status Codes & Error Mapping
- `200 OK` / `201 Created`: Successful query or resource creation.
- `400 Bad Request`: Validation failure (Zod error details included) or malformed payload.
- `401 Unauthorized`: Missing, expired, or invalid authentication session/token.
- `403 Forbidden`: Resource ownership mismatch (attempting to access another user's record).
- `404 Not Found`: Resource does not exist or does not belong to the user.
- `409 Conflict`: Duplicate key conflict or idempotency key collision.
- `500 Internal Server Error`: Unhandled operational defect (stack trace hidden in production).
- `503 Service Unavailable`: Database ping or downstream service failure.

---

## 3. Authentication & Authorization Strategy

1. **Authentication Mode**:
   - Secure HTTP-only cookies storing cryptographically signed JWT sessions or tokens.
   - Protection against XSS (no localStorage tokens) and CSRF protection headers (`SameSite: Lax`/`Strict`).
2. **Password Cryptography**:
   - Industry-standard bcrypt password hashing (minimum 12 salt rounds).
   - Strict complexity validation: min 8 chars, 1 uppercase, 1 lowercase, 1 digit.
3. **Multi-User Data Isolation**:
   - Every single persistent record (`BankAccount`, `Transaction`, `CreditCard`, `Budget`, etc.) contains a required `userId` indexed foreign key.
   - All Mongoose queries MUST include `{ _id: resourceId, userId: req.user.id }`.
   - Never trust user IDs provided in request parameters or body. User identity is derived strictly from verified JWT tokens.
4. **Role-Based Access Control**:
   - Roles: `user` (default) and `admin`.
   - Admin routes guarded by an explicit `requireRole(UserRole.ADMIN)` middleware.

---

## 4. Database Relationships & Entity Schemas

```
+--------------------------------------------------------------+
|                            USER                              |
| _id, email, passwordHash, fullName, role, currency, isActive |
+--------------------------------------------------------------+
         |                             |
         | (1:N)                       | (1:N)
         v                             v
+-----------------------+     +-------------------------------+
|     BANK_ACCOUNT      |     |          CREDIT_CARD          |
| _id, userId, name,    |     | _id, userId, cardNickname,    |
| bankName, accountType,|     | creditLimit, closingDay,      |
| openingBal, currentBal|     | dueDay, openingOut, currentOut|
+-----------------------+     +-------------------------------+
         |                             |
         | (1:N)                       | (1:N)
         v                             v
+--------------------------------------------------------------+
|                         TRANSACTION                          |
| _id, userId, type (income|expense|transfer|cc_payment),      |
| amount, date, category, paymentMethod, paymentChannel,       |
| accountId, creditCardId, destinationAccountId, status        |
+--------------------------------------------------------------+
```

---

## 5. Financial Accounting Rules & Correctness

1. **Decimal Safety**:
   - IEEE-754 floating-point errors (e.g., `0.1 + 0.2 = 0.30000000000000004`) are eliminated by performing internal calculations in integer cents/paise (`toCents`, `fromCents`, `safeAdd`, `safeSubtract`).
2. **Account Balances**:
   - `Current Balance = Opening Balance + SUM(Income) - SUM(Expenses from account) - Transfers Out + Transfers In - Credit Card Repayments Out`.
3. **Credit Card Accounting**:
   - **Purchases**: Count as an **expense once**. Increases card outstanding; reduces available credit. Does NOT alter bank account balances at purchase time.
   - **Repayments**: Are **liability settlements**. Reduces card outstanding; increases available credit; decreases bank account balance. Does NOT count as a second expense.
   - **Refunds**: Reduces card outstanding; increases available credit; reduces net expense. Does NOT count as income.
4. **Account Transfers**:
   - Atomically decreases source account and increases destination account.
   - Completely excluded from income and expense aggregates.
5. **Idempotency Protection**:
   - Financial mutations (payments, repayments, transfers) require an `Idempotency-Key` header to prevent double postings from duplicate network submissions.

---

## 6. Deployment Topology

- **Frontend**: Next.js App Router deployed on Vercel with optimized edge rendering and API rewrites.
- **Backend**: Express REST API runnable as a standalone Node.js service (Render, Fly.io, Railway, AWS ECS) or serverless Express adapter compatible with Vercel serverless functions.
- **Database**: MongoDB Atlas replica set with TLS encryption in transit, automated backups, and IP allowlist.

---

## 7. Environment Variables Reference

| Variable | Workspace | Default | Description |
|---|---|---|---|
| `PORT` | API | `5000` | Express server port |
| `NODE_ENV` | API | `development` | Runtime environment (`development`, `production`, `test`) |
| `MONGODB_URI` | API | `mongodb://127.0.0.1:27017/finora_db` | MongoDB connection URI (Atlas or local) |
| `JWT_SECRET` | API | - | Minimum 32-character cryptographic signing secret |
| `JWT_EXPIRES_IN`| API | `7d` | Token lifetime |
| `CORS_ORIGIN` | API | `http://localhost:3000` | Allowed frontend origin |
| `NEXT_PUBLIC_API_URL`| Web | `http://localhost:5000` | Public API endpoint for frontend client |
| `INTERNAL_API_URL` | Web | `http://localhost:5000` | Internal API endpoint for Next.js rewrites/SSR |
