import pg from 'pg';

// Render provides DATABASE_URL automatically when you attach a Postgres instance.
// ssl is required for Render's managed Postgres.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

// Create the table if it doesn't exist yet. Runs once on server startup,
// so you never have to run SQL by hand.
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_accounts (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL DEFAULT 'smtp',
      smtp_host TEXT,
      smtp_port INTEGER,
      smtp_user TEXT,
      smtp_pass TEXT,
      oauth_refresh_token TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('Database ready: email_accounts table exists.');
}

export { pool };
