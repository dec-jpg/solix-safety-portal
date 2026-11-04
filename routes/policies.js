// Company policies: read in the portal, signed by the director, PDF for accreditations. Text comes from Tresor.
const express = require('express');
const PDFDocument = require('pdfkit');
const { q } = require('../lib/db');
const client = require('../lib/client');
const { requireUser } = require('../lib/auth');
const { clean, validImage } = require('../lib/util');
const policies = require('../lib/policies');

const r = express.Router();
const view = requireUser();
const admin = requireUser('admin');
const owner = requireUser('owner');

r.get('/', view, async (req, res) => {
  const c = await policies.current();
  if (!c) return res.json({ version: null, policies: [], needs_signature: false, signings: [] });
  const signings = (await q('SELECT id, version, signed_name, signed_role, signed_at FROM policy_signings ORDER BY signed_at DESC')).rows;
  res.json({ ...c, signings, about_editable: req.user.role === 'owner' });
});

r.post('/sync', owner, async (req, res) => res.json(await policies.sync()));

r.put('/about', owner, async (req, res) => {
  const v = clean((req.body || {}).about, 400);
  await q("INSERT INTO settings (key, value) VALUES ('about', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [v]);
  res.json({ ok: true });
});

// The director signs the current version: typed name, role and a drawn signature.
r.post('/sign', admin, async (req, res) => {
  const c = await policies.current();
  if (!c) return res.status(400).json({ error: 'No policies to sign yet.' });
  const b = req.body || {};
  if (!clean(b.name)) return res.status(400).json({ error: 'Type your name as it should appear on the policies.' });
  if (!validImage(b.signature, 400_000)) return res.status(400).json({ error: 'Sign in the box.' });
  await q('INSERT INTO policy_signings (version, signed_name, signed_role, signature, signed_by_user) VALUES ($1,$2,$3,$4,$5)', [c.version, clean(b.name, 120), clean(b.role, 80) || 'Director', b.signature, req.user.name]);
  res.json({ ok: true });
});

r.get('/signings/:id/signature', view, async (req, res) => {
  const s = (await q('SELECT signature FROM policy_signings WHERE id = $1', [req.params.id])).rows[0];
  if (!s) return res.status(404).end();
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(s.signature);
  if (!m) return res.status(404).end();
  res.type(m[1]).send(Buffer.from(m[2], 'base64'));
});

// The pack as a PDF: every policy, then the signature page.
r.get('/pdf', view, async (req, res) => {
  const c = await policies.current();
  if (!c) return res.status(404).send('No policies yet.');
  const sig = c.signed ? (await q('SELECT signature FROM policy_signings WHERE id = $1', [c.signed.id])).rows[0] : null;
  const doc = new PDFDocument({ size: 'A4', margins: { top: 0, bottom: 0, left: 50, right: 50 }, bufferPages: true, info: { Title: `${client.company} Company Policies v${c.version}`, Author: 'Safety Simplified Ltd' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${client.company.replace(/[^\w ]+/g, '')} - Company Policies v${c.version}.pdf"`);
  doc.pipe(res);
  const L = 50, W = doc.page.width - 100, TOP = 60, BOT = 60, colour = client.colour || '#1f3a5f';
  let y = TOP;
  const need = h => { if (y + h > doc.page.height - BOT) { doc.addPage(); y = TOP; } };
  const para = (text, font = 'Helvetica', size = 10.5, gap = 7) => { doc.font(font).fontSize(size); const h = doc.heightOfString(text, { width: W }); need(h); doc.fillColor('#111').text(text, L, y, { width: W }); y += h + gap; };
  // cover
  doc.rect(0, 0, doc.page.width, 8).fill(colour);
  y = 160; doc.font('Helvetica-Bold').fontSize(26).fillColor('#111').text(client.company, L, y, { width: W }); y = doc.y + 6;
  doc.font('Helvetica').fontSize(16).fillColor('#444').text('Company Policies', L, y); y = doc.y + 30;
  doc.fontSize(11).fillColor('#111').text(`Version ${c.version}${c.published_at ? `, issued ${new Date(c.published_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}` : ''}`, L, y); y = doc.y + 4;
  doc.text(c.signed ? `Signed by ${c.signed.signed_name}, ${c.signed.signed_role || 'Director'}, on ${new Date(c.signed.signed_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}` : 'Not yet signed', L, y); y = doc.y + 30;
  doc.font('Helvetica-Bold').fontSize(11).text('Contents', L, y); y = doc.y + 6;
  c.policies.forEach((p, i) => { doc.font('Helvetica').fontSize(10.5).text(`${i + 1}. ${p.title}`, L + 10, y); y = doc.y + 2; });
  doc.font('Helvetica').fontSize(9).fillColor('#666').text('Prepared by Safety Simplified Ltd', L, doc.page.height - 80, { width: W });
  // policies
  c.policies.forEach((p, i) => {
    doc.addPage(); y = TOP;
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111').text(`${i + 1}. ${p.title}`, L, y, { width: W }); y = doc.y + 4;
    doc.rect(L, y, 60, 2.5).fill(colour); y += 16;
    for (const b of p.blocks) {
      if (b.t === 'h') { y += 4; para(b.text, 'Helvetica-Bold', 11.5, 5); }
      else if (b.t === 'ul') for (const it of b.items) { doc.font('Helvetica').fontSize(10.5); const h = doc.heightOfString(it, { width: W - 16 }); need(h); doc.fillColor('#111').text('•', L + 2, y, { lineBreak: false }); doc.text(it, L + 16, y, { width: W - 16 }); y += h + 3; }
      else para(b.text);
    }
  });
  // signature page
  doc.addPage(); y = TOP;
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111').text('Authorisation', L, y); y = doc.y + 4; doc.rect(L, y, 60, 2.5).fill(colour); y += 18;
  para(`These policies are approved by and issued under the authority of the director of ${client.company}. They are reviewed at least annually and whenever the business, the law or the work changes, with the current version published on the ${client.portal || 'company'} portal.`);
  y += 10;
  doc.strokeColor('#999').lineWidth(.6).rect(L, y, W, 150).stroke();
  if (c.signed) {
    doc.font('Helvetica').fontSize(10.5).fillColor('#111').text(`Name: ${c.signed.signed_name}`, L + 14, y + 14).text(`Position: ${c.signed.signed_role || 'Director'}`, L + 14, y + 32)
      .text(`Date: ${new Date(c.signed.signed_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`, L + 14, y + 50).text(`Policies version ${c.version}`, L + 14, y + 68);
    if (sig) { const m = /^data:image\/\w+;base64,(.+)$/.exec(sig.signature); if (m) { try { doc.image(Buffer.from(m[1], 'base64'), L + W - 230, y + 20, { fit: [200, 100] }); } catch { /* ignore */ } } }
    doc.font('Helvetica').fontSize(8.5).fillColor('#666').text('Signed electronically on the portal', L + W - 230, y + 128);
  } else {
    doc.font('Helvetica').fontSize(10.5).fillColor('#111').text('Name:', L + 14, y + 14).text('Position:', L + 14, y + 50).text('Signature:', L + 14, y + 86).text('Date:', L + 14, y + 122);
  }
  // footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor('#777').text(`${client.company} · Company Policies v${c.version} · Page ${i + 1} of ${range.count}`, L, doc.page.height - 36, { width: W, align: 'center', lineBreak: false });
  }
  doc.end();
});

module.exports = r;
