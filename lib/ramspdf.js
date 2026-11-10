// Renders a site RAMS (master content + site sheet) as a PDF in the Safety Simplified layout:
// a two-column method statement, the PC sign-off, the risk assessment table, COSHH assessments and the operative sign-off.
const PDFDocument = require('pdfkit');
const TOP = 64, BOT = 60; // header and footer bands; pdfkit margins are kept at 0 so it never adds pages on its own
const client = require('./client');

const INK = '#111', GREY = '#555', LINE = '#444', SHADE = '#e8e8e8';
const LABEL_W = 92, PAD = 6;

function render(master, site, { logo, signatures = [] } = {}) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 0, bottom: 0, left: 40, right: 40 }, bufferPages: true,
    info: { Title: `${client.company} RAMS ${site.project}`, Author: site.author || 'Safety Simplified Ltd' } });
  const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - BOT;
  const footers = [];

  // ---- page furniture (drawn at the end so page numbers are right) ----
  const furniture = (pageIndex, total, landscape) => {
    const pw = doc.page.width, w = pw - L - doc.page.margins.right;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(client.company, L, 22, { width: w, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(11).text(master.title || 'Method Statement & Risk Assessments', L, 37, { width: w, align: 'center' });
    const fy = doc.page.height - 48;
    doc.strokeColor(LINE).lineWidth(.6).rect(L, fy, w, 30).stroke();
    doc.moveTo(L, fy + 15).lineTo(L + w, fy + 15).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(INK);
    const cells = [[`Ref No: ${site.ref}`, `Issue No: ${site.issue_no}`, `Issue Date: ${site.issue_date_text}`, `Page: ${pageIndex + 1} of ${total}`],
      [`Author: ${site.author || ''}`, `Checked: ${site.reviewer || ''}`, `Next Review Date: ${site.review_text || ''}`, '']];
    cells.forEach((row, ri) => row.forEach((c, ci) => doc.text(c, L + 4 + ci * (w / 4), fy + 4 + ri * 15, { width: w / 4 - 8, lineBreak: false })));
  };

  // ---- helpers ----
  const newPage = (landscape) => { doc.addPage({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margins: { top: 0, bottom: 0, left: 40, right: 40 } }); };
  const blocksHeight = (blocks, width, font = 9.5) => {
    doc.font('Helvetica').fontSize(font);
    let h = 0;
    for (const b of blocks) {
      if (b.t === 'h') { doc.font('Helvetica-Bold'); h += doc.heightOfString(b.text, { width }) + 4; doc.font('Helvetica'); }
      else if (b.t === 'b') h += doc.heightOfString(b.text, { width: width - 12 }) + 2;
      else h += doc.heightOfString(b.text, { width }) + 4;
    }
    return h;
  };
  const drawBlocks = (blocks, x, y, width, font = 9.5) => {
    doc.font('Helvetica').fontSize(font).fillColor(INK);
    for (const b of blocks) {
      if (b.t === 'h') { doc.font('Helvetica-Bold').text(b.text, x, y, { width }); y = doc.y + 4; doc.font('Helvetica'); }
      else if (b.t === 'b') { doc.text('•', x + 2, y, { lineBreak: false }); doc.text(b.text, x + 12, y, { width: width - 12 }); y = doc.y + 2; }
      else { doc.text(b.text, x, y, { width }); y = doc.y + 4; }
    }
    return y;
  };
  const textBlocks = s => String(s || '').split(/\n/).map(t => t.trim()).filter(Boolean).map(t => ({ t: /^[•\-•]\s*/.test(t) ? 'b' : 'p', text: t.replace(/^[•\-•]\s*/, '') }));

  // A labelled row of the method statement table, split across pages as needed.
  let y = TOP;
  const row = (label, blocks) => {
    const contentW = W - LABEL_W - PAD * 2;
    let remaining = blocks.slice();
    let first = true;
    while (remaining.length) {
      const avail = bottom() - y - 6;
      if (avail < 40) { newPage(false); y = TOP; continue; }
      // take as many blocks as fit
      let take = [], h = 0;
      for (const b of remaining) {
        const bh = blocksHeight([b], contentW);
        if (h + bh > avail - 10 && take.length) break;
        take.push(b); h += bh;
        if (h > avail - 10) break;
      }
      // a single block taller than the page: let pdfkit flow it (rare, long paragraph)
      const rowH = Math.max(h + PAD * 2, 24);
      doc.strokeColor(LINE).lineWidth(.6).rect(L, y, W, rowH).stroke();
      doc.moveTo(L + LABEL_W, y).lineTo(L + LABEL_W, y + rowH).stroke();
      if (first) { doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(label, L + PAD, y + PAD, { width: LABEL_W - PAD * 2 }); first = false; }
      drawBlocks(take, L + LABEL_W + PAD, y + PAD, contentW);
      y += rowH;
      remaining = remaining.slice(take.length);
      if (remaining.length) { newPage(false); y = TOP; }
    }
  };
  const row4 = (l1, v1, l2, v2) => {
    const h = 24 + Math.max(doc.heightOfString(v1, { width: W / 2 - LABEL_W - 8 }), doc.heightOfString(v2 || '', { width: W / 2 - LABEL_W - 8 })) - 11;
    const rh = Math.max(h, 22);
    doc.strokeColor(LINE).lineWidth(.6).rect(L, y, W, rh).stroke();
    [LABEL_W, W / 2, W / 2 + LABEL_W].forEach(x => doc.moveTo(L + x, y).lineTo(L + x, y + rh).stroke());
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(l1, L + PAD, y + 6, { width: LABEL_W - 8 });
    doc.font('Helvetica').text(v1, L + LABEL_W + PAD, y + 6, { width: W / 2 - LABEL_W - 8 });
    doc.font('Helvetica-Bold').text(l2, L + W / 2 + PAD, y + 6, { width: LABEL_W - 8 });
    doc.font('Helvetica').text(v2 || '', L + W / 2 + LABEL_W + PAD, y + 6, { width: W / 2 - LABEL_W - 8 });
    y += rh;
  };
  const row2 = (label, value) => row(label, textBlocks(value));

  // ---- 1. front matter ----
  row4('Project:', site.project, 'Start Date:', site.start_text);
  row4('Client:', site.client, 'End Date:', site.end_text || 'TBC');
  row4('Author:', site.author, 'Reviewer:', site.reviewer);
  row2('Address:', site.address);
  row2('Scope of work:', site.scope);
  row4('Emergency contact:', site.emergency_contact, 'Site Supervisor:', site.site_supervisor);
  if (site.site_notes) row('Site-specific arrangements:', textBlocks(site.site_notes));

  // ---- 2. master sections ----
  const eq = master.sections.find(s => s.label === 'Equipment required'), mat = master.sections.find(s => s.label === 'Materials required');
  for (const s of master.sections) {
    if (s.label === 'Materials required') continue;
    if (s.label === 'Equipment required' && mat) {
      // side by side
      const half = (W - LABEL_W * 2) / 2 - PAD * 2;
      const h = Math.max(blocksHeight(eq.blocks, half), blocksHeight(mat.blocks, half)) + PAD * 2;
      if (y + h > bottom()) { newPage(false); y = TOP; }
      doc.strokeColor(LINE).lineWidth(.6).rect(L, y, W, h).stroke();
      [LABEL_W, W / 2, W / 2 + LABEL_W].forEach(x => doc.moveTo(L + x, y).lineTo(L + x, y + h).stroke());
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Equipment required:', L + PAD, y + PAD, { width: LABEL_W - 8 });
      drawBlocks(eq.blocks, L + LABEL_W + PAD, y + PAD, half);
      doc.font('Helvetica-Bold').fontSize(9).text('Materials required:', L + W / 2 + PAD, y + PAD, { width: LABEL_W - 8 });
      drawBlocks(mat.blocks, L + W / 2 + LABEL_W + PAD, y + PAD, half);
      y += h; continue;
    }
    row(s.label.replace(/\.$/, '') + ':', s.blocks);
  }

  // ---- 3. PC sign-off ----
  if (y + 150 > bottom()) { newPage(false); y = TOP; }
  y += 10;
  doc.strokeColor(LINE).rect(L, y, W, 22).stroke(); doc.rect(L, y, W, 22).fillAndStroke(SHADE, LINE);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Principal contractors sign off', L + PAD, y + 6); y += 22;
  const pcH = doc.font('Helvetica').fontSize(9).heightOfString(master.pc_signoff_text || '', { width: W - 12 }) + 12;
  doc.rect(L, y, W, pcH).stroke(); doc.text(master.pc_signoff_text || '', L + PAD, y + 6, { width: W - 12 }); y += pcH;
  const sig = [['Approved by contractor', 'Approved by Principal Contractor'], ['Name', 'Name'], ['Signature', 'Signature'], ['Date', 'Date']];
  sig.forEach((r, i) => {
    const h = i === 0 ? 20 : 26;
    doc.rect(L, y, W, h).stroke(); doc.moveTo(L + W / 2, y).lineTo(L + W / 2, y + h).stroke();
    if (i) { doc.moveTo(L + LABEL_W, y).lineTo(L + LABEL_W, y + h).stroke(); doc.moveTo(L + W / 2 + LABEL_W, y).lineTo(L + W / 2 + LABEL_W, y + h).stroke(); }
    doc.font(i ? 'Helvetica' : 'Helvetica-Bold').fontSize(9).text(r[0], L + PAD, y + 7).text(r[1], L + W / 2 + PAD, y + 7);
    y += h;
  });

  // ---- 4. risk assessments (landscape) ----
  newPage(true);
  const LW = doc.page.width - L - doc.page.margins.right;
  const cols = [['Activity', .14], ['Hazards identified', .13], ['L', .035], ['S', .035], ['RR', .04], ['Control Measures Required', .395], ['By whom', .07], ['Res.', .04], ['Persons at Risk', .115]];
  const widths = cols.map(c => Math.floor(LW * c[1]));
  let ry = TOP;
  const riskHeader = () => {
    doc.rect(L, ry, LW, 28).fillAndStroke(SHADE, LINE);
    let x = L; doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.5);
    cols.forEach((c, i) => { doc.text(c[0] + (c[0] === 'L' ? ' (1-3)' : c[0] === 'S' ? ' (1-3)' : c[0] === 'RR' ? ' (1-9)' : ''), x + 3, ry + 6, { width: widths[i] - 6, align: i >= 2 && i <= 4 || i === 7 ? 'center' : 'left' }); x += widths[i]; });
    ry += 28;
  };
  riskHeader();
  for (const r of master.risks) {
    const vals = [r.activity, r.hazards, String(r.likelihood), String(r.severity), String(r.rating), r.controls, r.by_whom, String(r.residual), r.persons];
    doc.font('Helvetica').fontSize(7.5);
    const h = Math.max(...vals.map((v, i) => doc.heightOfString(v, { width: widths[i] - 6 }))) + 8;
    if (ry + h > doc.page.height - BOT) { newPage(true); ry = TOP; riskHeader(); }
    let x = L;
    doc.rect(L, ry, LW, h).stroke();
    vals.forEach((v, i) => {
      doc.moveTo(x, ry).lineTo(x, ry + h).stroke();
      const centre = (i >= 2 && i <= 4) || i === 7;
      doc.fillColor(INK).text(v, x + 3, ry + 4, { width: widths[i] - 6, align: centre ? 'center' : 'left' });
      x += widths[i];
    });
    ry += h;
  }

  // ---- 5. COSHH ----
  for (const c of master.coshh) {
    newPage(false); let cy = TOP;
    const box = (label, text, shade) => {
      doc.font(shade ? 'Helvetica-Bold' : 'Helvetica').fontSize(shade ? 9.5 : 9);
      const h = doc.heightOfString(text, { width: W - 12 }) + 12;
      if (shade) doc.rect(L, cy, W, h).fillAndStroke(SHADE, LINE); else doc.rect(L, cy, W, h).stroke();
      doc.fillColor(INK).text(text, L + PAD, cy + 6, { width: W - 12 }); cy += h;
    };
    box('', 'COSHH Assessment', true);
    doc.rect(L, cy, W, 30).stroke(); doc.moveTo(L + W * .6, cy).lineTo(L + W * .6, cy + 30).stroke();
    doc.font('Helvetica-Bold').fontSize(9.5).text('Substance: ' + c.substance, L + PAD, cy + 10, { width: W * .6 - 12 });
    doc.font('Helvetica').fontSize(9).text('Hazard symbols: ' + (c.symbols || []).join(', '), L + W * .6 + PAD, cy + 10, { width: W * .4 - 12 }); cy += 30;
    box('', 'Health risks:', true); box('', c.health_risks);
    box('', 'First aid & emergency:', true); box('', c.first_aid);
    box('', 'PPE & Control requirements:', true); box('', c.controls);
    box('', 'Review', true); box('', c.review);
  }

  // ---- 6. operative sign-off ----
  newPage(false); let sy = TOP;
  doc.rect(L, sy, W, 22).fillAndStroke(SHADE, LINE); doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Operative sign off', L + PAD, sy + 6); sy += 22;
  doc.font('Helvetica').fontSize(9);
  const th = doc.heightOfString(master.operative_signoff_text || '', { width: W - 12 }) + 12;
  doc.rect(L, sy, W, th).stroke(); doc.text(master.operative_signoff_text || '', L + PAD, sy + 6, { width: W - 12 }); sy += th;
  const sc = [W * .38, W * .38, W * .24];
  const srow = (vals, bold) => { doc.rect(L, sy, W, 26).stroke(); let x = L; vals.forEach((v, i) => { if (i) doc.moveTo(x, sy).lineTo(x, sy + 26).stroke(); doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(v, x + PAD, sy + 8); x += sc[i]; }); sy += 26; };
  srow(['Name', 'Signature', 'Date'], true);
  // Electronic sign-offs from the portal go in first (name, drawn signature, date), then blank rows for anyone signing on paper.
  const ROW = 26, BOTTOM = doc.page.height - 60;
  const sigDate = d => new Date(d).toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  for (const sg of signatures) {
    if (sy + ROW > BOTTOM) { newPage(false); sy = TOP; srow(['Name', 'Signature', 'Date'], true); }
    const y0 = sy; srow([sg.name || '', '', sigDate(sg.signed_at)]);
    const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(sg.signature || '');
    if (m && m[1] !== 'webp') { try { doc.image(Buffer.from(m[2], 'base64'), L + sc[0] + PAD, y0 + 2, { fit: [sc[1] - 2 * PAD, ROW - 4], valign: 'center' }); } catch { /* bad image, leave the cell blank */ } }
  }
  for (let i = 0; i < Math.max(4, 12 - signatures.length); i++) { if (sy + ROW > BOTTOM) { newPage(false); sy = TOP; srow(['Name', 'Signature', 'Date'], true); } srow(['', '', '']); }
  doc.font('Helvetica').fontSize(8).fillColor(GREY).text(signatures.length ? `${signatures.length} signature${signatures.length === 1 ? '' : 's'} recorded electronically on the ${client.portal} portal and reproduced above.` : `Signatures are also recorded electronically on the ${client.portal} portal.`, L, sy + 8, { width: W });

  // ---- furniture on every page ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    furniture(i, range.count);
  }
  doc.end();
  return doc;
}

module.exports = { render };
