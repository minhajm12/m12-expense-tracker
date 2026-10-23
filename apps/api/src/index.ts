import { app } from "./app";
import { env } from "./config/env";
import { connectDatabase, disconnectDatabase } from "./config/database";
import { seedDefaultCategories } from "./models/Category";

const startServer = async () => {
  console.log(
    `🚀 [Server] Initializing M12 Expense Tracker API in ${env.NODE_ENV} mode...`,
  );

  // Attempt database connection
  await connectDatabase();

  // Ensure all default categories (including EMI) are seeded
  await seedDefaultCategories().catch((err) => {
    console.error("⚠️ [Database] Failed to verify default categories:", err);
  });

  const server = app.listen(env.PORT, () => {
    console.log(
      `🌐 [Server] M12 Expense Tracker API is running on http://localhost:${env.PORT}`,
    );
    console.log(
      `🩺 [Server] Health check available at http://localhost:${env.PORT}/api/health`,
    );
  });

  const shutdown = async (signal: string) => {
    console.log(
      `\n🛑 [Server] Received ${signal}. Starting graceful shutdown...`,
    );
    server.close(async () => {
      console.log("🚪 [Server] HTTP server closed");
      await disconnectDatabase();
      console.log("🏁 [Server] Graceful shutdown completed. Exiting.");
      process.exit(0);
    });

    // Force close after 10 seconds if hanging
    setTimeout(() => {
      console.error("⚠️  [Server] Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

startServer().catch((err) => {
  console.error("🔥 [Server] Fatal server startup failure:", err);
  process.exit(1);
});
