// Safety portal: people and training matrix, toolbox talks, job RAMS and site packs.
// Client-specific build: see /client.
const express = require('express');
const path = require('path');
const { migrate } = require('./lib/db');
const { loadSecret } = require('./lib/auth');
const { css, publicBrand } = require('./lib/brand');
const client = require('./lib/client');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/p', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));

// Branding, from this client's build
app.get('/api/brand', (req, res) => res.json(publicBrand()));
app.get('/brand.css', (req, res) => res.type('text/css').set('Cache-Control', 'no-cache').send(css()));
app.get('/logo', (req, res) => {
  if (!client.logo) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=3600').type(client.logo.type).sendFile(client.logo.file);
});

const pub = path.join(__dirname, 'public');
app.use(express.static(pub, { index: false, maxAge: '1h' }));
app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.get(['/t/:token', '/j/:token'], (req, res) => res.sendFile(path.join(pub, 'op.html')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'That file is over 20 MB.' });
  res.status(500).json({ error: 'Something went wrong on the server. Try again, and if it keeps happening let Safety Simplified know.' });
});

(async () => {
  await migrate();
  await loadSecret();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Portal listening on ${port}`));
})().catch(e => { console.error('Startup failed:', e); process.exit(1); });
