import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { Category, seedDefaultCategories } from '../models/Category';

async function main() {
  console.log('🌱 [Seeder] Starting category synchronization & seeding...');

  const connected = await connectDatabase();
  if (!connected) {
    console.error('❌ [Seeder] Could not connect to database. Aborting.');
    process.exit(1);
  }

  const result = await seedDefaultCategories();
  if (result.seeded > 0) {
    console.log(`✨ [Seeder] Successfully seeded ${result.seeded} category(ies): ${result.missingNames.join(', ')}`);
  } else {
    console.log('ℹ️  [Seeder] All default categories are already present in the database.');
  }

  const allCategories = await Category.find({ userId: null }).sort({ type: 1, name: 1 });
  console.log(`📋 [Seeder] Current system categories count: ${allCategories.length}`);
  console.log(
    allCategories.map((c) => `[${c.type.toUpperCase()}] ${c.name} (${c.icon}) - ${c.color}`).join('\n')
  );

  await disconnectDatabase();
  console.log('🏁 [Seeder] Done.');
}

main().catch((err) => {
  console.error('🔥 [Seeder] Unexpected error:', err);
  process.exit(1);
});
