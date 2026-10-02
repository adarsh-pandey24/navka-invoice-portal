import mongoose from 'mongoose';
import { ENV } from './env';

let mongodInstance: any = null;

export const connectDB = async (): Promise<void> => {
  try {
    mongoose.set('strictQuery', false);
    
    // Attempt standard connection to specified URI
    console.log(`[Database] Attempting connection to MongoDB at: ${ENV.MONGODB_URI}`);
    await mongoose.connect(ENV.MONGODB_URI, {
      serverSelectionTimeoutMS: 2500,
    });
    console.log('[Database] Successfully connected to MongoDB.');
  } catch (error: any) {
    console.warn(`[Database] Could not connect to primary MongoDB at ${ENV.MONGODB_URI}: ${error.message}`);
    
    // In development, fall back to in-memory MongoDB so the developer can immediately test everything
    // Never in production: an in-memory database would silently lose all data on restart.
    if (ENV.NODE_ENV !== 'production' && (ENV.NODE_ENV === 'development' || !process.env.MONGODB_URI)) {
      console.log('[Database] Starting in-memory MongoDB instance for development/testing...');
      try {
        const { MongoMemoryServer } = await import('mongodb-memory-server');
        mongodInstance = await MongoMemoryServer.create();
        const memUri = mongodInstance.getUri();
        await mongoose.connect(memUri);
        console.log(`[Database] In-memory MongoDB running at: ${memUri}`);
      } catch (memError: any) {
        console.error('[Database] Failed to launch in-memory MongoDB fallback:', memError.message);
        throw error;
      }
    } else {
      throw error;
    }
  }
};

export const disconnectDB = async (): Promise<void> => {
  try {
    await mongoose.disconnect();
    if (mongodInstance) {
      await mongodInstance.stop();
    }
    console.log('[Database] Disconnected from MongoDB.');
  } catch (err: any) {
    console.error('[Database] Error disconnecting MongoDB:', err.message);
  }
};
