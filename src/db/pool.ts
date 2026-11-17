import dotenv from 'dotenv';
import fs from 'fs';
import { Pool } from 'pg';

if (fs.existsSync('.env.local')) {
  dotenv.config({ path: '.env.local', override: true });
}
dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('[DB] DATABASE_URL não definida no ambiente (.env.local / .env).');
}

export const pool = new Pool({
  connectionString,
  ssl: connectionString?.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export async function verifyDatabaseConnection() {
  const client = await pool.connect();
  try {
    const versionRes = await client.query<{ version: string }>('SELECT version()');
    const tablesRes = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`
    );

    return {
      connected: true,
      version: versionRes.rows[0]?.version ?? 'PostgreSQL',
      tables: tablesRes.rows.map((r) => r.table_name),
    };
  } finally {
    client.release();
  }
}
