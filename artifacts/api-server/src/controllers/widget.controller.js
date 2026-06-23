'use strict';

/**
 * widget.controller.js
 * Atelier OmniCore — Embeddable visitor chat widget
 *
 * GET  /api/widget/widget.js    serve the embeddable JS bundle
 * POST /api/widget/session      create / restore a visitor session
 * POST /api/widget/upload       upload a file (base64 JSON body)
 * GET  /api/widget/files/:name  serve an uploaded file
 * POST /api/widget/message      send a message with attachments (REST fallback)
 * GET  /api/widget/demo         test page
 * GET  /api/widget/health       liveness check
 */

const { Router }            = require('express');
const express               = require('express');
const crypto                = require('crypto');
const fs                    = require('fs');
const path                  = require('path');
const { pool }              = require('../lib/db');
const logger                = require('../utils/logger');
const { broadcastToTenant, broadcastToConversation } = require('../services/socket.service');

const router = Router();

// Create uploads directory
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch(e) {}

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
    const { brandId, sessionToken, visitorName, visitorEmail, timezone } = req.body || {};
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

        // Update identity + timezone if provided
        const updates = [];
        const vals    = [];
        if (visitorName)  { updates.push(`display_name = $${vals.length+1}`); vals.push(visitorName); }
        if (visitorEmail) { updates.push(`email = $${vals.length+1}`);        vals.push(visitorEmail); }
        if (timezone)     { updates.push(`timezone = $${vals.length+1}`);     vals.push(timezone); }
        if (updates.length) {
          await pool.query(
            `UPDATE visitors SET ${updates.join(', ')} WHERE id = $${vals.length+1}`,
            [...vals, visitorId]
          );
        }

        // Find or create an open conversation
        let { rows: cRows } = await pool.query(
          `SELECT id FROM conversations WHERE visitor_id = $1 AND status != 'closed' ORDER BY created_at DESC LIMIT 1`,
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
          `SELECT m.id, m.conversation_id, m.sender_type, m.message_body, m.attachments_json,
                  m.is_internal_note, m.created_at,
                  COALESCE(a.name, vis.display_name, vis.email, m.sender_type) AS sender_name
           FROM messages m
           LEFT JOIN agents   a   ON (m.sender_type IN ('agent','bot') AND a.id   = m.sender_id)
           LEFT JOIN visitors vis ON (m.sender_type = 'visitor'        AND vis.id = m.sender_id)
           WHERE m.conversation_id = $1 AND m.is_internal_note = FALSE
           ORDER BY m.created_at ASC LIMIT 60`,
          [convId]
        );

        const { rows: bRows }  = await pool.query('SELECT brand_name FROM brands WHERE id = $1', [brandId]);
        const { rows: visData } = await pool.query('SELECT display_name FROM visitors WHERE id = $1', [visitorId]);

        return res.json({
          sessionToken,
          conversationId: convId,
          messages,
          brandName:   bRows[0]?.brand_name || 'Support',
          visitorName: visData[0]?.display_name || visitorName || null,
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
      `INSERT INTO visitors (tenant_id, brand_id, session_token, display_name, email, timezone)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenant_id, brandId, newToken, visitorName || null, visitorEmail || null, timezone || null]
    );

    const { rows: cNew } = await pool.query(
      `INSERT INTO conversations (tenant_id, brand_id, visitor_id, status, channel)
       VALUES ($1, $2, $3, 'open', 'widget') RETURNING id`,
      [tenant_id, brandId, vNew[0].id]
    );

    try {
      broadcastToTenant(tenant_id, 'conversation:created', {
        id: cNew[0].id,
        status: 'open', channel: 'widget', priority: 'normal', subject: null,
        visitor_name: visitorName || 'Visitor', visitor_email: visitorEmail || null,
        agent_name: null, brand_name,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        sla_breach_at: null, assigned_agent_id: null, unread: 0,
        visitor_id: vNew[0].id,
      });
    } catch { /* non-fatal */ }

    logger.info({ brandId, visitorId: vNew[0].id }, 'widget_session_created');
    return res.json({
      sessionToken: newToken,
      conversationId: cNew[0].id,
      messages: [],
      brandName: brand_name,
      visitorName: visitorName || null,
    });
  } catch (err) { next(err); }
});

// ── POST /api/widget/upload ───────────────────────────────────────────────────
// Accepts base64-encoded file data; saves to disk; returns a URL.
router.post('/upload', express.json({ limit: '20mb' }), async (req, res, next) => {
  try {
    const { filename, mimeType, data } = req.body || {};
    if (!filename || !data) return res.status(400).json({ error: 'filename and data are required' });
    const buffer  = Buffer.from(data, 'base64');
    const ext     = path.extname(filename) || '';
    const safeName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const filePath = path.join(UPLOADS_DIR, safeName);
    fs.writeFileSync(filePath, buffer);
    logger.info({ filename, size: buffer.length }, 'widget_file_uploaded');
    return res.json({ url: `/api/widget/files/${safeName}`, name: filename, type: mimeType });
  } catch (err) { next(err); }
});

// ── GET /api/widget/files/:name ───────────────────────────────────────────────
router.get('/files/:name', (req, res) => {
  const name     = path.basename(req.params.name); // prevent traversal
  const filePath = path.join(UPLOADS_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

// ── POST /api/widget/message ──────────────────────────────────────────────────
// REST fallback for visitor messages that include file attachments.
router.post('/message', async (req, res, next) => {
  try {
    const { conversationId, sessionToken, body: msgBody, attachments } = req.body || {};
    if (!conversationId || !sessionToken) {
      return res.status(400).json({ error: 'conversationId and sessionToken are required' });
    }

    const { rows: vRows } = await pool.query(
      'SELECT id, display_name, email FROM visitors WHERE session_token = $1',
      [sessionToken]
    );
    if (!vRows[0]) return res.status(401).json({ error: 'Invalid session' });
    const visitor = vRows[0];

    const { rows: cRows } = await pool.query(
      `SELECT id, status, tenant_id FROM conversations WHERE id = $1 AND visitor_id = $2`,
      [conversationId, visitor.id]
    );
    if (!cRows[0]) return res.status(404).json({ error: 'Conversation not found' });
    if (cRows[0].status === 'closed') return res.status(409).json({ error: 'Conversation is closed' });

    const attachmentsJson = (attachments && attachments.length > 0) ? JSON.stringify(attachments) : '[]';
    const { rows: newMsg } = await pool.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, message_body, is_internal_note, attachments_json)
       VALUES ($1, 'visitor', $2, $3, false, $4)
       RETURNING id, conversation_id, sender_type, message_body, is_internal_note, attachments_json, created_at`,
      [conversationId, visitor.id, (msgBody || '').trim(), attachmentsJson]
    );

    const result = { ...newMsg[0], sender_name: visitor.display_name || visitor.email || 'Visitor' };
    await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

    // Notify agents currently viewing this conversation
    broadcastToConversation(conversationId, 'server:new_message', result);

    // Notify ALL tenant agents so the inbox sidebar updates (unread count,
    // conversation sort order, toast) even if they haven't opened this conversation.
    try {
      broadcastToTenant(cRows[0].tenant_id, 'conversation:visitor_message', { conversationId, message: result });
    } catch { /* non-fatal */ }

    return res.status(201).json(result);
  } catch (err) { next(err); }
});

// ── GET /api/widget/widget.js ─────────────────────────────────────────────────
const WIDGET_JS = `
/* OmniCore Chat Widget — https://omnicore.chat */
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
var VNK='omnicore_vname_'+BRAND_ID;
var VEK='omnicore_vemail_'+BRAND_ID;

var state={
  open:false,loaded:false,loading:false,
  sessionToken:null,conversationId:null,
  messages:[],socket:null,connected:false,
  brandName:LABEL,unread:0,
  visitorName:null,visitorEmail:null
};
try{
  state.sessionToken=localStorage.getItem(SK);
  state.conversationId=localStorage.getItem(CK);
  state.visitorName=localStorage.getItem(VNK);
  state.visitorEmail=localStorage.getItem(VEK);
}catch(e){}

var pendingMessages=new Set();
var msgQueue=[];
var isSending=false;
var pendingFile=null;
var els={};

function ce(tag){return d.createElement(tag);}
function qs(sel,el){return(el||d).querySelector(sel);}

function setUnread(n){
  state.unread=n;
  var b=qs('#omni-badge');
  if(b){b.style.display=n>0?'flex':'none';b.textContent=n>9?'9+':String(n);}
}

function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmtTime(iso){
  try{
    var dt=new Date(iso),now=new Date(),diff=now-dt;
    if(diff<60000)return 'just now';
    if(diff<3600000)return Math.floor(diff/60000)+'m ago';
    if(dt.toDateString()===now.toDateString())return dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    return dt.toLocaleDateString([],{month:'short',day:'numeric'});
  }catch(e){return '';}
}

function appendMsg(msg,scroll){
  if(msg.is_internal_note)return;
  var box=qs('#omni-msgs');
  if(!box)return;
  var isAgent=msg.sender_type==='agent'||msg.sender_type==='bot';
  var wrap=ce('div');
  wrap.style.cssText='display:flex;flex-direction:column;align-items:'+(isAgent?'flex-end':'flex-start')+';gap:2px;margin-bottom:12px;';
  var lbl=ce('span');
  lbl.style.cssText='font-size:10px;color:#94a3b8;'+(isAgent?'margin-right:8px':'margin-left:8px');
  lbl.textContent=(isAgent?(msg.sender_name||'Agent'):(state.visitorName||'You'))+' \u00b7 '+fmtTime(msg.created_at);
  wrap.appendChild(lbl);
  if(msg.message_body){
    var bbl=ce('div');
    bbl.style.cssText='max-width:78%;padding:10px 13px;border-radius:16px;font-size:13px;line-height:1.55;word-break:break-word;white-space:pre-wrap;'+(isAgent?'border-bottom-right-radius:4px;background:'+COLOR+';color:#fff;':'border-bottom-left-radius:4px;background:#fff;color:#1e293b;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,.05);');
    bbl.textContent=msg.message_body;
    wrap.appendChild(bbl);
  }
  var atts=[];
  try{if(msg.attachments_json){var p=typeof msg.attachments_json==='string'?JSON.parse(msg.attachments_json):msg.attachments_json;if(Array.isArray(p))atts=p;}}catch(e){}
  atts.forEach(function(att){
    var aw=ce('div');aw.style.cssText='max-width:78%;margin-top:4px;';
    if(att.type&&att.type.startsWith('image/')){
      var img=ce('img');img.src=API_ORIGIN+att.url;
      img.style.cssText='max-width:200px;max-height:160px;border-radius:10px;display:block;cursor:pointer;';
      img.onclick=function(){w.open(API_ORIGIN+att.url,'_blank');};
      aw.appendChild(img);
    }else{
      var lnk=ce('a');lnk.href=API_ORIGIN+att.url;lnk.target='_blank';
      lnk.style.cssText='display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:500;'+(isAgent?'background:rgba(255,255,255,.2);color:#fff;':'background:#f1f5f9;color:#334155;');
      lnk.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'+escHtml(att.name||'File');
      aw.appendChild(lnk);
    }
    wrap.appendChild(aw);
  });
  box.appendChild(wrap);
  if(scroll!==false)box.scrollTop=box.scrollHeight;
}

function buildDom(){
  if(qs('#omni-widget-root'))return;
  var style=ce('style');
  style.textContent=[
    '#omni-fab{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:'+COLOR+';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,.22);z-index:2147483640;transition:transform .2s;}',
    '#omni-fab:hover{transform:scale(1.08);}',
    '#omni-badge{position:absolute;top:-3px;right:-3px;min-width:18px;height:18px;background:#ef4444;border-radius:9px;display:none;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;padding:0 4px;border:2px solid #fff;}',
    '#omni-widget-root{position:fixed;bottom:90px;right:24px;width:360px;height:580px;background:#f8fafc;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.06);display:flex;flex-direction:column;overflow:hidden;z-index:2147483639;}',
    '@media(max-width:440px){#omni-widget-root{width:calc(100vw - 16px);height:calc(100vh - 96px);bottom:80px;right:8px;border-radius:16px;}}',
    '#omni-header{background:'+COLOR+';padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;}',
    '#omni-title{color:#fff;font-size:15px;font-weight:700;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '#omni-subtitle{color:rgba(255,255,255,.8);font-size:11px;margin:2px 0 0;display:flex;align-items:center;gap:4px;}',
    '#omni-close-btn{background:rgba(255,255,255,.18);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;transition:background .15s;}',
    '#omni-close-btn:hover{background:rgba(255,255,255,.3);}',
    '#omni-prechat{flex:1;display:flex;flex-direction:column;justify-content:center;padding:28px 24px;background:#f8fafc;overflow-y:auto;}',
    '#omni-prechat h3{font-size:17px;font-weight:700;color:#0f172a;margin:0 0 6px;}',
    '#omni-prechat p{font-size:12px;color:#64748b;margin:0 0 22px;line-height:1.6;}',
    '.om-field{margin-bottom:14px;}',
    '.om-field label{display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em;}',
    '.om-field input{width:100%;padding:10px 13px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;color:#1e293b;outline:none;box-sizing:border-box;background:#fff;transition:border-color .15s;font-family:inherit;}',
    '.om-field input:focus{border-color:'+COLOR+';}',
    '.om-start-btn{width:100%;padding:12px;background:'+COLOR+';color:#fff;border:none;border-radius:11px;font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s;letter-spacing:.02em;font-family:inherit;}',
    '.om-start-btn:hover{opacity:.9;}',
    '.om-start-btn:disabled{opacity:.5;cursor:default;}',
    '#omni-loading{flex:1;display:flex;align-items:center;justify-content:center;font-size:13px;color:#94a3b8;font-family:inherit;}',
    '#omni-msgs{flex:1;overflow-y:auto;padding:14px;background:#f8fafc;}',
    '#omni-msgs::-webkit-scrollbar{width:4px;}',
    '#omni-msgs::-webkit-scrollbar-thumb{background:#e2e8f0;border-radius:2px;}',
    '#omni-attach-preview{padding:6px 12px;background:#eff6ff;border-top:1px solid #bfdbfe;display:none;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:#1d4ed8;flex-shrink:0;}',
    '#omni-attach-clear{background:none;border:none;cursor:pointer;color:#60a5fa;font-size:15px;padding:0;line-height:1;flex-shrink:0;}',
    '#omni-composer{padding:10px 12px;background:#fff;border-top:1px solid #e2e8f0;display:flex;align-items:flex-end;gap:8px;flex-shrink:0;}',
    '#omni-inp{flex:1;resize:none;border:1.5px solid #e2e8f0;border-radius:12px;padding:9px 13px;font-size:13px;line-height:1.45;outline:none;max-height:100px;background:#f8fafc;color:#1e293b;transition:border-color .15s;font-family:inherit;}',
    '#omni-inp:focus{border-color:'+COLOR+';background:#fff;}',
    '#omni-inp:disabled{opacity:.5;cursor:not-allowed;}',
    '#omni-file-btn{width:34px;height:34px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#64748b;transition:background .15s;}',
    '#omni-file-btn:hover{background:#e2e8f0;}',
    '#omni-snd{width:36px;height:36px;background:'+COLOR+';border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s;}',
    '#omni-snd:hover{opacity:.9;}',
    '#omni-snd:disabled{opacity:.35;cursor:default;}',
    '#omni-footer{padding:5px;text-align:center;background:#fff;border-top:1px solid #f1f5f9;font-size:9.5px;color:#94a3b8;font-family:inherit;flex-shrink:0;}'
  ].join('');
  d.head.appendChild(style);

  var fab=ce('button');
  fab.id='omni-fab';fab.setAttribute('aria-label','Open chat');
  fab.innerHTML=chatIcon()+'<div id="omni-badge" style="display:none">0</div>';
  d.body.appendChild(fab);
  els.fab=fab;

  var root=ce('div');root.id='omni-widget-root';root.style.display='none';
  root.innerHTML=(
    '<div id="omni-header">'+
      '<div style="flex:1;min-width:0">'+
        '<p id="omni-title">'+escHtml(state.brandName)+'</p>'+
        '<p id="omni-subtitle"><span style="width:7px;height:7px;border-radius:50%;background:#4ade80;display:inline-block;margin-right:4px"></span>Online \u2014 we reply fast</p>'+
      '</div>'+
      '<button id="omni-close-btn" aria-label="Close">\u2715</button>'+
    '</div>'+
    '<div id="omni-prechat" style="display:none">'+
      '<h3>\uD83D\uDC4B Welcome!</h3>'+
      '<p>Please introduce yourself so our support team can assist you.</p>'+
      '<div class="om-field"><label>Your Name <span style="color:#ef4444">*</span></label><input id="om-vname" type="text" placeholder="Jane Smith" autocomplete="name"></div>'+
      '<div class="om-field"><label>Email Address</label><input id="om-vemail" type="email" placeholder="jane@example.com" autocomplete="email"></div>'+
      '<button class="om-start-btn" id="om-start-btn">Start Chat \u2192</button>'+
    '</div>'+
    '<div id="omni-loading" style="display:none">Connecting\u2026</div>'+
    '<div id="omni-msgs" style="display:none"></div>'+
    '<div id="omni-attach-preview"><span id="omni-attach-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><button id="omni-attach-clear">\u2715</button></div>'+
    '<div id="omni-composer" style="display:none">'+
      '<button id="omni-file-btn" title="Attach file"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>'+
      '<input type="file" id="omni-file-input" accept="image/*,.pdf,.csv,.doc,.docx,.xls,.xlsx,.txt" style="display:none">'+
      '<textarea id="omni-inp" rows="1" placeholder="Type a message\u2026"></textarea>'+
      '<button id="omni-snd" aria-label="Send"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>'+
    '</div>'+
    '<div id="omni-footer">Powered by <strong>OmniCore</strong></div>'
  );
  d.body.appendChild(root);
  els.root=root;

  els.title    =qs('#omni-title');
  els.msgs     =qs('#omni-msgs');
  els.inp      =qs('#omni-inp');
  els.snd      =qs('#omni-snd');
  els.loading  =qs('#omni-loading');
  els.composer =qs('#omni-composer');
  els.prechat  =qs('#omni-prechat');
  els.fileBtn  =qs('#omni-file-btn');
  els.fileInput=qs('#omni-file-input');
  els.attPrev  =qs('#omni-attach-preview');
  els.attName  =qs('#omni-attach-name');

  fab.addEventListener('click',toggle);
  qs('#omni-close-btn').addEventListener('click',close);
  els.inp.addEventListener('input',autoResize);
  els.inp.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
  els.snd.addEventListener('click',send);
  els.fileBtn.addEventListener('click',function(){els.fileInput.click();});
  els.fileInput.addEventListener('change',onFileSelect);
  qs('#omni-attach-clear').addEventListener('click',clearAttach);
  qs('#om-start-btn').addEventListener('click',submitPreChat);
  qs('#om-vname').addEventListener('keydown',function(e){if(e.key==='Enter'){var em=qs('#om-vemail');em?em.focus():submitPreChat();}});
  qs('#om-vemail').addEventListener('keydown',function(e){if(e.key==='Enter')submitPreChat();});
}

function chatIcon(){
  return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
}
function closeIcon(){
  return '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
}

function onFileSelect(){
  var file=els.fileInput.files[0];
  if(!file)return;
  if(file.size>5*1024*1024){alert('File too large. Max 5\u202fMB.');return;}
  var reader=new FileReader();
  reader.onload=function(e){
    pendingFile={file:file,dataUrl:e.target.result,name:file.name,type:file.type};
    els.attName.textContent='\uD83D\uDCCE '+file.name;
    els.attPrev.style.display='flex';
    els.inp.placeholder='Add a message (optional)\u2026';
  };
  reader.readAsDataURL(file);
  els.fileInput.value='';
}
function clearAttach(){
  pendingFile=null;
  els.attPrev.style.display='none';
  els.inp.placeholder='Type a message\u2026';
}

function submitPreChat(){
  var nameEl=qs('#om-vname'),emailEl=qs('#om-vemail');
  var name=(nameEl.value||'').trim();
  if(!name){nameEl.focus();nameEl.style.borderColor='#ef4444';return;}
  nameEl.style.borderColor='';
  var email=(emailEl.value||'').trim()||null;
  state.visitorName=name;state.visitorEmail=email;
  try{localStorage.setItem(VNK,name);if(email)localStorage.setItem(VEK,email);}catch(e){}
  els.prechat.style.display='none';
  startSession();
}

function autoResize(){
  els.inp.style.height='auto';
  els.inp.style.height=Math.min(els.inp.scrollHeight,100)+'px';
}

function toggle(){if(state.open)close();else open();}

function open(){
  state.open=true;
  els.root.style.display='flex';
  els.fab.innerHTML=closeIcon()+'<div id="omni-badge" style="display:none">0</div>';
  setUnread(0);
  if(!state.loaded&&!state.loading){
    if(!state.visitorName&&!state.sessionToken){
      els.prechat.style.display='flex';
      setTimeout(function(){var v=qs('#om-vname');if(v)v.focus();},120);
    }else{
      startSession();
    }
  }else if(state.loaded){
    setTimeout(function(){if(els.msgs)els.msgs.scrollTop=els.msgs.scrollHeight;},50);
  }
}
function close(){
  state.open=false;
  els.root.style.display='none';
  if(els.fab)els.fab.innerHTML=chatIcon()+'<div id="omni-badge" style="display:none">0</div>';
}

function showLoading(){
  if(els.loading)els.loading.style.display='flex';
  if(els.msgs)els.msgs.style.display='none';
  if(els.composer)els.composer.style.display='none';
}
function showChat(){
  if(els.loading)els.loading.style.display='none';
  if(els.msgs)els.msgs.style.display='block';
  if(els.composer)els.composer.style.display='flex';
}

function startSession(){
  if(state.loading)return;
  state.loading=true;
  showLoading();
  var tz='';try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch(e){}
  fetch(API_BASE+'/widget/session',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      brandId:BRAND_ID,sessionToken:state.sessionToken,
      visitorName:state.visitorName||null,
      visitorEmail:state.visitorEmail||null,
      timezone:tz||null
    })
  })
  .then(function(r){return r.json();})
  .then(function(data){
    state.loading=false;state.loaded=true;
    state.sessionToken=data.sessionToken;
    state.conversationId=data.conversationId;
    if(data.visitorName&&!state.visitorName)state.visitorName=data.visitorName;
    if(data.brandName)state.brandName=data.brandName;
    try{localStorage.setItem(SK,data.sessionToken);localStorage.setItem(CK,data.conversationId);}catch(e){}
    if(els.title)els.title.textContent=state.brandName;
    state.messages=data.messages||[];
    showChat();
    state.messages.forEach(function(m){appendMsg(m,false);});
    if(els.msgs)els.msgs.scrollTop=els.msgs.scrollHeight;
    initSio();
  })
  .catch(function(){
    state.loading=false;
    if(els.loading){
      els.loading.textContent='Could not connect. Click to retry.';
      els.loading.style.cursor='pointer';
      els.loading.onclick=function(){els.loading.textContent='Connecting\u2026';els.loading.style.cursor='default';startSession();};
    }
  });
}

function initSio(){
  if(state.socket)return;
  var s=ce('script');s.src=API_ORIGIN+'/api/socket.io/socket.io.js';
  s.onload=function(){
    var sk=w.io(API_ORIGIN,{path:'/api/socket.io',auth:{sessionToken:state.sessionToken},transports:['websocket','polling'],reconnectionAttempts:6,reconnectionDelay:1500});
    state.socket=sk;
    sk.on('connect',function(){
      state.connected=true;
      sk.emit('join:conversation',{conversationId:state.conversationId});
      while(msgQueue.length>0)sk.emit('client:send_message',{conversationId:state.conversationId,body:msgQueue.shift()});
      emitPage();
    });
    sk.on('disconnect',function(){state.connected=false;});
    sk.on('server:new_message',function(msg){
      if(msg.is_internal_note)return;
      if(msg.sender_type==='visitor'&&pendingMessages.has(msg.message_body)){
        pendingMessages.delete(msg.message_body);
        state.messages.push(msg);
        return;
      }
      state.messages.push(msg);
      appendMsg(msg,true);
      if(!state.open)setUnread(state.unread+1);
    });
  };
  d.head.appendChild(s);
}

function emitPage(){
  if(!state.socket||!state.connected||!state.conversationId)return;
  state.socket.emit('visitor:page_change',{conversationId:state.conversationId,url:w.location.href});
}
var _lastHref=w.location.href;
setInterval(function(){if(w.location.href!==_lastHref){_lastHref=w.location.href;emitPage();}},1500);

function uploadFile(pf,cb){
  var comma=pf.dataUrl.indexOf(',');
  var base64=comma>=0?pf.dataUrl.slice(comma+1):pf.dataUrl;
  fetch(API_BASE+'/widget/upload',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({filename:pf.name,mimeType:pf.type,data:base64,conversationId:state.conversationId})
  }).then(function(r){return r.json();}).then(function(d){cb(null,d);}).catch(function(e){cb(e,null);});
}

function send(){
  var body=(els.inp.value||'').trim();
  var hasFile=!!pendingFile;
  if((!body&&!hasFile)||!state.conversationId||isSending)return;
  isSending=true;
  var sentBody=body;
  els.inp.value='';els.inp.style.height='auto';els.snd.disabled=true;

  if(hasFile){
    var pf=pendingFile;clearAttach();
    if(sentBody){
      pendingMessages.add(sentBody);
      appendMsg({id:'opt_'+Date.now(),sender_type:'visitor',message_body:sentBody,is_internal_note:false,created_at:new Date().toISOString()},true);
    }
    uploadFile(pf,function(err,fileData){
      isSending=false;els.snd.disabled=false;
      if(err){appendMsg({id:'err_'+Date.now(),sender_type:'system',message_body:'\u26A0\uFE0F File upload failed.',is_internal_note:false,created_at:new Date().toISOString()},true);return;}
      fetch(API_BASE+'/widget/message',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({conversationId:state.conversationId,sessionToken:state.sessionToken,body:sentBody||'',attachments:[{url:fileData.url,name:pf.name,type:pf.type}]})
      }).then(function(r){return r.json();}).then(function(msg){appendMsg(msg,true);}).catch(function(){});
    });
    return;
  }

  pendingMessages.add(sentBody);
  appendMsg({id:'opt_'+Date.now(),sender_type:'visitor',message_body:sentBody,is_internal_note:false,created_at:new Date().toISOString()},true);
  if(state.socket&&state.connected){
    state.socket.emit('client:send_message',{conversationId:state.conversationId,body:sentBody});
  }else{
    msgQueue.push(sentBody);
  }
  setTimeout(function(){isSending=false;els.snd.disabled=false;},600);
}

buildDom();
w.addEventListener('load',emitPage);
})(window,document);
`;

// ── GET /api/widget/demo ──────────────────────────────────────────────────────
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
  .embed{background:#1e293b;border-radius:10px;padding:16px;margin-top:20px;text-align:left;}
  .embed pre{color:#7dd3fc;font-size:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;}
</style>
</head>
<body>
<div class="card">
  <h1>OmniCore Widget</h1>
  <p>The chat widget is active on this page. Click the <strong>blue bubble</strong> in the bottom-right corner to open it.</p>
  <div class="badge"><span class="dot"></span>Widget loaded &amp; connected</div>
  <p>Embed on any site with one line:</p>
  <div class="embed">
    <pre>&lt;script src="https://YOUR_DOMAIN/api/widget/widget.js"
  data-brand-id="22222222-2222-2222-2222-222222222222"
  data-label="OmniCore Support" defer&gt;&lt;/script&gt;</pre>
  </div>
</div>
<script src="/api/widget/widget.js" data-brand-id="22222222-2222-2222-2222-222222222222" data-label="OmniCore Support" data-color="#0284c7"></script>
</body>
</html>`);
});

router.get('/widget.js', (_req, res) => {
  res.setHeader('Content-Type',                  'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control',                 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin',   '*');
  res.setHeader('Cross-Origin-Resource-Policy',  'cross-origin');
  res.send(WIDGET_JS.trimStart());
});

module.exports = router;
