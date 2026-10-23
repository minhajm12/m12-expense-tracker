import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import mongoose from 'mongoose';

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('No MONGODB_URI found!');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) {
    console.error('No db connected');
    return;
  }
  const col = db.collection('transactions');
  const indexes = await col.indexes();
  console.log('ALL TRANSACTIONS INDEXES FULL:');
  console.log(JSON.stringify(indexes, null, 2));

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
