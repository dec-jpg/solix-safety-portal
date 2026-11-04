// Training matrix as a PDF: landscape A4, one row per operative, one column per training type, colour-coded like the screen.
const PDFDocument = require('pdfkit');
const client = require('./client');

const COL = { ok: '#1e7a4a', okBg: '#e6f3ec', warn: '#b26a00', warnBg: '#fdf1dc', bad: '#b3261e', badBg: '#fbe7e5', ink: '#18201b', faint: '#6b746f', line: '#d9d4c9' };
const fmt = d => (d ? d.split('-').reverse().join('/') : '');

function render(m, { title, subtitle }) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 20, bottom: 12, left: 28, right: 28 }, info: { Title: title, Author: 'Safety Simplified Ltd' } });
  const W = doc.page.width - 56, left = 28;
  const many = m.types.length > 10;
  const nameW = many ? 118 : 150, roleW = many ? 72 : 90, typeW = (W - nameW - roleW) / Math.max(m.types.length, 1);
  const rowH = 22, headH = 44;
  const brand = client.colour || '#1f3a5f';

  const header = () => {
    doc.fillColor(COL.ink).font('Helvetica-Bold').fontSize(15).text(title, left, 24);
    doc.font('Helvetica').fontSize(9).fillColor(COL.faint).text(subtitle, left, 42);
    doc.fillColor(brand).rect(left, 58, W, 2).fill();
    let y = 68;
    doc.rect(left, y, W, headH).fill('#f3f1ec');
    doc.fillColor(COL.ink).font('Helvetica-Bold').fontSize(8);
    doc.text('NAME', left + 6, y + 6, { width: nameW - 8 });
    doc.text('ROLE', left + nameW + 2, y + 6, { width: roleW - 4 });
    m.types.forEach((t, i) => doc.fontSize(many ? 6.5 : 8).text((t.name + (t.required ? ' *' : '')).toUpperCase(), left + nameW + roleW + i * typeW + 2, y + 5, { width: typeW - 4, align: 'center', height: headH - 8, ellipsis: true }));
    return y + headH;
  };
  const footer = () => {
    doc.font('Helvetica').fontSize(7.5).fillColor(COL.faint)
      .text(`* required for everyone · Prepared by Safety Simplified Ltd for ${client.company} · ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`, left, doc.page.height - 22, { width: W, align: 'center', lineBreak: false });
  };

  let y = header();
  doc.on('pageAdded', () => { y = header(); });
  m.operatives.forEach((o, idx) => {
    if (y + rowH > doc.page.height - 30) { footer(); doc.addPage(); }
    if (idx % 2) doc.rect(left, y, W, rowH).fill('#faf9f6');
    doc.fillColor(COL.ink).font('Helvetica-Bold').fontSize(8.5).text(o.full_name, left + 6, y + 7, { width: nameW - 8, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(8).fillColor(COL.faint).text(o.role || '', left + nameW + 2, y + 7, { width: roleW - 4, lineBreak: false, ellipsis: true });
    m.types.forEach((t, i) => {
      const c = (m.cells[o.id] || {})[t.id];
      const x = left + nameW + roleW + i * typeW;
      let text = '', fg = COL.faint, bg = null;
      if (c) {
        if (!c.expires_on) { text = 'Held'; fg = COL.ok; bg = COL.okBg; }
        else if (c.status === 'expired') { text = fmt(c.expires_on); fg = COL.bad; bg = COL.badBg; }
        else if (c.status === 'expiring') { text = fmt(c.expires_on); fg = COL.warn; bg = COL.warnBg; }
        else { text = fmt(c.expires_on); fg = COL.ok; bg = COL.okBg; }
      } else if (t.required) { text = 'Missing'; fg = COL.bad; bg = COL.badBg; }
      if (bg) { doc.rect(x + 2, y + 3, typeW - 4, rowH - 6).fill(bg); }
      if (text) doc.fillColor(fg).font('Helvetica-Bold').fontSize(many ? 6.8 : 7.5).text(text, x + 2, y + 8, { width: typeW - 4, align: 'center', lineBreak: false });
    });
    doc.strokeColor(COL.line).lineWidth(.5).moveTo(left, y + rowH).lineTo(left + W, y + rowH).stroke();
    y += rowH;
  });
  footer();
  doc.end();
  return doc;
}

module.exports = { render };
