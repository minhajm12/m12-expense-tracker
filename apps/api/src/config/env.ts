import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';

/**
 * Robustly locate the monorepo root directory by searching upwards
 * for package.json defining workspaces.
 */
function getMonorepoRoot(): string {
  // Check from process.cwd() upwards
  let cur = path.resolve(process.cwd());
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(cur, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.workspaces) return cur;
      } catch {
        // Continue searching upwards
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  // Fallback: check from __dirname upwards
  cur = path.resolve(__dirname);
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(cur, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.workspaces) return cur;
      } catch {
        // Continue searching upwards
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  return process.cwd();
}

const monorepoRoot = getMonorepoRoot();
const rootEnvPath = path.join(monorepoRoot, '.env');
const apiEnvPath = path.join(monorepoRoot, 'apps', 'api', '.env');

const isTestEnv = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

// 1. First, load the authoritative root .env configuration
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: !isTestEnv });
}

// 2. Also support workspace-level apps/api/.env if it exists and has overrides
if (fs.existsSync(apiEnvPath) && apiEnvPath !== rootEnvPath) {
  dotenv.config({ path: apiEnvPath, override: false });
}

// 3. Fallback: load current working directory .env if different
dotenv.config();

if (isTestEnv) {
  process.env.NODE_ENV = 'test';
}

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z
    .string()
    .min(1, 'MONGODB_URI is required for persistent database operations'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters for cryptographic security')
    .default('m12_expense_tracker_secure_jwt_secret_key_at_least_32_chars!'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  MAIL_USER: z.string().optional(),
  MAIL_PASS: z.string().optional(),
  OTP_FROM_EMAIL: z.string().optional(),
  APP_BASE_URL: z.string().default('http://localhost:3000'),
});

export type EnvConfig = z.infer<typeof envSchema>;

let parsedEnv: EnvConfig;

try {
  parsedEnv = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    if (process.env.NODE_ENV === 'test') {
      // In automated test suite, provide a dummy fallback since MongoMemoryServer supplies the real URI
      parsedEnv = envSchema.parse({
        ...process.env,
        MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/m12_expense_tracker_test',
      });
    } else {
      console.error('❌ [Config] Fatal environment configuration errors:');
      error.errors.forEach((err) => {
        console.error(`   - ${err.path.join('.')}: ${err.message}`);
      });
      console.error('👉 Please ensure MONGODB_URI is set in your .env file with your MongoDB Atlas connection string.');
      process.exit(1);
    }
  } else {
    throw error;
  }
}

export const env = parsedEnv;
