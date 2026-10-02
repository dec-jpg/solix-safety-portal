// Contractor compliance portal: operatives and training matrix, toolbox talks, job RAMS and site packs.
// One codebase for every client. Branding and training types are set inside the portal.
const express = require('express');
const path = require('path');
const { migrate } = require('./lib/db');
const { loadSecret } = require('./lib/auth');
const { getBrand, css, wordmark } = require('./lib/brand');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/p', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));

// Branding
app.get('/api/brand', async (req, res, next) => {
  try { const b = await getBrand(); res.json({ name: b.company_name, colour: b.brand_colour, has_logo: !!b.logo }); } catch (e) { next(e); }
});
app.get('/brand.css', async (req, res, next) => {
  try { res.type('text/css').set('Cache-Control', 'no-cache').send(css(await getBrand())); } catch (e) { next(e); }
});
app.get('/logo', async (req, res, next) => {
  try {
    const b = await getBrand();
    res.set('Cache-Control', 'no-cache');
    const m = b.logo && b.logo.match(/^data:(image\/[\w+.-]+);base64,(.*)$/);
    if (m) return res.type(m[1]).send(Buffer.from(m[2], 'base64'));
    res.type('image/svg+xml').send(wordmark(b.company_name));
  } catch (e) { next(e); }
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
