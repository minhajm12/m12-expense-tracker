import { app } from '../src/app';
import { connectDatabase } from '../src/config/database';

// Ensure MongoDB is connected for serverless invocations
connectDatabase().catch((err) => {
  console.error('Failed to initialize MongoDB connection in serverless function:', err);
});

export default app;
