import mongoose from 'mongoose';
import { loadEnvConfig } from '../config/envConfig.js';

export async function initDatabase(): Promise<void> {
  const env = loadEnvConfig();
  await mongoose.connect(env.MONGO_URI, { dbName: env.DB_NAME });
  console.log('MongoDB connected');
}
