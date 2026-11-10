// Office side.
(() => {
  const root = document.getElementById('root');
  const dlg = document.getElementById('dlg');
  let me = null;
  let brand = { name: '', portal: 'Safety portal', terms: { op: 'operative', ops: 'operatives' } };
  const cache = { ops: null, types: null, jobs: null };

  // ---------- helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tz = { timeZone: 'Europe/London' };
  const fDate = d => {
    if (!d) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, dd] = d.split('-'); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
    return new Date(d).toLocaleDateString('en-GB', { ...tz, day: '2-digit', month: 'short', year: 'numeric' });
  };
  const fTime = d => (d ? new Date(d).toLocaleTimeString('en-GB', { ...tz, hour: '2-digit', minute: '2-digit' }) : '');
  const fDT = d => (d ? `${fDate(d)} ${fTime(d)}` : '');
  const shortDate = d => (d ? d.split('-').reverse().join('/').replace(/^(\d\d\/\d\d\/)\d\d(\d\d)$/, '$1$2') : '');
  const canEdit = () => me && me.role !== 'viewer';
  const isAdmin = () => me && (me.role === 'admin' || me.role === 'owner');
  const isOwner = () => me && me.role === 'owner';
  // Wording: {op} {ops} {Op} {Ops} become the word for the team on site.
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
  const tx = html => String(html).replace(/\{(op|ops|Op|Ops)\}/g, (_, k) => { const t = brand.terms || { op: 'operative', ops: 'operatives' }; return k === 'Op' ? cap(t.op) : k === 'Ops' ? cap(t.ops) : t[k]; });
  const addMonths = (iso, m) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + Number(m)); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

  async function api(path, opts = {}) {
    const init = { method: opts.method || (opts.body || opts.form ? 'POST' : 'GET'), headers: {} };
    if (opts.form) init.body = opts.form;
    else if (opts.body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    const res = await fetch(path.startsWith('/api') ? path : '/api/admin' + path, init);
    let data = {};
    try { data = await res.json(); } catch { /* not json */ }
    if (res.status === 401 && !path.startsWith('/api/auth')) { me = null; showLogin(); throw new Error('Log in to continue.'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    return data;
  }
  async function ops(force) { if (!cache.ops || force) cache.ops = (await api('/operatives')).rows; return cache.ops; }
  async function types(force) { if (!cache.types || force) cache.types = (await api('/qual-types')).rows; return cache.types; }
  async function jobs(force) { if (!cache.jobs || force) cache.jobs = (await api('/jobs')).rows; return cache.jobs; }
  const bust = () => { cache.ops = cache.types = cache.jobs = null; };

  const main = () => document.getElementById('main');
  const setMain = html => { main().innerHTML = tx(html); };
  function flash(msg, kind = 'ok') {
    const n = document.createElement('div'); n.className = `note ${kind} no-print`; n.textContent = tx(msg);
    main().prepend(n); setTimeout(() => n.remove(), kind === 'err' ? 7000 : 3500);
  }
  function dlgErr(msg) {
    let n = dlg.querySelector('.dlg-body .note.err');
    if (!n) { n = document.createElement('div'); n.className = 'note err'; dlg.querySelector('.dlg-body').prepend(n); }
    n.textContent = msg; n.scrollIntoView({ block: 'nearest' });
  }
  function openDlg(title, body, foot = '') {
    dlg.innerHTML = tx(`<div class="dlg-head"><h2>${esc(title)}</h2><button class="btn quiet" data-close aria-label="Close">Close</button></div>
      <div class="dlg-body">${body}</div>${foot ? `<div class="dlg-foot">${foot}</div>` : ''}`);
    dlg.querySelectorAll('[data-close]').forEach(b => (b.onclick = () => dlg.close()));
    if (!dlg.open) dlg.showModal();
    return dlg;
  }
  const $d = sel => dlg.querySelector(sel);
  const val = sel => { const el = $d(sel); return el ? el.value : null; };
  const v = id => document.getElementById(id).value;
  const field = (label, html, hint) => `<div class="field"><label>${label}${hint ? ` <span class="hint">${hint}</span>` : ''}</label>${html}</div>`;
  const input = (id, value, type = 'text', extra = '') => `<input id="${id}" type="${type}" value="${esc(value ?? '')}" ${extra}>`;
  const opt = (rows, sel, label = 'name') => rows.map(r => `<option value="${r.id}" ${String(sel) === String(r.id) ? 'selected' : ''}>${esc(r[label])}</option>`).join('');
  function copy(text, btn) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => { if (btn) { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = t), 1500); } })
      .catch(() => prompt('Copy this link', text));
  }
  function sigImg(id) { return `<img src="/api/admin/signoffs/${id}/signature" alt="Signature" style="height:34px;display:block">`; }
  function shareBox(url, qrPath, whatsappText) {
    return `<div class="linkbox"><input readonly value="${esc(url)}" onclick="this.select()"><button class="btn small" data-copy="${esc(url)}">Copy link</button>
      <a class="btn small ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(whatsappText + '\n' + url)}">Send on WhatsApp</a>
      <a class="btn small quiet" href="${qrPath}" download="qr.svg">Download QR</a></div>`;
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-copy]'); if (b) copy(b.dataset.copy, b); });

  // ---------- login ----------
  async function boot() {
    try { brand = await (await fetch('/api/brand')).json(); } catch { /* defaults */ }
    document.title = brand.portal;
    const s = await api('/api/auth/state');
    if (s.user) { me = s.user; return shell(); }
    showLogin(s);
  }

  async function showLogin(state) {
    const s = state || await api('/api/auth/state');
    const logo = `<img src="/logo" alt="${esc(brand.name)}" onerror="this.remove()"><div class="sub">${esc(brand.portal)}</div>`;
    if (s.needsSetup) {
      root.innerHTML = `<div class="login-wrap"><div class="login-card">${logo}<h1>Set up the portal</h1>
        ${s.setupEnabled ? `<p class="muted">Create the first admin account. Everyone else is added from inside the portal.</p><div id="msg"></div>
          ${field('Setup key', input('k', '', 'password'))}${field('Your name', input('n', '', 'text', 'autocomplete="name"'))}
          ${field('Email', input('e', '', 'email', 'autocomplete="email"'))}${field('Password', input('p', '', 'password', 'autocomplete="new-password"'), 'at least 8 characters')}
          <button class="btn big" id="go">Create admin account</button>`
          : '<div class="note warn">Add a SETUP_KEY variable to this service on Railway, redeploy, then reload this page.</div>'}</div></div>`;
      const go = document.getElementById('go');
      if (go) go.onclick = async () => {
        try { const r = await api('/api/auth/setup', { body: { setup_key: v('k'), name: v('n'), email: v('e'), password: v('p') } }); me = r.user; shell(); }
        catch (e) { document.getElementById('msg').innerHTML = `<div class="note err">${esc(e.message)}</div>`; }
      };
      return;
    }
    root.innerHTML = `<div class="login-wrap"><div class="login-card">${logo}<h1>Log in</h1><div id="msg"></div>
      ${field('Email', input('e', '', 'email', 'autocomplete="username"'))}${field('Password', input('p', '', 'password', 'autocomplete="current-password"'))}
      <button class="btn big" id="go">Log in</button></div></div>`;
    const go = async () => {
      try { const r = await api('/api/auth/login', { body: { email: v('e'), password: v('p') } }); me = r.user; shell(); }
      catch (e) { document.getElementById('msg').innerHTML = `<div class="note err">${esc(e.message)}</div>`; }
    };
    document.getElementById('go').onclick = go;
    document.getElementById('p').onkeydown = e => { if (e.key === 'Enter') go(); };
  }

  // ---------- shell & routing ----------
  const ICONS = {
    '': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    operatives: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    matrix: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 2.5 2.5 6 2.5s6-1.5 6-2.5v-5"/>',
    jobs: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/>',
    talks: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
    unmatched: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    policies: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    ramsmaster: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/>',
    health: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/><path d="M3.5 12h4l1.5-3 3 6 1.5-3h4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
  };
  const NAV = [
    ['Overview'], ['', 'Dashboard'],
    ['People'], ['operatives', '{Ops}'], ['matrix', 'Training matrix'], ['health', 'Occupational health', 'admin'],
    ['Site work'], ['jobs', 'Jobs & RAMS'], ['talks', 'Toolbox talks'], ['unmatched', 'Signatures to match'],
    ['Company'], ['policies', 'Policies'],
    ['Admin', 'admin'], ['users', 'Users', 'admin'], ['ramsmaster', 'RAMS master', 'owner'], ['settings', 'Safety Simplified', 'owner'],
  ];
  const CRUMB = { '': 'Health & safety overview', operatives: 'Your {ops} and their details', matrix: 'Cards, tickets and expiry dates', jobs: 'RAMS, drawings and sign-off per job',
    talks: 'Issue, sign and track', unmatched: 'Signatures from people not on the register', settings: 'Training list and account settings', users: 'Office logins', policies: 'Company policies, kept current by Safety Simplified and signed by the director', ramsmaster: 'The company method statement, risk assessments and COSHH that every site RAMS is built from', health: 'HAVS, noise and skin questionnaires: confidential, seen by admins and Safety Simplified only' };

  function shell() {
    const allowed = r => !r || (r === 'owner' ? isOwner() : isAdmin());
    const items = NAV.filter(n => (n.length === 1 || n[1] === 'admin' ? allowed(n[1]) : allowed(n[2]))).map(n => (n.length === 1 || n[1] === 'admin' && n.length === 2
      ? `<div class="nav-label">${n[0]}</div>`
      : `<a href="#/${n[0]}" data-nav="${n[0]}"><svg class="ic" viewBox="0 0 24 24">${ICONS[n[0]]}</svg>${esc(n[1])}<span class="count hidden" data-count="${n[0]}"></span></a>`)).join('');
    root.innerHTML = tx(`<div class="ad-shell"><aside class="ad-nav" id="rail"><div class="rail-brand"><div class="logo"><img src="/logo" alt="${esc(brand.name)}" onerror="this.parentNode.remove()"></div>
        <div class="t">${esc(brand.portal)}</div><div class="s">${esc(brand.name)}</div></div>
      <nav aria-label="Main">${items}</nav>
      <div class="rail-foot"><div class="live"><span class="dot"></span>Live</div><div style="margin-top:6px">Built and supported by Safety Simplified</div></div></aside>
      <div class="scrim" id="scrim"></div>
      <div class="ad-body"><div class="topbar"><div style="display:flex;align-items:center;gap:14px"><button class="burger" id="burger" aria-label="Menu"><svg viewBox="0 0 24 24"><path d="M3 12h18M3 6h18M3 18h18"/></svg></button>
        <div><h1 id="vt">Dashboard</h1><div class="crumb" id="vc"></div></div></div>
        <div class="userchip"><span>Signed in as <b>${esc(me.name)}</b></span><button id="pw">Password</button><button id="lo">Sign out</button></div></div>
      <main class="ad-main" id="main"></main></div></div>`);
    document.getElementById('lo').onclick = async () => { await api('/api/auth/logout', { body: {} }); me = null; showLogin(); };
    document.getElementById('pw').onclick = changePassword;
    const rail = document.getElementById('rail'), scrim = document.getElementById('scrim');
    const menu = on => { rail.classList.toggle('open', on); scrim.classList.toggle('show', on); };
    document.getElementById('burger').onclick = () => menu(true);
    scrim.onclick = () => menu(false);
    rail.addEventListener('click', e => { if (e.target.closest('a')) menu(false); });
    window.onhashchange = route;
    route();
  }

  function route() {
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    const params = new URLSearchParams(qs || '');
    const [view, id] = path.split('/');
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === (view || '')));
    const nav = NAV.find(n => n.length > 1 && n[0] === (view || '') && n[1] !== 'admin');
    document.getElementById('vt').textContent = tx(nav ? nav[1] : 'Dashboard');
    document.getElementById('vc').textContent = tx(`${brand.name} · ${CRUMB[view || ''] || ''}`);
    window.scrollTo(0, 0);
    const views = { '': dashboard, operatives, matrix: matrixView, jobs: jobsView, talks: talksView, unmatched, settings, users, ramsmaster: ramsMaster, policies: policiesView, health: healthView };
    setMain('<p class="muted">Loading</p>');
    (views[view] || dashboard)(params, id).catch(e => setMain(`<div class="note err">${esc(e.message)}</div>`));
    updateCounts();
  }

  async function updateCounts() {
    try {
      const d = await api('/unmatched');
      const el = document.querySelector('[data-count=unmatched]');
      if (el) { el.textContent = d.rows.length; el.classList.toggle('hidden', !d.rows.length); }
      if (isAdmin()) {
        const h = await api('/health'); const n = h.rows.filter(x => x.status === 'new').length;
        const hel = document.querySelector('[data-count=health]');
        if (hel) { hel.textContent = n; hel.classList.toggle('hidden', !n); }
      }
    } catch { /* ignore */ }
  }

  function changePassword() {
    openDlg('Change password', field('Current password', '<input id="c" type="password" autocomplete="current-password">') +
      field('New password', '<input id="n" type="password" autocomplete="new-password">', 'at least 8 characters'), '<button class="btn" id="save">Change password</button>');
    $d('#save').onclick = async () => {
      try { await api('/api/auth/password', { body: { current: val('#c'), next: val('#n') } }); dlg.close(); flash('Password changed.'); }
      catch (e) { dlgErr(e.message); }
    };
  }

  // ---------- dashboard ----------
  async function dashboard() {
    const d = await api('/dashboard');
    const c = d.counts;
    const flags = [];
    const expired = d.tickets.filter(t => t.status === 'expired'), expiring = d.tickets.filter(t => t.status === 'expiring');
    if (expired.length) flags.push(['red', `${expired.length} training record${expired.length === 1 ? ' has' : 's have'} expired.`, '#/matrix']);
    if (expiring.length) flags.push(['', `${expiring.length} expire${expiring.length === 1 ? 's' : ''} in the next 30 days.`, '#/matrix']);
    if (d.missing.length) flags.push(['red', `${d.missing.length} required card${d.missing.length === 1 ? ' is' : 's are'} missing from the register.`, '#/matrix']);
    d.jobs.filter(j => j.outstanding).forEach(j => flags.push(['', `${j.name}: ${j.outstanding} RAMS signature${j.outstanding === 1 ? '' : 's'} outstanding.`, `#/jobs/${j.id}`]));
    d.jobs.filter(j => !j.docs).forEach(j => flags.push(['red', `${j.name}: no RAMS uploaded.`, `#/jobs/${j.id}`]));
    if (c.unmatched) flags.push(['', `${c.unmatched} signature${c.unmatched === 1 ? '' : 's'} from people not on the register.`, '#/unmatched']);
    if (!c.operatives) flags.push(['red', 'No {ops} on the register yet. Start here.', '#/operatives']);

    setMain(`<div class="ad-head"><div><p class="muted" style="margin:0">${new Date().toLocaleDateString('en-GB', { ...tz, weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>
      <div class="stats">
        <a class="stat accent" href="#/operatives"><div class="n">${c.operatives}</div><div class="l">{Ops}</div></a>
        <a class="stat ${expired.length + d.missing.length ? 'bad' : ''}" href="#/matrix"><div class="n">${expired.length + d.missing.length}</div><div class="l">Training gaps</div></a>
        <a class="stat" href="#/jobs"><div class="n">${c.live_jobs}</div><div class="l">Live jobs</div></a>
        <a class="stat" href="#/talks"><div class="n">${c.open_talks}</div><div class="l">Talks open for signing</div></a></div>
      <h2>Needs attention</h2>
      <div class="flags">${flags.length ? flags.map(([k, t, h]) => `<a class="flag ${k}" href="${h}" style="text-decoration:none;color:inherit"><span>${esc(t)}</span><span class="btn small ghost">View</span></a>`).join('')
        : '<div class="flag green"><span>Nothing outstanding. Training is in date and everyone has signed.</span></div>'}</div>
      ${d.talks.length ? `<h2>Toolbox talks open for signing</h2><div class="tablewrap"><table><thead><tr><th>Talk</th><th>Issued</th><th>Signed</th></tr></thead><tbody>
        ${d.talks.map(t => `<tr class="click" data-href="#/talks/${t.id}"><td><b>${esc(t.title)}</b>${t.ref ? ` <span class="small muted">${esc(t.ref)}</span>` : ''}</td><td>${fDate(t.issued_at)}</td>
          <td>${t.signed} of ${t.expected}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${d.tickets.length ? `<h2>Training expiring or expired</h2><div class="tablewrap"><table><thead><tr><th>Name</th><th>Training</th><th>Expiry</th></tr></thead><tbody>
        ${d.tickets.map(t => `<tr class="click" data-href="#/operatives/${t.operative_id}"><td>${esc(t.full_name)}</td><td>${esc(t.type_name)}</td>
          <td><span class="pill ${t.status === 'expired' ? 'no' : 'under_review'}">${t.status === 'expired' ? 'Expired' : 'Expires'} ${fDate(t.expires_on)}</span></td></tr>`).join('')}</tbody></table></div>` : ''}
      ${d.recent.length ? `<h2>Latest signatures</h2><div class="tablewrap"><table><thead><tr><th>Who</th><th>Signed</th><th>When</th></tr></thead><tbody>
        ${d.recent.map(s => `<tr><td>${esc(s.full_name || s.name_given)}${s.operative_id ? '' : ' <span class="pill grey">not matched</span>'}</td>
          <td>${s.talk ? `Toolbox talk: ${esc(s.talk)}` : `${esc(s.doc)} <span class="small muted">${esc(s.job || '')}</span>`}</td><td>${fDT(s.signed_at)}</td></tr>`).join('')}</tbody></table></div>` : ''}`);
    main().querySelectorAll('[data-href]').forEach(tr => (tr.onclick = () => (location.hash = tr.dataset.href)));
  }

  // ---------- operatives ----------
  async function operatives(params, id) {
    if (id) return operativeDetail(id);
    const rows = await ops(true);
    const show = params.get('show') || 'active';
    const list = rows.filter(o => (show === 'all' ? true : o.active));
    setMain(`<div class="ad-head"><div><p class="muted">Everyone who works for you on site, employed or subcontract.</p></div>
        ${canEdit() ? '<div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn ghost" id="imp">Add a list</button><button class="btn" id="add">Add {op}</button></div>' : ''}</div>
      <div class="toolbar"><div class="field"><label>Search</label><input id="s" type="search" placeholder="Name, phone or role"></div>
        <div class="field"><label>Show</label><select id="sh"><option value="active">Current</option><option value="all" ${show === 'all' ? 'selected' : ''}>Including left</option></select></div></div>
      <div class="tablewrap">${list.length ? `<table><thead><tr><th>Name</th><th>Role</th><th>Mobile</th><th>Training</th><th>Live jobs</th></tr></thead><tbody>
        ${list.map(o => `<tr class="click" data-id="${o.id}" data-q="${esc((o.full_name + ' ' + (o.phone || '') + ' ' + (o.role || '')).toLowerCase())}">
          <td><b>${esc(o.full_name)}</b>${o.active ? '' : ' <span class="pill grey">left</span>'}</td><td>${esc(o.role || '')}${o.employment ? ` <span class="small muted">${esc(o.employment)}</span>` : ''}</td>
          <td>${esc(o.phone || '')}</td>
          <td>${o.expired || o.missing ? `<span class="pill no">${[o.expired && `${o.expired} expired`, o.missing && `${o.missing} missing`].filter(Boolean).join(', ')}</span>` : ''}
            ${o.expiring ? `<span class="pill under_review">${o.expiring} expiring</span>` : ''}${!o.expired && !o.missing && !o.expiring ? '<span class="pill yes">In date</span>' : ''}</td>
          <td class="small">${esc(o.jobs || '')}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty"><b>No {ops} yet.</b>Add them one at a time, or paste a list from a spreadsheet.</div>'}</div>`);
    document.getElementById('sh').onchange = e => (location.hash = `#/operatives?show=${e.target.value}`);
    document.getElementById('s').oninput = e => { const t = e.target.value.toLowerCase(); main().querySelectorAll('tr[data-q]').forEach(tr => tr.classList.toggle('hidden', !tr.dataset.q.includes(t))); };
    main().querySelectorAll('tr[data-id]').forEach(tr => (tr.onclick = () => (location.hash = '#/operatives/' + tr.dataset.id)));
    if (canEdit()) {
      document.getElementById('add').onclick = () => editOperative();
      document.getElementById('imp').onclick = importOperatives;
    }
  }

  function importOperatives() {
    openDlg('Add a list of {ops}', `<p class="muted">Paste from a spreadsheet or type one person per line: <b>name, mobile, role</b>. Mobile and role are optional. Anyone already on the register is skipped.</p>
      <textarea id="t" rows="12" placeholder="John Smith, 07700 900123, Fitter&#10;Dave Jones, 07700 900456, Labourer"></textarea>`, '<button class="btn" id="go">Add them</button>');
    $d('#go').onclick = async () => {
      try { const r = await api('/operatives/import', { body: { text: val('#t') } }); dlg.close(); bust(); flash(`${r.added} added${r.skipped ? `, ${r.skipped} skipped` : ''}.`); route(); }
      catch (e) { dlgErr(e.message); }
    };
  }

  function editOperative(o = {}) {
    const isNew = !o.id;
    openDlg(isNew ? 'Add {op}' : `Edit ${o.full_name}`, `
      <div class="row">${field('Full name', input('fn', o.full_name))}${field('Mobile', input('ph', o.phone, 'tel'), 'used to match their signatures')}</div>
      <div class="row">${field('Role or trade', input('ro', o.role, 'text', 'list="roles"'))}${field('Employment', `<select id="em"><option value="">Not set</option>${['Employed', 'Subcontract', 'Agency'].map(x => `<option ${o.employment === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}</div>
      <datalist id="roles">${['Installer', 'Fitter', 'Supervisor', 'Labourer', 'Apprentice', 'Plumber', 'Heating engineer', 'Gas engineer', 'Driver'].map(x => `<option>${x}</option>`).join('')}</datalist>
      <div class="row">${field('Email', input('ea', o.email, 'email'))}${field('Start date', input('sd', o.start_date, 'date'))}</div>
      <div class="row">${field('Emergency contact', input('en', o.emergency_name))}${field('Emergency number', input('ep', o.emergency_phone, 'tel'))}</div>
      ${field('Notes', `<textarea id="no">${esc(o.notes || '')}</textarea>`)}
      ${isNew ? '' : `<label class="check"><input type="checkbox" id="ac" ${o.active ? 'checked' : ''}> Currently working for us <span class="hint">untick when they leave; their records are kept</span></label>`}`,
    `<button class="btn" id="save">${isNew ? 'Add {op}' : 'Save'}</button>`);
    $d('#save').onclick = async () => {
      const body = { full_name: val('#fn'), phone: val('#ph'), role: val('#ro'), employment: val('#em'), email: val('#ea'), start_date: val('#sd'),
        emergency_name: val('#en'), emergency_phone: val('#ep'), notes: val('#no'), active: isNew ? true : $d('#ac').checked };
      try {
        if (isNew) { const r = await api('/operatives', { body }); dlg.close(); bust(); location.hash = '#/operatives/' + r.row.id; }
        else { await api('/operatives/' + o.id, { method: 'PUT', body }); dlg.close(); bust(); route(); }
      } catch (e) { dlgErr(e.message); }
    };
  }

  async function operativeDetail(id) {
    const [d, ts] = await Promise.all([api('/operatives/' + id), types()]);
    const o = d.operative;
    const latest = {};
    d.quals.forEach(x => { if (!latest[x.qual_type_id]) latest[x.qual_type_id] = x; });
    const today = new Date().toLocaleDateString('en-CA', tz), soon = new Date(Date.now() + 30 * 864e5).toLocaleDateString('en-CA', tz);
    const st = x => (!x ? null : !x.expires_on ? 'valid' : x.expires_on < today ? 'expired' : x.expires_on <= soon ? 'expiring' : 'valid');
    const activeTypes = ts.filter(t => t.active);
    setMain(`<p class="no-print"><a href="#/operatives">Back to {ops}</a></p>
      <div class="ad-head"><div><h1>${esc(o.full_name)}</h1><p class="muted">${[o.role, o.employment, o.phone].filter(Boolean).map(esc).join(' · ')}${o.active ? '' : ' · <span class="pill grey">left</span>'}</p></div>
        ${canEdit() ? '<div style="display:flex;gap:.5rem"><button class="btn ghost" id="ed">Edit details</button><button class="btn" id="aq">Add training</button></div>' : ''}</div>
      <div class="tabs"><button data-t="tr" class="on">Training (${d.quals.length})</button><button data-t="sg">Signed (${d.signoffs.length})</button><button data-t="dt">Details</button></div>
      <div data-p="tr"><div class="tablewrap"><table><thead><tr><th>Training</th><th>Number</th><th>Issued</th><th>Expires</th><th>Card</th><th></th></tr></thead><tbody>
        ${activeTypes.map(t => { const x = latest[t.id]; const s = st(x);
          return `<tr><td><b>${esc(t.name)}</b>${t.required ? ' <span class="small muted">required</span>' : ''}</td>
            ${x ? `<td>${esc(x.number || '')}</td><td>${fDate(x.issued_on)}</td><td>${x.expires_on ? `<span class="pill ${s === 'expired' ? 'no' : s === 'expiring' ? 'under_review' : 'yes'}">${fDate(x.expires_on)}</span>` : '<span class="small muted">No expiry</span>'}</td>
              <td>${x.has_file ? `<a href="/api/admin/quals/${x.id}/file" target="_blank" rel="noopener">View</a>` : '<span class="small muted">None</span>'}</td>
              <td>${canEdit() ? `<button class="btn small quiet" data-q="${x.id}">Edit</button><button class="btn small quiet" data-new="${t.id}">Renew</button>` : ''}</td>`
            : `<td colspan="4">${t.required ? '<span class="pill no">Missing</span>' : '<span class="small muted">Not held</span>'}</td><td>${canEdit() ? `<button class="btn small quiet" data-new="${t.id}">Add</button>` : ''}</td>`}</tr>`; }).join('')}
      </tbody></table></div>
      ${d.quals.length > Object.keys(latest).length ? `<details><summary class="small muted">Older records (${d.quals.length - Object.keys(latest).length})</summary><div class="tablewrap" style="margin-top:.6rem"><table><tbody>
        ${d.quals.filter(x => latest[x.qual_type_id] !== x).map(x => `<tr><td>${esc(x.type_name)}</td><td>${esc(x.number || '')}</td><td>Expired ${fDate(x.expires_on)}</td><td>${x.has_file ? `<a href="/api/admin/quals/${x.id}/file" target="_blank" rel="noopener">View</a>` : ''}</td></tr>`).join('')}
        </tbody></table></div></details>` : ''}</div>
      <div data-p="sg" class="hidden"><div class="tablewrap">${d.signoffs.length ? `<table><thead><tr><th>What</th><th>Signed</th><th>Signature</th></tr></thead><tbody>
        ${d.signoffs.map(s => `<tr><td>${s.talk_id ? `<a href="#/talks/${s.talk_id}">Toolbox talk: ${esc(s.talk)}</a>${s.talk_ref ? ` <span class="small muted">${esc(s.talk_ref)}</span>` : ''}`
          : `<a href="#/jobs/${s.job_id}">${esc(s.job)}</a>: ${esc(s.doc)}${s.revision ? ` <span class="small muted">rev ${esc(s.revision)}</span>` : ''}`}</td><td>${fDT(s.signed_at)}</td><td>${sigImg(s.id)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Nothing signed yet.</div>'}</div></div>
      <div data-p="dt" class="hidden"><div class="panel"><dl class="info-list" style="border:0;margin:0">
        ${[['Mobile', o.phone], ['Email', o.email], ['Role', o.role], ['Employment', o.employment], ['Start date', fDate(o.start_date)], ['Emergency contact', [o.emergency_name, o.emergency_phone].filter(Boolean).join(', ')], ['Live jobs', d.jobs.filter(j => j.status === 'live').map(j => j.name).join(', ')], ['Notes', o.notes]]
          .map(([k, x]) => `<div><dt>${k}</dt><dd>${esc(x || 'Not recorded')}</dd></div>`).join('')}</dl></div></div>`);
    main().querySelectorAll('.tabs button').forEach(b => (b.onclick = () => {
      main().querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
      main().querySelectorAll('[data-p]').forEach(p => p.classList.toggle('hidden', p.dataset.p !== b.dataset.t));
    }));
    if (!canEdit()) return;
    document.getElementById('ed').onclick = () => editOperative(o);
    document.getElementById('aq').onclick = () => qualDialog({ operative_id: o.id }, activeTypes);
    main().querySelectorAll('[data-new]').forEach(b => (b.onclick = () => qualDialog({ operative_id: o.id, qual_type_id: Number(b.dataset.new) }, activeTypes)));
    main().querySelectorAll('[data-q]').forEach(b => (b.onclick = () => qualDialog(d.quals.find(x => String(x.id) === b.dataset.q), activeTypes)));
  }

  // Add or edit one training record. Picking an issue date fills in the expiry from the type's validity.
  function qualDialog(x, ts) {
    const isNew = !x.id;
    openDlg(isNew ? 'Add training' : `Edit ${x.type_name}`, `
      ${isNew ? field('Training', `<select id="ty"><option value="">Choose</option>${opt(ts, x.qual_type_id)}</select>`) : ''}
      ${field('Card or certificate number', input('nu', x.number))}
      <div class="row">${field('Issued', input('is', x.issued_on, 'date'))}${field('Expires', input('ex', x.expires_on, 'date'), 'leave empty if it does not expire')}</div>
      ${field(isNew ? 'Copy of the card' : 'Replace the copy', '<input id="fi" type="file" accept="image/*,application/pdf" capture="environment">', 'photo or PDF')}`,
    `${isNew ? '' : '<button class="btn danger left" id="del">Delete</button>'}<button class="btn" id="save">Save</button>`);
    const fillExpiry = () => {
      const t = ts.find(t => String(t.id) === String(isNew ? val('#ty') : x.qual_type_id));
      if (t && t.validity_months && val('#is') && !val('#ex')) $d('#ex').value = addMonths(val('#is'), t.validity_months);
    };
    $d('#is').onchange = fillExpiry;
    if (isNew) $d('#ty').onchange = fillExpiry;
    $d('#save').onclick = async () => {
      const f = new FormData();
      f.append('operative_id', x.operative_id); if (isNew) f.append('qual_type_id', val('#ty'));
      f.append('number', val('#nu')); f.append('issued_on', val('#is')); f.append('expires_on', val('#ex'));
      if ($d('#fi').files[0]) f.append('file', $d('#fi').files[0]);
      try { await api(isNew ? '/quals' : '/quals/' + x.id, { form: f, method: isNew ? 'POST' : 'PUT' }); dlg.close(); bust(); route(); }
      catch (e) { dlgErr(e.message); }
    };
    if (!isNew) $d('#del').onclick = async () => {
      if (!confirm('Delete this training record?')) return;
      try { await api('/quals/' + x.id, { method: 'DELETE' }); dlg.close(); bust(); route(); } catch (e) { dlgErr(e.message); }
    };
  }

  // ---------- training matrix ----------
  async function matrixView(params) {
    const job = params.get('job') || '';
    const [m, js] = await Promise.all([api('/matrix' + (job ? `?job=${job}` : '')), jobs()]);
    const jobName = job ? (js.find(j => String(j.id) === job) || {}).name : '';
    setMain(`<div class="ad-head"><div><p class="muted">${jobName ? `Team on ${esc(jobName)}` : 'Everyone currently working for you'}, as of ${fDate(new Date().toISOString())}.</p></div>
        <div class="no-print" style="display:flex;gap:.5rem"><a class="btn ghost" href="/api/admin/matrix.pdf${job ? `?job=${job}` : ''}">Download PDF</a><a class="btn ghost" href="/api/admin/matrix.csv${job ? `?job=${job}` : ''}">Download spreadsheet</a><button class="btn ghost" onclick="print()">Print</button></div></div>
      <div class="toolbar"><div class="field"><label>Show</label><select id="jb"><option value="">Everyone</option>${opt(js.filter(j => j.status === 'live'), job)}</select></div></div>
      <div class="legend"><span class="valid">In date</span><span class="expiring">Expires within 30 days</span><span class="expired">Expired or required and missing</span><span class="none">Not held</span></div>
      ${m.operatives.length && m.types.length ? `<div class="tablewrap"><table class="matrix"><thead><tr><th>Name</th>${m.types.map(t => `<th class="rot"><div>${esc(t.name)}${t.required ? ' *' : ''}</div></th>`).join('')}</tr></thead><tbody>
        ${m.operatives.map(o => `<tr><td><a href="#/operatives/${o.id}"><b>${esc(o.full_name)}</b></a><br><span class="small muted">${esc(o.role || '')}</span></td>
          ${m.types.map(t => { const c = (m.cells[o.id] || {})[t.id];
            const cls = c ? c.status : t.required ? 'missing' : '';
            const txt = c ? (c.expires_on ? shortDate(c.expires_on) : 'Held') : t.required ? 'Missing' : '';
            return `<td class="c ${cls}" data-o="${o.id}" data-t="${t.id}" data-x="${c ? c.id : ''}" title="${esc(t.name)}">${txt}</td>`; }).join('')}</tr>`).join('')}
        </tbody></table></div><p class="small muted">* required for everyone. Click a cell to add or update a record.</p>`
        : '<div class="empty"><b>Nothing to show yet.</b>Add {ops}, then their training.</div>'}`);
    document.getElementById('jb').onchange = e => (location.hash = '#/matrix' + (e.target.value ? `?job=${e.target.value}` : ''));
    if (!canEdit()) return;
    main().querySelectorAll('td.c').forEach(td => (td.onclick = async () => {
      const ts = (await types()).filter(t => t.active);
      if (td.dataset.x) {
        const d = await api('/operatives/' + td.dataset.o);
        const x = d.quals.find(q => String(q.id) === td.dataset.x);
        return qualDialog(x, ts);
      }
      qualDialog({ operative_id: Number(td.dataset.o), qual_type_id: Number(td.dataset.t) }, ts);
    }));
  }

  // ---------- jobs, RAMS and site packs ----------
  const KIND = { rams: 'RAMS', permit: 'Permit', plan: 'Drawing / plan', other: 'Other', briefing: 'Site briefing' };

  async function jobsView(params, id) {
    if (id) return jobDetail(id);
    const rows = await jobs(true);
    setMain(`<div class="ad-head"><div><p class="muted">Each job has its own pack link. Your {ops} open it on their phone, read the RAMS and sign.</p></div>
        ${canEdit() ? '<button class="btn" id="add">Add job</button>' : ''}</div>
      <div class="tablewrap">${rows.length ? `<table><thead><tr><th>Job</th><th>Client</th><th>Dates</th><th>Team</th><th>Documents</th><th>Signatures</th></tr></thead><tbody>
        ${rows.map(j => `<tr class="click" data-id="${j.id}"><td><b>${esc(j.name)}</b>${j.ref ? ` <span class="small muted">${esc(j.ref)}</span>` : ''}${j.status === 'complete' ? ' <span class="pill grey">complete</span>' : ''}</td>
          <td>${esc(j.client || '')}</td><td class="small">${fDate(j.start_on)}${j.end_on ? ` to ${fDate(j.end_on)}` : ''}</td><td>${j.team}</td>
          <td>${j.docs || '<span class="pill no">None</span>'}</td><td>${j.status === 'live' ? (j.outstanding ? `<span class="pill under_review">${j.outstanding} outstanding</span>` : j.docs && j.team ? '<span class="pill yes">All signed</span>' : '') : ''}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty"><b>No jobs yet.</b>Add a job, upload its RAMS, and send the pack link to your {ops}.</div>'}</div>`);
    main().querySelectorAll('tr[data-id]').forEach(tr => (tr.onclick = () => (location.hash = '#/jobs/' + tr.dataset.id)));
    if (canEdit()) document.getElementById('add').onclick = () => editJob();
  }

  function editJob(j = {}) {
    const isNew = !j.id;
    openDlg(isNew ? 'Add job' : 'Edit job', `
      <div class="row">${field('Job name', input('nm', j.name), 'what the team call it')}${field('Job or order number', input('rf', j.ref))}</div>
      ${field('Site address', input('ad', j.address))}
      <div class="row">${field('Main contractor or client', input('cl', j.client))}${field('Their site contact', input('cc', j.client_contact))}</div>
      <div class="row">${field('Start', input('st', j.start_on, 'date'))}${field('Finish', input('en', j.end_on, 'date'))}</div>
      ${field('Notes', `<textarea id="no">${esc(j.notes || '')}</textarea>`)}
      ${isNew ? '' : field('Status', `<select id="ss"><option value="live">Live</option><option value="complete" ${j.status === 'complete' ? 'selected' : ''}>Complete (pack link stops working)</option></select>`)}`,
    `<button class="btn" id="save">${isNew ? 'Add job' : 'Save'}</button>`);
    $d('#save').onclick = async () => {
      const body = { name: val('#nm'), ref: val('#rf'), address: val('#ad'), client: val('#cl'), client_contact: val('#cc'), start_on: val('#st'), end_on: val('#en'), notes: val('#no'), status: isNew ? 'live' : val('#ss') };
      try {
        if (isNew) { const r = await api('/jobs', { body }); dlg.close(); bust(); location.hash = '#/jobs/' + r.row.id; }
        else { await api('/jobs/' + j.id, { method: 'PUT', body }); dlg.close(); bust(); route(); }
      } catch (e) { dlgErr(e.message); }
    };
  }

  async function jobDetail(id) {
    const d = await api('/jobs/' + id);
    const j = d.job;
    const cur = d.documents.filter(x => x.current), old = d.documents.filter(x => !x.current);
    const signable = cur.filter(x => x.requires_signoff);
    const signed = (docId, opId) => d.signoffs.find(s => s.document_id === docId && s.operative_id === opId);
    const others = d.signoffs.filter(s => cur.some(x => x.id === s.document_id) && (!s.operative_id || !d.team.some(t => t.id === s.operative_id)));
    const rams = await api(`/rams/jobs/${j.id}`);
    const liveRams = rams.rows.find(x => x.status === 'issued');
    setMain(`<p class="no-print"><a href="#/jobs">Back to jobs</a></p>
      <div class="ad-head"><div><h1>${esc(j.name)}</h1><p class="muted">${[j.ref, j.client, j.address].filter(Boolean).map(esc).join(' · ')}${j.status === 'complete' ? ' · <span class="pill grey">complete</span>' : ''}</p></div>
        ${canEdit() ? `<div class="no-print" style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn ghost" id="ed">Edit job</button><button class="btn ghost" id="tm">Choose team</button><button class="btn ghost" id="up">Upload document</button>${rams.defaults ? `<button class="btn" id="nr">${liveRams ? 'Revise RAMS' : 'New RAMS'}</button>` : ''}</div>` : ''}</div>
      ${rams.defaults ? `<div class="panel"><h2>RAMS</h2>${liveRams ? `<p><b>${esc(liveRams.ref || '')} Issue ${liveRams.issue_no}</b> issued ${fDate(liveRams.issue_date)} by ${esc(liveRams.created_by || '')}, from company RAMS master v${liveRams.master_version}.
          <a href="/api/admin/rams/${liveRams.id}/signed.pdf" target="_blank" rel="noopener">Open the PDF</a> · <a href="/api/admin/rams/${liveRams.id}/signed.pdf?download=1">Download</a><span class="small muted"> (with the sign-offs made so far on the signature page)</span></p>
          <p class="small muted">Site briefing confirmed by ${liveRams.briefed} ${liveRams.briefed === 1 ? 'person' : 'people'}. Your {ops} confirm it from the job pack link when they start on site, and that puts them on the team.</p>
          ${rams.rows.length > 1 ? `<details><summary class="small muted">Earlier issues (${rams.rows.length - 1})</summary><ul class="small">${rams.rows.filter(x => x.status !== 'issued').map(x => `<li>Issue ${x.issue_no}, ${fDate(x.issue_date)}, master v${x.master_version} <a href="/api/admin/rams/${x.id}/signed.pdf" target="_blank" rel="noopener">PDF</a></li>`).join('')}</ul></details>` : ''}`
        : `<p class="muted">No RAMS issued for this job from the portal yet.${canEdit() ? ' Use New RAMS: the site details are filled in from the job, you add anything site-specific, and the PDF is made from the company RAMS master.' : ''}</p>`}</div>` : ''}
      ${j.status === 'live' ? `<div class="panel no-print"><h2>Job pack link</h2><p class="small muted">${liveRams ? 'Send this to the {ops} on the job. They open it, read the site briefing and the RAMS, and confirm on their phone; that puts them on this job\'s team. Revise the RAMS and everyone is asked to confirm the new briefing.' : 'Send this to the {ops} on the job. They open it, read each RAMS and sign it on their phone. When a RAMS is updated, upload the new revision and everyone is asked to sign again.'}</p>
        ${shareBox(j.url, `/api/admin/jobs/${j.id}/qr.svg`, `${j.name}: please read and sign the RAMS for this job before you start.`)}</div>` : ''}
      <h2>Documents</h2>
      <div class="tablewrap">${cur.length ? `<table><thead><tr><th>Document</th><th>Type</th><th>Revision</th><th>Signatures</th><th>Uploaded</th><th></th></tr></thead><tbody>
        ${cur.map(x => `<tr><td>${x.has_content ? `<b>${esc(x.title)}</b>` : `<a href="/api/admin/documents/${x.id}/file" target="_blank" rel="noopener"><b>${esc(x.title)}</b></a>`}${x.reference ? ` <span class="small muted">${esc(x.reference)}</span>` : ''}</td>
          <td>${KIND[x.kind] || x.kind}</td><td>${esc(x.revision || '')}</td><td>${x.requires_signoff ? x.signed : '<span class="small muted">Read only</span>'}</td>
          <td class="small">${fDate(x.created_at)}<br><span class="muted">${esc(x.uploaded_by || '')}</span></td>
          <td class="no-print">${canEdit() && !x.has_content && !(liveRams && x.id === liveRams.document_id) ? `<button class="btn small quiet" data-rev="${x.id}">New revision</button><button class="btn small quiet" data-doc="${x.id}">Edit</button>` : liveRams && x.id === liveRams.document_id ? '<span class="small muted">Made by the portal</span>' : ''}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty"><b>No documents yet.</b>Upload the RAMS for this job, plus any drawings or permits the {ops} need.</div>'}</div>
      <h2>Sign-off register</h2>
      ${d.team.length && signable.length ? `<div class="tablewrap"><table class="matrix signmatrix"><thead><tr><th>Team</th>${signable.map(x => `<th class="rot"><div>${esc(x.title)}${x.revision ? ` rev ${esc(x.revision)}` : ''}</div></th>`).join('')}</tr></thead><tbody>
        ${d.team.map(o => `<tr><td><a href="#/operatives/${o.id}"><b>${esc(o.full_name)}</b></a><br><span class="small muted">${esc(o.role || '')}</span></td>
          ${signable.map(x => { const s = signed(x.id, o.id); return `<td class="c ${s ? 'valid' : 'missing'}">${s ? shortDate(s.signed_at.slice(0, 10)) : 'Not signed'}</td>`; }).join('')}</tr>`).join('')}
        </tbody></table></div>` : `<p class="muted">${d.team.length ? 'No documents need signing yet.' : 'Choose the team for this job to track who has signed. Anyone on the register who signs the pack is added automatically.'}</p>`}
      ${others.length ? `<h3>Also signed</h3><p class="small muted">People not in the team list${others.some(s => !s.operative_id) ? ', including some not on the register yet (see Signatures to match)' : ''}.</p>
        <div class="tablewrap"><table><tbody>${others.map(s => `<tr><td>${esc(s.name_given)}</td><td>${esc((cur.find(x => x.id === s.document_id) || {}).title || '')}</td><td>${fDT(s.signed_at)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${old.length ? `<details><summary class="small muted">Superseded documents (${old.length})</summary><div class="tablewrap" style="margin-top:.6rem"><table><tbody>
        ${old.map(x => `<tr><td><a href="/api/admin/documents/${x.id}/file" target="_blank" rel="noopener">${esc(x.title)}</a></td><td>rev ${esc(x.revision || '')}</td><td>${x.signed} signatures</td><td class="small">${fDate(x.created_at)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}`);
    if (!canEdit()) return;
    document.getElementById('ed').onclick = () => editJob(j);
    document.getElementById('up').onclick = () => uploadDoc(j);
    if (document.getElementById('nr')) document.getElementById('nr').onclick = () => newRams(j, rams, liveRams);
    document.getElementById('tm').onclick = () => chooseTeam(j, d.team);
    main().querySelectorAll('[data-rev]').forEach(b => (b.onclick = () => uploadDoc(j, cur.find(x => String(x.id) === b.dataset.rev))));
    main().querySelectorAll('[data-doc]').forEach(b => (b.onclick = () => editDoc(cur.find(x => String(x.id) === b.dataset.doc))));
  }

  function newRams(j, rams, prev) {
    const d = rams.defaults, f = prev ? prev.fields : {};
    const my = iso => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
    const ta = (id, value, rows = 3) => `<textarea id="${id}" rows="${rows}">${esc(value ?? '')}</textarea>`;
    openDlg(prev ? `Revise RAMS: Issue ${prev.issue_no + 1}` : 'New RAMS', `
      <p class="muted">The method statement, risk assessments and COSHH come from the company RAMS master (v${d.master_version}). Fill in the site sheet; the PDF is made when you issue.</p>
      <div class="row">${field('Project', input('project', f.project || j.name))}${field('Client', input('client', f.client || j.client || ''))}</div>
      ${field('Address', input('address', f.address || j.address || ''))}
      <div class="row">${field('Start', input('start_text', f.start_text || my(j.start_on)))}${field('End', input('end_text', f.end_text || 'TBC'))}</div>
      <div class="row">${field('Author', input('author', f.author || d.author || ''))}${field('Reviewer', input('reviewer', f.reviewer || d.reviewer || ''))}</div>
      <div class="row">${field('Emergency contact', ta('emergency_contact', f.emergency_contact || d.emergency_contact || '', 2))}${field('Site supervisor', input('site_supervisor', f.site_supervisor || d.site_supervisor || ''))}</div>
      ${field('Scope of work', ta('scope', f.scope || d.scope || '', 2))}
      ${field('Site-specific arrangements', ta('site_notes', f.site_notes || '', 5), 'access, welfare, PC rules, anything this site needs beyond the master; leave blank if nothing')}
      <div class="row">${field('Ref', input('ref', prev ? prev.ref : d.ref || ''))}${field('Issue no', input('issue_no', rams.next_issue || (prev ? prev.issue_no + 1 : 1), 'number'))}${field('Issue date', input('issue_date', new Date().toISOString().slice(0, 10), 'date'))}</div>
      ${prev ? '<p class="small muted">Issuing marks the current RAMS as superseded and gives the {ops} a fresh site briefing to confirm.</p>' : ''}`,
    '<button class="btn" id="save">Issue RAMS</button>');
    $d('#save').onclick = async () => {
      const body = {}; ['project', 'client', 'address', 'start_text', 'end_text', 'author', 'reviewer', 'emergency_contact', 'site_supervisor', 'scope', 'site_notes', 'ref', 'issue_no', 'issue_date'].forEach(k => (body[k] = val('#' + k)));
      const btn = $d('#save'); btn.disabled = true; btn.textContent = 'Making the PDF';
      try { await api(`/rams/jobs/${j.id}`, { body }); dlg.close(); bust(); flash('RAMS issued.'); route(); }
      catch (e) { btn.disabled = false; btn.textContent = 'Issue RAMS'; dlgErr(e.message); }
    };
  }

  function uploadDoc(j, prev) {
    const nextRev = prev && prev.revision ? (/^\d+$/.test(prev.revision) ? String(Number(prev.revision) + 1) : /^[A-Y]$/i.test(prev.revision) ? String.fromCharCode(prev.revision.charCodeAt(0) + 1) : '') : '';
    openDlg(prev ? `New revision of ${prev.title}` : 'Upload document', `
      ${prev ? '<p class="muted">The current version is marked as superseded and everyone on the job is asked to sign the new one.</p>' : ''}
      ${field('Type', `<select id="kd">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${(prev ? prev.kind : 'rams') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${field('Title', input('ti', prev ? prev.title : ''))}
      <div class="row">${field('Reference', input('rf', prev ? prev.reference : ''))}${field('Revision', input('rv', nextRev))}</div>
      ${field('File', '<input id="fi" type="file" accept="application/pdf,image/*,.doc,.docx">', 'PDF works best on phones')}
      <label class="check"><input type="checkbox" id="so" ${!prev || prev.requires_signoff ? 'checked' : ''}> {Ops} must read and sign this</label>`,
    '<button class="btn" id="save">Upload</button>');
    $d('#kd').onchange = () => { $d('#so').checked = ['rams', 'permit'].includes(val('#kd')); };
    $d('#fi').onchange = () => { const f = $d('#fi').files[0]; if (f && !val('#ti')) $d('#ti').value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '); };
    $d('#save').onclick = async () => {
      const f = new FormData();
      f.append('kind', val('#kd')); f.append('title', val('#ti')); f.append('reference', val('#rf')); f.append('revision', val('#rv'));
      f.append('requires_signoff', $d('#so').checked); if (prev) f.append('replaces', prev.id);
      if ($d('#fi').files[0]) f.append('file', $d('#fi').files[0]);
      const b = $d('#save'); b.disabled = true; b.textContent = 'Uploading';
      try { await api(`/jobs/${j.id}/documents`, { form: f }); dlg.close(); route(); }
      catch (e) { b.disabled = false; b.textContent = 'Upload'; dlgErr(e.message); }
    };
  }

  function editDoc(x) {
    openDlg('Edit document', `${field('Title', input('ti', x.title))}
      <div class="row">${field('Reference', input('rf', x.reference))}${field('Revision', input('rv', x.revision))}</div>
      ${field('Type', `<select id="kd">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${x.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      <label class="check" style="margin-bottom:.6rem"><input type="checkbox" id="so" ${x.requires_signoff ? 'checked' : ''}> {Ops} must read and sign this</label>
      <label class="check"><input type="checkbox" id="cu" checked> Current <span class="hint">untick to withdraw it from the pack</span></label>`,
    '<button class="btn danger left" id="del">Delete</button><button class="btn" id="save">Save</button>');
    $d('#save').onclick = async () => {
      try { await api('/documents/' + x.id, { method: 'PUT', body: { title: val('#ti'), reference: val('#rf'), revision: val('#rv'), kind: val('#kd'), requires_signoff: $d('#so').checked, current: $d('#cu').checked } }); dlg.close(); route(); }
      catch (e) { dlgErr(e.message); }
    };
    $d('#del').onclick = async () => {
      if (!confirm(`Delete ${x.title} and its ${x.signed} signature${x.signed === 1 ? '' : 's'}? To keep the record, untick Current instead.`)) return;
      try { await api('/documents/' + x.id, { method: 'DELETE' }); dlg.close(); route(); } catch (e) { dlgErr(e.message); }
    };
  }

  async function chooseTeam(j, team) {
    const all = (await ops(true)).filter(o => o.active);
    const on = new Set(team.map(t => t.id));
    openDlg(`Team on ${j.name}`, `<input type="search" id="fs" placeholder="Search" style="margin-bottom:.8rem">
      <div style="display:grid;gap:.4rem">${all.map(o => `<label class="check" data-q="${esc(o.full_name.toLowerCase())}"><input type="checkbox" value="${o.id}" ${on.has(o.id) ? 'checked' : ''}> ${esc(o.full_name)} <span class="hint">${esc(o.role || '')}</span></label>`).join('') || '<p class="muted">Add {ops} first.</p>'}</div>`,
    '<button class="btn" id="save">Save team</button>');
    $d('#fs').oninput = e => dlg.querySelectorAll('[data-q]').forEach(l => l.classList.toggle('hidden', !l.dataset.q.includes(e.target.value.toLowerCase())));
    $d('#save').onclick = async () => {
      const ids = [...dlg.querySelectorAll('input[type=checkbox]:checked')].map(c => Number(c.value));
      try { await api(`/jobs/${j.id}/team`, { method: 'PUT', body: { operative_ids: ids } }); dlg.close(); bust(); route(); } catch (e) { dlgErr(e.message); }
    };
  }

  // ---------- toolbox talks ----------
  async function talksView(params, id) {
    if (id) return talkDetail(id);
    const tab = params.get('tab') || 'issued';
    const [d, lib] = await Promise.all([api('/talks'), api('/library')]);
    const ST = { draft: ['Draft', 'draft'], issued: ['Open for signing', 'yes'], closed: ['Closed', 'grey'] };
    const cats = [...new Set(lib.rows.map(t => t.category || 'General'))];
    setMain(`<div class="ad-head"><div><p class="muted">Pick a talk from the library and issue it. Send the link on WhatsApp; they read it${brand.quiz === false ? '' : ', answer the questions'} and sign. You see who has and hasn't.</p></div>
        <div>${isOwner() && tab === 'library' ? '<button class="btn ghost" id="addLib">Add library talk</button>' : ''}${canEdit() ? '<button class="btn ghost" id="add">Write your own</button>' : ''}</div></div>
      <div class="tabs"><button data-tab="issued" class="${tab === 'issued' ? 'on' : ''}">Issued (${d.rows.length})</button><button data-tab="library" class="${tab === 'library' ? 'on' : ''}">Library (${lib.rows.length})</button></div>
      ${tab === 'issued' ? `<div class="tablewrap">${d.rows.length ? `<table><thead><tr><th>Talk</th><th>For</th><th>Status</th><th>Issued</th><th>Signed</th></tr></thead><tbody>
        ${d.rows.map(t => `<tr class="click" data-id="${t.id}"><td><b>${esc(t.title)}</b>${t.ref ? ` <span class="small muted">${esc(t.ref)}</span>` : ''}</td><td>${esc(t.job || 'Everyone')}</td>
          <td><span class="pill ${ST[t.status][1]}">${ST[t.status][0]}</span></td><td>${fDate(t.issued_at)}</td>
          <td>${t.status === 'draft' ? '' : `${t.signed} of ${t.expected}${t.signatures > t.signed ? ` <span class="small muted">+${t.signatures - t.signed} unmatched</span>` : ''}`}</td></tr>`).join('')}</tbody></table>`
        : `<div class="empty"><b>Nothing issued yet.</b>${lib.rows.length ? 'Open the library and issue your first talk.' : 'Write a talk to get started.'}</div>`}</div>`
      : lib.rows.length ? cats.map(c => `<h2>${esc(c)}</h2><div class="libgrid">${lib.rows.filter(t => (t.category || 'General') === c).map(t => `<div class="libcard">
          <div><span class="k">${esc(t.ref || '')}</span><b>${esc(t.title)}</b>${t.intro ? `<p class="small muted">${esc(t.intro.length > 140 ? t.intro.slice(0, 140) + '...' : t.intro)}</p>` : ''}
            <p class="small muted" style="margin:0">${t.parts} part${t.parts === 1 ? '' : 's'}${t.questions ? `, ${t.questions} question${t.questions === 1 ? '' : 's'}` : ''}${t.last_issued ? ` · last issued ${fDate(t.last_issued)}` : ''}</p></div>
          <div class="libact"><button class="btn small ghost" data-prev="${t.id}">${isOwner() ? 'Edit' : 'Preview'}</button>${canEdit() ? `<button class="btn small" data-issue="${t.id}">Issue</button>` : ''}</div></div>`).join('')}</div>`).join('')
        : '<div class="empty"><b>The library is empty.</b>Talks added by Safety Simplified appear here.</div>'}`);
    main().querySelectorAll('[data-tab]').forEach(b => (b.onclick = () => (location.hash = '#/talks?tab=' + b.dataset.tab)));
    main().querySelectorAll('tr[data-id]').forEach(tr => (tr.onclick = () => (location.hash = '#/talks/' + tr.dataset.id)));
    main().querySelectorAll('[data-prev]').forEach(b => (b.onclick = () => (location.hash = '#/talks/' + b.dataset.prev)));
    main().querySelectorAll('[data-issue]').forEach(b => (b.onclick = () => issueDialog(lib.rows.find(t => String(t.id) === b.dataset.issue))));
    if (canEdit()) document.getElementById('add').onclick = async () => { const r = await api('/talks', { body: {} }); location.hash = '#/talks/' + r.row.id; };
    if (document.getElementById('addLib')) document.getElementById('addLib').onclick = async () => { const r = await api('/talks', { body: { library: true } }); location.hash = '#/talks/' + r.row.id; };
  }

  async function issueDialog(t) {
    const js = (await jobs()).filter(j => j.status === 'live');
    openDlg(`Issue: ${t.title}`, `<p class="muted">You'll get a link and QR code to send out, and a register of who has signed this issue.</p>
      ${field('Who needs to sign it', `<select id="jb"><option value="">Everyone</option>${js.map(j => `<option value="${j.id}">Team on ${esc(j.name)}</option>`).join('')}</select>`)}`,
    '<button class="btn" id="go">Issue talk</button>');
    $d('#go').onclick = async () => {
      try { const r = await api(`/library/${t.id}/issue`, { body: { job_id: val('#jb') } }); dlg.close(); location.hash = '#/talks/' + r.id; } catch (e) { dlgErr(e.message); }
    };
  }

  async function talkDetail(id) {
    const [d, js] = await Promise.all([api('/talks/' + id), jobs()]);
    const t = d.talk;
    if ((t.status === 'draft' && canEdit()) || (t.status === 'library' && isOwner())) return talkEditor(t, js);
    if (t.status === 'library') return libraryPreview(t);
    const matched = d.signoffs.filter(s => s.operative_id), unmatchedRows = d.signoffs.filter(s => !s.operative_id);
    setMain(`<p class="no-print"><a href="#/talks">Back to toolbox talks</a></p>
      <div class="ad-head"><div><h1>${esc(t.title)}</h1><p class="muted">${t.ref ? `${esc(t.ref)} · ` : ''}${t.job ? `For ${esc(t.job)}` : 'For everyone'} · Issued ${fDate(t.issued_at)}${t.status === 'closed' ? ' · <span class="pill grey">closed</span>' : ''}</p></div>
        <div class="no-print" style="display:flex;gap:.5rem;flex-wrap:wrap">${canEdit() ? `<button class="btn ghost" id="cp">Copy as new talk</button><button class="btn ghost" id="cl">${t.status === 'closed' ? 'Reopen' : 'Close signing'}</button>` : ''}
          <button class="btn ghost" id="pv">View content</button><button class="btn ghost" onclick="print()">Print register</button>${isOwner() ? '<button class="btn quiet" id="deltalk">Delete</button>' : ''}</div></div>
      ${t.status === 'issued' ? `<div class="panel no-print"><h2>Link to send</h2>${shareBox(t.url, `/api/admin/talks/${t.id}/qr.svg`, `Toolbox talk: ${t.title}. Please read${t.questions.length ? ', answer the questions' : ''} and sign.`)}</div>` : ''}
      <div class="print-only"><p><b>Toolbox talk register.</b> ${esc(brand.name)}. Printed ${fDT(new Date().toISOString())}.</p></div>
      <h2>Signed (${matched.length})</h2>
      <div class="tablewrap">${matched.length ? `<table><thead><tr><th>Name</th><th>Signed</th><th>Attempts</th><th>Signature</th></tr></thead><tbody>
        ${matched.map(s => `<tr><td><a href="#/operatives/${s.operative_id}">${esc(s.full_name)}</a></td><td>${fDT(s.signed_at)}</td><td>${s.attempts}</td><td>${sigImg(s.id)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nobody yet.</div>'}</div>
      ${unmatchedRows.length ? `<h2>Signed, not on the register (${unmatchedRows.length})</h2><div class="tablewrap"><table><tbody>
        ${unmatchedRows.map(s => `<tr><td>${esc(s.name_given)}</td><td>${esc(s.phone_given || '')}</td><td>${fDT(s.signed_at)}</td><td>${sigImg(s.id)}</td><td class="no-print"><a href="#/unmatched">Match</a></td></tr>`).join('')}</tbody></table></div>` : ''}
      <h2>Still to sign (${d.outstanding.length})</h2>
      <div class="tablewrap">${d.outstanding.length ? `<table><tbody>${d.outstanding.map(o => `<tr><td><a href="#/operatives/${o.id}">${esc(o.full_name)}</a></td><td>${esc(o.role || '')}</td><td>${esc(o.phone || '')}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Everyone has signed.</div>'}</div>`);
    document.getElementById('pv').onclick = () => openDlg(t.title, `${t.intro ? `<p>${esc(t.intro)}</p>` : ''}${t.sections.map(s => `<h3>${esc(s.heading)}</h3><p style="white-space:pre-wrap">${esc(s.body)}</p>`).join('')}
      ${t.questions.length ? `<h3>Questions</h3>${t.questions.map((x, i) => `<p><b>${i + 1}. ${esc(x.question)}</b><br>${x.options.map((o, j) => (j === x.answer ? `<b>${esc(o)} (correct)</b>` : esc(o))).join('<br>')}</p>`).join('')}` : ''}`);
    if (isOwner()) document.getElementById('deltalk').onclick = async () => {
      if (!confirm(`Delete this issued talk and its ${d.signoffs.length} signature${d.signoffs.length === 1 ? '' : 's'}? For test issues only. It cannot be undone.`)) return;
      try { await api('/talks/' + t.id, { method: 'DELETE' }); flash('Talk deleted.'); location.hash = '#/talks'; } catch (e) { flash(e.message, 'err'); }
    };
    if (!canEdit()) return;
    document.getElementById('cp').onclick = async () => { const r = await api('/talks', { body: { copy_from: t.id } }); location.hash = '#/talks/' + r.row.id; };
    document.getElementById('cl').onclick = async () => { await api(`/talks/${t.id}/close`, { body: {} }); route(); };
  }

  function libraryPreview(t) {
    setMain(`<p><a href="#/talks?tab=library">Back to the library</a></p>
      <div class="ad-head"><div><h1>${esc(t.title)}</h1><p class="muted">${[t.ref, t.category].filter(Boolean).map(esc).join(' · ')}</p></div>${canEdit() ? '<button class="btn" id="iss">Issue this talk</button>' : ''}</div>
      ${t.intro ? `<div class="panel"><p style="margin:0">${esc(t.intro)}</p></div>` : ''}
      ${t.sections.map((s, i) => `<div class="panel"><span class="k" style="font-family:var(--mono);font-size:11px;color:var(--faint);font-weight:700">PART ${i + 1}</span><h2>${esc(s.heading)}</h2><p style="white-space:pre-wrap;margin:0">${esc(s.body)}</p></div>`).join('')}
      ${t.questions.length ? `<h2>Questions</h2><div class="panel">${t.questions.map((x, i) => `<p><b>${i + 1}. ${esc(x.question)}</b><br>${x.options.map((o, j) => (j === x.answer ? `<b>${esc(o)}</b> <span class="pill yes">correct</span>` : esc(o))).join('<br>')}</p>`).join('')}</div>` : ''}`);
    if (canEdit()) document.getElementById('iss').onclick = () => issueDialog(t);
  }

  function talkEditor(row, js) {
    let sections = row.sections.map(s => ({ ...s }));
    let questions = row.questions.map(x => ({ ...x, options: [...x.options] }));
    function draw() {
      const lib = row.status === 'library';
      setMain(`<p><a href="#/talks${lib ? '?tab=library' : ''}">Back to toolbox talks</a></p>
        <div class="ad-head"><div><h1>${esc(row.title)}</h1><p class="muted">${lib ? 'Library talk. Changes apply to future issues; anything already issued keeps the version people signed.' : 'Draft. Nobody can see it until you issue it. Once issued it is locked, so everyone signs the same thing.'}</p></div>
          <div style="display:flex;gap:.5rem"><button class="btn ghost" id="del">Delete</button><button class="btn ${lib ? '' : 'ghost'}" id="save">Save</button>${lib ? '' : '<button class="btn" id="iss">Issue</button>'}</div></div>
        <div class="panel"><div class="row">${field('Title', input('ti', row.title))}${field('Reference', input('rf', row.ref), 'optional, e.g. TBT-01')}
          ${lib ? field('Category', input('ct', row.category, 'text', 'list="cats"'), 'groups the library') + '<datalist id="cats"><option>General</option><option>Working at height</option><option>Manual handling</option><option>Health</option><option>Tools and equipment</option><option>Site safety</option></datalist>'
            : field('Who signs it', `<select id="jb"><option value="">Everyone</option>${opt(js.filter(j => j.status === 'live'), row.job_id)}</select>`)}</div>
          ${field('Introduction', `<textarea id="in">${esc(row.intro || '')}</textarea>`, 'optional, shown first')}</div>
        <h2>Content</h2><p class="muted small">Each part is one screen on the phone. Paste in your talk and split it into short parts.</p>
        <div>${sections.map((s, i) => `<div class="ed-block"><div class="ed-tools"><button class="btn quiet small" data-su="${i}" ${i === 0 ? 'disabled' : ''}>Move up</button><button class="btn quiet small" data-sd="${i}" ${i === sections.length - 1 ? 'disabled' : ''}>Move down</button><button class="btn quiet small" data-sx="${i}" style="color:var(--brick)">Remove</button></div>
          ${field('Heading', `<input data-sh="${i}" value="${esc(s.heading)}">`)}${field('Content', `<textarea data-sb="${i}" rows="7">${esc(s.body)}</textarea>`)}</div>`).join('') || '<p class="muted">No content yet.</p>'}</div>
        <p><button class="btn ghost small" id="addSec">Add part</button></p>
        <h2 style="margin-top:1.5rem">Questions</h2><p class="muted small">Optional. All answers must be right to sign; wrong ones are highlighted and they try again. Mark the correct option with the round button.</p>
        <div>${questions.map((x, i) => `<div class="ed-block"><div class="ed-tools"><button class="btn quiet small" data-qx="${i}" style="color:var(--brick)">Remove question</button></div>
          ${field(`Question ${i + 1}`, `<input data-qq="${i}" value="${esc(x.question)}">`)}
          ${x.options.map((o, j) => `<div class="ed-opt"><input type="radio" name="ans${i}" data-qa="${i}" value="${j}" ${x.answer === j ? 'checked' : ''} aria-label="Correct answer"><input data-qo="${i}:${j}" value="${esc(o)}"><button class="btn quiet small" data-qox="${i}:${j}" ${x.options.length <= 2 ? 'disabled' : ''}>Remove</button></div>`).join('')}
          <button class="btn quiet small" data-qadd="${i}">Add option</button></div>`).join('') || '<p class="muted">No questions.</p>'}</div>
        <p><button class="btn ghost small" id="addQ">Add question</button></p>`);
      const m = main();
      m.querySelectorAll('[data-sh]').forEach(el => (el.oninput = () => (sections[el.dataset.sh].heading = el.value)));
      m.querySelectorAll('[data-sb]').forEach(el => (el.oninput = () => (sections[el.dataset.sb].body = el.value)));
      m.querySelectorAll('[data-qq]').forEach(el => (el.oninput = () => (questions[el.dataset.qq].question = el.value)));
      m.querySelectorAll('[data-qo]').forEach(el => (el.oninput = () => { const [i, j] = el.dataset.qo.split(':'); questions[i].options[j] = el.value; }));
      m.querySelectorAll('[data-qa]').forEach(el => (el.onchange = () => (questions[el.dataset.qa].answer = Number(el.value))));
      const keep = () => { row.title = v('ti'); row.ref = v('rf'); row.intro = v('in'); if (lib) row.category = v('ct'); else row.job_id = v('jb') || null; };
      m.querySelectorAll('[data-su],[data-sd]').forEach(b => (b.onclick = () => { keep(); const i = Number(b.dataset.su ?? b.dataset.sd), j = b.dataset.su != null ? i - 1 : i + 1; [sections[i], sections[j]] = [sections[j], sections[i]]; draw(); }));
      m.querySelectorAll('[data-sx]').forEach(b => (b.onclick = () => { keep(); sections.splice(Number(b.dataset.sx), 1); draw(); }));
      m.querySelectorAll('[data-qx]').forEach(b => (b.onclick = () => { keep(); questions.splice(Number(b.dataset.qx), 1); draw(); }));
      m.querySelectorAll('[data-qadd]').forEach(b => (b.onclick = () => { keep(); questions[b.dataset.qadd].options.push(''); draw(); }));
      m.querySelectorAll('[data-qox]').forEach(b => (b.onclick = () => { keep(); const [i, j] = b.dataset.qox.split(':').map(Number); const x = questions[i]; x.options.splice(j, 1); if (x.answer === j) x.answer = 0; else if (x.answer > j) x.answer--; draw(); }));
      document.getElementById('addSec').onclick = () => { keep(); sections.push({ heading: '', body: '' }); draw(); };
      document.getElementById('addQ').onclick = () => { keep(); questions.push({ question: '', options: ['', ''], answer: 0 }); draw(); };
      const save = async quiet => { keep(); const r = await api('/talks/' + row.id, { method: 'PUT', body: { ...row, sections, questions } }); Object.assign(row, r.row); if (!quiet) flash('Saved.'); };
      document.getElementById('save').onclick = () => save().catch(e => flash(e.message, 'err'));
      document.getElementById('del').onclick = async () => { if (!confirm(`Delete ${lib ? 'this library talk' : 'this draft'}?`)) return; try { await api('/talks/' + row.id, { method: 'DELETE' }); location.hash = '#/talks' + (lib ? '?tab=library' : ''); } catch (e) { flash(e.message, 'err'); } };
      if (!lib) document.getElementById('iss').onclick = async () => {
        try {
          await save(true);
          if (!confirm(`Issue "${row.title}"? You'll get a link to send out, and the content is locked.`)) return;
          await api(`/talks/${row.id}/issue`, { body: {} }); route();
        } catch (e) { flash(e.message, 'err'); }
      };
    }
    draw();
  }

  // ---------- signatures to match ----------
  async function unmatched() {
    const [d, all] = await Promise.all([api('/unmatched'), ops(true)]);
    const groups = {};
    d.rows.forEach(s => { const k = `${s.name_given.toLowerCase()}|${s.phone_given || ''}`; (groups[k] = groups[k] || []).push(s); });
    const act = all.filter(o => o.active);
    setMain(`<div class="ad-head"><div><p class="muted">People who signed but didn't match anyone on the register (new starter, different number, or a typo). Match them to someone, or add them as a new {op}.</p></div></div>
      ${Object.keys(groups).length ? Object.values(groups).map(g => `<div class="panel"><div class="ad-head" style="margin:0 0 .6rem"><div><h2 style="margin:0">${esc(g[0].name_given)}</h2><p class="muted small">${esc(g[0].phone_given || 'No number')} · ${g.length} signature${g.length === 1 ? '' : 's'}</p></div>
          ${canEdit() ? `<div style="display:flex;gap:.5rem;align-items:end;flex-wrap:wrap"><select data-pick="${g[0].id}" style="width:auto"><option value="">Match to</option>${opt(act, '', 'full_name')}</select>
            <button class="btn small" data-link="${g[0].id}">Match</button><button class="btn small ghost" data-create="${g[0].id}">Add as new {op}</button><button class="btn small quiet" data-remove="${g.map(s => s.id).join(',')}" title="Delete these signatures (test signatures, wrong person)">Remove</button></div>` : ''}</div>
          <ul class="small" style="margin:0;padding-left:1.1rem">${g.map(s => `<li>${s.talk ? `Toolbox talk: ${esc(s.talk)}` : `${esc(s.job)}: ${esc(s.doc)}`}, ${fDT(s.signed_at)}</li>`).join('')}</ul></div>`).join('')
        : '<div class="empty"><b>Nothing to match.</b>Every signature is linked to someone on the register.</div>'}`);
    main().querySelectorAll('[data-link]').forEach(b => (b.onclick = async () => {
      const opId = main().querySelector(`[data-pick="${b.dataset.link}"]`).value;
      if (!opId) return flash('Choose who it is first.', 'err');
      try { await api(`/signoffs/${b.dataset.link}/link`, { body: { operative_id: opId } }); bust(); route(); } catch (e) { flash(e.message, 'err'); }
    }));
    main().querySelectorAll('[data-create]').forEach(b => (b.onclick = async () => {
      try { const r = await api(`/signoffs/${b.dataset.create}/link`, { body: { create: true } }); bust(); location.hash = '#/operatives/' + r.operative_id; } catch (e) { flash(e.message, 'err'); }
    }));
    main().querySelectorAll('[data-remove]').forEach(b => (b.onclick = async () => {
      const ids = b.dataset.remove.split(',');
      if (!confirm(`Delete ${ids.length === 1 ? 'this signature' : `these ${ids.length} signatures`}? Use this for test signatures or someone who should not be on the register. It cannot be undone.`)) return;
      try { for (const id of ids) await api(`/signoffs/${id}`, { method: 'DELETE' }); flash('Removed.'); route(); } catch (e) { flash(e.message, 'err'); }
    }));
  }

  // ---------- settings ----------
  // ---------- company policies ----------
  function adminSigPad(canvas) {
    const ctx = canvas.getContext('2d'); let drawing = false, dirty = false;
    const r0 = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = r0.width * dpr; canvas.height = r0.height * dpr; ctx.scale(dpr, dpr); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#18201b';
    const pt = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', e => { drawing = true; canvas.setPointerCapture(e.pointerId); const p = pt(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    canvas.addEventListener('pointermove', e => { if (!drawing) return; const p = pt(e); ctx.lineTo(p.x, p.y); ctx.stroke(); dirty = true; });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => canvas.addEventListener(t, () => { drawing = false; }));
    return { clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; }, empty: () => !dirty, data: () => canvas.toDataURL('image/png') };
  }
  async function policiesView() {
    const d = await api('/policies');
    if (!d.version) return setMain(`<div class="note warn">No policies have arrived from Safety Simplified yet.</div>${isOwner() ? '<p><button class="btn ghost" id="sync">Fetch now</button></p>' : ''}`), isOwner() && (document.getElementById('sync').onclick = async () => { const r = await api('/policies/sync', { body: {} }); flash(r.ok ? 'Fetched.' : r.reason, r.ok ? 'ok' : 'err'); route(); });
    const status = d.needs_signature
      ? `<div class="note warn"><b>${d.due_annual ? 'Annual review due.' : d.signed ? '' : `Version ${d.version} needs the director's signature.`}</b> ${d.last && !d.signed ? `Version ${d.last.version} was signed by ${esc(d.last.signed_name)} on ${fDate(d.last.signed_at)}.` : ''} ${d.note ? `What changed: ${esc(d.note)}` : ''}</div>`
      : `<div class="note ok">Version ${d.version} signed by <b>${esc(d.signed ? d.signed.signed_name : d.last.signed_name)}</b>, ${esc((d.signed || d.last).signed_role || 'Director')}, on ${fDate((d.signed || d.last).signed_at)}.</div>`;
    setMain(`<div class="ad-head"><div><p class="muted">${d.policies.length} policies, version ${d.version}${d.published_at ? `, issued ${fDate(d.published_at)}` : ''}. Maintained by Safety Simplified; the current signed set is what goes to SSIP assessors, principal contractors and clients.</p></div>
        <div class="no-print" style="display:flex;gap:.5rem;flex-wrap:wrap"><a class="btn ghost" href="/api/admin/policies/pdf" target="_blank" rel="noopener">Open PDF</a><a class="btn ghost" href="/api/admin/policies/pdf?download=1">Download PDF</a>${isAdmin() && d.needs_signature ? '<button class="btn" id="sign">Sign the policies</button>' : ''}</div></div>
      ${status}
      ${d.about_editable ? `<div class="panel no-print"><h2>Trade line</h2><p class="small muted">Fills in "{{company}} is …" in the policies. Safety Simplified only.</p><div class="linkbox"><input id="about" value="${esc(d.vars.about)}"><button class="btn small" id="aboutsave">Save</button><button class="btn small ghost" id="sync">Fetch latest</button></div></div>` : ''}
      <div class="panel"><h2>Contents</h2><ol class="small" style="columns:2;margin:0;padding-left:1.2rem">${d.policies.map(p => `<li><a href="#pol-${esc(p.key)}">${esc(p.title)}</a></li>`).join('')}</ol></div>
      ${d.policies.map((p, i) => `<div class="panel pol-doc" id="pol-${esc(p.key)}"><h2>${i + 1}. ${esc(p.title)}</h2>${p.blocks.map(b => b.t === 'h' ? `<h3>${esc(b.text)}</h3>` : b.t === 'ul' ? `<ul>${b.items.map(it => `<li>${esc(it)}</li>`).join('')}</ul>` : `<p>${esc(b.text)}</p>`).join('')}</div>`).join('')}
      ${d.signings.length ? `<div class="panel"><h2>Signing record</h2><div class="tablewrap" style="box-shadow:none"><table><thead><tr><th>Version</th><th>Signed by</th><th>Position</th><th>Date</th><th>Signature</th></tr></thead><tbody>
        ${d.signings.map(s => `<tr><td>${s.version}</td><td>${esc(s.signed_name)}</td><td>${esc(s.signed_role || '')}</td><td>${fDT(s.signed_at)}</td><td><img src="/api/admin/policies/signings/${s.id}/signature" alt="" style="height:34px"></td></tr>`).join('')}</tbody></table></div></div>` : ''}`);
    if (document.getElementById('sign')) document.getElementById('sign').onclick = () => {
      openDlg('Sign the company policies', `<p class="muted">By signing, the director confirms that these policies (version ${d.version}) are approved and issued under their authority for ${esc(brand.name)}.</p>
        <div class="row">${field('Full name', input('sn', d.last ? d.last.signed_name : '', 'text', 'autocomplete="name"'))}${field('Position', input('sr', d.last ? d.last.signed_role || 'Director' : 'Director'))}</div>
        <label>Signature</label><div class="sig-wrap"><canvas id="sig"></canvas></div><p style="margin:0 0 1rem;text-align:right"><button class="btn quiet small" id="clr">Clear</button></p>`,
      '<button class="btn" id="go">Sign</button>');
      const pad = adminSigPad($d('#sig')); $d('#clr').onclick = () => pad.clear();
      $d('#go').onclick = async () => {
        if (pad.empty()) return dlgErr('Sign in the box first.');
        try { await api('/policies/sign', { body: { name: val('#sn'), role: val('#sr'), signature: pad.data() } }); dlg.close(); flash('Policies signed.'); route(); } catch (e) { dlgErr(e.message); }
      };
    };
    if (document.getElementById('aboutsave')) document.getElementById('aboutsave').onclick = async () => { await api('/policies/about', { method: 'PUT', body: { about: v('about') } }); flash('Saved.'); route(); };
    if (document.getElementById('sync')) document.getElementById('sync').onclick = async () => { const r = await api('/policies/sync', { body: {} }); flash(r.ok ? (r.added ? `Version ${r.version} received.` : `Already on version ${r.version}.`) : r.reason, r.ok ? 'ok' : 'err'); route(); };
  }

  // ---------- RAMS master (Safety Simplified) ----------
  const blocksToText = blocks => (blocks || []).map(b => (b.t === 'h' ? `## ${b.text}` : b.t === 'b' ? `- ${b.text}` : b.text)).join('\n');
  const textToBlocks = text => String(text || '').split(/\n/).map(l => l.trim()).filter(Boolean).map(l => (/^##\s*/.test(l) ? { t: 'h', text: l.replace(/^##\s*/, '') } : /^[-•*]\s*/.test(l) ? { t: 'b', text: l.replace(/^[-•*]\s*/, '') } : { t: 'p', text: l }));
  async function ramsMaster() {
    if (!isOwner()) return setMain('<div class="note warn">This page is for Safety Simplified.</div>');
    const d = await api('/rams/master');
    if (!d.master) return setMain('<div class="note warn">No RAMS master in this portal yet. It comes from the build (client/rams-master.json).</div>');
    const m = d.master.body, df = m.defaults || {};
    const ta = (id, value, rows) => `<textarea id="${id}" rows="${rows}" style="font-family:var(--mono);font-size:12px">${esc(value ?? '')}</textarea>`;
    const risk = (r, i) => `<tr data-risk="${i}"><td><textarea rows="3">${esc(r.activity)}</textarea></td><td><textarea rows="3">${esc(r.hazards)}</textarea></td>
      <td><input type="number" min="1" max="3" value="${r.likelihood}"></td><td><input type="number" min="1" max="3" value="${r.severity}"></td>
      <td><textarea rows="3">${esc(r.controls)}</textarea></td><td><input value="${esc(r.by_whom)}"></td><td><input type="number" min="1" max="9" value="${r.residual}"></td>
      <td><textarea rows="3">${esc(r.persons)}</textarea></td><td><button class="btn small quiet" data-del>Remove</button></td></tr>`;
    const coshh = (c, i) => `<div class="panel" data-coshh="${i}"><div class="row">${field('Substance', `<input class="c-sub" value="${esc(c.substance)}">`)}${field('Hazard symbols', `<input class="c-sym" value="${esc((c.symbols || []).join(', '))}">`, 'comma separated')}</div>
      ${field('Health risks', `<textarea class="c-hr" rows="3">${esc(c.health_risks)}</textarea>`)}${field('First aid and emergency', `<textarea class="c-fa" rows="3">${esc(c.first_aid)}</textarea>`)}
      ${field('PPE and control requirements', `<textarea class="c-ct" rows="3">${esc(c.controls)}</textarea>`)}${field('Review', `<textarea class="c-rv" rows="2">${esc(c.review)}</textarea>`)}
      <p><button class="btn small quiet" data-del>Remove substance</button></p></div>`;
    setMain(`<div class="ad-head"><div><p class="muted">Version ${d.master.version}, ${esc(d.master.created_by || '')}, ${fDate(d.master.created_at)}. Saving makes a new version; RAMS already issued keep the version they were made from, and the next issue on any site uses the new one.</p></div>
        <button class="btn" id="save">Save as version ${d.master.version + 1}</button></div>
      <div class="panel"><h2>Site sheet defaults</h2><p class="small muted">Pre-filled on every new RAMS; can be changed per site.</p>
        <div class="row">${field('Ref', input('m-ref', m.ref || ''))}${field('Author', input('m-author', df.author || ''))}${field('Reviewer', input('m-reviewer', df.reviewer || ''))}</div>
        <div class="row">${field('Emergency contact', `<textarea id="m-ec" rows="2">${esc(df.emergency_contact || '')}</textarea>`)}${field('Site supervisor', input('m-sup', df.site_supervisor || ''))}${field('Review period (months)', input('m-rev', df.review_months || 12, 'number'))}</div>
        ${field('Scope of work', `<textarea id="m-scope" rows="2">${esc(df.scope || '')}</textarea>`)}</div>
      <div class="panel"><h2>Method statement</h2><p class="small muted">One box per section. Lines starting with <code>- </code> are bullets, lines starting with <code>## </code> are sub-headings, anything else is a paragraph.</p>
        <div id="secs">${m.sections.map((sec, i) => `<div data-sec="${i}">${field(`<input class="sec-label" value="${esc(sec.label)}" style="font-weight:700;max-width:360px">`, ta('sec-' + i, blocksToText(sec.blocks), Math.min(18, Math.max(3, sec.blocks.length + 1))))}<p class="small"><button class="btn small quiet" data-del>Remove section</button></p></div>`).join('')}</div>
        <button class="btn ghost small" id="addsec">Add section</button></div>
      <div class="panel"><h2>Risk assessments</h2><p class="small muted">Risk rating is likelihood × severity (1 to 3 each).</p>
        <div class="tablewrap" style="box-shadow:none"><table class="risk-edit"><thead><tr><th>Activity</th><th>Hazards</th><th>L</th><th>S</th><th>Controls</th><th>By whom</th><th>Residual</th><th>Persons at risk</th><th></th></tr></thead><tbody id="risks">${m.risks.map(risk).join('')}</tbody></table></div>
        <button class="btn ghost small" id="addrisk">Add risk</button></div>
      <div class="panel"><h2>COSHH assessments</h2><div id="coshh">${(m.coshh || []).map(coshh).join('')}</div><button class="btn ghost small" id="addcoshh">Add substance</button></div>
      <div class="panel"><h2>Sign-off wording</h2>${field('Principal contractor sign-off', `<textarea id="m-pc" rows="4">${esc(m.pc_signoff_text || '')}</textarea>`)}${field('Operative sign-off', `<textarea id="m-op" rows="6">${esc(m.operative_signoff_text || '')}</textarea>`)}</div>
      ${field('Note for this version', input('m-note', ''), 'what changed, for the record')}
      <p><button class="btn" id="save2">Save as version ${d.master.version + 1}</button></p>`);
    const mainEl = main();
    const wire = () => mainEl.querySelectorAll('[data-del]').forEach(b => (b.onclick = () => { b.closest('[data-sec],[data-risk],[data-coshh]').remove(); }));
    wire();
    document.getElementById('addsec').onclick = () => { const i = Date.now(); document.getElementById('secs').insertAdjacentHTML('beforeend', `<div data-sec="${i}">${field(`<input class="sec-label" value="" placeholder="Section heading" style="font-weight:700;max-width:360px">`, ta('sec-' + i, '', 4))}<p class="small"><button class="btn small quiet" data-del>Remove section</button></p></div>`); wire(); };
    document.getElementById('addrisk').onclick = () => { document.getElementById('risks').insertAdjacentHTML('beforeend', risk({ activity: '', hazards: '', likelihood: 2, severity: 3, controls: '', by_whom: 'Con', residual: 2, persons: 'Employee' }, Date.now())); wire(); };
    document.getElementById('addcoshh').onclick = () => { document.getElementById('coshh').insertAdjacentHTML('beforeend', coshh({ substance: '', symbols: [], health_risks: '', first_aid: '', controls: '', review: 'Please see Health and Safety Data sheet. This COSHH Assessment will be reviewed annually or when the product, task or conditions change.' }, Date.now())); wire(); };
    const save = async () => {
      const body = { ...m, title: m.title, ref: v('m-ref'),
        defaults: { author: v('m-author'), reviewer: v('m-reviewer'), emergency_contact: v('m-ec'), site_supervisor: v('m-sup'), review_months: Number(v('m-rev')) || 12, scope: v('m-scope') },
        sections: [...mainEl.querySelectorAll('[data-sec]')].map(el => ({ label: el.querySelector('.sec-label').value.trim(), blocks: textToBlocks(el.querySelector('textarea').value) })).filter(x => x.label && x.blocks.length),
        risks: [...mainEl.querySelectorAll('[data-risk]')].map(tr => { const f = tr.querySelectorAll('textarea,input'); const L = Number(f[2].value) || 1, S = Number(f[3].value) || 1;
          return { activity: f[0].value.trim(), hazards: f[1].value.trim(), likelihood: L, severity: S, rating: L * S, controls: f[4].value.trim(), by_whom: f[5].value.trim(), residual: Number(f[6].value) || 1, persons: f[7].value.trim() }; }).filter(x => x.activity),
        coshh: [...mainEl.querySelectorAll('[data-coshh]')].map(el => ({ substance: el.querySelector('.c-sub').value.trim(), symbols: el.querySelector('.c-sym').value.split(',').map(x => x.trim()).filter(Boolean),
          health_risks: el.querySelector('.c-hr').value.trim(), first_aid: el.querySelector('.c-fa').value.trim(), controls: el.querySelector('.c-ct').value.trim(), review: el.querySelector('.c-rv').value.trim() })).filter(x => x.substance),
        pc_signoff_text: v('m-pc'), operative_signoff_text: v('m-op') };
      try { const r = await api('/rams/master', { method: 'PUT', body: { body, note: v('m-note') } }); flash(`Saved as version ${r.version}.`); route(); } catch (e) { flash(e.message, 'err'); }
    };
    document.getElementById('save').onclick = save; document.getElementById('save2').onclick = save;
  }

  async function settings() {
    if (!isOwner()) return setMain('<div class="note warn">This page is for Safety Simplified.</div>');
    const [acc, ts] = await Promise.all([api('/account'), types(true)]);
    setMain(`<div class="panel"><h2>Direct Debit link</h2><p class="small muted">The GoCardless link for this client. Their admins see a "Set up Direct Debit" button on the Users page.</p>
        <div class="linkbox"><input id="dd" value="${esc(acc.dd_link)}" placeholder="https://pay.gocardless.com/..."><button class="btn small" id="ddsave">Save link</button></div></div>
      <div class="panel"><div class="ad-head" style="margin-bottom:.6rem"><div><h2 style="margin:0">Training list</h2><p class="small muted" style="margin:0">The columns on the training matrix. Required ones show as missing for anyone without them.</p></div><button class="btn small" id="at">Add training</button></div>
        <div class="tablewrap" style="box-shadow:none"><table><thead><tr><th>Training</th><th>Required for everyone</th><th>Valid for</th><th></th></tr></thead><tbody>
          ${ts.map(t => `<tr><td><b>${esc(t.name)}</b>${t.active ? '' : ' <span class="pill grey">hidden</span>'}</td><td>${t.required ? 'Yes' : ''}</td><td>${t.validity_months ? `${t.validity_months} months` : 'No expiry'}</td>
            <td><button class="btn small quiet" data-t="${t.id}">Edit</button></td></tr>`).join('')}</tbody></table></div></div>`);
    document.getElementById('ddsave').onclick = async () => {
      try { await api('/settings', { method: 'PUT', body: { dd_link: v('dd') } }); flash('Link saved.'); } catch (e) { flash(e.message, 'err'); }
    };
    const editType = (t = {}) => {
      openDlg(t.id ? 'Edit training type' : 'Add training type', `${field('Name', input('nm', t.name))}
        ${field('Valid for (months)', input('vm', t.validity_months, 'number', 'min="1"'), 'leave empty if it does not expire; used to fill in expiry dates')}
        <label class="check" style="margin-bottom:.6rem"><input type="checkbox" id="rq" ${t.required ? 'checked' : ''}> Required for everyone</label>
        ${t.id ? `<label class="check"><input type="checkbox" id="ac" ${t.active ? 'checked' : ''}> Show on the matrix</label>` : ''}`, '<button class="btn" id="save">Save</button>');
      $d('#save').onclick = async () => {
        const body = { name: val('#nm'), validity_months: val('#vm'), required: $d('#rq').checked, active: t.id ? $d('#ac').checked : true };
        try { await api(t.id ? '/qual-types/' + t.id : '/qual-types', { method: t.id ? 'PUT' : 'POST', body }); dlg.close(); bust(); route(); } catch (e) { dlgErr(e.message); }
      };
    };
    document.getElementById('at').onclick = () => editType();
    main().querySelectorAll('[data-t]').forEach(b => (b.onclick = () => editType(ts.find(t => String(t.id) === b.dataset.t))));
  }


  // ---------- occupational health ----------
  async function healthView(params, id) {
    if (!isAdmin()) return setMain('<div class="note warn">Health questionnaires are confidential. Only admins and Safety Simplified can open them.</div>');
    if (id) return healthDetail(id);
    const d = await api('/health');
    const tab = params.get('tab') || 'register';
    const ST = { new: ['Needs review', 'no'], reviewed: ['Reviewed', 'yes'], referred: ['Referred', 'under_review'], closed: ['Closed', 'grey'] };
    const flagPills = f => (f && f.length ? f.map(x => `<span class="pill no">${esc(d.flag_labels[x] || x)}</span>`).join(' ') : '<span class="pill yes">No flags</span>');
    const needs = d.rows.filter(x => x.status === 'new');
    setMain(`<div class="ad-head"><div><p class="muted">Hand-arm vibration, noise and skin health questionnaire for {ops}: a baseline for new starters, then once a year, and whenever someone reports symptoms. Send the link; they answer and sign on their phone. Anything that needs a follow-up is flagged here for you.</p></div>
        <div style="display:flex;gap:.5rem"><a class="btn ghost" href="/api/admin/health/export.csv">Export CSV</a><button class="btn quiet" id="newlink">New link</button></div></div>
      <div class="panel"><h2 style="margin-top:0">Questionnaire link</h2>${shareBox(d.link, '/api/admin/health/qr.svg', 'Please fill in your health questionnaire (vibration, noise and skin). It takes about five minutes and is confidential:')}</div>
      ${needs.length ? `<div class="note warn">${needs.length} questionnaire${needs.length === 1 ? '' : 's'} to review${needs.some(x => x.flags.length) ? `, ${needs.filter(x => x.flags.length).length} with flags` : ''}.</div>` : ''}
      <div class="tabs"><button data-tab="register" class="${tab === 'register' ? 'on' : ''}">Register (${d.rows.length})</button><button data-tab="due" class="${tab === 'due' ? 'on' : ''}">Not done or due (${d.never.length + d.due.length})</button></div>
      ${tab === 'register' ? `<div class="tablewrap">${d.rows.length ? `<table><thead><tr><th>Name</th><th>Questionnaire</th><th>Submitted</th><th>Flags</th><th>Status</th></tr></thead><tbody>
        ${d.rows.map(x => `<tr class="click" data-id="${x.id}"><td><b>${esc(x.full_name || x.name_given)}</b>${x.operative_id ? '' : ' <span class="pill grey">not on register</span>'}<div class="small muted">${esc(x.role || '')}</div></td>
          <td>${esc(d.kinds[x.kind] || x.kind)}</td><td>${fDate(x.submitted_at)}</td><td>${flagPills(x.flags)}</td>
          <td><span class="pill ${ST[x.status][1]}">${ST[x.status][0]}</span>${x.reviewed_by ? `<div class="small muted">${esc(x.reviewed_by)}, ${fDate(x.reviewed_at)}</div>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty"><b>No questionnaires yet.</b>Send the link above and completed questionnaires appear here.</div>'}</div>`
      : `<div class="tablewrap"><table><thead><tr><th>Name</th><th>Role</th><th>Last questionnaire</th></tr></thead><tbody>
        ${d.due.map(x => `<tr><td><a href="#/operatives/${x.id}">${esc(x.full_name)}</a></td><td></td><td><span class="pill under_review">${fDate(x.last)}</span> <span class="small muted">annual review due</span></td></tr>`).join('')}
        ${d.never.map(x => `<tr><td><a href="#/operatives/${x.id}">${esc(x.full_name)}</a></td><td>${esc(x.role || '')}</td><td><span class="pill no">Never</span></td></tr>`).join('')}
        ${!d.due.length && !d.never.length ? '<tr><td colspan="3" class="muted">Everyone on the register has a questionnaire from the last 11 months.</td></tr>' : ''}</tbody></table></div>`}`);
    main().querySelectorAll('[data-tab]').forEach(b => (b.onclick = () => (location.hash = '#/health?tab=' + b.dataset.tab)));
    main().querySelectorAll('tr[data-id]').forEach(tr => (tr.onclick = () => (location.hash = '#/health/' + tr.dataset.id)));
    document.getElementById('newlink').onclick = async () => {
      if (!confirm('Make a new link? The old one stops working, so anyone you have already sent it to will need the new one.')) return;
      await api('/health/new-link', { body: {} }); flash('New link made.'); route();
    };
  }

  async function healthDetail(id) {
    const [d, allOps] = await Promise.all([api('/health/' + id), ops()]);
    const x = d.row, Q = d.questionnaire;
    const ST = { new: 'Needs review', reviewed: 'Reviewed, no action', referred: 'Referred to occupational health', closed: 'Closed' };
    const yes = (sec) => sec.questions.filter(qq => (x.answers[qq.id] || {}).a === 'yes');
    setMain(`<p class="no-print"><a href="#/health">Back to occupational health</a></p>
      <div class="ad-head"><div><h1>${esc(x.full_name || x.name_given)}</h1><p class="muted">${esc(Q.kinds[x.kind] || x.kind)} · submitted ${fDT(x.submitted_at)}${x.dob ? ` · date of birth ${fDate(x.dob)}` : ''}${x.phone_given ? ` · ${esc(x.phone_given)}` : ''}</p></div>
        <div style="display:flex;gap:.5rem"><button class="btn ghost no-print" onclick="window.print()">Print</button><button class="btn" id="rev">Review</button></div></div>
      ${x.flags.length ? `<div class="note warn"><b>Needs a follow-up.</b> ${x.flags.map(f => esc((Q.sections.find(s => s.flag === f) || {}).flag_label || f)).join('; ')}. ${x.flags.includes('havs') ? 'HAVS symptoms mean a referral to an occupational health professional (tier 3), and the person should not wait for their next review. ' : ''}${x.flags.includes('hearing') ? 'Hearing symptoms mean arranging a formal hearing test (audiometry). ' : ''}${x.flags.includes('skin') ? 'Skin symptoms mean a check of the substances and gloves in use and, if symptoms persist, a referral. ' : ''}</div>`
        : '<div class="note ok">No symptoms flagged. Keep on the annual cycle.</div>'}
      <div class="panel"><h2 style="margin-top:0">Status</h2><p style="margin:0"><b>${ST[x.status] || x.status}</b>${x.reviewed_by ? ` <span class="muted">by ${esc(x.reviewed_by)}, ${fDT(x.reviewed_at)}</span>` : ''}</p>${x.review_note ? `<p class="muted" style="white-space:pre-wrap;margin:.5rem 0 0">${esc(x.review_note)}</p>` : ''}
        ${!x.operative_id ? `<p class="small muted" style="margin:.6rem 0 0">This name did not match anyone on the register. Use Review to link it to the right person.</p>` : ''}</div>
      <div class="panel"><h2 style="margin-top:0">About</h2><dl class="info-list" style="border:0;margin:0">
        <div><dt>Time in role</dt><dd>${esc(x.time_in_role || 'Not given')}</dd></div><div><dt>Previous vibration or noise exposure</dt><dd style="white-space:pre-wrap">${esc(x.previous_exposure || 'None given')}</dd></div></dl></div>
      ${Q.sections.map(sec => `<div class="panel"><h2 style="margin-top:0">${esc(sec.title)} ${yes(sec).length ? `<span class="pill ${sec.questions.some(qq => qq.flag && (x.answers[qq.id] || {}).a === 'yes') ? 'no' : 'under_review'}">${yes(sec).length} yes</span>` : '<span class="pill yes">All no</span>'}</h2>
        <div class="tablewrap" style="box-shadow:none"><table><tbody>${sec.questions.map(qq => { const a = x.answers[qq.id] || {}; return `<tr style="${a.a === 'yes' ? 'background:#fff8f0' : ''}"><td class="small muted" style="white-space:nowrap">${esc(qq.id)}</td><td>${esc(qq.text)}${a.d ? `<div class="small" style="margin-top:.25rem"><b>${esc(qq.detail || 'Details')}:</b> ${esc(a.d)}</div>` : ''}</td>
          <td style="white-space:nowrap"><span class="pill ${a.a === 'yes' ? (qq.flag ? 'no' : 'under_review') : 'grey'}">${a.a === 'yes' ? 'Yes' : 'No'}</span></td></tr>`; }).join('')}</tbody></table></div></div>`).join('')}
      <div class="panel"><h2 style="margin-top:0">Declaration</h2><p class="small muted">${esc(Q.declaration)}</p><img src="/api/admin/health/${x.id}/signature" alt="Signature" style="height:60px;display:block;border:1px solid var(--line);border-radius:6px;padding:4px;background:#fff"><p class="small muted" style="margin:.4rem 0 0">Signed ${fDT(x.submitted_at)}</p></div>
      ${d.previous.length ? `<div class="panel"><h2 style="margin-top:0">Previous questionnaires</h2><div class="tablewrap" style="box-shadow:none"><table><tbody>${d.previous.map(pv => `<tr class="click" data-id="${pv.id}"><td>${fDate(pv.submitted_at)}</td><td>${esc(Q.kinds[pv.kind] || pv.kind)}</td><td>${pv.flags.length ? pv.flags.map(f => `<span class="pill no">${esc((Q.sections.find(s => s.flag === f) || {}).flag_label || f)}</span>`).join(' ') : '<span class="pill yes">No flags</span>'}</td><td>${ST[pv.status] || pv.status}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`);
    main().querySelectorAll('tr[data-id]').forEach(tr => (tr.onclick = () => (location.hash = '#/health/' + tr.dataset.id)));
    document.getElementById('rev').onclick = () => {
      openDlg('Review questionnaire', `${field('Outcome', `<select id="st">${Object.entries(ST).map(([k, l]) => `<option value="${k}" ${x.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${field('Note', `<textarea id="nt" rows="4">${esc(x.review_note || '')}</textarea>`, 'what was done, who was referred where, dates')}
        ${field('On the register as', `<select id="op"><option value="">Not linked</option>${opt(allOps.filter(o => o.active || o.id === x.operative_id), x.operative_id, 'full_name')}</select>`)}`,
      '<button class="btn" id="save">Save</button>');
      $d('#save').onclick = async () => {
        try { await api('/health/' + x.id, { method: 'PUT', body: { status: val('#st'), review_note: val('#nt'), operative_id: val('#op') || null } }); dlg.close(); flash('Saved.'); route(); } catch (e) { dlgErr(e.message); }
      };
    };
  }

  // ---------- users ----------
  async function users() {
    if (!isAdmin()) return setMain('<div class="note warn">Only admins can manage users.</div>');
    const d = await api('/users');
    const roleName = { owner: 'Safety Simplified', admin: 'Admin', manager: 'Manager', viewer: 'View only' };
    if (!isOwner()) delete roleName.owner;
    const [acc, rem] = await Promise.all([api('/account'), api('/reminders')]);
    setMain(`<div class="panel"><div class="ad-head" style="margin:0 0 .5rem"><div><h2 style="margin:0">Training expiry reminders</h2>
          <p class="small muted" style="margin:0">Every Monday morning the portal emails a list of cards that have expired, cards expiring in the next ${rem.expiring_days} days, and anyone missing a required card. Right now: ${rem.counts.expired} expired, ${rem.counts.expiring} expiring, ${rem.counts.missing} missing.${rem.last ? ` Last sent ${fDate(rem.last)}.` : ''}</p></div>
          <div style="display:flex;gap:.5rem"><a class="btn small ghost" href="/api/admin/reminders/preview" target="_blank" rel="noopener">Preview</a><button class="btn small ghost" id="remsend">Send now</button></div></div>
        ${rem.configured ? '' : '<div class="note warn">Email sending is not switched on for this portal yet. Safety Simplified will turn it on; the list below is saved in the meantime.</div>'}
        ${field('Send to', `<input id="remto" value="${esc(rem.emails)}" placeholder="${esc(rem.recipients.join(', '))}">`, 'email addresses separated by commas; leave empty to send to every admin login')}
        <button class="btn small" id="remsave">Save recipients</button></div>
      ${acc.dd_link ? `<div class="panel"><div class="ad-head" style="margin:0;align-items:center"><div><h2 style="margin:0">Your account</h2><p class="small muted" style="margin:0">Your subscription with Safety Simplified is paid by Direct Debit, handled securely by GoCardless.</p></div>
        <a class="btn" href="${esc(acc.dd_link)}" target="_blank" rel="noopener">Set up Direct Debit</a></div></div>` : ''}
      <div class="ad-head"><div><p class="muted">Office staff who log in here. {Ops} don't need accounts; they use the links you send.</p></div><button class="btn" id="add">Add user</button></div>
      <div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
        ${d.rows.map(u => `<tr><td><b>${esc(u.name)}</b>${u.active ? '' : ' <span class="pill grey">disabled</span>'}</td><td>${esc(u.email)}</td><td>${roleName[u.role]}</td>
          <td><button class="btn small quiet" data-u="${u.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`);
    document.getElementById('remsave').onclick = async () => {
      try { const r = await api('/reminders', { method: 'PUT', body: { emails: v('remto') } }); flash(`Saved. Reminders go to ${r.recipients.join(', ')}.`); } catch (e) { flash(e.message, 'err'); }
    };
    document.getElementById('remsend').onclick = async () => {
      if (!confirm('Send the reminder email now to ' + (v('remto') || rem.recipients.join(', ')) + '?')) return;
      try { const r = await api('/reminders/send', { body: {} }); flash(r.sent ? `Sent to ${r.to.join(', ')}.` : r.reason, r.sent ? 'ok' : 'err'); } catch (e) { flash(e.message, 'err'); }
    };
    document.getElementById('add').onclick = () => {
      openDlg('Add user', `${field('Name', input('n', ''))}${field('Email', input('e', '', 'email'))}
        ${field('Role', `<select id="r">${['manager', 'viewer', 'admin', 'owner'].filter(k => roleName[k]).map(k => `<option value="${k}">${roleName[k]}</option>`).join('')}</select>`)}
        ${field('Temporary password', input('p', ''), 'at least 8 characters; they can change it after logging in')}`, '<button class="btn" id="save">Add user</button>');
      $d('#save').onclick = async () => {
        try { await api('/users', { body: { name: val('#n'), email: val('#e'), role: val('#r'), password: val('#p') } }); dlg.close(); users(); } catch (e) { dlgErr(e.message); }
      };
    };
    main().querySelectorAll('[data-u]').forEach(b => (b.onclick = () => {
      const u = d.rows.find(x => String(x.id) === b.dataset.u);
      if (u.role === 'owner' && !isOwner()) return;
      openDlg(u.name, `${field('Role', `<select id="r">${Object.entries(roleName).map(([k, l]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
        <label class="check" style="margin-bottom:1rem"><input type="checkbox" id="a" ${u.active ? 'checked' : ''}> Account active</label>
        ${field('Reset password', input('p', ''), 'leave empty to keep the current one')}`, '<button class="btn" id="save">Save changes</button>');
      $d('#save').onclick = async () => {
        try { await api('/users/' + u.id, { method: 'PUT', body: { role: val('#r'), active: $d('#a').checked, password: val('#p') || undefined } }); dlg.close(); users(); } catch (e) { dlgErr(e.message); }
      };
    }));
  }

  boot().catch(e => (root.innerHTML = `<div class="login-wrap"><div class="login-card"><div class="note err">${esc(e.message)}</div></div></div>`));
})();
