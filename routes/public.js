// Operative-facing API, used by links shared on WhatsApp:
//   /t/TOKEN  a toolbox talk: read, answer the questions, sign
//   /j/TOKEN  a job pack: read the RAMS and site documents, sign each one that needs it
// Operatives identify themselves with name and mobile. If they match the register they are linked
// straight away; if not, the signature is still recorded and the office links it later.
const express = require('express');
const { q } = require('../lib/db');
const { token, clean, normPhone, surname, validImage } = require('../lib/util');
const { publicBrand } = require('../lib/brand');

const r = express.Router();

async function findOperative(name, phone, tok) {
  if (tok) {
    const o = (await q('SELECT * FROM operatives WHERE device_token = $1 AND active', [tok])).rows[0];
    if (o) return o;
  }
  const p = normPhone(phone);
  if (p.length < 10 || !name) return null;
  return (await q('SELECT * FROM operatives WHERE phone = $1 AND active', [p])).rows.find(o => surname(o.full_name) === surname(name)) || null;
}

function who(req) {
  const b = req.body || {};
  return { name: clean(b.name || req.query.name, 120), phone: normPhone(b.phone || req.query.phone), tok: req.get('x-op-token') || null };
}

// Has this person already signed? Matches on the register first, then on the name and number they gave.
async function alreadySigned(col, id, op, w) {
  if (op) return !!(await q(`SELECT 1 FROM signoffs WHERE ${col} = $1 AND operative_id = $2`, [id, op.id])).rows[0];
  if (!w.name) return false;
  return !!(await q(`SELECT 1 FROM signoffs WHERE ${col} = $1 AND LOWER(name_given) = LOWER($2) AND COALESCE(phone_given,'') = $3`, [id, w.name, w.phone || ''])).rows[0];
}

async function record(col, id, op, w, signature, attempts) {
  await q(`INSERT INTO signoffs (${col}, operative_id, name_given, phone_given, signature, attempts) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, op ? op.id : null, op ? op.full_name : w.name, w.phone || (op && op.phone) || null, signature, Math.max(1, parseInt(attempts, 10) || 1)]);
}

// ---------- identity ----------
r.post('/identify', async (req, res) => {
  const w = who(req);
  if (!w.name || w.name.split(/\s+/).length < 2) return res.status(400).json({ error: 'Enter your first name and surname.' });
  if (w.phone.length < 10) return res.status(400).json({ error: 'Enter your mobile number.' });
  const op = await findOperative(w.name, w.phone);
  if (!op) return res.json({ matched: false, name: w.name, phone: w.phone });
  const t = op.device_token || token();
  if (!op.device_token) await q('UPDATE operatives SET device_token = $1 WHERE id = $2', [t, op.id]);
  res.json({ matched: true, token: t, name: op.full_name, phone: op.phone });
});

r.get('/brand', (req, res) => res.json(publicBrand()));

// ---------- toolbox talks ----------
async function talkByToken(t) { return (await q("SELECT * FROM talks WHERE token = $1 AND status <> 'draft'", [t])).rows[0]; }

r.get('/t/:token', async (req, res) => {
  const t = await talkByToken(req.params.token);
  if (!t) return res.status(404).json({ error: 'This toolbox talk link is not active. Ask the office for the current link.' });
  const w = who(req);
  const op = await findOperative(w.name, w.phone, w.tok);
  res.json({
    talk: { ref: t.ref, title: t.title, intro: t.intro, sections: t.sections, questions: t.questions.map(x => ({ question: x.question, options: x.options })), closed: t.status === 'closed' },
    signed: await alreadySigned('talk_id', t.id, op, w),
  });
});

// Answers are checked before the signature screen, and again when signing.
r.post('/t/:token/check', async (req, res) => {
  const t = await talkByToken(req.params.token);
  if (!t) return res.status(404).json({ error: 'This toolbox talk link is not active.' });
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  res.json({ wrong: (t.questions || []).map((x, i) => (Number(answers[i]) === Number(x.answer) ? null : i)).filter(i => i !== null) });
});

r.post('/t/:token/sign', async (req, res) => {
  const t = await talkByToken(req.params.token);
  if (!t) return res.status(404).json({ error: 'This toolbox talk link is not active.' });
  if (t.status === 'closed') return res.status(400).json({ error: 'This talk has been closed. Ask the office if you still need to sign it.' });
  const w = who(req);
  const op = await findOperative(w.name, w.phone, w.tok);
  if (!op && (!w.name || w.phone.length < 10)) return res.status(400).json({ error: 'Enter your name and mobile number first.' });
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  const wrong = (t.questions || []).map((x, i) => (Number(answers[i]) === Number(x.answer) ? null : i)).filter(i => i !== null);
  if (wrong.length) return res.json({ ok: false, wrong });
  if (!validImage(req.body.signature, 400_000)) return res.status(400).json({ error: 'Sign in the box to confirm.' });
  if (await alreadySigned('talk_id', t.id, op, w)) return res.json({ ok: true, already: true });
  await record('talk_id', t.id, op, w, req.body.signature, req.body.attempts);
  res.json({ ok: true });
});

// ---------- job packs ----------
async function jobByToken(t) { return (await q("SELECT * FROM jobs WHERE token = $1 AND status = 'live'", [t])).rows[0]; }

r.get('/j/:token', async (req, res) => {
  const j = await jobByToken(req.params.token);
  if (!j) return res.status(404).json({ error: 'This job pack link is not active. Ask the office for the current link.' });
  const w = who(req);
  const op = await findOperative(w.name, w.phone, w.tok);
  const docs = (await q(`SELECT id, kind, title, reference, revision, requires_signoff, file_name, created_at FROM documents
      WHERE job_id = $1 AND current ORDER BY CASE kind WHEN 'rams' THEN 0 WHEN 'permit' THEN 1 WHEN 'plan' THEN 2 ELSE 3 END, title`, [j.id])).rows;
  for (const d of docs) d.signed = d.requires_signoff ? await alreadySigned('document_id', d.id, op, w) : null;
  res.json({ job: { name: j.name, ref: j.ref, address: j.address, client: j.client }, documents: docs });
});

r.get('/j/:token/doc/:id', async (req, res) => {
  const j = await jobByToken(req.params.token);
  if (!j) return res.status(404).send('This job pack link is not active.');
  const d = (await q('SELECT file_name, file_mime, file_data FROM documents WHERE id = $1 AND job_id = $2 AND current', [req.params.id, j.id])).rows[0];
  if (!d || !d.file_data) return res.status(404).send('Document not available.');
  res.setHeader('Content-Type', d.file_mime || 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${(d.file_name || 'document').replace(/"/g, '')}"`);
  res.send(d.file_data);
});

r.post('/j/:token/doc/:id/sign', async (req, res) => {
  const j = await jobByToken(req.params.token);
  if (!j) return res.status(404).json({ error: 'This job pack link is not active.' });
  const d = (await q('SELECT id FROM documents WHERE id = $1 AND job_id = $2 AND current AND requires_signoff', [req.params.id, j.id])).rows[0];
  if (!d) return res.status(404).json({ error: 'This document has been replaced. Reload the page.' });
  const w = who(req);
  const op = await findOperative(w.name, w.phone, w.tok);
  if (!op && (!w.name || w.phone.length < 10)) return res.status(400).json({ error: 'Enter your name and mobile number first.' });
  if (!validImage(req.body.signature, 400_000)) return res.status(400).json({ error: 'Sign in the box to confirm.' });
  if (await alreadySigned('document_id', d.id, op, w)) return res.json({ ok: true, already: true });
  await record('document_id', d.id, op, w, req.body.signature, 1);
  // Someone signing a job pack who is on the register gets added to the job team.
  if (op) await q('INSERT INTO job_operatives (job_id, operative_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [j.id, op.id]);
  res.json({ ok: true });
});

module.exports = r;
