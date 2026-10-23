import mongoose from 'mongoose';
import { env } from './env';

export enum DatabaseStatus {
  DISCONNECTED = 'disconnected',
  CONNECTED = 'connected',
  CONNECTING = 'connecting',
  DISCONNECTING = 'disconnecting',
  ERROR = 'error',
}

// Disable Mongoose command buffering so operations fail fast when disconnected
mongoose.set('bufferCommands', false);

let lastConnectionError: string | null = null;
let currentConnectionString: string | null = null;
let listenersRegistered = false;
let activeConnectPromise: Promise<boolean> | null = null;

/**
 * Safely extracts host/cluster information without revealing usernames or passwords.
 */
export function getSanitizedDbTarget(uri: string): string {
  try {
    const atIndex = uri.indexOf('@');
    if (atIndex !== -1) {
      const hostPart = uri.substring(atIndex + 1).split('/')[0].split('?')[0];
      return uri.startsWith('mongodb+srv://')
        ? `MongoDB Atlas Cluster (${hostPart})`
        : `MongoDB Host (${hostPart})`;
    }
    const slashSlash = uri.indexOf('://');
    if (slashSlash !== -1) {
      const hostPart = uri.substring(slashSlash + 3).split('/')[0].split('?')[0];
      return `MongoDB (${hostPart})`;
    }
    return 'Custom MongoDB URI';
  } catch {
    return 'Configured MongoDB URI';
  }
}

export const getConnectionState = (): DatabaseStatus => {
  const readyState = mongoose.connection.readyState;
  switch (readyState) {
    case 0:
      return DatabaseStatus.DISCONNECTED;
    case 1:
      return DatabaseStatus.CONNECTED;
    case 2:
      return DatabaseStatus.CONNECTING;
    case 3:
      return DatabaseStatus.DISCONNECTING;
    default:
      return DatabaseStatus.ERROR;
  }
};

export const isConnected = (): boolean => {
  return mongoose.connection.readyState === 1;
};

export const getLastError = (): string | null => {
  return lastConnectionError;
};

function ensureConnectionListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  mongoose.connection.on('connected', () => {
    console.log('✅ [Database] MongoDB connection established successfully');
    lastConnectionError = null;
  });

  mongoose.connection.on('error', (err) => {
    console.error('❌ [Database] MongoDB runtime connection error:', err.message);
    lastConnectionError = err.message;
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  [Database] MongoDB connection lost/disconnected');
  });
}

export const connectDatabase = async (uri?: string): Promise<boolean> => {
  const connectionString = uri || env.MONGODB_URI;

  if (!connectionString) {
    lastConnectionError = 'Missing MONGODB_URI environment variable';
    console.error('❌ [Database] Connection error: MONGODB_URI is not defined.');
    return false;
  }

  // Reuse existing connection if already connected to the same database
  if (mongoose.connection.readyState === 1 && currentConnectionString === connectionString) {
    return true;
  }

  // If connected to a different database (e.g. between test suites), disconnect first
  if (mongoose.connection.readyState !== 0 && currentConnectionString !== connectionString) {
    await mongoose.disconnect();
    currentConnectionString = null;
  }

  // If a connection attempt is already in flight for the same connection, await it
  if (activeConnectPromise && currentConnectionString === connectionString) {
    return activeConnectPromise;
  }

  ensureConnectionListeners();

  activeConnectPromise = (async () => {
    try {
      const sanitizedTarget = getSanitizedDbTarget(connectionString);
      console.log(`🔌 [Database] Connecting to ${sanitizedTarget}...`);

      currentConnectionString = connectionString;

      await mongoose.connect(connectionString, {
        serverSelectionTimeoutMS: 5000,
        autoIndex: env.NODE_ENV !== 'production',
        dbName: 'finora',
        bufferCommands: false,
      });

      // Verify and ensure correct partial index on transactions collection
      try {
        const col = mongoose.connection.db?.collection('transactions');
        if (col) {
          const indexes = await col.indexes();
          const faulty = indexes.find(
            (i) => i.name === 'userId_1_idempotencyKey_1' && (i.sparse === true || !i.partialFilterExpression)
          );
          if (faulty) {
            console.log('🔄 [Database] Migrating obsolete sparse index on transactions...');
            await col.dropIndex('userId_1_idempotencyKey_1');
            await col.createIndex(
              { userId: 1, idempotencyKey: 1 },
              {
                name: 'userId_1_idempotencyKey_1',
                unique: true,
                partialFilterExpression: { idempotencyKey: { $type: 'string' } },
                background: true,
              }
            );
            console.log('✅ [Database] Synchronized transaction index with partialFilterExpression');
          }
        }

        // Ensure single chit fund bank account constraint per user
        const bankCol = mongoose.connection.db?.collection('bankaccounts');
        if (bankCol) {
          const bankIndexes = await bankCol.indexes();
          const hasChitFundIndex = bankIndexes.some((i) => i.name === 'userId_1_isChitFundAccount_1');
          if (!hasChitFundIndex) {
            await bankCol.createIndex(
              { userId: 1, isChitFundAccount: 1 },
              {
                name: 'userId_1_isChitFundAccount_1',
                unique: true,
                partialFilterExpression: { isChitFundAccount: true },
                background: true,
              }
            );
            console.log('✅ [Database] Synchronized BankAccount index for single chit fund account enforcement');
          }
        }
      } catch (indexErr) {
        // Non-blocking index synchronization warning
        console.warn('⚠️ [Database] Index synchronization notice:', indexErr);
      }

      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      lastConnectionError = message;
      currentConnectionString = null;
      console.error('❌ [Database] Failed to connect to MongoDB:');
      console.error(`   ${message}`);
      console.error('👉 Please verify your MONGODB_URI, Atlas network whitelist, and database credentials in .env.');
      return false;
    } finally {
      activeConnectPromise = null;
    }
  })();

  return activeConnectPromise;
};

export const disconnectDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    currentConnectionString = null;
    console.log('🔌 [Database] MongoDB connection closed');
  }
};

export const pingDatabase = async (): Promise<{ ok: boolean; latencyMs?: number; error?: string }> => {
  if (!isConnected() || !mongoose.connection.db) {
    return { ok: false, error: lastConnectionError || 'Database not connected' };
  }

  const start = Date.now();
  try {
    await mongoose.connection.db.admin().ping();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
};
