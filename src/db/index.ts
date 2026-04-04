import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';
import * as dotenv from 'dotenv';

dotenv.config();

// Use WebSocket for persistent connection — eliminates Neon cold-start latency
// and supports transactions (unlike the HTTP driver)
neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
export const db = drizzle(pool, { schema });

export type DB = typeof db;
