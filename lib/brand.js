// Client branding, held in the settings table so one codebase serves every client.
const { q } = require('./db');

const DEFAULTS = { company_name: process.env.COMPANY_NAME || 'Company portal', brand_colour: process.env.BRAND_COLOUR || '#1f3a5f' };
let cache = null;

async function getBrand() {
  if (cache) return cache;
  const rows = (await q("SELECT key, value FROM settings WHERE key IN ('company_name','brand_colour','logo','dd_link')")).rows;
  const b = { ...DEFAULTS, logo: null };
  rows.forEach(r => { if (r.value) b[r.key] = r.value; });
  cache = b;
  return b;
}

async function setBrand(values) {
  for (const [k, v] of Object.entries(values)) {
    await q('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, v]);
  }
  cache = null;
}

const hex = c => (/^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULTS.brand_colour);
function shade(c, f) {
  // f < 0 darkens towards black, f > 0 lightens towards white
  const n = parseInt(hex(c).slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
  return '#' + ch.map(v => v.toString(16).padStart(2, '0')).join('');
}

function css(b) {
  const c = hex(b.brand_colour);
  return `:root{--oak:${c};--oak-2:${shade(c, 0.18)};--tint:${shade(c, 0.9)};}`;
}

// Text wordmark used until a logo is uploaded.
function wordmark(name) {
  const t = String(name).replace(/[&<>"]/g, '');
  const w = Math.max(120, Math.round(t.length * 13.5) + 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="32" viewBox="0 0 ${w} 32"><text x="0" y="24" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#18201b">${t}</text></svg>`;
}

module.exports = { getBrand, setBrand, css, wordmark, hex };
