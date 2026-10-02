import path from 'path';
import fs from 'fs';
import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Development only: runs a persistent local MongoDB on 127.0.0.1:27017 (the default
 * MONGODB_URI) using the mongod binary that mongodb-memory-server already downloads.
 * `npm run seed` and `npm run dev` then share one database, and data survives
 * backend restarts. Not needed if MongoDB is installed locally.
 *
 *   npm run db:local        (keep this terminal open; Ctrl+C to stop)
 */
const PORT = 27017;
const dbPath = path.resolve(__dirname, '../../.local-mongo');

const main = async () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:local is for local development only.');
  }
  fs.mkdirSync(dbPath, { recursive: true });

  const server = await MongoMemoryServer.create({
    instance: { port: PORT, ip: '127.0.0.1', dbPath, storageEngine: 'wiredTiger' },
  });

  console.log(`[LocalDB] MongoDB running at mongodb://127.0.0.1:${PORT}/  (data: ${dbPath})`);
  console.log('[LocalDB] Keep this terminal open. Press Ctrl+C to stop.');

  const stop = async () => {
    // doCleanup: false keeps the data directory for the next run.
    await server.stop({ doCleanup: false });
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
};

main().catch((err) => {
  console.error(`[LocalDB] ${err.message}`);
  if (/EADDRINUSE|already in use/i.test(err.message)) {
    console.error(`[LocalDB] Port ${PORT} is busy. Is another MongoDB already running?`);
  }
  process.exit(1);
});
