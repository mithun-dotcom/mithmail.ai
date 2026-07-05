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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      company TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (campaign_id, email)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sequence_steps (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      step_number INTEGER NOT NULL,
      subject TEXT,
      body TEXT NOT NULL DEFAULT '',
      delay_days INTEGER NOT NULL DEFAULT 0,
      UNIQUE (campaign_id, step_number)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_accounts (
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
      PRIMARY KEY (campaign_id, account_id)
    );
  `);

  console.log('Database ready: all tables exist.');
}

export { pool };
