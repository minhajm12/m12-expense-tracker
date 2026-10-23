# M12 Expense Tracker — Personal Finance & Enterprise Accounting Platform

M12 Expense Tracker is an enterprise-grade personal finance management and double-entry accounting application built with Next.js 14, React 18, Node.js, Express.js, MongoDB/Mongoose, TypeScript, and Tailwind CSS.

Designed with strict multi-user tenant isolation, decimal-safe integer arithmetic, pure manual financial data entry (no bank passwords or screen-scraping required), and full liability accounting for credit cards.

---

## 🛠️ Tech Stack & Workspace Architecture

- **Frontend (`apps/web`)**: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Lucide React, Recharts, Sonner, Framer Motion.
- **Backend (`apps/api`)**: Express.js REST API, TypeScript, Mongoose, Helmet, CORS, Cookie Parser, Zod, Express Rate Limit.
- **Database**: MongoDB Atlas compatible with strict multi-user tenant isolation (`{ _id, userId }` on every database query).
- **Shared Package (`packages/shared`)**: Shared TypeScript interfaces, financial enums, Zod validation schemas, and integer cents/paise arithmetic utilities.
- **Testing**: Vitest, Supertest, MongoMemoryServer with 60 comprehensive unit and integration tests.

---

## 🌟 Core Modules & Capabilities

1. **Multi-User Isolation & Role-Based Security**:
   - HTTP-only cookie authentication with bcrypt password hashing (12 salt rounds).
   - Token versioning (`tokenVersion`) for instantaneous session revocation upon logout or password change.
   - Secure first-admin bootstrap without hardcoded credentials (`/api/v1/admin/bootstrap`).
   - Rate limiting on public auth endpoints (30 requests / 15 mins) and global API (300 requests / 15 mins).

2. **Liquid Bank Accounts & Atomic Transfers**:
   - Multiple bank accounts per user (Savings, Current, Salary, Cash, Wallet).
   - Real-time balance calculations with decimal-safe integer arithmetic.
   - Atomic account-to-account transfers with idempotency key protection (transfers strictly excluded from income and expenses).

3. **Double-Entry Credit Card Accounting**:
   - Purchases count as an expense exactly once; card outstanding increases and available credit decreases while bank balances remain untouched.
   - Bill repayments are liability settlements: funds decrease from source bank account and reduce card liability, strictly avoiding duplicate expense accounting.
   - Merchant refunds consistently reduce card outstanding and net expense.
   - Billing cycle closing and payment due date tracking.

4. **Dynamic Analytics & KPI Dashboard**:
   - Live KPI summary (Monthly Income, Expenses, Net Cash Flow, Liquid Bank Balances, Credit Card Liability, Available Credit, Savings Rate).
   - Recharts monthly comparisons, category spending doughnut, and payment channel breakdown.
   - Date range filters: `this-month`, `last-month`, `last-30-days`, `last-90-days`, `this-year`, `custom`.

5. **Category Budgets & Automated Threshold Alerts**:
   - Monthly and custom-period category budgets with server-authoritative progress tracking.
   - Visual progress indicators with dynamic threshold color coding (Green < 70%, Amber 70-99%, Rose >= 100%).
   - Proactive alert badges when user spending reaches configurable thresholds (e.g. 80%).

6. **Recurring Schedules with Explicit Confirmation**:
   - Schedules for weekly, monthly, quarterly, and yearly bills or income.
   - Explicit user manual confirmation workflow preventing ghost duplicate transactions.
   - One-click "Log Now" execution instantly posting transactions and advancing the schedule cycle.

7. **Financial Reports & Spreadsheet-Safe CSV Export**:
   - Cash flow summaries, category breakdowns, and channel statistics.
   - Safe CSV export with Formula Injection (DDE) sanitization: prepends `'` to cells starting with `=`, `+`, `-`, `@`, `\t`, `\r`.

8. **Admin Control & Audit Trails**:
   - Persistent AuditLog model recording critical system events (bootstrap, status updates, role assignments).
   - User account activation and deactivation controls.

---

## 🚀 Quickstart & Local Development

### 1. Prerequisites
- Node.js >= 20.0.0 (Node 22 recommended)
- npm >= 10.0.0

### 2. Installation
Install all dependencies across the monorepo workspaces:
```bash
npm install
```

### 3. Environment Variables Configuration
Copy the `.env.example` templates to `.env`:
```bash
cp .env.example .env
```

Verify your `.env` contains:
```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/finora_db
JWT_SECRET=finora_super_secure_jwt_secret_key_at_least_32_chars_long!
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:5000
```

### 4. Build Shared Package
```bash
npm run build:shared
```

### 5. Running the Application Concurrently
```bash
npm run dev
```
- Frontend Web App: `http://localhost:3000`
- Backend REST API: `http://localhost:5000`
- API Health Check: `http://localhost:5000/api/health`

### 6. Automated Testing & Verification
```bash
# Execute all 60 automated tests across 7 test suites
npm run test

# Type-check all workspaces (shared, api, web)
npm run typecheck

# Full production build
npm run build
```

---

## 📖 System Documentation & Deployment Guides
- Detailed architectural patterns, financial calculations, and security models: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Step-by-step MongoDB Atlas setup and Vercel/Docker production deployment guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- 7-Phase implementation roadmap and verification logs: [docs/IMPLEMENTATION_PROGRESS.md](docs/IMPLEMENTATION_PROGRESS.md)

