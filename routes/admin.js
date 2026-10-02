// Portal API for office staff. Roles: admin (everything incl. users and settings), manager (edit), viewer (read only).
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { q } = require('../lib/db');
const { requireUser, hash } = require('../lib/auth');
const { token, clean, normPhone, csv } = require('../lib/util');
const { getSetting, setSetting } = require('../lib/brand');

const r = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const view = requireUser();
const edit = requireUser('manager');
const admin = requireUser('admin');
const owner = requireUser('owner');

const baseUrl = req => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const int = v => (v === '' || v == null ? null : parseInt(v, 10));
const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
const bool = v => v === true || v === 'true' || v === '1' || v === 'on';
const DOC_KINDS = ['rams', 'plan', 'permit', 'other'];
const EXPIRING_DAYS = 30;

function sendFile(res, row, download) {
  if (!row || !row.file_data) return res.status(404).end();
  res.setHeader('Content-Type', row.file_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${(row.file_name || 'file').replace(/"/g, '')}"`);
  res.send(row.file_data);
}
async function qrSvg(url) { return QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }); }

// Latest record per operative and training type, with a status.
const LATEST_QUALS = `
  SELECT DISTINCT ON (ql.operative_id, ql.qual_type_id) ql.id, ql.operative_id, ql.qual_type_id, ql.number, ql.issued_on, ql.expires_on,
    (ql.file_data IS NOT NULL) AS has_file,
    CASE WHEN ql.expires_on IS NULL THEN 'valid'
         WHEN ql.expires_on < CURRENT_DATE THEN 'expired'
         WHEN ql.expires_on <= CURRENT_DATE + ${EXPIRING_DAYS} THEN 'expiring'
         ELSE 'valid' END AS status
  FROM quals ql ORDER BY ql.operative_id, ql.qual_type_id, ql.expires_on DESC NULLS FIRST, ql.id DESC`;

r.get('/me', view, (req, res) => res.json({ user: req.user }));

// ---------- dashboard ----------
r.get('/dashboard', view, async (req, res) => {
  const counts = (await q(`SELECT
      (SELECT COUNT(*)::int FROM operatives WHERE active) AS operatives,
      (SELECT COUNT(*)::int FROM jobs WHERE status = 'live') AS live_jobs,
      (SELECT COUNT(*)::int FROM talks WHERE status = 'issued') AS open_talks,
      (SELECT COUNT(*)::int FROM signoffs WHERE operative_id IS NULL) AS unmatched`)).rows[0];
  const tickets = (await q(`SELECT l.*, o.full_name, t.name AS type_name FROM (${LATEST_QUALS}) l
      JOIN operatives o ON o.id = l.operative_id AND o.active JOIN qual_types t ON t.id = l.qual_type_id AND t.active
      WHERE l.status IN ('expired','expiring') ORDER BY l.expires_on`)).rows;
  const missing = (await q(`SELECT o.id AS operative_id, o.full_name, t.id AS qual_type_id, t.name AS type_name
      FROM operatives o CROSS JOIN qual_types t
      WHERE o.active AND t.active AND t.required AND NOT EXISTS (SELECT 1 FROM quals ql WHERE ql.operative_id = o.id AND ql.qual_type_id = t.id)
      ORDER BY o.full_name, t.sort`)).rows;
  const jobs = (await q(`SELECT j.id, j.ref, j.name,
      (SELECT COUNT(*)::int FROM job_operatives jo JOIN operatives o ON o.id = jo.operative_id AND o.active WHERE jo.job_id = j.id) AS team,
      (SELECT COUNT(*)::int FROM documents d WHERE d.job_id = j.id AND d.current AND d.requires_signoff) AS docs,
      (SELECT COUNT(*)::int FROM job_operatives jo JOIN operatives o ON o.id = jo.operative_id AND o.active
         JOIN documents d ON d.job_id = jo.job_id AND d.current AND d.requires_signoff
         WHERE jo.job_id = j.id AND NOT EXISTS (SELECT 1 FROM signoffs s WHERE s.document_id = d.id AND s.operative_id = jo.operative_id)) AS outstanding
      FROM jobs j WHERE j.status = 'live' ORDER BY j.name`)).rows;
  const talks = (await q(`SELECT t.id, t.ref, t.title, t.issued_at, t.job_id,
      (SELECT COUNT(DISTINCT s.operative_id)::int FROM signoffs s WHERE s.talk_id = t.id AND s.operative_id IS NOT NULL) AS signed,
      CASE WHEN t.job_id IS NULL THEN (SELECT COUNT(*)::int FROM operatives WHERE active)
           ELSE (SELECT COUNT(*)::int FROM job_operatives jo JOIN operatives o ON o.id = jo.operative_id AND o.active WHERE jo.job_id = t.job_id) END AS expected
      FROM talks t WHERE t.status = 'issued' ORDER BY t.issued_at DESC`)).rows;
  const recent = (await q(`SELECT s.id, s.signed_at, s.name_given, s.operative_id, o.full_name, t.title AS talk, d.title AS doc, j.name AS job
      FROM signoffs s LEFT JOIN operatives o ON o.id = s.operative_id LEFT JOIN talks t ON t.id = s.talk_id
      LEFT JOIN documents d ON d.id = s.document_id LEFT JOIN jobs j ON j.id = d.job_id
      ORDER BY s.signed_at DESC LIMIT 12`)).rows;
  res.json({ counts, tickets, missing, jobs, talks, recent });
});

// ---------- operatives ----------
const OP_FIELDS = ['full_name', 'phone', 'email', 'role', 'employment', 'start_date', 'emergency_name', 'emergency_phone', 'notes', 'active'];
function opValues(b) {
  return [clean(b.full_name, 120), normPhone(b.phone) || null, clean(b.email, 160), clean(b.role, 80), clean(b.employment, 40), date(b.start_date),
    clean(b.emergency_name, 120), normPhone(b.emergency_phone) || null, clean(b.notes, 2000), b.active === undefined ? true : bool(b.active)];
}

r.get('/operatives', view, async (req, res) => {
  const rows = (await q(`SELECT o.id, o.full_name, o.phone, o.role, o.employment, o.active,
      (SELECT COUNT(*)::int FROM (${LATEST_QUALS}) l WHERE l.operative_id = o.id AND l.status = 'expired') AS expired,
      (SELECT COUNT(*)::int FROM (${LATEST_QUALS}) l WHERE l.operative_id = o.id AND l.status = 'expiring') AS expiring,
      (SELECT COUNT(*)::int FROM qual_types t WHERE t.active AND t.required AND NOT EXISTS (SELECT 1 FROM quals ql WHERE ql.operative_id = o.id AND ql.qual_type_id = t.id)) AS missing,
      (SELECT string_agg(j.name, ', ' ORDER BY j.name) FROM job_operatives jo JOIN jobs j ON j.id = jo.job_id AND j.status = 'live' WHERE jo.operative_id = o.id) AS jobs
      FROM operatives o ORDER BY o.active DESC, o.full_name`)).rows;
  res.json({ rows });
});

r.post('/operatives', edit, async (req, res) => {
  const v = opValues(req.body || {});
  if (!v[0]) return res.status(400).json({ error: 'Enter their full name.' });
  const row = (await q(`INSERT INTO operatives (${OP_FIELDS.join(',')}) VALUES (${OP_FIELDS.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, v)).rows[0];
  res.json({ row });
});

r.get('/operatives/:id', view, async (req, res) => {
  const op = (await q('SELECT * FROM operatives WHERE id = $1', [req.params.id])).rows[0];
  if (!op) return res.status(404).json({ error: 'Not found.' });
  delete op.device_token;
  const quals = (await q(`SELECT ql.id, ql.qual_type_id, ql.number, ql.issued_on, ql.expires_on, ql.file_name, (ql.file_data IS NOT NULL) AS has_file, ql.added_by, ql.created_at, t.name AS type_name
      FROM quals ql JOIN qual_types t ON t.id = ql.qual_type_id WHERE ql.operative_id = $1 ORDER BY t.sort, ql.expires_on DESC NULLS FIRST`, [op.id])).rows;
  const signoffs = (await q(`SELECT s.id, s.signed_at, s.attempts, t.id AS talk_id, t.ref AS talk_ref, t.title AS talk, d.id AS document_id, d.title AS doc, d.revision, j.id AS job_id, j.name AS job
      FROM signoffs s LEFT JOIN talks t ON t.id = s.talk_id LEFT JOIN documents d ON d.id = s.document_id LEFT JOIN jobs j ON j.id = d.job_id
      WHERE s.operative_id = $1 ORDER BY s.signed_at DESC`, [op.id])).rows;
  const jobs = (await q(`SELECT j.id, j.ref, j.name, j.status FROM job_operatives jo JOIN jobs j ON j.id = jo.job_id WHERE jo.operative_id = $1 ORDER BY j.status, j.name`, [op.id])).rows;
  res.json({ operative: op, quals, signoffs, jobs });
});

r.put('/operatives/:id', edit, async (req, res) => {
  const v = opValues(req.body || {});
  if (!v[0]) return res.status(400).json({ error: 'Enter their full name.' });
  await q(`UPDATE operatives SET ${OP_FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ')} WHERE id = $${OP_FIELDS.length + 1}`, [...v, req.params.id]);
  res.json({ ok: true });
});

// Bulk add from a pasted list or spreadsheet export: one person per line, "Name, mobile, role".
r.post('/operatives/import', edit, async (req, res) => {
  const lines = String((req.body || {}).text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let added = 0, skipped = 0;
  for (const line of lines) {
    const [name, phone, role] = line.split(/\t|,/).map(s => s.trim());
    if (!name || /^name$/i.test(name)) { skipped++; continue; }
    const exists = (await q('SELECT 1 FROM operatives WHERE LOWER(full_name) = LOWER($1)', [name])).rows[0];
    if (exists) { skipped++; continue; }
    await q('INSERT INTO operatives (full_name, phone, role) VALUES ($1,$2,$3)', [clean(name, 120), normPhone(phone) || null, clean(role, 80)]);
    added++;
  }
  res.json({ added, skipped });
});

// ---------- training records ----------
r.post('/quals', edit, upload.single('file'), async (req, res) => {
  const b = req.body || {};
  if (!int(b.operative_id) || !int(b.qual_type_id)) return res.status(400).json({ error: 'Choose the person and the training type.' });
  const f = req.file;
  const row = (await q(`INSERT INTO quals (operative_id, qual_type_id, number, issued_on, expires_on, file_name, file_mime, file_data, added_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [int(b.operative_id), int(b.qual_type_id), clean(b.number, 60), date(b.issued_on), date(b.expires_on),
      f ? f.originalname : null, f ? f.mimetype : null, f ? f.buffer : null, req.user.name])).rows[0];
  res.json({ id: row.id });
});

r.put('/quals/:id', edit, upload.single('file'), async (req, res) => {
  const b = req.body || {};
  const f = req.file;
  await q(`UPDATE quals SET number = $1, issued_on = $2, expires_on = $3,
      file_name = COALESCE($4, file_name), file_mime = COALESCE($5, file_mime), file_data = COALESCE($6, file_data) WHERE id = $7`,
    [clean(b.number, 60), date(b.issued_on), date(b.expires_on), f ? f.originalname : null, f ? f.mimetype : null, f ? f.buffer : null, req.params.id]);
  res.json({ ok: true });
});

r.delete('/quals/:id', edit, async (req, res) => { await q('DELETE FROM quals WHERE id = $1', [req.params.id]); res.json({ ok: true }); });
r.get('/quals/:id/file', view, async (req, res) => sendFile(res, (await q('SELECT file_name, file_mime, file_data FROM quals WHERE id = $1', [req.params.id])).rows[0], req.query.download));

async function matrix(req) {
  const job = int(req.query.job);
  const types = (await q('SELECT id, name, required, validity_months FROM qual_types WHERE active ORDER BY sort, name')).rows;
  const ops = (await q(`SELECT o.id, o.full_name, o.role FROM operatives o WHERE o.active
      AND ($1::int IS NULL OR EXISTS (SELECT 1 FROM job_operatives jo WHERE jo.job_id = $1 AND jo.operative_id = o.id)) ORDER BY o.full_name`, [job])).rows;
  const cells = {};
  (await q(LATEST_QUALS)).rows.forEach(c => { (cells[c.operative_id] = cells[c.operative_id] || {})[c.qual_type_id] = c; });
  return { types, operatives: ops, cells };
}
r.get('/matrix', view, async (req, res) => res.json(await matrix(req)));
r.get('/matrix.csv', view, async (req, res) => {
  const m = await matrix(req);
  const fmt = d => (d ? d.split('-').reverse().join('/') : '');
  const cols = [{ label: 'Name', key: 'full_name' }, { label: 'Role', key: 'role' },
    ...m.types.map(t => ({ label: t.name, get: o => { const c = (m.cells[o.id] || {})[t.id]; return c ? (c.expires_on ? `${c.status === 'expired' ? 'EXPIRED ' : ''}${fmt(c.expires_on)}` : 'Held') : (t.required ? 'MISSING' : ''); } }))];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="training-matrix.csv"');
  res.send(csv(m.operatives, cols));
});

// ---------- training types ----------
r.get('/qual-types', view, async (req, res) => res.json({ rows: (await q('SELECT * FROM qual_types ORDER BY active DESC, sort, name')).rows }));
r.post('/qual-types', owner, async (req, res) => {
  const b = req.body || {};
  if (!clean(b.name)) return res.status(400).json({ error: 'Enter a name.' });
  const sort = (await q('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM qual_types')).rows[0].s;
  res.json({ row: (await q('INSERT INTO qual_types (name, required, validity_months, sort) VALUES ($1,$2,$3,$4) RETURNING *', [clean(b.name, 120), bool(b.required), int(b.validity_months), sort])).rows[0] });
});
r.put('/qual-types/:id', owner, async (req, res) => {
  const b = req.body || {};
  if (!clean(b.name)) return res.status(400).json({ error: 'Enter a name.' });
  await q('UPDATE qual_types SET name = $1, required = $2, validity_months = $3, active = $4, sort = COALESCE($5, sort) WHERE id = $6',
    [clean(b.name, 120), bool(b.required), int(b.validity_months), b.active === undefined ? true : bool(b.active), int(b.sort), req.params.id]);
  res.json({ ok: true });
});

// ---------- jobs ----------
const JOB_FIELDS = ['ref', 'name', 'address', 'client', 'client_contact', 'start_on', 'end_on', 'status', 'notes'];
function jobValues(b) {
  return [clean(b.ref, 40), clean(b.name, 160), clean(b.address, 300), clean(b.client, 160), clean(b.client_contact, 200),
    date(b.start_on), date(b.end_on), b.status === 'complete' ? 'complete' : 'live', clean(b.notes, 4000)];
}

r.get('/jobs', view, async (req, res) => {
  const rows = (await q(`SELECT j.id, j.ref, j.name, j.client, j.start_on, j.end_on, j.status,
      (SELECT COUNT(*)::int FROM job_operatives jo WHERE jo.job_id = j.id) AS team,
      (SELECT COUNT(*)::int FROM documents d WHERE d.job_id = j.id AND d.current) AS docs,
      (SELECT COUNT(*)::int FROM job_operatives jo JOIN operatives o ON o.id = jo.operative_id AND o.active
         JOIN documents d ON d.job_id = jo.job_id AND d.current AND d.requires_signoff
         WHERE jo.job_id = j.id AND NOT EXISTS (SELECT 1 FROM signoffs s WHERE s.document_id = d.id AND s.operative_id = jo.operative_id)) AS outstanding
      FROM jobs j ORDER BY j.status = 'live' DESC, j.start_on DESC NULLS LAST, j.name`)).rows;
  res.json({ rows });
});

r.post('/jobs', edit, async (req, res) => {
  const v = jobValues(req.body || {});
  if (!v[1]) return res.status(400).json({ error: 'Give the job a name.' });
  const row = (await q(`INSERT INTO jobs (${JOB_FIELDS.join(',')}, token) VALUES (${JOB_FIELDS.map((_, i) => '$' + (i + 1)).join(',')}, $${JOB_FIELDS.length + 1}) RETURNING *`, [...v, token(12)])).rows[0];
  res.json({ row });
});

r.get('/jobs/:id', view, async (req, res) => {
  const job = (await q('SELECT * FROM jobs WHERE id = $1', [req.params.id])).rows[0];
  if (!job) return res.status(404).json({ error: 'Not found.' });
  job.url = `${baseUrl(req)}/j/${job.token}`;
  const team = (await q(`SELECT o.id, o.full_name, o.role, o.phone, o.active FROM job_operatives jo JOIN operatives o ON o.id = jo.operative_id WHERE jo.job_id = $1 ORDER BY o.full_name`, [job.id])).rows;
  const documents = (await q(`SELECT d.id, d.kind, d.title, d.reference, d.revision, d.requires_signoff, d.current, d.file_name, d.uploaded_by, d.created_at,
      (SELECT COUNT(*)::int FROM signoffs s WHERE s.document_id = d.id) AS signed
      FROM documents d WHERE d.job_id = $1 ORDER BY d.current DESC, d.kind, d.title, d.created_at DESC`, [job.id])).rows;
  const signoffs = (await q(`SELECT s.id, s.document_id, s.operative_id, s.name_given, s.signed_at FROM signoffs s JOIN documents d ON d.id = s.document_id WHERE d.job_id = $1`, [job.id])).rows;
  res.json({ job, team, documents, signoffs });
});

r.put('/jobs/:id', edit, async (req, res) => {
  const v = jobValues(req.body || {});
  if (!v[1]) return res.status(400).json({ error: 'Give the job a name.' });
  await q(`UPDATE jobs SET ${JOB_FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ')} WHERE id = $${JOB_FIELDS.length + 1}`, [...v, req.params.id]);
  res.json({ ok: true });
});

r.put('/jobs/:id/team', edit, async (req, res) => {
  const ids = ((req.body || {}).operative_ids || []).map(Number).filter(Boolean);
  await q('DELETE FROM job_operatives WHERE job_id = $1 AND NOT (operative_id = ANY($2::int[]))', [req.params.id, ids]);
  for (const id of ids) await q('INSERT INTO job_operatives (job_id, operative_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, id]);
  res.json({ ok: true });
});

r.post('/jobs/:id/new-link', edit, async (req, res) => {
  await q('UPDATE jobs SET token = $1 WHERE id = $2', [token(12), req.params.id]);
  res.json({ ok: true });
});

r.get('/jobs/:id/qr.svg', view, async (req, res) => {
  const j = (await q('SELECT token FROM jobs WHERE id = $1', [req.params.id])).rows[0];
  if (!j) return res.status(404).end();
  res.type('image/svg+xml').send(await qrSvg(`${baseUrl(req)}/j/${j.token}`));
});

// Documents: uploading a new revision of an existing document marks the old one as superseded,
// so everyone on the job is asked to sign the new one.
r.post('/jobs/:id/documents', edit, upload.single('file'), async (req, res) => {
  const b = req.body || {};
  if (!clean(b.title)) return res.status(400).json({ error: 'Give the document a title.' });
  if (!req.file) return res.status(400).json({ error: 'Attach the document.' });
  const kind = DOC_KINDS.includes(b.kind) ? b.kind : 'rams';
  if (int(b.replaces)) await q('UPDATE documents SET current = FALSE WHERE id = $1 AND job_id = $2', [int(b.replaces), req.params.id]);
  const row = (await q(`INSERT INTO documents (job_id, kind, title, reference, revision, requires_signoff, file_name, file_mime, file_data, uploaded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [req.params.id, kind, clean(b.title, 200), clean(b.reference, 80), clean(b.revision, 20), b.requires_signoff === undefined ? kind === 'rams' : bool(b.requires_signoff),
      req.file.originalname, req.file.mimetype, req.file.buffer, req.user.name])).rows[0];
  res.json({ id: row.id });
});

r.put('/documents/:id', edit, async (req, res) => {
  const b = req.body || {};
  await q('UPDATE documents SET title = COALESCE($1, title), reference = $2, revision = $3, requires_signoff = $4, current = $5, kind = COALESCE($6, kind) WHERE id = $7',
    [clean(b.title, 200), clean(b.reference, 80), clean(b.revision, 20), bool(b.requires_signoff), b.current === undefined ? true : bool(b.current),
      DOC_KINDS.includes(b.kind) ? b.kind : null, req.params.id]);
  res.json({ ok: true });
});
r.delete('/documents/:id', edit, async (req, res) => { await q('DELETE FROM documents WHERE id = $1', [req.params.id]); res.json({ ok: true }); });
r.get('/documents/:id/file', view, async (req, res) => sendFile(res, (await q('SELECT file_name, file_mime, file_data FROM documents WHERE id = $1', [req.params.id])).rows[0], req.query.download));

// ---------- toolbox talks ----------
function talkPayload(b) {
  const sections = (Array.isArray(b.sections) ? b.sections : []).map(s => ({ heading: clean(s.heading, 200) || '', body: clean(s.body, 20000) || '' })).filter(s => s.heading || s.body);
  const questions = (Array.isArray(b.questions) ? b.questions : []).map(x => {
    const options = (Array.isArray(x.options) ? x.options : []).map(o => clean(o, 300)).filter(Boolean);
    return { question: clean(x.question, 500) || '', options, answer: Math.min(Math.max(0, int(x.answer) || 0), Math.max(0, options.length - 1)) };
  }).filter(x => x.question && x.options.length >= 2);
  return { ref: clean(b.ref, 40), title: clean(b.title, 200), intro: clean(b.intro, 4000), job_id: int(b.job_id), sections, questions };
}

const EXPECTED_SQL = `CASE WHEN t.job_id IS NULL THEN (SELECT COUNT(*)::int FROM operatives WHERE active)
  ELSE (SELECT COUNT(*)::int FROM job_operatives jo JOIN operatives o ON o.id = jo.operative_id AND o.active WHERE jo.job_id = t.job_id) END`;

r.get('/talks', view, async (req, res) => {
  const rows = (await q(`SELECT t.id, t.ref, t.title, t.status, t.issued_at, t.created_at, j.name AS job,
      (SELECT COUNT(*)::int FROM signoffs s WHERE s.talk_id = t.id) AS signatures,
      (SELECT COUNT(DISTINCT s.operative_id)::int FROM signoffs s WHERE s.talk_id = t.id AND s.operative_id IS NOT NULL) AS signed,
      ${EXPECTED_SQL} AS expected
      FROM talks t LEFT JOIN jobs j ON j.id = t.job_id WHERE t.status <> 'library'
      ORDER BY CASE t.status WHEN 'draft' THEN 0 WHEN 'issued' THEN 1 ELSE 2 END, COALESCE(t.issued_at, t.created_at) DESC`)).rows;
  res.json({ rows });
});

// The talk library: ready-made talks, issued as many times as needed (each issue has its own link and register).
r.get('/library', view, async (req, res) => {
  const rows = (await q(`SELECT t.id, t.ref, t.title, t.intro, t.category, jsonb_array_length(t.sections) AS parts, jsonb_array_length(t.questions) AS questions,
      (SELECT MAX(i.issued_at) FROM talks i WHERE i.source_id = t.id) AS last_issued,
      (SELECT COUNT(*)::int FROM talks i WHERE i.source_id = t.id) AS times_issued
      FROM talks t WHERE t.status = 'library' AND ($1 OR jsonb_array_length(t.sections) > 0) ORDER BY t.ref NULLS LAST, t.title`, [req.user.role === 'owner'])).rows;
  res.json({ rows });
});

r.post('/library/:id/issue', edit, async (req, res) => {
  const src = (await q("SELECT * FROM talks WHERE id = $1 AND status = 'library'", [req.params.id])).rows[0];
  if (!src) return res.status(404).json({ error: 'Not found.' });
  if (!src.sections.length) return res.status(400).json({ error: 'This talk has no content yet.' });
  const row = (await q(`INSERT INTO talks (ref, title, intro, category, sections, questions, job_id, status, token, issued_at, created_by, source_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'issued',$8,NOW(),$9,$10) RETURNING id`,
    [src.ref, src.title, src.intro, src.category, JSON.stringify(src.sections), JSON.stringify(src.questions), int((req.body || {}).job_id), token(12), req.user.name, src.id])).rows[0];
  res.json({ id: row.id });
});

r.post('/talks', edit, async (req, res) => {
  const b = req.body || {};
  if (b.library && req.user.role !== 'owner') return res.status(403).json({ error: 'Only Safety Simplified can add to the library.' });
  let base = { ref: null, title: 'New toolbox talk', intro: null, sections: [], questions: [], job_id: null };
  if (int(b.copy_from)) {
    const src = (await q('SELECT * FROM talks WHERE id = $1', [int(b.copy_from)])).rows[0];
    if (src) base = { ref: src.ref, title: src.title, intro: src.intro, sections: src.sections, questions: src.questions, job_id: null };
  }
  const row = (await q(`INSERT INTO talks (ref, title, intro, sections, questions, job_id, token, created_by, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [base.ref, base.title, base.intro, JSON.stringify(base.sections), JSON.stringify(base.questions), base.job_id, token(12), req.user.name, b.library ? 'library' : 'draft'])).rows[0];
  res.json({ row });
});

r.get('/talks/:id', view, async (req, res) => {
  const talk = (await q('SELECT t.*, j.name AS job FROM talks t LEFT JOIN jobs j ON j.id = t.job_id WHERE t.id = $1', [req.params.id])).rows[0];
  if (!talk) return res.status(404).json({ error: 'Not found.' });
  talk.url = `${baseUrl(req)}/t/${talk.token}`;
  const signoffs = (await q(`SELECT s.id, s.operative_id, s.name_given, s.phone_given, s.signed_at, s.attempts, o.full_name
      FROM signoffs s LEFT JOIN operatives o ON o.id = s.operative_id WHERE s.talk_id = $1 ORDER BY s.signed_at`, [talk.id])).rows;
  const outstanding = (await q(`SELECT o.id, o.full_name, o.role, o.phone FROM operatives o WHERE o.active
      AND ($1::int IS NULL OR EXISTS (SELECT 1 FROM job_operatives jo WHERE jo.job_id = $1 AND jo.operative_id = o.id))
      AND NOT EXISTS (SELECT 1 FROM signoffs s WHERE s.talk_id = $2 AND s.operative_id = o.id) ORDER BY o.full_name`, [talk.job_id, talk.id])).rows;
  res.json({ talk, signoffs, outstanding });
});

r.put('/talks/:id', edit, async (req, res) => {
  const cur = (await q('SELECT status FROM talks WHERE id = $1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Not found.' });
  if (cur.status === 'library' && req.user.role !== 'owner') return res.status(403).json({ error: 'Library talks are maintained by Safety Simplified.' });
  if (!['draft', 'library'].includes(cur.status)) return res.status(400).json({ error: 'Issued talks are locked so everyone signs the same thing. Make a copy to change it.' });
  const p = talkPayload(req.body || {});
  if (!p.title) return res.status(400).json({ error: 'Give the talk a title.' });
  const row = (await q('UPDATE talks SET ref=$1, title=$2, intro=$3, sections=$4, questions=$5, job_id=$6, category=COALESCE($7, category), updated_at=NOW() WHERE id=$8 RETURNING *',
    [p.ref, p.title, p.intro, JSON.stringify(p.sections), JSON.stringify(p.questions), cur.status === 'library' ? null : p.job_id, clean((req.body || {}).category, 60), req.params.id])).rows[0];
  res.json({ row });
});

r.post('/talks/:id/issue', edit, async (req, res) => {
  const t = (await q('SELECT * FROM talks WHERE id = $1', [req.params.id])).rows[0];
  if (!t) return res.status(404).json({ error: 'Not found.' });
  if (t.status !== 'draft') return res.status(400).json({ error: 'This talk has already been issued.' });
  if (!t.sections.length) return res.status(400).json({ error: 'Add at least one section before issuing.' });
  await q("UPDATE talks SET status = 'issued', issued_at = NOW() WHERE id = $1", [t.id]);
  res.json({ ok: true });
});

r.post('/talks/:id/close', edit, async (req, res) => {
  await q("UPDATE talks SET status = CASE WHEN status = 'closed' THEN 'issued' ELSE 'closed' END WHERE id = $1 AND status <> 'draft'", [req.params.id]);
  res.json({ ok: true });
});

r.delete('/talks/:id', edit, async (req, res) => {
  const t = (await q('SELECT status FROM talks WHERE id = $1', [req.params.id])).rows[0];
  if (t && t.status === 'library' && req.user.role !== 'owner') return res.status(403).json({ error: 'Library talks are maintained by Safety Simplified.' });
  const row = (await q("DELETE FROM talks WHERE id = $1 AND status IN ('draft','library') RETURNING id", [req.params.id])).rows[0];
  if (!row) return res.status(400).json({ error: 'Only drafts can be deleted.' });
  res.json({ ok: true });
});

r.get('/talks/:id/qr.svg', view, async (req, res) => {
  const t = (await q('SELECT token FROM talks WHERE id = $1', [req.params.id])).rows[0];
  if (!t) return res.status(404).end();
  res.type('image/svg+xml').send(await qrSvg(`${baseUrl(req)}/t/${t.token}`));
});

// ---------- signatures ----------
r.get('/signoffs/:id/signature', view, async (req, res) => {
  const row = (await q('SELECT signature FROM signoffs WHERE id = $1', [req.params.id])).rows[0];
  const m = row && row.signature && row.signature.match(/^data:(image\/\w+);base64,(.*)$/);
  if (!m) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type(m[1]).send(Buffer.from(m[2], 'base64'));
});

// Signatures from people not matched to the register.
r.get('/unmatched', view, async (req, res) => {
  const rows = (await q(`SELECT s.id, s.name_given, s.phone_given, s.signed_at, t.title AS talk, d.title AS doc, j.name AS job
      FROM signoffs s LEFT JOIN talks t ON t.id = s.talk_id LEFT JOIN documents d ON d.id = s.document_id LEFT JOIN jobs j ON j.id = d.job_id
      WHERE s.operative_id IS NULL ORDER BY s.name_given, s.signed_at`)).rows;
  res.json({ rows });
});

// Link a signature (and any others with the same name and phone) to someone on the register.
r.post('/signoffs/:id/link', edit, async (req, res) => {
  const s = (await q('SELECT * FROM signoffs WHERE id = $1', [req.params.id])).rows[0];
  if (!s) return res.status(404).json({ error: 'Not found.' });
  let opId = int((req.body || {}).operative_id);
  if ((req.body || {}).create) {
    opId = (await q('INSERT INTO operatives (full_name, phone) VALUES ($1,$2) RETURNING id', [s.name_given, s.phone_given])).rows[0].id;
  }
  if (!opId) return res.status(400).json({ error: 'Choose who this is.' });
  const n = await q(`UPDATE signoffs SET operative_id = $1 WHERE operative_id IS NULL
      AND LOWER(name_given) = LOWER($2) AND COALESCE(phone_given, '') = COALESCE($3, '')`, [opId, s.name_given, s.phone_given]);
  if (s.phone_given) await q('UPDATE operatives SET phone = COALESCE(phone, $1) WHERE id = $2', [s.phone_given, opId]);
  res.json({ ok: true, linked: n.rowCount, operative_id: opId });
});

r.delete('/signoffs/:id', edit, async (req, res) => { await q('DELETE FROM signoffs WHERE id = $1', [req.params.id]); res.json({ ok: true }); });

// ---------- account & Safety Simplified settings ----------
r.get('/account', view, async (req, res) => res.json({ dd_link: await getSetting('dd_link') }));

r.put('/settings', owner, async (req, res) => {
  const l = String((req.body || {}).dd_link || '').trim();
  if (l && !/^https:\/\/\S+$/.test(l)) return res.status(400).json({ error: 'The Direct Debit link must start with https://' });
  await setSetting('dd_link', l);
  res.json({ ok: true });
});

// ---------- users ----------
r.get('/users', admin, async (req, res) => {
  res.json({ rows: (await q(`SELECT id, name, email, role, active, created_at FROM users WHERE $1 OR role <> 'owner' ORDER BY name`, [req.user.role === 'owner'])).rows });
});

r.post('/users', admin, async (req, res) => {
  const b = req.body || {};
  if (!clean(b.name) || !clean(b.email) || !b.password || b.password.length < 8) return res.status(400).json({ error: 'Enter a name, an email and a password of at least 8 characters.' });
  const roles = req.user.role === 'owner' ? ['owner', 'admin', 'manager', 'viewer'] : ['admin', 'manager', 'viewer'];
  const role = roles.includes(b.role) ? b.role : 'manager';
  try {
    const row = (await q('INSERT INTO users (name, email, password_hash, role) VALUES ($1, LOWER($2), $3, $4) RETURNING id, name, email, role, active',
      [clean(b.name, 120), clean(b.email, 160), await hash(b.password), role])).rows[0];
    res.json({ row });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'There is already an account with that email.' });
    throw e;
  }
});

r.put('/users/:id', admin, async (req, res) => {
  const b = req.body || {};
  const target = (await q('SELECT role FROM users WHERE id = $1', [req.params.id])).rows[0];
  if (!target) return res.status(404).json({ error: 'Not found.' });
  if (target.role === 'owner' && req.user.role !== 'owner') return res.status(403).json({ error: 'Only Safety Simplified can change this account.' });
  const roles = req.user.role === 'owner' ? ['owner', 'admin', 'manager', 'viewer'] : ['admin', 'manager', 'viewer'];
  const role = roles.includes(b.role) ? b.role : null;
  if (Number(req.params.id) === req.user.id && (b.active === false || (role && role !== req.user.role))) return res.status(400).json({ error: 'You cannot remove your own admin access.' });
  if (b.password && b.password.length < 8) return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
  await q('UPDATE users SET role = COALESCE($1, role), active = COALESCE($2, active) WHERE id = $3', [role, typeof b.active === 'boolean' ? b.active : null, req.params.id]);
  if (b.password) await q('UPDATE users SET password_hash = $1 WHERE id = $2', [await hash(b.password), req.params.id]);
  res.json({ ok: true });
});

module.exports = r;
