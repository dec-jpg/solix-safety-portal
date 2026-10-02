// Database connection, schema and first-boot presets.
// The schema is applied on every boot (all statements are idempotent), so a
// Railway deploy never runs code against a database missing tables or columns.
const { Pool, types } = require('pg');
const presets = require('./presets');

// DATE columns come back as plain 'YYYY-MM-DD' strings.
types.setTypeParser(1082, v => v);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Add a PostgreSQL service on Railway and reference its DATABASE_URL.');
  process.exit(1);
}
const needsSsl = /sslmode=require/.test(connectionString) || /proxy\.rlwy\.net/.test(connectionString);
const pool = new Pool({ connectionString, ssl: needsSsl ? { rejectUnauthorized: false } : false, max: 10 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'manager',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS operatives (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  role TEXT,
  employment TEXT,
  start_date DATE,
  emergency_name TEXT,
  emergency_phone TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  device_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS operatives_phone_idx ON operatives (phone);
CREATE INDEX IF NOT EXISTS operatives_token_idx ON operatives (device_token);

CREATE TABLE IF NOT EXISTS qual_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  validity_months INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS quals (
  id SERIAL PRIMARY KEY,
  operative_id INTEGER NOT NULL REFERENCES operatives(id) ON DELETE CASCADE,
  qual_type_id INTEGER NOT NULL REFERENCES qual_types(id) ON DELETE CASCADE,
  number TEXT,
  issued_on DATE,
  expires_on DATE,
  file_name TEXT,
  file_mime TEXT,
  file_data BYTEA,
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS quals_op_idx ON quals (operative_id, qual_type_id);

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  ref TEXT,
  name TEXT NOT NULL,
  address TEXT,
  client TEXT,
  client_contact TEXT,
  start_on DATE,
  end_on DATE,
  status TEXT NOT NULL DEFAULT 'live',
  notes TEXT,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_operatives (
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  operative_id INTEGER NOT NULL REFERENCES operatives(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, operative_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'rams',
  title TEXT NOT NULL,
  reference TEXT,
  revision TEXT,
  requires_signoff BOOLEAN NOT NULL DEFAULT TRUE,
  current BOOLEAN NOT NULL DEFAULT TRUE,
  file_name TEXT,
  file_mime TEXT,
  file_data BYTEA,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS talks (
  id SERIAL PRIMARY KEY,
  ref TEXT,
  title TEXT NOT NULL,
  intro TEXT,
  sections JSONB NOT NULL DEFAULT '[]',
  questions JSONB NOT NULL DEFAULT '[]',
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  token TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One table for every signature: toolbox talks and job documents.
-- operative_id is null when someone not on the register signs; the office links them later.
CREATE TABLE IF NOT EXISTS signoffs (
  id SERIAL PRIMARY KEY,
  talk_id INTEGER REFERENCES talks(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  operative_id INTEGER REFERENCES operatives(id) ON DELETE SET NULL,
  name_given TEXT NOT NULL,
  phone_given TEXT,
  signature TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((talk_id IS NULL) <> (document_id IS NULL))
);
CREATE INDEX IF NOT EXISTS signoffs_talk_idx ON signoffs (talk_id);
CREATE INDEX IF NOT EXISTS signoffs_doc_idx ON signoffs (document_id);
CREATE INDEX IF NOT EXISTS signoffs_op_idx ON signoffs (operative_id);
`;

const q = (text, params) => pool.query(text, params);

async function migrate() {
  await pool.query(SCHEMA);
  // First boot: load the qualification list for the client's trade (PRESET variable).
  const n = (await q('SELECT COUNT(*)::int AS n FROM qual_types')).rows[0].n;
  if (n === 0) {
    const list = presets[(process.env.PRESET || 'general').toLowerCase()] || presets.general;
    for (const [i, t] of list.entries()) {
      await q('INSERT INTO qual_types (name, required, validity_months, sort) VALUES ($1,$2,$3,$4)', [t.name, !!t.required, t.months || null, i]);
    }
    console.log(`Loaded ${list.length} qualification types (${process.env.PRESET || 'general'} preset)`);
  }
}

module.exports = { pool, q, migrate };
