// Contractor portal: office side.
(() => {
  const root = document.getElementById('root');
  const dlg = document.getElementById('dlg');
  let me = null;
  let brand = { name: 'Portal' };
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
  const isAdmin = () => me && me.role === 'admin';
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
  const setMain = html => { main().innerHTML = html; };
  function flash(msg, kind = 'ok') {
    const n = document.createElement('div'); n.className = `note ${kind} no-print`; n.textContent = msg;
    main().prepend(n); setTimeout(() => n.remove(), kind === 'err' ? 7000 : 3500);
  }
  function dlgErr(msg) {
    let n = dlg.querySelector('.dlg-body .note.err');
    if (!n) { n = document.createElement('div'); n.className = 'note err'; dlg.querySelector('.dlg-body').prepend(n); }
    n.textContent = msg; n.scrollIntoView({ block: 'nearest' });
  }
  function openDlg(title, body, foot = '') {
    dlg.innerHTML = `<div class="dlg-head"><h2>${esc(title)}</h2><button class="btn quiet" data-close aria-label="Close">Close</button></div>
      <div class="dlg-body">${body}</div>${foot ? `<div class="dlg-foot">${foot}</div>` : ''}`;
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
    document.title = `${brand.name} portal`;
    const s = await api('/api/auth/state');
    if (s.user) { me = s.user; return shell(); }
    showLogin(s);
  }

  async function showLogin(state) {
    const s = state || await api('/api/auth/state');
    const logo = `<img src="/logo" alt="${esc(brand.name)}"><div class="sub">Safety Portal</div>`;
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
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
  };
  const NAV = [
    ['Overview'], ['', 'Dashboard'],
    ['People'], ['operatives', 'Operatives'], ['matrix', 'Training matrix'],
    ['Site work'], ['jobs', 'Jobs & RAMS'], ['talks', 'Toolbox talks'], ['unmatched', 'Signatures to match'],
    ['Admin', 'admin'], ['settings', 'Settings', 'admin'], ['users', 'Users', 'admin'],
  ];
  const CRUMB = { '': 'Health & safety overview', operatives: 'Everyone working for you', matrix: 'Cards, tickets and expiry dates', jobs: 'RAMS, drawings and sign-off per job',
    talks: 'Issue, sign and track', unmatched: 'Signatures from people not on the register', settings: 'Branding and training types', users: 'Office logins' };

  function shell() {
    const items = NAV.filter(n => (n.length === 1 || n[1] === 'admin' ? !n[1] || isAdmin() : !n[2] || isAdmin())).map(n => (n.length === 1 || n[1] === 'admin' && n.length === 2
      ? `<div class="nav-label">${n[0]}</div>`
      : `<a href="#/${n[0]}" data-nav="${n[0]}"><svg class="ic" viewBox="0 0 24 24">${ICONS[n[0]]}</svg>${esc(n[1])}<span class="count hidden" data-count="${n[0]}"></span></a>`)).join('');
    root.innerHTML = `<div class="ad-shell"><aside class="ad-nav" id="rail"><div class="rail-brand"><div class="logo"><img src="/logo" alt="${esc(brand.name)}"></div>
        <div class="t">Safety Portal</div><div class="s">${esc(brand.name)}</div></div>
      <nav aria-label="Main">${items}</nav>
      <div class="rail-foot"><div class="live"><span class="dot"></span>Live</div><div style="margin-top:6px">Managed by Safety Simplified Ltd</div></div></aside>
      <div class="scrim" id="scrim"></div>
      <div class="ad-body"><div class="topbar"><div style="display:flex;align-items:center;gap:14px"><button class="burger" id="burger" aria-label="Menu"><svg viewBox="0 0 24 24"><path d="M3 12h18M3 6h18M3 18h18"/></svg></button>
        <div><h1 id="vt">Dashboard</h1><div class="crumb" id="vc"></div></div></div>
        <div class="userchip"><span>Signed in as <b>${esc(me.name)}</b></span><button id="pw">Password</button><button id="lo">Sign out</button></div></div>
      <main class="ad-main" id="main"></main></div></div>`;
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
    document.getElementById('vt').textContent = nav ? nav[1] : 'Dashboard';
    document.getElementById('vc').textContent = `${brand.name} · ${CRUMB[view || ''] || ''}`;
    window.scrollTo(0, 0);
    const views = { '': dashboard, operatives, matrix: matrixView, jobs: jobsView, talks: talksView, unmatched, settings, users };
    setMain('<p class="muted">Loading</p>');
    (views[view] || dashboard)(params, id).catch(e => setMain(`<div class="note err">${esc(e.message)}</div>`));
    updateCounts();
  }

  async function updateCounts() {
    try {
      const d = await api('/unmatched');
      const el = document.querySelector('[data-count=unmatched]');
      if (el) { el.textContent = d.rows.length; el.classList.toggle('hidden', !d.rows.length); }
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
    if (!c.operatives) flags.push(['red', 'No operatives on the register yet. Start here.', '#/operatives']);

    setMain(`<div class="ad-head"><div><p class="muted" style="margin:0">${new Date().toLocaleDateString('en-GB', { ...tz, weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>
      <div class="stats">
        <a class="stat accent" href="#/operatives"><div class="n">${c.operatives}</div><div class="l">Operatives</div></a>
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
        ${canEdit() ? '<div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn ghost" id="imp">Add a list</button><button class="btn" id="add">Add operative</button></div>' : ''}</div>
      <div class="toolbar"><div class="field"><label>Search</label><input id="s" type="search" placeholder="Name, phone or role"></div>
        <div class="field"><label>Show</label><select id="sh"><option value="active">Current</option><option value="all" ${show === 'all' ? 'selected' : ''}>Including left</option></select></div></div>
      <div class="tablewrap">${list.length ? `<table><thead><tr><th>Name</th><th>Role</th><th>Mobile</th><th>Training</th><th>Live jobs</th></tr></thead><tbody>
        ${list.map(o => `<tr class="click" data-id="${o.id}" data-q="${esc((o.full_name + ' ' + (o.phone || '') + ' ' + (o.role || '')).toLowerCase())}">
          <td><b>${esc(o.full_name)}</b>${o.active ? '' : ' <span class="pill grey">left</span>'}</td><td>${esc(o.role || '')}${o.employment ? ` <span class="small muted">${esc(o.employment)}</span>` : ''}</td>
          <td>${esc(o.phone || '')}</td>
          <td>${o.expired || o.missing ? `<span class="pill no">${[o.expired && `${o.expired} expired`, o.missing && `${o.missing} missing`].filter(Boolean).join(', ')}</span>` : ''}
            ${o.expiring ? `<span class="pill under_review">${o.expiring} expiring</span>` : ''}${!o.expired && !o.missing && !o.expiring ? '<span class="pill yes">In date</span>' : ''}</td>
          <td class="small">${esc(o.jobs || '')}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty"><b>No operatives yet.</b>Add them one at a time, or paste a list from a spreadsheet.</div>'}</div>`);
    document.getElementById('sh').onchange = e => (location.hash = `#/operatives?show=${e.target.value}`);
    document.getElementById('s').oninput = e => { const t = e.target.value.toLowerCase(); main().querySelectorAll('tr[data-q]').forEach(tr => tr.classList.toggle('hidden', !tr.dataset.q.includes(t))); };
    main().querySelectorAll('tr[data-id]').forEach(tr => (tr.onclick = () => (location.hash = '#/operatives/' + tr.dataset.id)));
    if (canEdit()) {
      document.getElementById('add').onclick = () => editOperative();
      document.getElementById('imp').onclick = importOperatives;
    }
  }

  function importOperatives() {
    openDlg('Add a list of operatives', `<p class="muted">Paste from a spreadsheet or type one person per line: <b>name, mobile, role</b>. Mobile and role are optional. Anyone already on the register is skipped.</p>
      <textarea id="t" rows="12" placeholder="John Smith, 07700 900123, Fitter&#10;Dave Jones, 07700 900456, Labourer"></textarea>`, '<button class="btn" id="go">Add them</button>');
    $d('#go').onclick = async () => {
      try { const r = await api('/operatives/import', { body: { text: val('#t') } }); dlg.close(); bust(); flash(`${r.added} added${r.skipped ? `, ${r.skipped} skipped` : ''}.`); route(); }
      catch (e) { dlgErr(e.message); }
    };
  }

  function editOperative(o = {}) {
    const isNew = !o.id;
    openDlg(isNew ? 'Add operative' : `Edit ${o.full_name}`, `
      <div class="row">${field('Full name', input('fn', o.full_name))}${field('Mobile', input('ph', o.phone, 'tel'), 'used to match their signatures')}</div>
      <div class="row">${field('Role or trade', input('ro', o.role, 'text', 'list="roles"'))}${field('Employment', `<select id="em"><option value="">Not set</option>${['Employed', 'Subcontract', 'Agency'].map(x => `<option ${o.employment === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}</div>
      <datalist id="roles">${['Installer', 'Fitter', 'Supervisor', 'Labourer', 'Apprentice', 'Plumber', 'Heating engineer', 'Gas engineer', 'Driver'].map(x => `<option>${x}</option>`).join('')}</datalist>
      <div class="row">${field('Email', input('ea', o.email, 'email'))}${field('Start date', input('sd', o.start_date, 'date'))}</div>
      <div class="row">${field('Emergency contact', input('en', o.emergency_name))}${field('Emergency number', input('ep', o.emergency_phone, 'tel'))}</div>
      ${field('Notes', `<textarea id="no">${esc(o.notes || '')}</textarea>`)}
      ${isNew ? '' : `<label class="check"><input type="checkbox" id="ac" ${o.active ? 'checked' : ''}> Currently working for us <span class="hint">untick when they leave; their records are kept</span></label>`}`,
    `<button class="btn" id="save">${isNew ? 'Add operative' : 'Save'}</button>`);
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
    setMain(`<p class="no-print"><a href="#/operatives">Back to operatives</a></p>
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
        <div class="no-print" style="display:flex;gap:.5rem"><a class="btn ghost" href="/api/admin/matrix.csv${job ? `?job=${job}` : ''}">Download spreadsheet</a><button class="btn ghost" onclick="print()">Print</button></div></div>
      <div class="toolbar"><div class="field"><label>Show</label><select id="jb"><option value="">Everyone</option>${opt(js.filter(j => j.status === 'live'), job)}</select></div></div>
      <div class="legend"><span class="valid">In date</span><span class="expiring">Expires within 30 days</span><span class="expired">Expired or required and missing</span><span class="none">Not held</span></div>
      ${m.operatives.length && m.types.length ? `<div class="tablewrap"><table class="matrix"><thead><tr><th>Name</th>${m.types.map(t => `<th class="rot"><div>${esc(t.name)}${t.required ? ' *' : ''}</div></th>`).join('')}</tr></thead><tbody>
        ${m.operatives.map(o => `<tr><td><a href="#/operatives/${o.id}"><b>${esc(o.full_name)}</b></a><br><span class="small muted">${esc(o.role || '')}</span></td>
          ${m.types.map(t => { const c = (m.cells[o.id] || {})[t.id];
            const cls = c ? c.status : t.required ? 'missing' : '';
            const txt = c ? (c.expires_on ? shortDate(c.expires_on) : 'Held') : t.required ? 'Missing' : '';
            return `<td class="c ${cls}" data-o="${o.id}" data-t="${t.id}" data-x="${c ? c.id : ''}" title="${esc(t.name)}">${txt}</td>`; }).join('')}</tr>`).join('')}
        </tbody></table></div><p class="small muted">* required for everyone. Click a cell to add or update a record.</p>`
        : '<div class="empty"><b>Nothing to show yet.</b>Add operatives, then their training.</div>'}`);
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
  const KIND = { rams: 'RAMS', permit: 'Permit', plan: 'Drawing / plan', other: 'Other' };

  async function jobsView(params, id) {
    if (id) return jobDetail(id);
    const rows = await jobs(true);
    setMain(`<div class="ad-head"><div><p class="muted">Each job has its own pack link. The lads open it on their phone, read the RAMS and sign.</p></div>
        ${canEdit() ? '<button class="btn" id="add">Add job</button>' : ''}</div>
      <div class="tablewrap">${rows.length ? `<table><thead><tr><th>Job</th><th>Client</th><th>Dates</th><th>Team</th><th>Documents</th><th>Signatures</th></tr></thead><tbody>
        ${rows.map(j => `<tr class="click" data-id="${j.id}"><td><b>${esc(j.name)}</b>${j.ref ? ` <span class="small muted">${esc(j.ref)}</span>` : ''}${j.status === 'complete' ? ' <span class="pill grey">complete</span>' : ''}</td>
          <td>${esc(j.client || '')}</td><td class="small">${fDate(j.start_on)}${j.end_on ? ` to ${fDate(j.end_on)}` : ''}</td><td>${j.team}</td>
          <td>${j.docs || '<span class="pill no">None</span>'}</td><td>${j.status === 'live' ? (j.outstanding ? `<span class="pill under_review">${j.outstanding} outstanding</span>` : j.docs && j.team ? '<span class="pill yes">All signed</span>' : '') : ''}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty"><b>No jobs yet.</b>Add a job, upload its RAMS, and send the pack link to the lads.</div>'}</div>`);
    main().querySelectorAll('tr[data-id]').forEach(tr => (tr.onclick = () => (location.hash = '#/jobs/' + tr.dataset.id)));
    if (canEdit()) document.getElementById('add').onclick = () => editJob();
  }

  function editJob(j = {}) {
    const isNew = !j.id;
    openDlg(isNew ? 'Add job' : 'Edit job', `
      <div class="row">${field('Job name', input('nm', j.name), 'what the lads call it')}${field('Job or order number', input('rf', j.ref))}</div>
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
    setMain(`<p class="no-print"><a href="#/jobs">Back to jobs</a></p>
      <div class="ad-head"><div><h1>${esc(j.name)}</h1><p class="muted">${[j.ref, j.client, j.address].filter(Boolean).map(esc).join(' · ')}${j.status === 'complete' ? ' · <span class="pill grey">complete</span>' : ''}</p></div>
        ${canEdit() ? '<div class="no-print" style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn ghost" id="ed">Edit job</button><button class="btn ghost" id="tm">Choose team</button><button class="btn" id="up">Upload document</button></div>' : ''}</div>
      ${j.status === 'live' ? `<div class="panel no-print"><h2>Job pack link</h2><p class="small muted">Send this to the lads on the job. They open it, read each RAMS and sign it on their phone. When a RAMS is updated, upload the new revision and everyone is asked to sign again.</p>
        ${shareBox(j.url, `/api/admin/jobs/${j.id}/qr.svg`, `${j.name}: please read and sign the RAMS for this job before you start.`)}</div>` : ''}
      <h2>Documents</h2>
      <div class="tablewrap">${cur.length ? `<table><thead><tr><th>Document</th><th>Type</th><th>Revision</th><th>Signatures</th><th>Uploaded</th><th></th></tr></thead><tbody>
        ${cur.map(x => `<tr><td><a href="/api/admin/documents/${x.id}/file" target="_blank" rel="noopener"><b>${esc(x.title)}</b></a>${x.reference ? ` <span class="small muted">${esc(x.reference)}</span>` : ''}</td>
          <td>${KIND[x.kind] || x.kind}</td><td>${esc(x.revision || '')}</td><td>${x.requires_signoff ? x.signed : '<span class="small muted">Read only</span>'}</td>
          <td class="small">${fDate(x.created_at)}<br><span class="muted">${esc(x.uploaded_by || '')}</span></td>
          <td class="no-print">${canEdit() ? `<button class="btn small quiet" data-rev="${x.id}">New revision</button><button class="btn small quiet" data-doc="${x.id}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty"><b>No documents yet.</b>Upload the RAMS for this job, plus any drawings or permits the lads need.</div>'}</div>
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
    document.getElementById('tm').onclick = () => chooseTeam(j, d.team);
    main().querySelectorAll('[data-rev]').forEach(b => (b.onclick = () => uploadDoc(j, cur.find(x => String(x.id) === b.dataset.rev))));
    main().querySelectorAll('[data-doc]').forEach(b => (b.onclick = () => editDoc(cur.find(x => String(x.id) === b.dataset.doc))));
  }

  function uploadDoc(j, prev) {
    const nextRev = prev && prev.revision ? (/^\d+$/.test(prev.revision) ? String(Number(prev.revision) + 1) : /^[A-Y]$/i.test(prev.revision) ? String.fromCharCode(prev.revision.charCodeAt(0) + 1) : '') : '';
    openDlg(prev ? `New revision of ${prev.title}` : 'Upload document', `
      ${prev ? '<p class="muted">The current version is marked as superseded and everyone on the job is asked to sign the new one.</p>' : ''}
      ${field('Type', `<select id="kd">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${(prev ? prev.kind : 'rams') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${field('Title', input('ti', prev ? prev.title : ''))}
      <div class="row">${field('Reference', input('rf', prev ? prev.reference : ''))}${field('Revision', input('rv', nextRev))}</div>
      ${field('File', '<input id="fi" type="file" accept="application/pdf,image/*,.doc,.docx">', 'PDF works best on phones')}
      <label class="check"><input type="checkbox" id="so" ${!prev || prev.requires_signoff ? 'checked' : ''}> Operatives must read and sign this</label>`,
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
      <label class="check" style="margin-bottom:.6rem"><input type="checkbox" id="so" ${x.requires_signoff ? 'checked' : ''}> Operatives must read and sign this</label>
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
      <div style="display:grid;gap:.4rem">${all.map(o => `<label class="check" data-q="${esc(o.full_name.toLowerCase())}"><input type="checkbox" value="${o.id}" ${on.has(o.id) ? 'checked' : ''}> ${esc(o.full_name)} <span class="hint">${esc(o.role || '')}</span></label>`).join('') || '<p class="muted">Add operatives first.</p>'}</div>`,
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
    const d = await api('/talks');
    const ST = { draft: ['Draft', 'draft'], issued: ['Open for signing', 'yes'], closed: ['Closed', 'grey'] };
    setMain(`<div class="ad-head"><div><p class="muted">Write the talk once, send the link on WhatsApp. They read it, answer the questions and sign. You see who has and hasn't.</p></div>
        ${canEdit() ? '<button class="btn" id="add">New toolbox talk</button>' : ''}</div>
      <div class="tablewrap">${d.rows.length ? `<table><thead><tr><th>Talk</th><th>For</th><th>Status</th><th>Issued</th><th>Signed</th></tr></thead><tbody>
        ${d.rows.map(t => `<tr class="click" data-id="${t.id}"><td><b>${esc(t.title)}</b>${t.ref ? ` <span class="small muted">${esc(t.ref)}</span>` : ''}</td><td>${esc(t.job || 'Everyone')}</td>
          <td><span class="pill ${ST[t.status][1]}">${ST[t.status][0]}</span></td><td>${fDate(t.issued_at)}</td>
          <td>${t.status === 'draft' ? '' : `${t.signed} of ${t.expected}${t.signatures > t.signed ? ` <span class="small muted">+${t.signatures - t.signed} unmatched</span>` : ''}`}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty"><b>No toolbox talks yet.</b>Start one and paste in the content from your usual talk.</div>'}</div>`);
    main().querySelectorAll('tr[data-id]').forEach(tr => (tr.onclick = () => (location.hash = '#/talks/' + tr.dataset.id)));
    if (canEdit()) document.getElementById('add').onclick = async () => { const r = await api('/talks', { body: {} }); location.hash = '#/talks/' + r.row.id; };
  }

  async function talkDetail(id) {
    const [d, js] = await Promise.all([api('/talks/' + id), jobs()]);
    const t = d.talk;
    if (t.status === 'draft' && canEdit()) return talkEditor(t, js);
    const matched = d.signoffs.filter(s => s.operative_id), unmatchedRows = d.signoffs.filter(s => !s.operative_id);
    setMain(`<p class="no-print"><a href="#/talks">Back to toolbox talks</a></p>
      <div class="ad-head"><div><h1>${esc(t.title)}</h1><p class="muted">${t.ref ? `${esc(t.ref)} · ` : ''}${t.job ? `For ${esc(t.job)}` : 'For everyone'} · Issued ${fDate(t.issued_at)}${t.status === 'closed' ? ' · <span class="pill grey">closed</span>' : ''}</p></div>
        <div class="no-print" style="display:flex;gap:.5rem;flex-wrap:wrap">${canEdit() ? `<button class="btn ghost" id="cp">Copy as new talk</button><button class="btn ghost" id="cl">${t.status === 'closed' ? 'Reopen' : 'Close signing'}</button>` : ''}
          <button class="btn ghost" id="pv">View content</button><button class="btn ghost" onclick="print()">Print register</button></div></div>
      ${t.status === 'issued' ? `<div class="panel no-print"><h2>Link to send</h2>${shareBox(t.url, `/api/admin/talks/${t.id}/qr.svg`, `Toolbox talk: ${t.title}. Please read, answer the questions and sign.`)}</div>` : ''}
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
    if (!canEdit()) return;
    document.getElementById('cp').onclick = async () => { const r = await api('/talks', { body: { copy_from: t.id } }); location.hash = '#/talks/' + r.row.id; };
    document.getElementById('cl').onclick = async () => { await api(`/talks/${t.id}/close`, { body: {} }); route(); };
  }

  function talkEditor(row, js) {
    let sections = row.sections.map(s => ({ ...s }));
    let questions = row.questions.map(x => ({ ...x, options: [...x.options] }));
    function draw() {
      setMain(`<p><a href="#/talks">Back to toolbox talks</a></p>
        <div class="ad-head"><div><h1>${esc(row.title)}</h1><p class="muted">Draft. Nobody can see it until you issue it. Once issued it is locked, so everyone signs the same thing.</p></div>
          <div style="display:flex;gap:.5rem"><button class="btn ghost" id="del">Delete draft</button><button class="btn ghost" id="save">Save draft</button><button class="btn" id="iss">Issue</button></div></div>
        <div class="panel"><div class="row">${field('Title', input('ti', row.title))}${field('Reference', input('rf', row.ref), 'optional, e.g. TBT-01')}
          ${field('Who signs it', `<select id="jb"><option value="">Everyone</option>${opt(js.filter(j => j.status === 'live'), row.job_id)}</select>`)}</div>
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
      const keep = () => { row.title = v('ti'); row.ref = v('rf'); row.intro = v('in'); row.job_id = v('jb') || null; };
      m.querySelectorAll('[data-su],[data-sd]').forEach(b => (b.onclick = () => { keep(); const i = Number(b.dataset.su ?? b.dataset.sd), j = b.dataset.su != null ? i - 1 : i + 1; [sections[i], sections[j]] = [sections[j], sections[i]]; draw(); }));
      m.querySelectorAll('[data-sx]').forEach(b => (b.onclick = () => { keep(); sections.splice(Number(b.dataset.sx), 1); draw(); }));
      m.querySelectorAll('[data-qx]').forEach(b => (b.onclick = () => { keep(); questions.splice(Number(b.dataset.qx), 1); draw(); }));
      m.querySelectorAll('[data-qadd]').forEach(b => (b.onclick = () => { keep(); questions[b.dataset.qadd].options.push(''); draw(); }));
      m.querySelectorAll('[data-qox]').forEach(b => (b.onclick = () => { keep(); const [i, j] = b.dataset.qox.split(':').map(Number); const x = questions[i]; x.options.splice(j, 1); if (x.answer === j) x.answer = 0; else if (x.answer > j) x.answer--; draw(); }));
      document.getElementById('addSec').onclick = () => { keep(); sections.push({ heading: '', body: '' }); draw(); };
      document.getElementById('addQ').onclick = () => { keep(); questions.push({ question: '', options: ['', ''], answer: 0 }); draw(); };
      const save = async quiet => { keep(); const r = await api('/talks/' + row.id, { method: 'PUT', body: { ...row, sections, questions } }); Object.assign(row, r.row); if (!quiet) flash('Draft saved.'); };
      document.getElementById('save').onclick = () => save().catch(e => flash(e.message, 'err'));
      document.getElementById('del').onclick = async () => { if (!confirm('Delete this draft?')) return; try { await api('/talks/' + row.id, { method: 'DELETE' }); location.hash = '#/talks'; } catch (e) { flash(e.message, 'err'); } };
      document.getElementById('iss').onclick = async () => {
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
    setMain(`<div class="ad-head"><div><p class="muted">People who signed but didn't match anyone on the register (new starter, different number, or a typo). Match them to someone, or add them as a new operative.</p></div></div>
      ${Object.keys(groups).length ? Object.values(groups).map(g => `<div class="panel"><div class="ad-head" style="margin:0 0 .6rem"><div><h2 style="margin:0">${esc(g[0].name_given)}</h2><p class="muted small">${esc(g[0].phone_given || 'No number')} · ${g.length} signature${g.length === 1 ? '' : 's'}</p></div>
          ${canEdit() ? `<div style="display:flex;gap:.5rem;align-items:end;flex-wrap:wrap"><select data-pick="${g[0].id}" style="width:auto"><option value="">Match to</option>${opt(act, '', 'full_name')}</select>
            <button class="btn small" data-link="${g[0].id}">Match</button><button class="btn small ghost" data-create="${g[0].id}">Add as new operative</button></div>` : ''}</div>
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
  }

  // ---------- settings ----------
  async function settings() {
    if (!isAdmin()) return setMain('<div class="note warn">Only admins can change settings.</div>');
    const [s, ts] = await Promise.all([api('/settings'), types(true)]);
    let logo;
    setMain(`
      <div class="panel"><h2>Subscription</h2><p class="small muted">Your portal subscription with Safety Simplified is paid by Direct Debit through GoCardless.</p>
        ${s.dd_link ? `<p><a class="btn" href="${esc(s.dd_link)}" target="_blank" rel="noopener">Set up Direct Debit</a></p>` : '<p class="small muted">No Direct Debit link added yet.</p>'}
        <details><summary class="small muted">Change the Direct Debit link</summary><div class="linkbox" style="margin-top:.6rem"><input id="dd" value="${esc(s.dd_link)}" placeholder="https://pay.gocardless.com/..."><button class="btn small" id="ddsave">Save link</button></div></details></div>
      <div class="panel"><h2>Company branding</h2><p class="small muted">Shown on the portal and on every link the lads open.</p>
        <div class="row">${field('Company name', input('cn', s.company_name))}${field('Brand colour', `<input id="bc" type="color" value="${esc(s.brand_colour)}" style="height:2.9rem;padding:.2rem">`)}</div>
        ${field('Logo', '<input id="lg" type="file" accept="image/png,image/jpeg,image/svg+xml">', 'PNG with a transparent background works best')}
        <div style="display:flex;gap:1rem;align-items:center;margin-bottom:1rem"><img src="/logo?${Date.now()}" alt="Current logo" style="max-height:48px;max-width:240px;background:#fff;border:1px solid var(--line);padding:.4rem;border-radius:6px">
          ${s.has_logo ? '<button class="btn small quiet" id="rl">Remove logo</button>' : '<span class="small muted">No logo yet, the company name is shown instead.</span>'}</div>
        <button class="btn" id="sb">Save branding</button></div>
      <div class="panel"><div class="ad-head" style="margin-bottom:.6rem"><div><h2 style="margin:0">Training types</h2><p class="small muted" style="margin:0">The columns on the training matrix. Required ones show as missing for anyone without them.</p></div><button class="btn small" id="at">Add type</button></div>
        <div class="tablewrap"><table><thead><tr><th>Training</th><th>Required for everyone</th><th>Valid for</th><th></th></tr></thead><tbody>
          ${ts.map(t => `<tr><td><b>${esc(t.name)}</b>${t.active ? '' : ' <span class="pill grey">hidden</span>'}</td><td>${t.required ? 'Yes' : ''}</td><td>${t.validity_months ? `${t.validity_months} months` : 'No expiry'}</td>
            <td><button class="btn small quiet" data-t="${t.id}">Edit</button></td></tr>`).join('')}</tbody></table></div></div>`);
    document.getElementById('ddsave').onclick = async () => {
      try { await api('/settings', { method: 'PUT', body: { dd_link: v('dd') } }); bust(); route(); } catch (e) { flash(e.message, 'err'); }
    };
    document.getElementById('lg').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader(); rd.onload = () => { logo = rd.result; }; rd.readAsDataURL(f);
    };
    document.getElementById('sb').onclick = async () => {
      try { await api('/settings', { method: 'PUT', body: { company_name: v('cn'), brand_colour: v('bc'), ...(logo ? { logo } : {}) } }); location.reload(); }
      catch (e) { flash(e.message, 'err'); }
    };
    if (document.getElementById('rl')) document.getElementById('rl').onclick = async () => { await api('/settings', { method: 'PUT', body: { logo: null } }); location.reload(); };
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

  // ---------- users ----------
  async function users() {
    if (!isAdmin()) return setMain('<div class="note warn">Only admins can manage users.</div>');
    const d = await api('/users');
    const roleName = { admin: 'Admin', manager: 'Manager', viewer: 'View only' };
    setMain(`<div class="ad-head"><div><p class="muted">Office staff who log in here. Operatives don't need accounts; they use the links you send.</p></div><button class="btn" id="add">Add user</button></div>
      <div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
        ${d.rows.map(u => `<tr><td><b>${esc(u.name)}</b>${u.active ? '' : ' <span class="pill grey">disabled</span>'}</td><td>${esc(u.email)}</td><td>${roleName[u.role]}</td>
          <td><button class="btn small quiet" data-u="${u.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`);
    document.getElementById('add').onclick = () => {
      openDlg('Add user', `${field('Name', input('n', ''))}${field('Email', input('e', '', 'email'))}
        ${field('Role', '<select id="r"><option value="manager">Manager</option><option value="viewer">View only</option><option value="admin">Admin</option></select>')}
        ${field('Temporary password', input('p', ''), 'at least 8 characters; they can change it after logging in')}`, '<button class="btn" id="save">Add user</button>');
      $d('#save').onclick = async () => {
        try { await api('/users', { body: { name: val('#n'), email: val('#e'), role: val('#r'), password: val('#p') } }); dlg.close(); users(); } catch (e) { dlgErr(e.message); }
      };
    };
    main().querySelectorAll('[data-u]').forEach(b => (b.onclick = () => {
      const u = d.rows.find(x => String(x.id) === b.dataset.u);
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
