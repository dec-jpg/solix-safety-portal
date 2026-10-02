// Operative pages opened from WhatsApp links: toolbox talks (/t/TOKEN) and job packs (/j/TOKEN).
(() => {
  const app = document.getElementById('app');
  const [MODE, TOKEN] = location.pathname.split('/').filter(Boolean);
  const KEY = 'portal_who';
  let me = null; // { name, phone, token }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = sel => app.querySelector(sel);
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } },
    clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
  };

  async function api(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (me && me.token) headers['x-op-token'] = me.token;
    const qs = me && !me.token ? `${path.includes('?') ? '&' : '?'}name=${encodeURIComponent(me.name)}&phone=${encodeURIComponent(me.phone)}` : '';
    const send = body ? { name: me && me.name, phone: me && me.phone, ...body } : undefined;
    const res = await fetch('/api/p' + path + (body ? '' : qs), { method: body ? 'POST' : 'GET', headers, body: send ? JSON.stringify(send) : undefined });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Check your signal and try again.');
    return data;
  }

  function render(html) { app.innerHTML = html; window.scrollTo(0, 0); }
  function head(title, sub) { document.getElementById('title').textContent = title; document.getElementById('sub').textContent = sub || ''; document.title = title; }
  function showErr(msg) {
    let n = $('.note.err');
    if (!n) { n = document.createElement('div'); n.className = 'note err'; app.prepend(n); }
    n.textContent = msg; n.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Please wait'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }
  const whoBar = () => `<div class="si-who"><div><b>${esc(me.name)}</b><span class="muted small">${esc(me.phone || '')}</span></div><button class="btn quiet" data-act="forget">Not you?</button></div>`;
  app.addEventListener('click', e => {
    if (e.target.closest('[data-act=forget]')) { store.clear(); me = null; identify(); }
  });

  function sigPad(canvas) {
    const ctx = canvas.getContext('2d');
    let drawing = false, dirty = false;
    const r0 = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = r0.width * dpr; canvas.height = r0.height * dpr;
    ctx.scale(dpr, dpr); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#18201b';
    const pt = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', e => { drawing = true; canvas.setPointerCapture(e.pointerId); const p = pt(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    canvas.addEventListener('pointermove', e => { if (!drawing) return; const p = pt(e); ctx.lineTo(p.x, p.y); ctx.stroke(); dirty = true; });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => canvas.addEventListener(t, () => { drawing = false; }));
    return { clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; }, empty: () => !dirty, data: () => canvas.toDataURL('image/png') };
  }
  const sigBlock = `<label>Your signature</label><div class="sig-wrap"><canvas id="sig"></canvas></div>
    <p style="margin:0 0 1rem;text-align:right"><button class="btn quiet small" id="clr">Clear signature</button></p>`;
  function wireSig() { const pad = sigPad($('#sig')); $('#clr').onclick = () => pad.clear(); return pad; }

  function done(title, text) {
    render(`${whoBar()}<div class="si-done"><div class="tick" aria-hidden="true">&#10003;</div><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p></div>
      ${MODE === 'j' ? '<button class="btn big ghost" id="back">Back to the job pack</button>' : ''}`);
    if ($('#back')) $('#back').onclick = jobPack;
  }

  // ---------- who are you ----------
  function identify() {
    head(MODE === 't' ? 'Toolbox talk' : 'Job pack', 'Sign-off');
    render(`<h1>Who's signing?</h1><p class="muted">Enter your name and mobile. You only do this once on this phone.</p>
      <div class="field"><label for="n">First name and surname</label><input id="n" autocomplete="name"></div>
      <div class="field"><label for="p">Mobile number</label><input id="p" type="tel" autocomplete="tel" inputmode="tel"></div>
      <button class="btn big" id="go">Continue</button>`);
    $('#go').onclick = async () => {
      const btn = $('#go'); busy(btn, true);
      try {
        const r = await api('/identify', { name: $('#n').value, phone: $('#p').value });
        me = { name: r.name, phone: r.phone, token: r.token || null };
        store.set(me);
        start();
      } catch (e) { busy(btn, false); showErr(e.message); }
    };
  }

  // ---------- toolbox talk ----------
  let talk = null;
  async function toolboxTalk() {
    const d = await api('/t/' + TOKEN);
    talk = d.talk;
    head(talk.title, talk.ref ? `Toolbox talk · ${talk.ref}` : 'Toolbox talk');
    if (d.signed) return done('Already signed', 'You have already signed this toolbox talk. Nothing more to do.');
    if (talk.closed) return render(`${whoBar()}<div class="note warn">This toolbox talk has been closed. Ask the office if you still need to sign it.</div>`);
    if (talk.intro) return render(`${whoBar()}<div class="ind-section"><div class="body">${esc(talk.intro)}</div></div><button class="btn big" id="next">Start</button>`), ($('#next').onclick = () => section(0));
    section(0);
  }

  function section(i) {
    const s = talk.sections[i];
    if (!s) return quiz(talk.questions.map(() => null), 1);
    render(`${whoBar()}<p class="ind-progress">Part ${i + 1} of ${talk.sections.length}</p>
      <div class="ind-section">${s.heading ? `<h2>${esc(s.heading)}</h2>` : ''}<div class="body">${esc(s.body)}</div></div>
      <button class="btn big" id="next">${i + 1 < talk.sections.length ? 'Next' : talk.questions.length ? 'Answer the questions' : 'Sign'}</button>
      ${i > 0 ? '<p class="link-row"><button class="btn quiet" id="prev">Back</button></p>' : ''}`);
    $('#next').onclick = () => section(i + 1);
    if ($('#prev')) $('#prev').onclick = () => section(i - 1);
  }

  function quiz(answers, attempt, wrong = []) {
    if (!talk.questions.length) return signTalk([], attempt);
    render(`${whoBar()}<h1>Check your understanding</h1>
      ${wrong.length ? `<div class="note err">${wrong.length === 1 ? 'One answer is' : `${wrong.length} answers are`} not right. Have another look and try again.</div>` : '<p class="muted">Every answer needs to be right to sign.</p>'}
      ${talk.questions.map((x, i) => `<div class="quiz-q ${wrong.includes(i) ? 'wrong' : ''}"><b>${i + 1}. ${esc(x.question)}</b><div class="opts">
        ${x.options.map((o, j) => `<label><input type="radio" name="q${i}" value="${j}" ${answers[i] === j && !wrong.includes(i) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div></div>`).join('')}
      <button class="btn big" id="go">Check answers</button>`);
    $('#go').onclick = () => {
      const a = talk.questions.map((_, i) => { const el = app.querySelector(`input[name=q${i}]:checked`); return el ? Number(el.value) : null; });
      if (a.some(v => v === null)) return showErr('Answer every question.');
      api(`/t/${TOKEN}/check`, { answers: a }).then(r => (r.wrong.length ? quiz(a, attempt + 1, r.wrong) : signTalk(a, attempt))).catch(e => showErr(e.message));
    };
  }

  function signTalk(answers, attempt) {
    render(`${whoBar()}<h1>Sign to confirm</h1><p class="muted">By signing you confirm you have read and understood this toolbox talk and will follow it.</p>
      ${sigBlock}<button class="btn big" id="go">Sign</button>`);
    const pad = wireSig();
    $('#go').onclick = async () => {
      if (pad.empty()) return showErr('Sign in the box first.');
      const btn = $('#go'); busy(btn, true, 'Sending');
      try {
        const r = await api(`/t/${TOKEN}/sign`, { answers, signature: pad.data(), attempts: attempt });
        if (r.ok === false) return quiz(answers, attempt + 1, r.wrong);
        done('Signed', 'Thanks. Your signature has been recorded.');
      } catch (e) { busy(btn, false); showErr(e.message); }
    };
  }

  // ---------- job pack ----------
  let pack = null;
  async function jobPack() {
    pack = await api('/j/' + TOKEN);
    head(pack.job.name, ['Job pack', pack.job.ref].filter(Boolean).join(' · '));
    const docs = pack.documents;
    const toSign = docs.filter(d => d.requires_signoff && !d.signed).length;
    const KIND = { rams: 'RAMS', permit: 'Permit', plan: 'Drawing / plan', other: 'Document' };
    render(`${whoBar()}
      ${docs.length ? (toSign ? `<div class="note warn">${toSign} document${toSign === 1 ? '' : 's'} to read and sign.</div>` : '<div class="note ok">You have signed everything for this job.</div>') : '<div class="note info">No documents have been added to this job yet.</div>'}
      ${docs.map(d => `<div class="doc-card ${!d.requires_signoff ? 'info' : d.signed ? 'done' : ''}"><div><span class="k">${KIND[d.kind] || 'Document'}${d.revision ? ` · rev ${esc(d.revision)}` : ''}</span><b>${esc(d.title)}</b>
          ${d.requires_signoff ? (d.signed ? '<span class="pill yes">Signed</span>' : '<span class="pill no">Not signed</span>') : '<span class="pill grey">Read only</span>'}</div>
        ${d.requires_signoff && !d.signed ? `<button class="btn" data-doc="${d.id}">Read &amp; sign</button>` : `<a class="btn ghost" href="/api/p/j/${TOKEN}/doc/${d.id}" target="_blank" rel="noopener">Open</a>`}</div>`).join('')}`);
    app.querySelectorAll('[data-doc]').forEach(b => (b.onclick = () => signDoc(docs.find(d => String(d.id) === b.dataset.doc))));
  }

  function signDoc(d) {
    render(`${whoBar()}<h1>${esc(d.title)}</h1><p class="muted">${[d.reference, d.revision && `Revision ${d.revision}`].filter(Boolean).map(esc).join(', ')}</p>
      <a class="btn big ghost" href="/api/p/j/${TOKEN}/doc/${d.id}" target="_blank" rel="noopener" id="open">Open the document</a>
      <p class="small muted" style="margin:.6rem 0 1.2rem">Read it all the way through. If anything is unclear, ask your supervisor before you start.</p>
      <label class="check" style="margin-bottom:1rem"><input type="checkbox" id="ok"> I have read and understood this document and will work to it.</label>
      ${sigBlock}<button class="btn big" id="go">Sign</button>
      <p class="link-row"><button class="btn quiet" id="back">Back to the job pack</button></p>`);
    const pad = wireSig();
    $('#back').onclick = jobPack;
    $('#go').onclick = async () => {
      if (!$('#ok').checked) return showErr('Tick the box to confirm you have read it.');
      if (pad.empty()) return showErr('Sign in the box first.');
      const btn = $('#go'); busy(btn, true, 'Sending');
      try { await api(`/j/${TOKEN}/doc/${d.id}/sign`, { signature: pad.data() }); done('Signed', `${d.title} is signed.`); }
      catch (e) { busy(btn, false); showErr(e.message); }
    };
  }

  // ---------- start ----------
  function start() {
    const go = MODE === 't' ? toolboxTalk : jobPack;
    go().catch(e => render(`<div class="note err">${esc(e.message)}</div>`));
  }
  fetch('/api/p/brand').then(r => r.json()).then(b => { document.getElementById('logo').alt = b.name; }).catch(() => {});
  me = store.get();
  if (!me || !me.name) identify(); else start();
})();
