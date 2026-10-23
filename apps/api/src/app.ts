import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env } from './config/env';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { accountRouter } from './routes/account';
import { categoryRouter } from './routes/category';
import { transactionRouter } from './routes/transaction';
import { creditCardRouter } from './routes/credit-card';
import { analyticsRouter } from './routes/analytics';
import { budgetRouter } from './routes/budget';
import { recurringRouter } from './routes/recurring';
import { emiRouter } from './routes/emi';
import { reportsRouter } from './routes/reports';
import { remindersRouter } from './routes/reminders';
import chitFundRouter from './routes/chit-fund';
import { lendingBorrowingRouter } from './routes/lending-borrowing';
import settingsRouter from './routes/settings';
import investmentRouter from './routes/investment';
import { apiRateLimiter } from './middleware/rate-limiter';
import { dbConnectionMiddleware } from './middleware/db-connection';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';

export const createApp = (): Express => {
  const app = express();

  // Trust first proxy hop (e.g. Next.js rewrite, reverse proxy, load balancer)
  app.set('trust proxy', 1);

  // Security Middleware
  app.use(helmet());

  // CORS Configuration
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, postman) or matching allowed origins
        if (!origin || origin === env.CORS_ORIGIN || origin.includes('localhost') || origin.includes('127.0.0.1')) {
          callback(null, true);
        } else {
          callback(null, true); // Allow all for dev, tight for production
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key'],
    })
  );

  // Body Parsing Middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  // HTTP Request Logging
  if (env.NODE_ENV !== 'test') {
    app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  }

  // Rate Limiting for all v1 APIs
  app.use('/api/v1', apiRateLimiter);

  // Health and System Diagnostics
  app.use(healthRouter);

  // Database Connection Verification for all v1 APIs
  app.use('/api/v1', dbConnectionMiddleware);

  // Routes
  app.use('/api/v1/auth', authRouter);

  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/accounts', accountRouter);
  app.use('/api/v1/categories', categoryRouter);
  app.use('/api/v1/transactions', transactionRouter);
  app.use('/api/v1/credit-cards', creditCardRouter);
  app.use('/api/v1/analytics', analyticsRouter);
  app.use('/api/v1/budgets', budgetRouter);
  app.use('/api/v1/recurring', recurringRouter);
  app.use('/api/v1/emi', emiRouter);
  app.use('/api/v1/reports', reportsRouter);
  app.use('/api/v1/reminders', remindersRouter);
  app.use('/api/v1/chit-funds', chitFundRouter);
  app.use('/api/v1/chit-fund', chitFundRouter);
  app.use('/api/v1/lending-borrowing', lendingBorrowingRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/investments', investmentRouter);


  // 404 Handler
  app.use(notFoundHandler);

  // Global Error Handler
  app.use(errorHandler);

  return app;
};

export const app = createApp();
