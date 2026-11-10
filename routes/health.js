// Occupational health questionnaires on the office side. Confidential health information, so only admins
// (the client's responsible person) and Safety Simplified can read answers; managers and viewers see nothing here.
const express = require('express');
const QRCode = require('qrcode');
const { q } = require('../lib/db');
const { requireUser } = require('../lib/auth');
const { clean, token, csv } = require('../lib/util');
const { getSetting, setSetting } = require('../lib/brand');
const health = require('../lib/health');

const r = express.Router();
const admin = requireUser('admin');
const owner = requireUser('owner');
const baseUrl = req => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const STATUSES = ['new', 'reviewed', 'referred', 'closed'];

const LIST = `SELECT h.id, h.operative_id, h.name_given, h.phone_given, h.kind, h.flags, h.status, h.reviewed_by, h.reviewed_at, h.submitted_at, o.full_name, o.role
  FROM health_checks h LEFT JOIN operatives o ON o.id = h.operative_id`;

// The register: every submission, newest first, plus who on the register has never completed one.
r.get('/', admin, async (req, res) => {
  const rows = (await q(`${LIST} ORDER BY h.submitted_at DESC`)).rows;
  const never = (await q(`SELECT o.id, o.full_name, o.role FROM operatives o WHERE o.active AND NOT o.office
      AND NOT EXISTS (SELECT 1 FROM health_checks h WHERE h.operative_id = o.id) ORDER BY o.full_name`)).rows;
  // Due: last one over 11 months ago (annual review), so the office can chase before the year is up.
  const due = (await q(`SELECT o.id, o.full_name, MAX(h.submitted_at) AS last FROM operatives o JOIN health_checks h ON h.operative_id = o.id
      WHERE o.active AND NOT o.office GROUP BY o.id, o.full_name HAVING MAX(h.submitted_at) < NOW() - INTERVAL '11 months' ORDER BY last`)).rows;
  const tok = await getSetting('health_token');
  res.json({ rows, never, due, link: `${baseUrl(req)}/h/${tok}`, kinds: health.KINDS, flag_labels: Object.fromEntries(health.SECTIONS.map(s => [s.flag, s.flag_label])) });
});

r.get('/qr.svg', admin, async (req, res) => {
  const tok = await getSetting('health_token');
  res.type('image/svg+xml').send(await QRCode.toString(`${baseUrl(req)}/h/${tok}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
});

// A new link retires the old one (if it has got somewhere it shouldn't).
r.post('/new-link', admin, async (req, res) => {
  const tok = token(12);
  await setSetting('health_token', tok);
  res.json({ link: `${baseUrl(req)}/h/${tok}` });
});

r.get('/export.csv', admin, async (req, res) => {
  const rows = (await q(`${LIST} ORDER BY h.submitted_at DESC`)).rows;
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="occupational-health-register.csv"').send(csv(rows, [
    { label: 'Name', get: x => x.full_name || x.name_given }, { label: 'Role', key: 'role' }, { label: 'Questionnaire', get: x => health.KINDS[x.kind] || x.kind },
    { label: 'Submitted', key: 'submitted_at' }, { label: 'Flags', get: x => (x.flags || []).map(health.flagLabel).join('; ') }, { label: 'Status', key: 'status' },
    { label: 'Reviewed by', key: 'reviewed_by' }, { label: 'Reviewed', key: 'reviewed_at' },
  ]));
});

r.get('/:id', admin, async (req, res) => {
  const row = (await q(`SELECT h.*, o.full_name, o.role FROM health_checks h LEFT JOIN operatives o ON o.id = h.operative_id WHERE h.id = $1`, [req.params.id])).rows[0];
  if (!row) return res.status(404).json({ error: 'Not found.' });
  delete row.signature;
  const previous = row.operative_id ? (await q('SELECT id, kind, flags, status, submitted_at FROM health_checks WHERE operative_id = $1 AND id <> $2 ORDER BY submitted_at DESC', [row.operative_id, row.id])).rows : [];
  res.json({ row, previous, questionnaire: health.publicDefinition() });
});

r.get('/:id/signature', admin, async (req, res) => {
  const row = (await q('SELECT signature FROM health_checks WHERE id = $1', [req.params.id])).rows[0];
  const m = row && /^data:(image\/\w+);base64,(.+)$/.exec(row.signature);
  if (!m) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type(m[1]).send(Buffer.from(m[2], 'base64'));
});

// Review: status and a note. Linking to someone on the register is also done here when the name didn't match.
r.put('/:id', admin, async (req, res) => {
  const b = req.body || {};
  const row = (await q('SELECT * FROM health_checks WHERE id = $1', [req.params.id])).rows[0];
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const status = STATUSES.includes(b.status) ? b.status : row.status;
  const opId = b.operative_id === undefined ? row.operative_id : (parseInt(b.operative_id, 10) || null);
  await q(`UPDATE health_checks SET status = $2, review_note = $3, operative_id = $4,
      reviewed_by = CASE WHEN $2 <> 'new' THEN $5 ELSE reviewed_by END, reviewed_at = CASE WHEN $2 <> 'new' THEN NOW() ELSE reviewed_at END WHERE id = $1`,
    [row.id, status, clean(b.review_note, 2000), opId, req.user.name]);
  res.json({ ok: true });
});

// Safety Simplified can delete a questionnaire (test entries); the client's own admins review and close instead.
r.delete('/:id', owner, async (req, res) => { await q('DELETE FROM health_checks WHERE id = $1', [req.params.id]); res.json({ ok: true }); });

module.exports = r;
