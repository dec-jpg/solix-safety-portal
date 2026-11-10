// Card scanner: a photo of a training card (CSCS, IPAF, PASMA, CPCS, first aid, any printed card) is read on the
// phone itself with Tesseract (no image leaves the device until the record is saved), and the card number, dates
// and training type are picked out of the text to pre-fill the training record. Always "pre-fill and check".
window.CardScan = (() => {
  const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };
  let worker = null;

  async function getWorker(onProgress) {
    if (worker) return worker;
    worker = await Tesseract.createWorker('eng', 1, {
      workerPath: '/vendor/tess/worker.min.js', corePath: '/vendor/tess/', langPath: '/vendor/tess/', gzip: true,
      logger: m => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); },
    });
    await worker.setParameters({ preserve_interword_spaces: '1' });
    return worker;
  }

  // Downscale, grey and sharpen the photo a little: faster and more accurate than a 12MP original.
  function prepare(file, max = 1800) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
        const upload = c.toDataURL('image/jpeg', 0.85);
        const d = ctx.getImageData(0, 0, c.width, c.height), p = d.data;
        for (let i = 0; i < p.length; i += 4) { const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; const v = Math.max(0, Math.min(255, (g - 128) * 1.25 + 128)); p[i] = p[i + 1] = p[i + 2] = v; }
        ctx.putImageData(d, 0, 0);
        URL.revokeObjectURL(img.src);
        resolve({ ocr: c, upload });
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  const pad = n => String(n).padStart(2, '0');
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const year4 = y => (y.length === 2 ? (Number(y) > 60 ? 1900 : 2000) + Number(y) : Number(y));
  const iso = (y, m, d) => (y >= 1990 && y <= 2060 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);

  // Every date-looking thing in the text, with the words just before it for context.
  function findDates(text) {
    const out = [];
    const push = (idx, raw, y, m, d, monthOnly) => { const v = iso(y, m, d); if (v) out.push({ idx, raw, iso: v, ctx: text.slice(Math.max(0, idx - 28), idx).toUpperCase(), monthOnly: !!monthOnly }); };
    let m;
    const r1 = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g;                       // 31/03/2029, 31.03.29
    while ((m = r1.exec(text))) push(m.index, m[0], year4(m[3]), Number(m[2]), Number(m[1]));
    const r2 = /\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{2,4})\b/gi;  // 12 Jan 2029
    while ((m = r2.exec(text))) push(m.index, m[0], year4(m[3]), MONTHS[m[2].toUpperCase()], Number(m[1]));
    const r3 = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{4})\b/gi;                  // Mar 2029 (end of month)
    while ((m = r3.exec(text))) { const y = Number(m[2]), mo = MONTHS[m[1].toUpperCase()]; push(m.index, m[0], y, mo, lastDay(y, mo), true); }
    const r4 = /(?<![\d\/.\-])(\d{2})[\/\-](\d{4})(?![\d\/.\-])/g;                                                  // 03/2029 (end of month)
    while ((m = r4.exec(text))) { const y = Number(m[2]), mo = Number(m[1]); push(m.index, m[0], y, mo, lastDay(y, mo), true); }
    // one entry per position
    const seen = new Set();
    return out.filter(x => { const k = x.idx + ':' + x.iso; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.idx - b.idx);
  }

  const EXP = /EXP|VALID (TO|UNTIL)|UNTIL|END|RENEW/;
  const ISS = /ISSU|FROM|START|DATE OF|AWARD|PASS|COMPLET|TRAIN/;

  function pickDates(text) {
    const ds = findDates(text), today = new Date().toISOString().slice(0, 10);
    let expires = ds.find(d => EXP.test(d.ctx)), issued = ds.find(d => ISS.test(d.ctx) && d !== expires);
    const rest = ds.filter(d => d !== expires && d !== issued);
    if (!expires) expires = [...rest].reverse().find(d => d.iso > today) || null;
    if (!issued) issued = rest.find(d => d.iso <= today && d !== expires) || null;
    // a card's issue date is before its expiry; if they came out the wrong way round, swap
    if (issued && expires && issued.iso > expires.iso) [issued, expires] = [expires, issued];
    return { issued: issued ? issued.iso : '', expires: expires ? expires.iso : '', dates: ds };
  }

  function pickNumber(text) {
    const t = text.replace(/[OoQ](?=\d)|(?<=\d)[OoQ]/g, '0').replace(/(?<=\d)[Il|](?=\d)/g, '1');
    const labelled = /(?:REG(?:ISTRATION)?\.?\s*(?:NO|NUMBER|#)?|CARD\s*(?:NO|NUMBER|#)|CERT(?:IFICATE)?\s*(?:NO|NUMBER|#)|LICEN[CS]E\s*(?:NO|NUMBER)?|ID\s*(?:NO|NUMBER)?|NO\.?|NUMBER|#)\s*[:.]?\s*([A-Z]{0,3}[\s\-]?\d[\d\s\-]{5,14}\d)/i.exec(t);
    if (labelled) return labelled[1].replace(/\s+/g, '').replace(/-+/g, '-');
    const dateSpans = findDates(t).map(d => [d.idx, d.idx + d.raw.length]);
    const runs = [...t.matchAll(/\b\d[\d ]{6,13}\d\b/g)].filter(m => !dateSpans.some(([a, b]) => m.index >= a && m.index < b)).map(m => m[0].replace(/\s+/g, ''));
    runs.sort((a, b) => b.length - a.length);
    return runs[0] || '';
  }

  // Which of this portal's training types the card is for, by keywords in the text.
  function pickType(text, types) {
    const T = text.toUpperCase();
    const rules = [
      [/\bCSCS\b|CONSTRUCTION SKILLS CERTIFICATION/, /cscs/i], [/\bIPAF\b|POWERED ACCESS/, /ipaf|mewp/i], [/\bPASMA\b/, /pasma/i], [/\bCPCS\b/, /cpcs/i], [/\bNPORS\b/, /npors/i],
      [/\bSSSTS\b|SITE SUPERVISOR/, /sssts|supervis/i], [/\bSMSTS\b|SITE MANAGEMENT SAFETY/, /smsts|site manag/i], [/EMERGENCY FIRST AID/, /emergency first aid|efaw/i], [/FIRST AID/, /first aid/i],
      [/ABRASIVE WHEEL/, /abrasive/i], [/MANUAL HANDLING/, /manual handling/i], [/WORKING AT HEIGHT|WORK AT HEIGHT/, /height/i], [/HARNESS/, /harness/i], [/ASBESTOS/, /asbestos/i],
      [/SILICA|DUST/, /silica|dust/i], [/FACE ?FIT/, /face ?fit/i], [/FIRE MARSHAL|FIRE WARDEN/, /fire/i], [/NEBOSH/, /nebosh/i], [/IOSH/, /iosh/i], [/CONFINED SPACE/, /confined/i],
      [/SCAFFOLD/, /scaffold|cisrs/i], [/BANKSMAN|SLINGER|SIGNALLER/, /banksman|slinger/i], [/TELEHANDLER|FORKLIFT|FORK LIFT/, /telehandler|forklift/i], [/NVQ|DIPLOMA|QCF|LEVEL [1-7]/, /nvq|diploma/i],
    ];
    for (const [re, typeRe] of rules) if (re.test(T)) { const t = types.find(x => typeRe.test(x.name)); if (t) return t; }
    return null;
  }

  const surname = n => (n || '').trim().split(/\s+/).pop().toUpperCase();

  async function scan(file, { types = [], operativeName = '', onProgress } = {}) {
    const [{ ocr, upload }, w] = await Promise.all([prepare(file), getWorker(onProgress)]);
    const { data } = await w.recognize(ocr);
    const text = (data.text || '').replace(/[ \t]+/g, ' ');
    const d = pickDates(text);
    const type = pickType(text, types);
    const sn = surname(operativeName);
    const nameMatch = sn ? (sn.length > 2 && text.toUpperCase().includes(sn)) : null;
    const b = atob(upload.split(',')[1]); const bytes = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
    const photo = new File([bytes], (file.name || 'card').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    return { text, number: pickNumber(text), issued: d.issued, expires: d.expires, type, nameMatch, confidence: data.confidence, photo, dates: d.dates.map(x => x.raw) };
  }

  return { scan, pickDates, pickNumber, pickType };
})();
