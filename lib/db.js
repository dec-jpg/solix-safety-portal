// Database connection, schema and first-boot presets.
// The schema is applied on every boot (all statements are idempotent), so a
// Railway deploy never runs code against a database missing tables or columns.
const { Pool, types } = require('pg');
const client = require('./client');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

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
ALTER TABLE talks ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE talks ADD COLUMN IF NOT EXISTS source_id INTEGER;

CREATE INDEX IF NOT EXISTS signoffs_talk_idx ON signoffs (talk_id);
CREATE INDEX IF NOT EXISTS signoffs_doc_idx ON signoffs (document_id);
CREATE INDEX IF NOT EXISTS signoffs_op_idx ON signoffs (operative_id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content TEXT;

CREATE TABLE IF NOT EXISTS rams_masters (
  id SERIAL PRIMARY KEY,
  version INTEGER NOT NULL,
  title TEXT,
  body JSONB NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS rams (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  master_id INTEGER NOT NULL REFERENCES rams_masters(id),
  ref TEXT,
  issue_no INTEGER NOT NULL,
  issue_date DATE NOT NULL,
  fields JSONB NOT NULL,
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  briefing_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'issued',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rams_job_idx ON rams (job_id);

-- Occupational health questionnaires (HAVS, noise, skin). Confidential: read by admins and Safety Simplified only.
CREATE TABLE IF NOT EXISTS health_checks (
  id SERIAL PRIMARY KEY,
  operative_id INTEGER REFERENCES operatives(id) ON DELETE SET NULL,
  name_given TEXT NOT NULL,
  phone_given TEXT,
  dob DATE,
  kind TEXT NOT NULL DEFAULT 'annual',
  time_in_role TEXT,
  previous_exposure TEXT,
  answers JSONB NOT NULL,
  flags JSONB NOT NULL DEFAULT '[]',
  signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS health_op_idx ON health_checks (operative_id);
`;

const q = (text, params) => pool.query(text, params);

function addMonths(d, m) { const x = new Date(d); x.setMonth(x.getMonth() + m); return x.toISOString().slice(0, 10); }

async function migrate() {
  await pool.query(SCHEMA);
  await pool.query(require('./policies').SCHEMA);
  // First boot: this client's training list and starting toolbox talks.
  // This client's training list: the build is the source of truth for which types exist, which are required and how long they last.
  {
    const have = (await q('SELECT LOWER(name) AS n FROM qual_types')).rows.map(r => r.n);
    for (const [i, t] of (client.training || []).entries()) {
      if (have.includes(t.name.toLowerCase())) {
        await q('UPDATE qual_types SET required = $2, validity_months = $3 WHERE LOWER(name) = LOWER($1)', [t.name, !!t.required, t.months || null]);
        continue;
      }
      await q('INSERT INTO qual_types (name, required, validity_months, sort) VALUES ($1,$2,$3,$4)', [t.name, !!t.required, t.months || null, i]);
    }
  }
  for (const name of client.retired_training || []) await q('UPDATE qual_types SET active = FALSE WHERE LOWER(name) = LOWER($1)', [name]);
  // This client's operatives and the training they hold, from the matrix Safety Simplified holds for them.
  // New names are added on any boot. When the build carries a new matrix_version, the whole matrix is applied:
  // roles and the matrix's own records are replaced, people no longer on it are set inactive (not deleted),
  // and records with a file attached or added inside the portal are left alone.
  if (client.operatives) {
    const types = (await q('SELECT id, name, validity_months FROM qual_types')).rows;
    const typeOf = n => types.find(x => x.name.toLowerCase() === String(n).toLowerCase());
    const stamp = client.matrix_version || null;
    const applied = ((await q("SELECT value FROM settings WHERE key = 'matrix_version'")).rows[0] || {}).value || null;
    const full = !!stamp && stamp !== applied;
    const expiry = (ql, t) => ql.expires_on || (ql.issued_on && t.validity_months ? addMonths(ql.issued_on, t.validity_months) : null);
    for (const o of client.operatives) {
      let row = (await q('SELECT id FROM operatives WHERE LOWER(full_name) = LOWER($1)', [o.name])).rows[0];
      if (row && !full) continue;
      if (row) await q('UPDATE operatives SET role = $2, active = TRUE WHERE id = $1', [row.id, o.role || null]);
      else row = (await q('INSERT INTO operatives (full_name, role) VALUES ($1,$2) RETURNING id', [o.name, o.role || null])).rows[0];
      if (full) await q("DELETE FROM quals WHERE operative_id = $1 AND file_data IS NULL AND added_by = 'Safety Simplified'", [row.id]);
      for (const ql of o.quals || []) {
        const t = typeOf(ql.type); if (!t) continue;
        await q('INSERT INTO quals (operative_id, qual_type_id, number, issued_on, expires_on, added_by) VALUES ($1,$2,$3,$4,$5,$6)',
          [row.id, t.id, ql.number || null, ql.issued_on || null, expiry(ql, t), 'Safety Simplified']);
      }
    }
    if (full) {
      const names = client.operatives.map(o => o.name.toLowerCase());
      await q('UPDATE operatives SET active = FALSE WHERE active AND NOT (LOWER(full_name) = ANY($1))', [names]);
      await q("INSERT INTO settings (key, value) VALUES ('matrix_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [stamp]);
    }
  }
  // Document packs in the build (policies and the like): created once, matched on name, with the files from client/documents.
  const packsApplied = ((await q("SELECT value FROM settings WHERE key = 'packs_version'")).rows[0] || {}).value || null;
  const packsFull = !!client.packs_version && client.packs_version !== packsApplied;
  for (const pk of client.packs || []) {
    const existing = (await q('SELECT id FROM jobs WHERE LOWER(name) = LOWER($1)', [pk.name])).rows[0];
    if (existing) {
      if (packsFull) {
        // Re-apply what the build says about sign-off and team for packs that are already there.
        for (const d of pk.documents || []) await q('UPDATE documents SET requires_signoff = $3 WHERE job_id = $1 AND LOWER(title) = LOWER($2)', [existing.id, d.title, d.requires_signoff !== false]);
        if (pk.team === 'nobody') await q('DELETE FROM job_operatives WHERE job_id = $1', [existing.id]);
      }
      continue;
    }
    const job = (await q('INSERT INTO jobs (ref, name, client, address, start_on, notes, status, token) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [pk.ref || null, pk.name, pk.client || client.company, pk.address || null, pk.start_on || null, pk.notes || null, 'live', crypto.randomBytes(9).toString('base64url')])).rows[0];
    for (const d of pk.documents || []) {
      const file = path.join(__dirname, '..', 'client', 'documents', d.file);
      if (!fs.existsSync(file)) continue;
      await q(`INSERT INTO documents (job_id, kind, title, reference, revision, requires_signoff, current, file_name, file_mime, file_data, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Safety Simplified')`,
        [job.id, d.kind || 'other', d.title, d.reference || null, d.revision || null, d.requires_signoff !== false, d.current !== false, d.file, 'application/pdf', fs.readFileSync(file)]);
    }
    if (pk.team === 'everyone') await q('INSERT INTO job_operatives (job_id, operative_id) SELECT $1, id FROM operatives WHERE active ON CONFLICT DO NOTHING', [job.id]);
  }
  if (packsFull) await q("INSERT INTO settings (key, value) VALUES ('packs_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [client.packs_version]);
  // The RAMS master in the build (client/rams-master.json) is loaded once, as version 1. Later versions are made inside the portal.
  {
    const mfile = path.join(__dirname, '..', 'client', 'rams-master.json');
    // A build whose file carries a higher "version" than anything in the portal is loaded as the next version, so a
    // master corrected in the build reaches the live portal; masters saved inside the portal are never overwritten.
    if (fs.existsSync(mfile)) {
      const m = JSON.parse(fs.readFileSync(mfile, 'utf8'));
      const top = (await q('SELECT MAX(version)::int AS v, COUNT(*)::int AS n FROM rams_masters')).rows[0];
      const applied = ((await q("SELECT value FROM settings WHERE key = 'rams_master_build'")).rows[0] || {}).value;
      if (top.n === 0 || (m.version && String(m.version) !== applied && m.version > top.v)) {
        await q('INSERT INTO rams_masters (version, title, body, note, created_by) VALUES ($1, $2, $3, $4, $5)', [top.n === 0 ? 1 : top.v + 1, m.title || null, JSON.stringify(m), m.note || 'Loaded from the build', 'Safety Simplified']);
        await q("INSERT INTO settings (key, value) VALUES ('rams_master_build', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [String(m.version || 1)]);
      }
    }
  }
  // One standing link for the occupational health questionnaire (the office shares it; a new one can be made from the portal).
  if (!(await q("SELECT 1 FROM settings WHERE key = 'health_token'")).rows[0]) {
    await q("INSERT INTO settings (key, value) VALUES ('health_token', $1)", [crypto.randomBytes(12).toString('base64url')]);
  }
  // Safety Simplified's master account, from MASTER_EMAIL and MASTER_PASSWORD on Railway: created on first boot,
  // kept in step with the variables after that, always an owner. Each client's own users are added from inside the portal.
  if (process.env.MASTER_EMAIL && process.env.MASTER_PASSWORD) {
    const bcrypt = require('bcryptjs');
    const hashed = await bcrypt.hash(process.env.MASTER_PASSWORD, 10);
    await q(`INSERT INTO users (name, email, password_hash, role) VALUES ('Safety Simplified', LOWER($1), $2, 'owner')
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'owner'`, [process.env.MASTER_EMAIL, hashed]);
  }
  // Library talks in the build are added on boot if not already there (matched on title), so new ones arrive with a redeploy.
  {
    for (const t of client.talks || []) {
      if ((await q("SELECT 1 FROM talks WHERE status = 'library' AND LOWER(title) = LOWER($1)", [t.title])).rows[0]) continue;
      await q(`INSERT INTO talks (ref, title, intro, category, sections, questions, status, token, created_by) VALUES ($1,$2,$3,$4,$5,$6,'library',$7,'Safety Simplified')`,
        [t.ref || null, t.title, t.intro || null, t.category || null, JSON.stringify(t.sections || []), JSON.stringify(t.questions || []), crypto.randomBytes(9).toString('base64url')]);
    }
  }
}

module.exports = { pool, q, migrate };
