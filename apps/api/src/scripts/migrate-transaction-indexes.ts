import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import mongoose from 'mongoose';

async function migrateIndexes() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('No MONGODB_URI found in environment!');
    process.exit(1);
  }

  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection not established');
  }

  const col = db.collection('transactions');
  const existingIndexes = await col.indexes();
  console.log('Current indexes on transactions:');
  for (const idx of existingIndexes) {
    console.log(`- ${idx.name}: unique=${idx.unique}, sparse=${idx.sparse}, partialFilterExpression=${JSON.stringify(idx.partialFilterExpression)}`);
  }

  const faultyIndex = existingIndexes.find((idx) => idx.name === 'userId_1_idempotencyKey_1');
  if (faultyIndex) {
    console.log('\nDropping obsolete/sparse userId_1_idempotencyKey_1 index...');
    await col.dropIndex('userId_1_idempotencyKey_1');
    console.log('Successfully dropped userId_1_idempotencyKey_1!');
  }

  console.log('\nCreating correct partial index: { userId: 1, idempotencyKey: 1 } with partialFilterExpression { idempotencyKey: { $type: "string" } }...');
  await col.createIndex(
    { userId: 1, idempotencyKey: 1 },
    {
      name: 'userId_1_idempotencyKey_1',
      unique: true,
      partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      background: true,
    }
  );
  console.log('Successfully created correct partial index!');

  const updatedIndexes = await col.indexes();
  console.log('\nUpdated indexes on transactions:');
  for (const idx of updatedIndexes) {
    console.log(`- ${idx.name}: unique=${idx.unique}, partialFilter=${JSON.stringify(idx.partialFilterExpression)}`);
  }

  await mongoose.disconnect();
  console.log('\nMigration complete & database disconnected cleanly.');
}

migrateIndexes().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
