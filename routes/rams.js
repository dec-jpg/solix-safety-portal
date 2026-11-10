// RAMS built inside the portal: a master (method statement, risk assessments, COSHH) kept by Safety Simplified,
// and a site RAMS per job made from the master plus the site sheet. Issuing one renders the PDF onto the job
// (read only) and puts a short site briefing on the job pack for the lads to confirm.
const express = require('express');
const { q } = require('../lib/db');
const client = require('../lib/client');
const { requireUser } = require('../lib/auth');
const { clean } = require('../lib/util');
const { render } = require('../lib/ramspdf');

const r = express.Router();
const view = requireUser();
const edit = requireUser('manager');
const owner = requireUser('owner');
const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
const ddmmyy = iso => { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y.slice(2)}`; };
const monthYear = iso => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

async function currentMaster() {
  const m = (await q('SELECT * FROM rams_masters ORDER BY version DESC LIMIT 1')).rows[0];
  if (!m) throw Object.assign(new Error('No RAMS master has been set up for this portal yet.'), { status: 400 });
  return m;
}
function pdfBuffer(doc) {
  return new Promise((resolve, reject) => { const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
}

// ---------- master ----------
r.get('/master', view, async (req, res) => {
  const m = (await q('SELECT * FROM rams_masters ORDER BY version DESC LIMIT 1')).rows[0] || null;
  const versions = (await q('SELECT id, version, note, created_by, created_at FROM rams_masters ORDER BY version DESC')).rows;
  res.json({ master: m, versions });
});

// Saving the master always makes a new version; nothing issued before changes.
r.put('/master', owner, async (req, res) => {
  const b = req.body || {}, body = b.body;
  if (!body || !Array.isArray(body.sections) || !Array.isArray(body.risks)) return res.status(400).json({ error: 'The master needs its sections and risk assessments.' });
  const prev = (await q('SELECT version FROM rams_masters ORDER BY version DESC LIMIT 1')).rows[0];
  const version = prev ? prev.version + 1 : 1;
  const row = (await q('INSERT INTO rams_masters (version, title, body, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, version',
    [version, clean(body.title, 120) || 'Method Statement & Risk Assessments', JSON.stringify(body), clean(b.note, 300), req.user.name])).rows[0];
  res.json({ id: row.id, version: row.version });
});

// ---------- site RAMS ----------
r.get('/jobs/:id', view, async (req, res) => {
  const rows = (await q(`SELECT rs.id, rs.ref, rs.issue_no, rs.issue_date, rs.fields, rs.status, rs.document_id, rs.briefing_id, rs.created_by, rs.created_at, m.version AS master_version,
      (SELECT COUNT(*)::int FROM signoffs s WHERE s.document_id = rs.briefing_id) AS briefed
      FROM rams rs JOIN rams_masters m ON m.id = rs.master_id WHERE rs.job_id = $1 ORDER BY rs.issue_no DESC`, [req.params.id])).rows;
  const m = (await q('SELECT id, version, body FROM rams_masters ORDER BY version DESC LIMIT 1')).rows[0] || null;
  // Next issue number follows whatever is current on the job, including a RAMS uploaded as a file (its revision, if numeric).
  const cur = (await q("SELECT revision FROM documents WHERE job_id = $1 AND kind = 'rams' AND current ORDER BY created_at DESC LIMIT 1", [req.params.id])).rows[0];
  const curNo = cur && /^\d+$/.test(cur.revision || '') ? parseInt(cur.revision, 10) : null;
  const next = Math.max(rows[0] ? rows[0].issue_no + 1 : 1, curNo !== null ? curNo + 1 : 1);
  res.json({ rows, next_issue: next, defaults: m ? { ...(m.body.defaults || {}), ref: m.body.ref || '', master_version: m.version } : null });
});

// Make and issue a site RAMS for a job. Each issue is the next issue number; the previous one is superseded.
r.post('/jobs/:id', edit, async (req, res) => {
  const job = (await q('SELECT * FROM jobs WHERE id = $1', [req.params.id])).rows[0];
  if (!job) return res.status(404).json({ error: 'Not found.' });
  const m = await currentMaster();
  const b = req.body || {};
  const f = {
    project: clean(b.project, 160) || job.name, client: clean(b.client, 120) || job.client || '', address: clean(b.address, 300) || job.address || '',
    start_text: clean(b.start_text, 40) || monthYear(job.start_on) || '', end_text: clean(b.end_text, 40) || 'TBC',
    author: clean(b.author, 80) || (m.body.defaults || {}).author || '', reviewer: clean(b.reviewer, 80) || (m.body.defaults || {}).reviewer || '',
    emergency_contact: clean(b.emergency_contact, 160) || (m.body.defaults || {}).emergency_contact || '', site_supervisor: clean(b.site_supervisor, 80) || (m.body.defaults || {}).site_supervisor || '',
    scope: clean(b.scope, 600) || (m.body.defaults || {}).scope || '', site_notes: clean(b.site_notes, 4000) || '',
  };
  const issue_date = date(b.issue_date) || new Date().toISOString().slice(0, 10);
  const ref = clean(b.ref, 40) || m.body.ref || '';
  const prev = (await q('SELECT * FROM rams WHERE job_id = $1 ORDER BY issue_no DESC LIMIT 1', [job.id])).rows[0];
  const curDoc = (await q("SELECT revision FROM documents WHERE job_id = $1 AND kind = 'rams' AND current ORDER BY created_at DESC LIMIT 1", [job.id])).rows[0];
  const curNo = curDoc && /^\d+$/.test(curDoc.revision || '') ? parseInt(curDoc.revision, 10) : 0;
  const issue_no = b.issue_no !== undefined && b.issue_no !== '' ? parseInt(b.issue_no, 10) : Math.max(prev ? prev.issue_no + 1 : 1, curNo + 1);
  if (!Number.isInteger(issue_no) || issue_no < 0) return res.status(400).json({ error: 'Issue number must be a whole number.' });
  const review_months = (m.body.defaults || {}).review_months || 12;

  // 1. the PDF
  const site = { ...f, ref, issue_no, issue_date_text: ddmmyy(issue_date), review_text: `${review_months} months` };
  const pdf = await pdfBuffer(render(m.body, site));
  const fileName = `${client.company} - RAMS - ${f.project} - Issue ${issue_no}.pdf`.replace(/[\\/:*?"<>|]+/g, '');
  await q("UPDATE documents SET current = FALSE WHERE job_id = $1 AND kind = 'rams' AND current", [job.id]);
  const doc = (await q(`INSERT INTO documents (job_id, kind, title, reference, revision, requires_signoff, current, file_name, file_mime, file_data, uploaded_by)
      VALUES ($1,'rams',$2,$3,$4,FALSE,TRUE,$5,'application/pdf',$6,$7) RETURNING id`,
    [job.id, `RAMS: ${f.project}`, ref, String(issue_no), fileName, pdf, req.user.name])).rows[0];

  // 2. the site briefing: what the lads confirm when they start on this site
  const briefing = [
    `Site: ${f.project}`, `Client: ${f.client}`, `Address: ${f.address}`, `Dates: ${f.start_text} to ${f.end_text}`,
    `Site supervisor: ${f.site_supervisor}`, `Emergency contact: ${f.emergency_contact.replace(/\n/g, ', ')}`,
    '', `Scope of work: ${f.scope}`,
    f.site_notes ? `\nSite-specific arrangements:\n${f.site_notes}` : '',
    '', `The full RAMS for this site is ${ref} Issue ${issue_no} (${ddmmyy(issue_date)}), based on the company RAMS master. It is on this job pack to read. By confirming below you agree that you have been briefed on this site, have read the RAMS and will work to them.`,
  ].join('\n');
  await q("UPDATE documents SET current = FALSE WHERE job_id = $1 AND kind = 'briefing' AND current", [job.id]);
  const brief = (await q(`INSERT INTO documents (job_id, kind, title, reference, revision, requires_signoff, current, content, uploaded_by)
      VALUES ($1,'briefing',$2,$3,$4,TRUE,TRUE,$5,$6) RETURNING id`,
    [job.id, `Site briefing: ${f.project}`, ref, String(issue_no), briefing, req.user.name])).rows[0];

  // 3. the record
  if (prev) await q("UPDATE rams SET status = 'superseded' WHERE job_id = $1 AND status = 'issued'", [job.id]);
  const row = (await q(`INSERT INTO rams (job_id, master_id, ref, issue_no, issue_date, fields, document_id, briefing_id, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [job.id, m.id, ref, issue_no, issue_date, JSON.stringify(f), doc.id, brief.id, req.user.name])).rows[0];
  res.json({ id: row.id, document_id: doc.id, briefing_id: brief.id, issue_no });
});

module.exports = r;
