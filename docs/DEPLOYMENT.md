# M12 Expense Tracker — Production Deployment & Operations Guide

This guide details the step-by-step production deployment procedure for **M12 Expense Tracker**, covering MongoDB Atlas provisioning, Express REST API hosting, Next.js frontend hosting on Vercel, and the end-to-end security verification checklist.

---

## Architecture Overview

```
                      ┌───────────────────────────────────────────────┐
                      │             Next.js 14 Frontend               │
                      │          (Hosted on Vercel Edge CDN)          │
                      └──────────────────────┬────────────────────────┘
                                             │ HTTPS + HTTP-only Cookies
                                             ▼
                      ┌───────────────────────────────────────────────┐
                      │              Express REST API                 │
                      │  (Conventional Node / Docker or Serverless)  │
                      └──────────────────────┬────────────────────────┘
                                             │ Mongoose (TLS/SSL)
                                             ▼
                      ┌───────────────────────────────────────────────┐
                      │          MongoDB Atlas Cluster                │
                      │          (Persistent Replica Set)             │
                      └───────────────────────────────────────────────┘
```

---

## 1. MongoDB Atlas Setup Guide

M12 Expense Tracker requires persistent, high-availability document storage with atomic multi-document transaction support.

### Step 1: Create a Cluster
1. Sign in to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2. Create a new project (e.g. named **M12 Expense Tracker** or keep existing).
3. Deploy a new Database Cluster:
   - **Tier**: `M0 Free` for hobby/staging, or `M10+` for production with automated point-in-time restores.
   - **Cloud Provider & Region**: Choose a region closest to your application hosting (e.g. AWS `ap-south-1` Mumbai or `us-east-1` N. Virginia).

### Step 2: Configure Database Access User
1. Navigate to **Security** > **Database Access**.
2. Click **Add New Database User**.
3. Select **Password Authentication**.
4. Set **Username**: e.g. `m12_prod_user`.
5. Generate a cryptographically secure password (save it safely).
6. Under **Database User Privileges**, select **Built-in Role**: `Read and write to any database` (or restrict to your application database name, e.g. `finora` for existing production migrations, or `m12_expense_tracker_db`).
7. Click **Add User**.

### Step 3: Configure Network Access (IP Whitelist)
1. Navigate to **Security** > **Network Access**.
2. Click **Add IP Address**.
3. For dynamic cloud platforms (Vercel, Render, Railway, Heroku):
   - Select **Allow Access From Anywhere** (`0.0.0.0/0`).
   - For dedicated enterprise VPCs, configure VPC Peering or static outbound NAT IPs.
4. Confirm changes.

### Step 4: Acquire Connection String
1. In the **Database Deployments** overview, click **Connect**.
2. Select **Drivers** (Node.js version 5.5 or later).
3. Copy the SRV connection URI:
   ```
   mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/finora?retryWrites=true&w=majority
   ```
4. Replace `<username>` and `<password>` with your database user credentials.
   > **Note on Database Name**: For existing production deployments where user data and transaction history are stored under database `finora`, keep `/finora` or set `MONGODB_DB_NAME=finora` so no existing records are lost. For fresh setups, you can specify `/m12_expense_tracker_db`.

---

## 2. Backend Express API Deployment

You have two supported deployment options:

### Option A: Conventional Container / Node.js (Recommended)
Suitable for platforms like **Render**, **Railway**, **Fly.io**, or **AWS ECS/EC2**.

#### Deploying on Render:
1. Create a new **Web Service** connected to your repository.
2. Select **Docker** environment (Render detects the root `Dockerfile`).
3. Set the following environment variables:
   - `NODE_ENV`: `production`
   - `PORT`: `5000`
   - `MONGODB_URI`: your MongoDB Atlas connection string
   - `JWT_SECRET`: a 64-character random string (`openssl rand -base64 32`)
   - `JWT_EXPIRES_IN`: `7d`
   - `CORS_ORIGIN`: `https://m12-expense-tracker.vercel.app` (your frontend domain)
4. Health check path: `/api/health`.

#### Deploying on Railway:
1. Create a **New Project** > **Deploy from GitHub repo**.
2. Select the repository.
3. In settings, set Build Command to root `Dockerfile` or npm workspace script:
   - `npm run build --workspace=@finora/shared && npm run build --workspace=@finora/api`
   - Start Command: `node apps/api/dist/index.js`
4. Add environment variables matching `apps/api/.env.production.example`.

### Option B: Serverless on Vercel
M12 Expense Tracker API includes `apps/api/vercel.json` and `apps/api/api/index.ts` for native Vercel serverless functions.
1. In Vercel, import your repository as a new project.
2. Set **Root Directory** to `apps/api`.
3. Configure the environment variables (`MONGODB_URI`, `JWT_SECRET`, `CORS_ORIGIN`).
4. Deploy.

---

## 3. Frontend Next.js Deployment on Vercel

1. In [Vercel](https://vercel.com), click **Add New Project**.
2. Select your Git repository.
3. Configure the project settings:
   - **Framework Preset**: Next.js
   - **Root Directory**: `apps/web`
   - **Build Command**: `npm run build --workspace=@finora/shared && next build`
   - **Output Directory**: `.next`
4. Add Environment Variable:
   - `NEXT_PUBLIC_API_URL`: URL of your deployed Express API (e.g. `https://m12-api.onrender.com` without trailing slash).
5. Click **Deploy**.

---

## 4. Production Security & Audit Verification Checklist

M12 Expense Tracker incorporates enterprise-level financial and application safeguards:

| Security Domain | Implementation | Verification Method |
|---|---|---|
| **Multi-User Isolation** | Ownership query filter (`{ _id, userId }`) enforced on every read, write, and delete query. Never trusts user IDs from body/params. | Tested against IDOR attempts in `auth-security.test.ts`. |
| **Authentication** | Passwords hashed with bcrypt (12 salt rounds). Strict password complexity (8+ chars, upper, lower, number). | Enforced via Zod schema and pre-save hook. |
| **Session Control** | HTTP-only, SameSite=Lax, Secure cookies. Instant session invalidation on password change or logout via `tokenVersion`. | Tested in `auth-security.test.ts`. |
| **Rate Limiting** | `express-rate-limit` throttles brute force attempts to 30 per 15 mins on `/api/v1/auth/*` and 300 per 15 mins globally. | Implemented in `src/middleware/rate-limiter.ts`. |
| **Spreadsheet Injection** | CSV export sanitization (`sanitizeCsvField`) prepends single quote `'` to cells starting with `=`, `+`, `-`, `@`, `\t`, `\r`. | Tested against DDE payloads in `budgets-reports.test.ts`. |
| **Decimal Arithmetic** | All financial math converts standard currency units to integer cents/paise (`toCents`, `fromCents`) preventing IEEE-754 binary floating-point drift. | Unit tested across financial engine. |
| **Double-Entry Liability** | Credit card repayments settle liabilities without double-counting as expenses. Transfers transfer balances without affecting income or expense totals. | Tested in `credit-card.test.ts` and `financial-core.test.ts`. |
| **Idempotency** | Financial transfers and credit card repayments accept `Idempotency-Key` headers backed by unique sparse MongoDB indexes. | Duplicate submission prevention verified. |
| **HTTP Headers** | Helmet middleware applies Content-Security-Policy, HSTS, X-Content-Type-Options, and frameguard headers. | Enabled in `createApp()`. |

---

## 5. First-Time System Bootstrap

After deploying to production:
1. Navigate to `/admin` or issue a `POST` request to `/api/v1/admin/bootstrap`:
   ```bash
   curl -X POST https://your-api-domain/api/v1/admin/bootstrap \
     -H "Content-Type: application/json" \
     -d '{
       "email": "owner@yourdomain.com",
       "password": "SecurePassword123!",
       "fullName": "System Owner",
       "currency": "INR"
     }'
   ```
2. The endpoint creates the first administrator user and permanently closes further bootstrapping.
3. Sign in to access the Admin Control Panel.
