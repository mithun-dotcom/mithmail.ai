import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

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

  // Schedule + options columns (safe to run repeatedly; migrates existing table)
  await pool.query(`
    ALTER TABLE campaigns
      ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC',
      ADD COLUMN IF NOT EXISTS send_window_start INTEGER NOT NULL DEFAULT 9,
      ADD COLUMN IF NOT EXISTS send_window_end INTEGER NOT NULL DEFAULT 17,
      ADD COLUMN IF NOT EXISTS send_days INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}',
      ADD COLUMN IF NOT EXISTS daily_limit INTEGER NOT NULL DEFAULT 30,
      ADD COLUMN IF NOT EXISTS stop_on_reply BOOLEAN NOT NULL DEFAULT true;
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
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS assigned_account_id INTEGER REFERENCES email_accounts(id) ON DELETE SET NULL;
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

  // The send queue
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_emails (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      step_id INTEGER NOT NULL REFERENCES sequence_steps(id) ON DELETE CASCADE,
      account_id INTEGER REFERENCES email_accounts(id) ON DELETE SET NULL,
      scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at TIMESTAMPTZ,
      error TEXT,
      UNIQUE (lead_id, step_id)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sched_pending
      ON scheduled_emails (scheduled_for) WHERE status = 'pending';
  `);

  // Record of every email sent (Unibox reads/writes here later too)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      account_id INTEGER REFERENCES email_accounts(id) ON DELETE SET NULL,
      campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
      lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
      direction TEXT NOT NULL DEFAULT 'outbound',
      message_id TEXT,
      in_reply_to TEXT,
      references_header TEXT,
      subject TEXT,
      body TEXT,
      from_email TEXT,
      to_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_msgid ON messages (message_id);
  `);

  // Per-inbox pacing: when this inbox may send next (randomized gaps live here)
  await pool.query(`
    ALTER TABLE email_accounts
      ADD COLUMN IF NOT EXISTS next_send_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);

  console.log('Database ready: all tables exist.');
}

export { pool };
