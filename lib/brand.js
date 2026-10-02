// Branding comes from this client's build (client/config.json and client/logo.*), not from settings.
const client = require('./client');
const { q } = require('./db');

const hex = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#1f3a5f');
function shade(c, f) {
  const n = parseInt(hex(c).slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
  return '#' + ch.map(v => v.toString(16).padStart(2, '0')).join('');
}
function css() {
  const c = hex(client.colour);
  return `:root{--oak:${c};--oak-2:${shade(c, client.dark ? 0.25 : -0.18)};--tint:${shade(c, 0.9)};}`;
}
const publicBrand = () => ({ name: client.company, portal: client.portal, terms: client.terms, short: client.short || client.company });

// Settings that Safety Simplified manages per client (currently just the Direct Debit link).
async function getSetting(key) { return ((await q('SELECT value FROM settings WHERE key = $1', [key])).rows[0] || {}).value || ''; }
async function setSetting(key, value) { await q('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]); }

module.exports = { css, publicBrand, getSetting, setSetting };
