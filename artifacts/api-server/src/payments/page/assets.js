'use strict';

/**
 * The customer pay page (/pay/:token and /pay/l/:token). Plain HTML + a script
 * served from the same origin (strict CSP, no inline script). All text is
 * rendered with textContent.
 */

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Payment</title>
<style>
  :root { --bg:#f1f5f9; --card:#fff; --text:#0f172a; --muted:#64748b; --line:#e2e8f0; --brand:#0284c7; --ok:#059669; --warn:#b45309; --err:#dc2626; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b1220; --card:#111a2e; --text:#e2e8f0; --muted:#94a3b8; --line:#1f2a44; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; }
  main { max-width:640px; margin:0 auto; padding:24px 16px 48px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:20px; margin-bottom:16px; }
  .biz { display:flex; align-items:center; gap:12px; }
  .biz img { max-height:44px; max-width:140px; }
  .biz h1 { font-size:18px; margin:0; }
  .muted { color:var(--muted); font-size:13px; }
  table { width:100%; border-collapse:collapse; }
  td { padding:7px 0; border-bottom:1px solid var(--line); vertical-align:top; }
  td.r { text-align:right; white-space:nowrap; padding-left:12px; }
  tr.total td { border-bottom:none; font-weight:700; font-size:17px; padding-top:12px; }
  .banner { border-radius:10px; padding:12px 14px; margin-bottom:16px; font-weight:600; }
  .banner.ok { background:rgba(5,150,105,.12); color:var(--ok); }
  .banner.warn { background:rgba(180,83,9,.12); color:var(--warn); }
  .banner.err { background:rgba(220,38,38,.12); color:var(--err); }
  button, .btn { display:block; width:100%; border:0; border-radius:10px; padding:13px 16px; font-size:15px; font-weight:600; cursor:pointer; background:var(--brand); color:#fff; margin-top:10px; text-align:center; text-decoration:none; }
  button.secondary { background:transparent; color:var(--text); border:1px solid var(--line); }
  button:disabled { opacity:.6; cursor:wait; }
  input { width:100%; padding:11px 12px; border:1px solid var(--line); border-radius:10px; font-size:15px; background:var(--card); color:var(--text); margin-top:6px; }
  label { display:block; margin-top:12px; font-size:13px; color:var(--muted); }
  .row { display:flex; gap:8px; } .row > * { flex:1; }
  .instructions { white-space:pre-wrap; background:var(--bg); border-radius:10px; padding:12px; margin-top:10px; font-size:14px; }
  footer { text-align:center; margin-top:24px; }
  .hidden { display:none !important; }
</style>
</head>
<body>
<main>
  <div id="banner" class="banner hidden"></div>
  <div class="card"><div class="biz"><img id="logo" class="hidden" alt=""><div><h1 id="biz">Loading…</h1><div id="bizinfo" class="muted"></div></div></div></div>
  <div id="content"></div>
  <footer class="muted" id="foot"></footer>
</main>
<script src="/pay/assets/pay.js"></script>
</body>
</html>`;

const SCRIPT = String.raw`(function () {
  'use strict';
  var path = location.pathname.replace(/\/+$/, '');
  var isLink = /^\/pay\/l\//.test(path);
  var token = path.split('/').pop();
  var api = isLink ? '/api/pay/link/' + encodeURIComponent(token) : '/api/pay/doc/' + encodeURIComponent(token);
  var params = new URLSearchParams(location.search);

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k]; else if (k === 'onclick') e.addEventListener('click', attrs[k]); else e.setAttribute(k, attrs[k]);
    });
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  var ZERO = ['bif','clp','djf','gnf','jpy','kmf','krw','mga','pyg','rwf','ugx','vnd','vuv','xaf','xof','xpf'];
  function dec(c) { return ZERO.indexOf(String(c).toLowerCase()) >= 0 ? 0 : 2; }
  function fmt(minor, cur) {
    var d = dec(cur);
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(cur).toUpperCase() }).format(minor / Math.pow(10, d)); }
    catch (e) { return (minor / Math.pow(10, d)).toFixed(d) + ' ' + String(cur).toUpperCase(); }
  }
  function toMinor(v, cur) { return Math.round(Number(v) * Math.pow(10, dec(cur))); }
  function banner(kind, text) { var b = document.getElementById('banner'); b.className = 'banner ' + kind; b.textContent = text; }
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; }); });
  }

  var result = params.get('result');
  if (result === 'paid') banner('ok', 'Payment received. Thank you!');
  else if (result === 'processing') banner('warn', 'Your payment is being processed. You will receive a confirmation by email.');
  else if (result === 'cancelled') banner('warn', 'Payment cancelled. You can try again below.');

  fetch(api).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Not found'); return j; }); })
    .then(render)
    .catch(function (e) { document.getElementById('biz').textContent = 'Not available'; banner('err', e.message); });

  function render(data) {
    var b = data.business || {};
    document.title = (b.name || 'Payment');
    document.getElementById('biz').textContent = b.name || '';
    document.getElementById('bizinfo').textContent = [b.email, b.phone].filter(Boolean).join(' · ');
    if (b.logo_url) { var logo = document.getElementById('logo'); logo.src = b.logo_url; logo.classList.remove('hidden'); }
    if (b.footer_note) document.getElementById('foot').textContent = b.footer_note;
    var c = document.getElementById('content');
    if (isLink) renderLink(c, data); else renderDoc(c, data);
  }

  function lines(card, d) {
    var t = el('table');
    (d.line_items || []).forEach(function (it) {
      var tr = el('tr');
      var left = el('td'); left.appendChild(el('div', null, it.description)); left.appendChild(el('div', { class: 'muted' }, it.quantity + ' × ' + fmt(it.unit_price, d.currency)));
      tr.appendChild(left); tr.appendChild(el('td', { class: 'r' }, fmt(it.amount, d.currency))); t.appendChild(tr);
    });
    function row(label, v, cls) { var tr = el('tr', cls ? { class: cls } : null); tr.appendChild(el('td', null, label)); tr.appendChild(el('td', { class: 'r' }, v)); t.appendChild(tr); }
    row('Subtotal', fmt(d.subtotal, d.currency));
    if (d.tax_total) row('Tax', fmt(d.tax_total, d.currency));
    if (d.discount_total) row('Discount', '−' + fmt(d.discount_total, d.currency));
    if (d.amount_paid) row('Paid', '−' + fmt(d.amount_paid, d.currency));
    row(d.kind === 'estimate' ? 'Total' : 'Amount due', fmt(d.kind === 'estimate' ? d.total : d.balance, d.currency), 'total');
    card.appendChild(t);
  }

  function renderDoc(c, data) {
    var d = data.document;
    var card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'muted' }, (d.kind === 'estimate' ? 'Estimate ' : 'Invoice ') + d.number + (d.due_date ? ' · due ' + String(d.due_date).slice(0, 10) : '')));
    if (d.title) card.appendChild(el('h2', null, d.title));
    if (d.customer_name) card.appendChild(el('div', { class: 'muted' }, 'For ' + d.customer_name));
    lines(card, d);
    if (d.notes) card.appendChild(el('p', { class: 'muted' }, d.notes));
    c.appendChild(card);

    if (d.return_url) {
      var back = el('a', { class: 'muted', href: d.return_url }, (d.status === 'paid' || d.balance <= 0 || result) ? (d.return_label || 'Back to the store') + ' →' : '← ' + (d.return_label || 'Back to the store'));
      back.style.display = 'inline-block'; back.style.marginTop = '12px';
      card.appendChild(back);
      if (result === 'paid' || result === 'processing') setTimeout(function () { location.href = d.return_url; }, 4000);
    }
    if (d.status === 'void') { banner('err', 'This invoice was cancelled.'); return; }
    if (d.kind === 'estimate') return renderAccept(c, d);
    if (d.status === 'paid' || d.balance <= 0) { if (!result) banner('ok', 'This invoice is paid. Thank you!'); return; }
    renderMethods(c, data.methods, '/api/pay/doc/' + encodeURIComponent(token) + '/checkout', function () { return {}; }, d.balance, d.currency);
    renderGiftCard(c);
  }

  function renderAccept(c, d) {
    var card = el('div', { class: 'card' });
    if (d.status === 'accepted') { card.appendChild(el('strong', null, 'Accepted — thank you!')); c.appendChild(card); return; }
    card.appendChild(el('label', null, 'Your name'));
    var name = el('input', { autocomplete: 'name' }); card.appendChild(name);
    var btn = el('button', { onclick: function () {
      btn.disabled = true;
      post('/api/pay/doc/' + encodeURIComponent(token) + '/accept', { name: name.value }).then(function () { banner('ok', 'Estimate accepted. We will be in touch.'); card.remove(); })
        .catch(function (e) { banner('err', e.message); btn.disabled = false; });
    } }, 'Accept estimate');
    card.appendChild(btn); c.appendChild(card);
  }

  function renderGiftCard(c) {
    var card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'muted' }, 'Have a gift card?'));
    var code = el('input', { placeholder: 'XXXX-XXXX-XXXX', autocomplete: 'off' });
    var btn = el('button', { class: 'secondary', onclick: function () {
      btn.disabled = true;
      post('/api/pay/doc/' + encodeURIComponent(token) + '/gift-card', { code: code.value }).then(function () { location.search = '?result=paid'; })
        .catch(function (e) { banner('err', e.message); btn.disabled = false; });
    } }, 'Apply gift card');
    card.appendChild(code); card.appendChild(btn); c.appendChild(card);
  }

  function renderLink(c, data) {
    var l = data.link;
    var card = el('div', { class: 'card' });
    card.appendChild(el('h2', null, l.title));
    if (l.description) card.appendChild(el('p', { class: 'muted' }, l.description));
    var amountInput = null;
    if (l.amount == null) {
      card.appendChild(el('label', null, 'Amount (' + String(l.currency).toUpperCase() + ')'));
      amountInput = el('input', { type: 'number', min: '0', step: dec(l.currency) ? '0.01' : '1', inputmode: 'decimal' });
      card.appendChild(amountInput);
    } else {
      card.appendChild(el('div', { style: 'font-size:22px;font-weight:700;margin-top:8px' }, fmt(l.amount, l.currency)));
    }
    card.appendChild(el('label', null, 'Your name')); var name = el('input', { autocomplete: 'name' }); card.appendChild(name);
    card.appendChild(el('label', null, 'Email')); var email = el('input', { type: 'email', autocomplete: 'email' }); card.appendChild(email);
    card.appendChild(el('label', null, 'Coupon (optional)')); var coupon = el('input', { autocomplete: 'off' }); card.appendChild(coupon);
    c.appendChild(card);
    renderMethods(c, data.methods, '/api/pay/link/' + encodeURIComponent(token) + '/checkout', function () {
      return {
        amount: amountInput ? toMinor(amountInput.value, l.currency) : undefined,
        customer_name: name.value, customer_email: email.value, coupon: coupon.value || undefined,
      };
    }, l.amount, l.currency);
  }

  function renderMethods(c, methods, url, extra) {
    var card = el('div', { class: 'card' });
    if (!methods || !methods.length) { card.appendChild(el('div', { class: 'muted' }, 'Online payment is not set up yet. Please contact us to pay.')); c.appendChild(card); return; }
    card.appendChild(el('div', { class: 'muted' }, 'Choose how to pay'));
    var refWrap = el('div', { class: 'hidden' });
    refWrap.appendChild(el('label', null, 'Payment reference (optional)'));
    var ref = el('input', { autocomplete: 'off' }); refWrap.appendChild(ref);
    methods.forEach(function (m) {
      var btn = el('button', { onclick: function () { pay(m, btn); } }, (m.kind === 'manual' ? '' : 'Pay with ') + m.label + (m.environment === 'sandbox' || m.environment === 'test' ? ' (test mode)' : ''));
      if (m.kind === 'manual') btn.className = 'secondary';
      card.appendChild(btn);
    });
    card.appendChild(refWrap);
    var out = el('div'); card.appendChild(out);
    c.appendChild(card);

    function pay(m, btn) {
      var body = extra(); body.provider = m.provider; body.reference = ref.value || undefined;
      btn.disabled = true;
      post(url, body).then(function (r) {
        if (r.type === 'redirect') { location.href = r.url; return; }
        if (r.type === 'form') {
          var f = el('form', { method: 'POST', action: r.action });
          Object.keys(r.fields).forEach(function (k) { var i = el('input', { type: 'hidden', name: k }); i.value = r.fields[k]; f.appendChild(i); });
          document.body.appendChild(f); f.submit(); return;
        }
        if (r.type === 'paddle') { paddle(r); return; }
        if (r.type === 'manual') {
          out.textContent = '';
          out.appendChild(el('div', { class: 'instructions' }, r.instructions || ''));
          if (r.url) out.appendChild(el('a', { class: 'btn', href: r.url, target: '_blank', rel: 'noopener' }, 'Open payment page'));
          banner('warn', 'Thank you. Your payment will be confirmed once received.');
          refWrap.classList.remove('hidden');
          btn.disabled = false;
        }
      }).catch(function (e) { banner('err', e.message); btn.disabled = false; });
    }
  }

  function paddle(r) {
    var done = '/api/pay/return/paddle?attempt=' + encodeURIComponent(r.attempt_id) + '&result=success';
    function open() {
      if (r.environment === 'sandbox') window.Paddle.Environment.set('sandbox');
      window.Paddle.Initialize({ token: r.clientToken, eventCallback: function (ev) { if (ev && ev.name === 'checkout.completed') setTimeout(function () { location.href = done; }, 1200); } });
      window.Paddle.Checkout.open({ transactionId: r.transactionId });
    }
    if (window.Paddle) return open();
    var s = document.createElement('script'); s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js'; s.onload = open;
    s.onerror = function () { banner('err', 'Could not load the checkout. Check your connection and try again.'); };
    document.head.appendChild(s);
  }
})();`;

module.exports = { PAGE, SCRIPT };
