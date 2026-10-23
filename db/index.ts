import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.ts';

// v0 injects these values into the local project env file; deployed runtimes
// provide DATABASE_URL directly through their environment.
dotenv.config({ path: '.env.development.local' });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL belum dikonfigurasi untuk koneksi database Neon.');
}

export const db = drizzle({ client: neon(connectionString), schema });
