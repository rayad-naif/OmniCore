'use strict';

/**
 * widget.controller.js
 * Atelier OmniCore — Embeddable visitor chat widget
 *
 * GET  /api/widget/widget.js   serve the embeddable JS bundle
 * POST /api/widget/session     create / restore a visitor session
 * GET  /api/widget/health      quick liveness check (no auth)
 *
 * All endpoints are unauthenticated and CORS * because they are called
 * from third-party websites, not from the dashboard.
 */

const { Router }  = require('express');
const crypto      = require('crypto');
const { pool }    = require('../lib/db');
const logger      = require('../utils/logger');

const router = Router();

// ── CORS: allow any origin (widget is embedded on customer sites) ─────────────
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ── GET /api/widget/health ────────────────────────────────────────────────────
router.get('/health', (_req, res) => res.json({ ok: true }));

// ── POST /api/widget/session ──────────────────────────────────────────────────
router.post('/session', async (req, res, next) => {
  try {
    const { brandId, sessionToken } = req.body || {};
    if (!brandId) return res.status(400).json({ error: 'brandId is required' });

    // ── Returning visitor ──────────────────────────────────────────────────────
    if (sessionToken) {
      const { rows: vRows } = await pool.query(
        'SELECT id, tenant_id FROM visitors WHERE session_token = $1 AND brand_id = $2',
        [sessionToken, brandId]
      );
      if (vRows[0]) {
        const visitorId = vRows[0].id;
        const tenantId  = vRows[0].tenant_id;

        // Find or create an open conversation
        let { rows: cRows } = await pool.query(
          `SELECT id FROM conversations
           WHERE visitor_id = $1 AND status != 'closed'
           ORDER BY created_at DESC LIMIT 1`,
          [visitorId]
        );
        let convId = cRows[0]?.id;
        if (!convId) {
          const { rows: nc } = await pool.query(
            `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel)
             VALUES ($1, $2, $3, 'open', 'widget') RETURNING id`,
            [tenantId, brandId, visitorId]
          );
          convId = nc[0].id;
        }

        // Recent public messages
        const { rows: messages } = await pool.query(
          `SELECT m.id, m.conversation_id, m.sender_type, m.message_body,
                  m.is_internal_note, m.created_at,
                  COALESCE(a.name, vis.display_name, vis.email, m.sender_type) AS sender_name
           FROM messages m
           LEFT JOIN agents   a   ON (m.sender_type IN ('agent','bot') AND a.id   = m.sender_id)
           LEFT JOIN visitors vis ON (m.sender_type = 'visitor'        AND vis.id = m.sender_id)
           WHERE m.conversation_id = $1 AND m.is_internal_note = FALSE
           ORDER BY m.created_at ASC LIMIT 60`,
          [convId]
        );

        const { rows: bRows } = await pool.query(
          'SELECT brand_name FROM brands WHERE id = $1', [brandId]
        );

        return res.json({
          sessionToken,
          conversationId: convId,
          messages,
          brandName: bRows[0]?.brand_name || 'Support',
        });
      }
    }

    // ── New visitor ────────────────────────────────────────────────────────────
    const { rows: bRows } = await pool.query(
      'SELECT id, tenant_id, brand_name FROM brands WHERE id = $1', [brandId]
    );
    if (!bRows[0]) return res.status(404).json({ error: 'Brand not found' });
    const { tenant_id, brand_name } = bRows[0];

    const newToken = crypto.randomUUID();
    const { rows: vNew } = await pool.query(
      `INSERT INTO visitors (tenant_id, brand_id, session_token) VALUES ($1, $2, $3) RETURNING id`,
      [tenant_id, brandId, newToken]
    );

    const { rows: cNew } = await pool.query(
      `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel)
       VALUES ($1, $2, $3, 'open', 'widget') RETURNING id`,
      [tenant_id, brandId, vNew[0].id]
    );

    logger.info({ brandId, visitorId: vNew[0].id }, 'widget_session_created');
    return res.json({
      sessionToken: newToken,
      conversationId: cNew[0].id,
      messages: [],
      brandName: brand_name,
    });
  } catch (err) { next(err); }
});

// ── GET /api/widget/widget.js ─────────────────────────────────────────────────
// The widget JS is served inline so esbuild doesn't need to deal with
// static file references.  Every request gets the same bytes.
// ---------------------------------------------------------------------------
const WIDGET_JS = `
/* OmniCore Chat Widget — https://github.com/atelier-omnicore */
(function(w,d){
'use strict';
var script=d.currentScript;
if(!script)return;
var BRAND_ID=script.getAttribute('data-brand-id');
var LABEL=script.getAttribute('data-label')||'Chat with us';
var COLOR=script.getAttribute('data-color')||'#0284c7';
var API_ORIGIN=(function(){try{return new URL(script.src).origin;}catch(e){return w.location.origin;}})();
var API_BASE=API_ORIGIN+'/api';
if(!BRAND_ID)return;

var SK='omnicore_sid_'+BRAND_ID;
var CK='omnicore_cid_'+BRAND_ID;

var state={
  open:false,loaded:false,loading:false,
  sessionToken:null,conversationId:null,
  messages:[],socket:null,connected:false,
  brandName:LABEL,unread:0
};
try{state.sessionToken=localStorage.getItem(SK);state.conversationId=localStorage.getItem(CK);}catch(e){}

var els={};

function qs(id){return d.getElementById(id);}
function ce(tag){return d.createElement(tag);}

function tAgo(iso){
  var diff=Date.now()-new Date(iso).getTime(),m=60000,h=3600000;
  if(diff<m)return'just now';
  if(diff<h)return Math.floor(diff/m)+'m ago';
  return Math.floor(diff/h)+'h ago';
}

function svgi(p){return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';}
var ICO_CHAT = svgi('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>');
var ICO_X    = svgi('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>');
var ICO_SEND = svgi('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>');
var ICO_BOT  = svgi('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="5" r="1"/>');

function injectCss(){
  var s=ce('style');
  s.textContent=[
    '#omni-fab{position:fixed;bottom:24px;right:24px;z-index:2147483640;width:56px;height:56px;border-radius:50%;background:'+COLOR+';color:#fff;border:none;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;transition:transform .2s,box-shadow .2s;font-family:inherit;}',
    '#omni-fab:hover{transform:scale(1.08);box-shadow:0 8px 28px rgba(0,0,0,.35);}',
    '#omni-badge{position:absolute;top:-3px;right:-3px;background:#ef4444;color:#fff;border-radius:999px;padding:2px 5px;font-size:11px;font-weight:700;display:none;border:2px solid #fff;line-height:1.2;}',
    '#omni-panel{position:fixed;bottom:90px;right:24px;z-index:2147483639;width:360px;height:530px;max-height:calc(100vh - 120px);background:#fff;border-radius:18px;box-shadow:0 16px 56px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden;transform:scale(.94) translateY(14px);opacity:0;pointer-events:none;transition:transform .22s cubic-bezier(.34,1.2,.64,1),opacity .16s;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
    '#omni-panel.omni-open{transform:scale(1) translateY(0);opacity:1;pointer-events:all;}',
    '#omni-hd{background:#0f172a;padding:14px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0;}',
    '#omni-av{width:36px;height:36px;border-radius:50%;background:'+COLOR+';color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0;}',
    '#omni-info{flex:1;min-width:0;}',
    '#omni-title{color:#f1f5f9;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '#omni-srow{display:flex;align-items:center;gap:5px;margin-top:2px;}',
    '#omni-sdot{width:7px;height:7px;border-radius:50%;background:#94a3b8;transition:background .4s;}',
    '#omni-sdot.on{background:#22c55e;}',
    '#omni-stxt{color:#94a3b8;font-size:11px;}',
    '#omni-xbtn{background:transparent;border:none;cursor:pointer;color:#64748b;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px;transition:background .15s,color .15s;flex-shrink:0;}',
    '#omni-xbtn:hover{background:#1e293b;color:#f1f5f9;}',
    '#omni-msgs{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:8px;background:#f8fafc;}',
    '#omni-msgs::-webkit-scrollbar{width:4px;}#omni-msgs::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:2px;}',
    '.om{display:flex;align-items:flex-end;gap:7px;max-width:88%;}',
    '.om.out{align-self:flex-end;flex-direction:row-reverse;}',
    '.om.in{align-self:flex-start;}',
    '.om-av{width:26px;height:26px;border-radius:50%;background:#e2e8f0;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#475569;}',
    '.om-av.bot{background:#ede9fe;color:#7c3aed;}',
    '.om-bub{padding:9px 13px;border-radius:16px;font-size:13px;line-height:1.45;max-width:100%;word-break:break-word;white-space:pre-wrap;}',
    '.out .om-bub{background:'+COLOR+';color:#fff;border-bottom-right-radius:4px;}',
    '.in  .om-bub{background:#fff;color:#1e293b;border:1px solid #e2e8f0;border-bottom-left-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.06);}',
    '.bot .om-bub{background:#f5f3ff;color:#4c1d95;border:1px solid #ede9fe;border-bottom-left-radius:4px;}',
    '.om-ts{font-size:10px;color:#94a3b8;margin-top:2px;padding:0 3px;}',
    '.out .om-ts{text-align:right;}',
    '.om-dots{display:flex;gap:4px;padding:2px 0;}',
    '.om-dots span{width:6px;height:6px;background:#94a3b8;border-radius:50%;animation:om-b .9s infinite;}',
    '.om-dots span:nth-child(2){animation-delay:.15s}.om-dots span:nth-child(3){animation-delay:.3s}',
    '@keyframes om-b{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}',
    '#omni-intro{text-align:center;padding:24px 16px;color:#64748b;font-size:12px;line-height:1.6;}',
    '#omni-intro strong{display:block;font-size:15px;color:#1e293b;margin-bottom:6px;}',
    '#omni-ldr{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:#94a3b8;font-size:12px;}',
    '.om-spin{width:20px;height:20px;border:2px solid #e2e8f0;border-top-color:'+COLOR+';border-radius:50%;animation:om-s .6s linear infinite;}',
    '@keyframes om-s{to{transform:rotate(360deg)}}',
    '#omni-cmp{border-top:1px solid #e2e8f0;padding:10px 12px;display:flex;align-items:flex-end;gap:8px;background:#fff;flex-shrink:0;}',
    '#omni-inp{flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:13px;color:#1e293b;resize:none;max-height:100px;outline:none;font-family:inherit;background:#f8fafc;transition:border-color .15s;}',
    '#omni-inp:focus{border-color:'+COLOR+';background:#fff;}',
    '#omni-inp::placeholder{color:#94a3b8;}',
    '#omni-snd{width:36px;height:36px;border-radius:10px;flex-shrink:0;background:'+COLOR+';color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .15s;}',
    '#omni-snd:disabled{opacity:.38;cursor:default;}',
    '#omni-ft{text-align:center;padding:5px;font-size:10px;color:#cbd5e1;border-top:1px solid #f1f5f9;flex-shrink:0;}',
    '@media(max-width:440px){#omni-panel{width:calc(100vw - 20px);right:10px;bottom:78px;}#omni-fab{right:10px;bottom:10px;}}'
  ].join('');
  d.head.appendChild(s);
}

function buildDom(){
  var fab=ce('button');fab.id='omni-fab';fab.setAttribute('aria-label',LABEL);
  fab.innerHTML=ICO_CHAT+'<span id="omni-badge"></span>';
  fab.onclick=toggle;
  d.body.appendChild(fab);

  var panel=ce('div');panel.id='omni-panel';panel.setAttribute('role','dialog');
  panel.innerHTML=(
    '<div id="omni-hd">'+
      '<div id="omni-av">'+LABEL[0].toUpperCase()+'</div>'+
      '<div id="omni-info">'+
        '<div id="omni-title">'+LABEL+'</div>'+
        '<div id="omni-srow"><span id="omni-sdot"></span><span id="omni-stxt">Connecting\u2026</span></div>'+
      '</div>'+
      '<button id="omni-xbtn" aria-label="Close">'+ICO_X+'</button>'+
    '</div>'+
    '<div id="omni-msgs"><div id="omni-ldr"><div class="om-spin"></div>Loading\u2026</div></div>'+
    '<div id="omni-cmp">'+
      '<textarea id="omni-inp" rows="1" placeholder="Type a message\u2026"></textarea>'+
      '<button id="omni-snd" aria-label="Send">'+ICO_SEND+'</button>'+
    '</div>'+
    '<div id="omni-ft">Powered by <strong>OmniCore</strong></div>'
  );
  d.body.appendChild(panel);

  els.fab   =fab;  els.panel =panel;
  els.badge =qs('omni-badge');  els.msgs  =qs('omni-msgs');
  els.sdot  =qs('omni-sdot');   els.stxt  =qs('omni-stxt');
  els.title =qs('omni-title');  els.inp   =qs('omni-inp');
  els.snd   =qs('omni-snd');    els.xbtn  =qs('omni-xbtn');

  els.xbtn.onclick=close;
  els.inp.addEventListener('input',function(){
    this.style.height='auto';
    this.style.height=Math.min(this.scrollHeight,100)+'px';
    els.snd.disabled=!this.value.trim();
  });
  els.inp.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}
  });
  els.snd.onclick=send;
}

function toggle(){state.open?close():open();}

function open(){
  state.open=true;
  els.panel.classList.add('omni-open');
  els.fab.innerHTML=ICO_X+'<span id="omni-badge"></span>';
  els.badge=qs('omni-badge');
  setUnread(0);
  if(!state.loaded&&!state.loading)startSession();
  setTimeout(function(){if(els.inp)els.inp.focus();},240);
}

function close(){
  state.open=false;
  els.panel.classList.remove('omni-open');
  els.fab.innerHTML=ICO_CHAT+'<span id="omni-badge"></span>';
  els.badge=qs('omni-badge');
  renderBadge();
}

function setUnread(n){state.unread=n;renderBadge();}
function renderBadge(){
  if(!els.badge)return;
  if(state.unread>0&&!state.open){els.badge.style.display='block';els.badge.textContent=state.unread>9?'9+':state.unread;}
  else{els.badge.style.display='none';}
}

function startSession(){
  state.loading=true;
  fetch(API_BASE+'/widget/session',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({brandId:BRAND_ID,sessionToken:state.sessionToken})
  })
  .then(function(r){return r.json();})
  .then(function(data){
    state.loading=false;state.loaded=true;
    state.sessionToken=data.sessionToken;
    state.conversationId=data.conversationId;
    state.messages=data.messages||[];
    if(data.brandName){state.brandName=data.brandName;if(els.title)els.title.textContent=data.brandName;}
    try{localStorage.setItem(SK,state.sessionToken);localStorage.setItem(CK,state.conversationId);}catch(e){}
    renderMsgs();
    loadSio();
  })
  .catch(function(){state.loading=false;showErr('Could not connect. Please try again.');});
}

function loadSio(){
  if(w.io){initSio();return;}
  var s=ce('script');
  s.src='https://cdn.socket.io/4.8.1/socket.io.min.js';
  s.crossOrigin='anonymous';
  s.onload=initSio;
  s.onerror=function(){setSt('Offline',false);};
  d.head.appendChild(s);
}

var msgQueue=[];

function flushQueue(){
  var q=msgQueue.splice(0);
  q.forEach(function(body){
    state.socket.emit('client:send_message',{conversationId:state.conversationId,body:body});
  });
}

function initSio(){
  var sk=w.io(API_ORIGIN,{
    path:'/api/socket.io',
    auth:{sessionToken:state.sessionToken},
    transports:['websocket','polling'],
    reconnectionDelay:2000
  });
  state.socket=sk;
  sk.on('connect',function(){
    state.connected=true;setSt('Online',true);
    sk.emit('join:conversation',{conversationId:state.conversationId});
    flushQueue();
  });
  sk.on('disconnect',function(){
    state.connected=false;setSt('Reconnecting\u2026',false);
  });
  sk.on('connect_error',function(){setSt('Offline — retrying\u2026',false);});
  sk.on('server:new_message',function(msg){
    if(msg.is_internal_note)return;
    state.messages.push(msg);
    appendMsg(msg,false);
    if(!state.open)setUnread(state.unread+1);
  });
  sk.on('agent:is_typing',function(){showTyping();});
  sk.on('agent:typing_stopped',function(){hideTyping();});
}

function renderMsgs(){
  var ldr=qs('omni-ldr');if(ldr)ldr.remove();
  if(state.messages.length===0){
    var intro=ce('div');intro.id='omni-intro';
    intro.innerHTML='<strong>'+state.brandName+'</strong>We typically reply in a few minutes.\uD83D\uDCAC';
    els.msgs.appendChild(intro);
  }else{
    state.messages.forEach(function(m){appendMsg(m,true);});
  }
  scrollBot();
}

function appendMsg(msg,noScroll){
  if(!els.msgs||msg.is_internal_note)return;
  var intro=qs('omni-intro');if(intro)intro.remove();
  var isOut=msg.sender_type==='visitor';
  var isBot=msg.sender_type==='bot';
  var wrap=ce('div');wrap.className='om '+(isOut?'out':isBot?'bot in':'in');
  var av=ce('div');av.className='om-av'+(isBot?' bot':'');
  if(isBot){av.innerHTML=ICO_BOT;}
  else if(isOut){av.textContent='\u2605';}
  else{av.textContent=(msg.sender_name||'A')[0].toUpperCase();}
  var right=ce('div');
  var bub=ce('div');bub.className='om-bub';bub.textContent=msg.message_body;
  var ts=ce('div');ts.className='om-ts';ts.textContent=tAgo(msg.created_at);
  right.appendChild(bub);right.appendChild(ts);
  if(!isOut)wrap.appendChild(av);
  wrap.appendChild(right);
  if(isOut)wrap.appendChild(av);
  els.msgs.appendChild(wrap);
  if(!noScroll)scrollBot();
}

var typingEl=null;
function showTyping(){
  if(typingEl)return;
  typingEl=ce('div');typingEl.className='om bot in';
  typingEl.innerHTML='<div class="om-av bot">'+ICO_BOT+'</div><div><div class="om-bub"><div class="om-dots"><span></span><span></span><span></span></div></div></div>';
  els.msgs.appendChild(typingEl);scrollBot();
}
function hideTyping(){if(typingEl){typingEl.remove();typingEl=null;}}

function send(){
  var body=els.inp.value.trim();
  if(!body||!state.conversationId)return;
  els.inp.value='';els.inp.style.height='auto';els.snd.disabled=true;
  appendMsg({id:'opt_'+Date.now(),sender_type:'visitor',message_body:body,is_internal_note:false,created_at:new Date().toISOString()},false);
  if(state.socket&&state.connected){
    state.socket.emit('client:send_message',{conversationId:state.conversationId,body:body});
  } else {
    // Socket not yet connected — queue the message and flush on connect
    msgQueue.push(body);
  }
}

function scrollBot(){if(els.msgs)els.msgs.scrollTop=els.msgs.scrollHeight;}

function setSt(text,online){
  if(els.stxt)els.stxt.textContent=text;
  if(els.sdot){if(online)els.sdot.classList.add('on');else els.sdot.classList.remove('on');}
}

function showErr(msg){
  var ldr=qs('omni-ldr');if(ldr)ldr.remove();
  var e=ce('div');e.style.cssText='text-align:center;padding:20px;font-size:12px;color:#ef4444;';
  e.textContent=msg;if(els.msgs)els.msgs.appendChild(e);
}

injectCss();
if(d.readyState==='loading'){d.addEventListener('DOMContentLoaded',buildDom);}
else{buildDom();}

})(window,document);
`;

// ── GET /api/widget/demo ──────────────────────────────────────────────────────
// Simple HTML test page — load it in a browser to see the widget in action
router.get('/demo', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>OmniCore Widget Demo</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;}
  .card{background:#fff;border-radius:16px;padding:48px 40px;max-width:480px;width:100%;box-shadow:0 4px 32px rgba(0,0,0,.1);text-align:center;}
  h1{font-size:24px;font-weight:700;color:#0f172a;margin-bottom:8px;}
  p{color:#64748b;font-size:14px;line-height:1.6;margin-bottom:24px;}
  .badge{display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;margin-bottom:24px;}
  .dot{width:7px;height:7px;border-radius:50%;background:#22c55e;}
  code{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:2px 8px;font-size:12px;color:#475569;}
  .embed{background:#1e293b;border-radius:10px;padding:16px;margin-top:20px;text-align:left;}
  .embed pre{color:#7dd3fc;font-size:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;}
</style>
</head>
<body>
<div class="card">
  <h1>OmniCore Widget</h1>
  <p>The chat widget is active on this page. Click the <strong>sky-blue bubble</strong> in the bottom-right corner to open it.</p>
  <div class="badge"><span class="dot"></span>Widget loaded &amp; connected</div>
  <p>Embed on any site with one line:</p>
  <div class="embed">
    <pre>&lt;script
  src="https://YOUR_DOMAIN/api/widget/widget.js"
  data-brand-id="22222222-2222-2222-2222-222222222222"
  data-label="OmniCore Support"
  defer
&gt;&lt;/script&gt;</pre>
  </div>
</div>
<script
  src="/api/widget/widget.js"
  data-brand-id="22222222-2222-2222-2222-222222222222"
  data-label="OmniCore Support"
  data-color="#0284c7"
></script>
</body>
</html>`);
});

router.get('/widget.js', (_req, res) => {
  res.setHeader('Content-Type',                  'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control',                 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin',   '*');
  res.setHeader('Cross-Origin-Resource-Policy',  'cross-origin');  // allows GoHighLevel / external sites to inject
  res.send(WIDGET_JS.trimStart());
});

module.exports = router;
