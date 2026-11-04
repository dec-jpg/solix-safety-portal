// Company policies come from Safety Simplified's library in Tresor (one master for every client).
// The portal pulls the current published version, keeps a copy, fills in this client's name and trade line,
// and records the director's signature against each version.
const { q } = require('./db');
const client = require('./client');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS policy_versions (
  version INTEGER PRIMARY KEY,
  body JSONB NOT NULL,
  note TEXT,
  resign BOOLEAN NOT NULL DEFAULT TRUE,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS policy_signings (
  id SERIAL PRIMARY KEY,
  version INTEGER NOT NULL REFERENCES policy_versions(version),
  signed_name TEXT NOT NULL,
  signed_role TEXT,
  signature TEXT NOT NULL,
  signed_by_user TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;

async function sync() {
  const url = process.env.TRESOR_URL, key = process.env.TRESOR_KEY;
  if (!url || !key) return { ok: false, reason: 'TRESOR_URL or TRESOR_KEY not set' };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/api/library/policies', { headers: { 'x-tresor-key': key }, signal: ctl.signal });
    if (!r.ok) return { ok: false, reason: `Tresor answered ${r.status}` };
    const v = await r.json();
    const have = (await q('SELECT 1 FROM policy_versions WHERE version = $1', [v.version])).rows[0];
    if (!have) await q('INSERT INTO policy_versions (version, body, note, resign, published_at) VALUES ($1,$2,$3,$4,$5)', [v.version, JSON.stringify(v.body), v.note || null, v.resign !== false, v.published_at || null]);
    return { ok: true, version: v.version, added: !have };
  } catch (e) { return { ok: false, reason: e.name === 'AbortError' ? 'Tresor did not answer in time' : e.message }; }
  finally { clearTimeout(t); }
}

async function about() {
  const row = (await q("SELECT value FROM settings WHERE key = 'about'")).rows[0];
  return (row && row.value) || client.about || 'a contractor';
}

const fill = (text, vars) => String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
function merge(body, vars) {
  return (body.policies || []).map(p => ({ key: p.key, title: fill(p.title, vars), blocks: (p.blocks || []).map(b => (b.t === 'ul' ? { t: 'ul', items: b.items.map(i => fill(i, vars)) } : { t: b.t, text: fill(b.text, vars) })) }));
}

// The current state for this client: latest version held, the merged text, and whether the director needs to sign.
async function current() {
  const v = (await q('SELECT * FROM policy_versions ORDER BY version DESC LIMIT 1')).rows[0];
  if (!v) return null;
  const vars = { company: client.company, about: await about() };
  const last = (await q('SELECT id, version, signed_name, signed_role, signed_at FROM policy_signings ORDER BY signed_at DESC LIMIT 1')).rows[0] || null;
  const signedThis = (await q('SELECT id, signed_name, signed_role, signed_at FROM policy_signings WHERE version = $1 ORDER BY signed_at DESC LIMIT 1', [v.version])).rows[0] || null;
  // A version published without "re-sign" counts as signed if any earlier version was.
  let needs = !signedThis;
  if (needs && !v.resign && last) needs = false;
  const yearOld = signedThis && (Date.now() - new Date(signedThis.signed_at)) > 365 * 864e5;
  return { version: v.version, note: v.note, published_at: v.published_at, fetched_at: v.fetched_at, vars, policies: merge(v.body, vars), signed: signedThis, last, needs_signature: needs || !!yearOld, due_annual: !!yearOld };
}

function schedule() {
  const run = () => sync().then(r => { if (!r.ok) console.log('Policies: not synced,', r.reason); else if (r.added) console.log('Policies: version', r.version, 'received from Tresor'); }).catch(() => {});
  run(); setInterval(run, 6 * 3600 * 1000).unref();
}

module.exports = { SCHEMA, sync, current, about, merge, schedule };
