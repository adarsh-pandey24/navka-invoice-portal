import app from './app';
import { ENV } from './config/env';
import { connectDB, disconnectDB } from './config/db';

const startServer = async () => {
  try {
    await connectDB();

    const server = app.listen(ENV.PORT, () => {
      console.log(`===============================================`);
      console.log(` NAVKA Invoice Management API Server Running `);
      console.log(` Port: ${ENV.PORT}`);
      console.log(` Environment: ${ENV.NODE_ENV}`);
      console.log(` Health URL: http://localhost:${ENV.PORT}/api/health`);
      console.log(`===============================================`);
    });

    const shutdown = async (signal: string) => {
      console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
      server.close(async () => {
        await disconnectDB();
        console.log('[Server] Graceful shutdown complete.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error: any) {
    console.error('[Server] Critical failure during startup:', error.message);
    process.exit(1);
  }
};

startServer();
