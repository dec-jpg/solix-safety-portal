// Tresor feed: a read-only summary of this portal for Safety Simplified's Tresor dashboard.
// Locked with TRESOR_KEY (set on Railway); nothing here is reachable without it.
const express = require('express');
const crypto = require('crypto');
const { q } = require('../lib/db');
const client = require('../lib/client');

const r = express.Router();
const EXPIRING_DAYS = 30;

r.use((req, res, next) => {
  const key = process.env.TRESOR_KEY, given = req.get('x-tresor-key') || '';
  if (!key || given.length !== key.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key))) return res.status(401).json({ error: 'Not authorised.' });
  next();
});

r.get('/summary', async (req, res) => {
  const latest = `SELECT DISTINCT ON (ql.operative_id, ql.qual_type_id) ql.operative_id, ql.qual_type_id, ql.expires_on
    FROM quals ql ORDER BY ql.operative_id, ql.qual_type_id, ql.expires_on DESC NULLS FIRST, ql.id DESC`;
  const counts = (await q(`SELECT
      (SELECT COUNT(*)::int FROM operatives WHERE active) AS operatives,
      (SELECT COUNT(*)::int FROM jobs WHERE status = 'live') AS live_jobs,
      (SELECT COUNT(*)::int FROM talks WHERE status = 'issued') AS open_talks,
      (SELECT COUNT(*)::int FROM signoffs WHERE operative_id IS NULL) AS unmatched,
      (SELECT COUNT(*)::int FROM (${latest}) l JOIN operatives o ON o.id = l.operative_id AND o.active JOIN qual_types t ON t.id = l.qual_type_id AND t.active
         WHERE l.expires_on < CURRENT_DATE) AS expired,
      (SELECT COUNT(*)::int FROM (${latest}) l JOIN operatives o ON o.id = l.operative_id AND o.active JOIN qual_types t ON t.id = l.qual_type_id AND t.active
         WHERE l.expires_on >= CURRENT_DATE AND l.expires_on <= CURRENT_DATE + ${EXPIRING_DAYS}) AS expiring,
      (SELECT COUNT(*)::int FROM operatives o CROSS JOIN qual_types t WHERE o.active AND t.active AND t.required
         AND NOT EXISTS (SELECT 1 FROM quals ql WHERE ql.operative_id = o.id AND ql.qual_type_id = t.id)) AS missing,
      (SELECT MAX(signed_at) FROM signoffs) AS last_signoff,
      (SELECT COUNT(*)::int FROM signoffs WHERE signed_at > NOW() - INTERVAL '30 days') AS signoffs_30d`)).rows[0];
  const talks = (await q(`SELECT t.ref, t.title, t.issued_at,
      (SELECT COUNT(DISTINCT s.operative_id)::int FROM signoffs s WHERE s.talk_id = t.id AND s.operative_id IS NOT NULL) AS signed,
      CASE WHEN t.job_id IS NULL THEN (SELECT COUNT(*)::int FROM operatives WHERE active)
           ELSE (SELECT COUNT(*)::int FROM job_operatives jo JOIN operatives o ON o.id = jo.operative_id AND o.active WHERE jo.job_id = t.job_id) END AS expected
      FROM talks t WHERE t.status = 'issued' ORDER BY t.issued_at DESC LIMIT 10`)).rows;
  const tickets = (await q(`SELECT o.full_name, t.name AS type_name, l.expires_on FROM (${latest}) l
      JOIN operatives o ON o.id = l.operative_id AND o.active JOIN qual_types t ON t.id = l.qual_type_id AND t.active
      WHERE l.expires_on <= CURRENT_DATE + ${EXPIRING_DAYS} ORDER BY l.expires_on LIMIT 25`)).rows;
  const recent = (await q(`SELECT s.signed_at, COALESCE(o.full_name, s.name_given) AS name, t.title AS talk, d.title AS doc
      FROM signoffs s LEFT JOIN operatives o ON o.id = s.operative_id LEFT JOIN talks t ON t.id = s.talk_id LEFT JOIN documents d ON d.id = s.document_id
      ORDER BY s.signed_at DESC LIMIT 8`)).rows;
  res.json({ company: client.company, short: client.short || client.company, portal: client.portal, colour: client.colour, counts, talks, tickets, recent, at: new Date().toISOString() });
});

module.exports = r;
