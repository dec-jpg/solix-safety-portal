// Training expiry reminders: a digest email once a week (Monday morning, Europe/London) listing cards that have
// expired, cards expiring in the next 30 days, and anyone missing a required card. Sent through Resend
// (RESEND_API_KEY and MAIL_FROM on Railway). Recipients are kept in settings and edited from the Users page;
// until they are set, every active admin and Safety Simplified login gets it.
const { q } = require('./db');
const client = require('./client');
const { getSetting, setSetting } = require('./brand');

const EXPIRING_DAYS = 30;
const SEND_DAY = 1;      // Monday
const SEND_HOUR = 7;     // 07:00 London

const london = (d = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).map(p => [p.type, p.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), hour: parseInt(parts.hour, 10) % 24, date: `${parts.year}-${parts.month}-${parts.day}` };
};
const fDate = iso => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function recipients() {
  const saved = (await getSetting('reminder_emails')).split(/[,\s;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  if (saved.length) return saved;
  return (await q("SELECT email FROM users WHERE active AND role IN ('admin','owner') ORDER BY email")).rows.map(u => u.email);
}

// What the digest would say right now.
async function gather() {
  const latest = `SELECT DISTINCT ON (ql.operative_id, ql.qual_type_id) ql.operative_id, ql.qual_type_id, ql.expires_on
      FROM quals ql ORDER BY ql.operative_id, ql.qual_type_id, ql.expires_on DESC NULLS FIRST, ql.id DESC`;
  const rows = (await q(`SELECT o.full_name, t.name AS type_name, l.expires_on, (l.expires_on < CURRENT_DATE) AS expired
      FROM (${latest}) l JOIN operatives o ON o.id = l.operative_id AND o.active AND NOT o.office JOIN qual_types t ON t.id = l.qual_type_id AND t.active
      WHERE l.expires_on IS NOT NULL AND l.expires_on <= CURRENT_DATE + ${EXPIRING_DAYS} ORDER BY l.expires_on, o.full_name`)).rows;
  const missing = (await q(`SELECT o.full_name, t.name AS type_name FROM operatives o CROSS JOIN qual_types t
      WHERE o.active AND NOT o.office AND t.active AND t.required AND NOT EXISTS (SELECT 1 FROM quals ql WHERE ql.operative_id = o.id AND ql.qual_type_id = t.id)
      ORDER BY o.full_name, t.sort`)).rows;
  return { expired: rows.filter(r => r.expired), expiring: rows.filter(r => !r.expired), missing };
}

function render(d, portalUrl) {
  const table = rows => `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:6px 0 18px">
    ${rows.map(r => `<tr><td style="border-bottom:1px solid #e6e6e6"><b>${esc(r.full_name)}</b></td><td style="border-bottom:1px solid #e6e6e6">${esc(r.type_name)}</td><td style="border-bottom:1px solid #e6e6e6;color:#666">${r.expires_on ? fDate(r.expires_on) : ''}</td></tr>`).join('')}</table>`;
  const h = (t, n) => `<h3 style="font:bold 15px Arial,sans-serif;margin:18px 0 4px">${t} (${n})</h3>`;
  const total = d.expired.length + d.expiring.length + d.missing.length;
  const html = `<div style="font:14px Arial,sans-serif;color:#222;max-width:640px">
    <p style="font-size:16px"><b>${esc(client.portal)}</b>: training cards this week</p>
    ${total ? '' : '<p>Nothing expired, nothing expiring in the next 30 days, and nobody missing a required card.</p>'}
    ${d.expired.length ? h('Expired', d.expired.length) + table(d.expired) : ''}
    ${d.expiring.length ? h(`Expiring in the next ${EXPIRING_DAYS} days`, d.expiring.length) + table(d.expiring) : ''}
    ${d.missing.length ? h('Missing a required card', d.missing.length) + table(d.missing) : ''}
    <p style="margin-top:20px"><a href="${esc(portalUrl)}/admin#/matrix" style="color:#1f3a5f">Open the training matrix</a> to update records or add the new card.</p>
    <p style="color:#777;font-size:12px;margin-top:24px">Sent every Monday by the ${esc(client.portal)} portal, built and supported by Safety Simplified Ltd. Recipients are set on the portal's Users page.</p></div>`;
  const text = [`${client.portal}: training cards this week`, '',
    ...(total ? [] : ['Nothing expired, nothing expiring in the next 30 days, and nobody missing a required card.']),
    ...(d.expired.length ? [`EXPIRED (${d.expired.length})`, ...d.expired.map(r => `  ${r.full_name}: ${r.type_name}, ${fDate(r.expires_on)}`), ''] : []),
    ...(d.expiring.length ? [`EXPIRING IN THE NEXT ${EXPIRING_DAYS} DAYS (${d.expiring.length})`, ...d.expiring.map(r => `  ${r.full_name}: ${r.type_name}, ${fDate(r.expires_on)}`), ''] : []),
    ...(d.missing.length ? [`MISSING A REQUIRED CARD (${d.missing.length})`, ...d.missing.map(r => `  ${r.full_name}: ${r.type_name}`), ''] : []),
    `Training matrix: ${portalUrl}/admin#/matrix`].join('\n');
  const subject = total ? `${client.short || client.company}: ${[d.expired.length && `${d.expired.length} expired`, d.expiring.length && `${d.expiring.length} expiring soon`, d.missing.length && `${d.missing.length} missing`].filter(Boolean).join(', ')}` : `${client.short || client.company}: training cards all in date`;
  return { subject, html, text, total };
}

const configured = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

async function deliver(to, msg) {
  if (!configured()) throw new Error('Email is not set up on this portal yet (RESEND_API_KEY and MAIL_FROM).');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to, subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (!r.ok) throw new Error(`Resend said ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Send the digest now. skipEmpty: the weekly run stays quiet when there is nothing to say.
async function send({ skipEmpty = false, portalUrl } = {}) {
  const to = await recipients();
  if (!to.length) return { sent: false, reason: 'No recipients set and no admin logins to fall back on.' };
  const d = await gather();
  const msg = render(d, portalUrl || process.env.PUBLIC_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN || ''}`);
  if (skipEmpty && !msg.total) { await setSetting('reminder_last', london().date); return { sent: false, reason: 'Nothing to report.', to }; }
  await deliver(to, msg);
  await setSetting('reminder_last', london().date);
  return { sent: true, to, subject: msg.subject, counts: { expired: d.expired.length, expiring: d.expiring.length, missing: d.missing.length } };
}

function schedule() {
  if (!configured()) { console.log('Reminders: email not configured (RESEND_API_KEY, MAIL_FROM), weekly digest off'); return; }
  const tick = async () => {
    try {
      const now = london();
      if (now.day !== SEND_DAY || now.hour < SEND_HOUR) return;
      if ((await getSetting('reminder_last')) === now.date) return;
      const r = await send({ skipEmpty: true });
      console.log('Reminders:', r.sent ? `sent to ${r.to.join(', ')} (${r.subject})` : r.reason);
    } catch (e) { console.error('Reminders failed:', e.message); }
  };
  tick(); setInterval(tick, 20 * 60 * 1000).unref();
}

module.exports = { recipients, gather, render, send, schedule, configured, EXPIRING_DAYS };
