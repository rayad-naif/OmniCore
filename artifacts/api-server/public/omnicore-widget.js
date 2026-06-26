/**
 * omnicore-widget.js
 * Atelier OmniCore — Public Chat Widget
 * Compiled as a self-contained IIFE — no build step required.
 * Embed: <script src="https://cdn.iratelier.com/omnicore-widget.js"
 *                 data-brand-id="YOUR_BRAND_UUID"
 *                 data-api-url="https://app.iratelier.com/api"
 *                 data-theme="#6366f1"></script>
 */
(function (global) {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // 0. Guard: prevent double-init
  // ─────────────────────────────────────────────────────────────────────────
  if (global.__omnicoreLoaded) return;
  global.__omnicoreLoaded = true;

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Configuration — read from <script> data attributes
  // ─────────────────────────────────────────────────────────────────────────
  var scriptTag  = document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName('script');
      return scripts[scripts.length - 1];
    })();

  var CONFIG = {
    brandId:      scriptTag.getAttribute('data-brand-id')  || '',
    apiUrl:       (scriptTag.getAttribute('data-api-url')  || '').replace(/\/$/, ''),
    theme:        scriptTag.getAttribute('data-theme')     || '#6366f1',
    position:     scriptTag.getAttribute('data-position')  || 'bottom-right',
    welcomeMsg:   scriptTag.getAttribute('data-welcome')   || 'Hi! How can we help you today?',
    maxFileSizeMB: parseInt(scriptTag.getAttribute('data-max-file-mb') || '10', 10),
  };

  if (!CONFIG.brandId || !CONFIG.apiUrl) {
    console.warn('[OmniCore] data-brand-id and data-api-url are required.');
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. State
  // ─────────────────────────────────────────────────────────────────────────
  var STATE = {
    sessionToken:    null,
    conversationId:  null,
    isOpen:          false,
    isConnected:     false,
    messages:        [],       // { id, senderType, body, attachments, createdAt }
    offlineQueue:    [],       // messages buffered while socket is disconnected
    socket:          null,
    isAgentTyping:   false,
    agentTypingName: '',
    uploads:         {},       // { [tempId]: { name, progress, url } }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Utilities
  // ─────────────────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function debounce(fn, ms) {
    var timer;
    return function () {
      var args = arguments;
      var ctx  = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function storeSession(token, convId) {
    try {
      sessionStorage.setItem('omnicore_token', token);
      sessionStorage.setItem('omnicore_conv',  convId);
    } catch (e) { /* sessionStorage blocked */ }
  }

  function loadSession() {
    try {
      return {
        token:  sessionStorage.getItem('omnicore_token'),
        convId: sessionStorage.getItem('omnicore_conv'),
      };
    } catch (e) { return { token: null, convId: null }; }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. REST helpers
  // ─────────────────────────────────────────────────────────────────────────
  function apiPost(path, body) {
    return fetch(CONFIG.apiUrl + path, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'X-Session-Token': STATE.sessionToken || '',
      },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) throw new Error('API ' + r.status);
      return r.json();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Session initialisation
  // ─────────────────────────────────────────────────────────────────────────
  function initSession() {
    var saved = loadSession();
    if (saved.token && saved.convId) {
      STATE.sessionToken   = saved.token;
      STATE.conversationId = saved.convId;
      return Promise.resolve();
    }
    return apiPost('/widget/session', { brandId: CONFIG.brandId })
      .then(function (data) {
        STATE.sessionToken   = data.sessionToken;
        STATE.conversationId = data.conversationId;
        storeSession(data.sessionToken, data.conversationId);
      });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Socket.io connection
  // ─────────────────────────────────────────────────────────────────────────
  function loadSocketIO(callback) {
    if (global.io) { callback(); return; }
    var s = document.createElement('script');
    s.src = CONFIG.apiUrl.replace('/api', '') + '/socket.io/socket.io.js';
    s.onload  = callback;
    s.onerror = function () {
      console.warn('[OmniCore] Could not load Socket.io client.');
    };
    document.head.appendChild(s);
  }

  function connectSocket() {
    var socketUrl = CONFIG.apiUrl.replace('/api', '');
    STATE.socket = global.io(socketUrl, {
      auth:           { sessionToken: STATE.sessionToken },
      transports:     ['websocket', 'polling'],
      reconnection:   true,
      reconnectionDelay:        1000,
      reconnectionDelayMax:     8000,
      reconnectionAttempts:     Infinity,
    });

    STATE.socket.on('connect', function () {
      STATE.isConnected = true;
      updateConnectionBadge(true);

      // Join the conversation room
      STATE.socket.emit('join:conversation', { conversationId: STATE.conversationId });

      // Drain offline queue
      if (STATE.offlineQueue.length) {
        STATE.socket.emit('client:drain_queue',
          { messages: STATE.offlineQueue.slice() },
          function (res) {
            if (res && res.ok) STATE.offlineQueue = [];
          }
        );
      }
    });

    STATE.socket.on('disconnect', function () {
      STATE.isConnected = false;
      updateConnectionBadge(false);
    });

    STATE.socket.on('server:new_message', function (msg) {
      pushMessage({
        id:          msg.id || uuid(),
        senderType:  msg.senderType || msg.sender_type,
        body:        msg.messageBody || msg.message_body,
        attachments: msg.attachments_json || [],
        createdAt:   msg.createdAt || msg.created_at || new Date().toISOString(),
      });
    });

    STATE.socket.on('agent:is_typing', function (data) {
      STATE.isAgentTyping   = true;
      STATE.agentTypingName = data.displayName || 'Agent';
      renderTypingIndicator(true);
    });

    STATE.socket.on('agent:typing_stopped', function () {
      STATE.isAgentTyping   = false;
      STATE.agentTypingName = '';
      renderTypingIndicator(false);
    });

    STATE.socket.on('server:handover_required', function () {
      appendSystemNotice('You\'ve been connected to a human agent.');
    });

    STATE.socket.on('conversation:closed', function (data) {
      if (data && data.trigger_csat) {
        showCsatSurvey();
      } else {
        appendSystemNotice('This conversation has been closed.');
        showStartNewChatButton();
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CSAT survey — injected inline when agent triggers CSAT on close
  // ─────────────────────────────────────────────────────────────────────────
  function showCsatSurvey() {
    ensureRefs();
    var saved = loadSession();

    var pending = null;
    try { pending = localStorage.getItem('omnicore_csat_pending'); } catch (e) {}
    if (pending === 'done') return;

    var el = document.createElement('div');
    el.id  = 'oc-csat';
    el.style.cssText = 'background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:12px 14px;margin:8px 0;font-size:13px';
    el.innerHTML =
      '<p style="margin:0 0 8px;font-weight:600;color:#166534">How was your experience?</p>' +
      '<div id="oc-csat-stars" style="display:flex;gap:6px;margin-bottom:8px">' +
        [1,2,3,4,5].map(function(n) {
          return '<button data-score="' + n + '" style="font-size:24px;background:none;border:none;cursor:pointer;opacity:.4;transition:opacity .15s" title="' + n + ' star' + (n > 1 ? 's' : '') + '">★</button>';
        }).join('') +
      '</div>' +
      '<p id="oc-csat-thanks" style="display:none;color:#166534;font-size:12px;margin:0">Thank you for your feedback!</p>';

    _msgsEl.appendChild(el);
    _msgsEl.scrollTop = _msgsEl.scrollHeight;

    var stars = el.querySelectorAll('#oc-csat-stars button');
    stars.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var score = parseInt(btn.getAttribute('data-score'), 10);
        stars.forEach(function (s, i) { s.style.opacity = i < score ? '1' : '.25'; });
        el.querySelector('#oc-csat-thanks').style.display = 'block';
        el.querySelector('#oc-csat-stars').style.pointerEvents = 'none';
        try { localStorage.setItem('omnicore_csat_pending', 'done'); } catch(e) {}

        if (STATE.socket && STATE.conversationId) {
          STATE.socket.emit('visitor:csat_submitted', {
            conversationId: STATE.conversationId,
            score:          score,
          });
        }
      });
    });
  }

  function showStartNewChatButton() {
    ensureRefs();
    var el = document.createElement('div');
    el.style.cssText = 'text-align:center;padding:10px 0';
    var btn = document.createElement('button');
    btn.textContent = '+ Start a new chat';
    btn.style.cssText =
      'background:var(--oc-primary);color:#fff;border:none;border-radius:8px;' +
      'padding:7px 16px;font-size:13px;cursor:pointer;font-family:inherit';
    btn.addEventListener('click', function () {
      startFreshChat();
      el.remove();
    });
    el.appendChild(btn);
    _msgsEl.appendChild(el);
    _msgsEl.scrollTop = _msgsEl.scrollHeight;
  }

  function startFreshChat() {
    try {
      sessionStorage.removeItem('omnicore_token');
      sessionStorage.removeItem('omnicore_conv');
      localStorage.removeItem('omnicore_csat_pending');
    } catch (e) {}
    STATE.sessionToken   = null;
    STATE.conversationId = null;
    STATE.messages       = [];
    STATE.offlineQueue   = [];
    if (STATE.socket) { STATE.socket.disconnect(); STATE.socket = null; }
    STATE.isConnected = false;

    ensureRefs();
    _msgsEl.innerHTML = '';

    apiPost('/widget/session', { brandId: CONFIG.brandId, force_new: true })
      .then(function (data) {
        STATE.sessionToken   = data.sessionToken;
        STATE.conversationId = data.conversationId;
        storeSession(data.sessionToken, data.conversationId);
        pushMessage({ id: uuid(), senderType: 'bot', body: CONFIG.welcomeMsg, createdAt: new Date().toISOString() });
        loadSocketIO(function () { if (global.io) connectSocket(); });
      })
      .catch(function (err) { console.error('[OmniCore] New chat failed', err); });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Telemetry — debounced emission
  //    Emits client:telemetry_update at most once per 1 500 ms per event type
  // ─────────────────────────────────────────────────────────────────────────
  var _telemetryEmitters = {};

  function emitTelemetry(event, meta) {
    if (!STATE.socket || !STATE.isConnected || !STATE.conversationId) return;
    if (!_telemetryEmitters[event]) {
      _telemetryEmitters[event] = debounce(function (m) {
        STATE.socket.emit('client:telemetry_update', {
          conversationId: STATE.conversationId,
          event:          event,
          meta:           m,
        });
      }, 1500);
    }
    _telemetryEmitters[event](meta || {});
  }

  // Debounced typing indicator
  var emitTyping = debounce(function (isTyping) {
    if (!STATE.socket || !STATE.conversationId) return;
    STATE.socket.emit('agent:is_typing', {
      conversationId: STATE.conversationId,
      isTyping:       isTyping,
    });
  }, 400);

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Sending messages
  // ─────────────────────────────────────────────────────────────────────────
  function sendMessage(body, attachments) {
    if (!body.trim() && (!attachments || !attachments.length)) return;

    var tempId  = uuid();
    var payload = {
      conversationId: STATE.conversationId,
      body:           body.trim(),
      attachments:    attachments || [],
    };

    // Optimistic local render
    pushMessage({
      id:          tempId,
      senderType:  'visitor',
      body:        body.trim(),
      attachments: attachments || [],
      createdAt:   new Date().toISOString(),
      pending:     true,
    });

    if (!STATE.isConnected || !STATE.socket) {
      // Queue for later drain
      STATE.offlineQueue.push(payload);
      markMessageDelivered(tempId, false);
      return;
    }

    STATE.socket.emit('client:send_message', payload, function (res) {
      if (res && res.ok) {
        markMessageDelivered(tempId, true);
      } else {
        STATE.offlineQueue.push(payload);
        markMessageDelivered(tempId, false);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 9. Cloudflare R2 file upload via pre-signed URL
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Request a pre-signed PUT URL from the backend, then upload directly to R2.
   * The backend endpoint (POST /api/widget/upload-url) returns:
   *   { uploadUrl, publicUrl, key }
   *
   * Max file size: CONFIG.maxFileSizeMB (default 10 MB per spec).
   *
   * @param {File} file
   * @param {function} onProgress  callback({ percent })
   * @returns {Promise<{ url: string, name: string, size: number, type: string }>}
   */
  function uploadFile(file, onProgress) {
    var maxBytes = CONFIG.maxFileSizeMB * 1024 * 1024;

    if (file.size > maxBytes) {
      return Promise.reject(
        new Error('File exceeds ' + CONFIG.maxFileSizeMB + ' MB limit.')
      );
    }

    // 1. Get pre-signed URL from backend
    return apiPost('/widget/upload-url', {
      brandId:     CONFIG.brandId,
      fileName:    file.name,
      fileType:    file.type,
      fileSizeBytes: file.size,
    }).then(function (data) {
      var uploadUrl = data.uploadUrl;
      var publicUrl = data.publicUrl;

      // 2. PUT directly to Cloudflare R2 via the pre-signed URL
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.type);

        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable && typeof onProgress === 'function') {
            onProgress({ percent: Math.round((e.loaded / e.total) * 100) });
          }
        };

        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({ url: publicUrl, name: file.name, size: file.size, type: file.type });
          } else {
            reject(new Error('R2 upload failed: HTTP ' + xhr.status));
          }
        };

        xhr.onerror  = function () { reject(new Error('R2 upload network error')); };
        xhr.onabort  = function () { reject(new Error('R2 upload aborted')); };

        xhr.send(file);
      });
    });
  }

  /**
   * Handle a FileList from the file input.
   * Uploads each file, renders a progress bar, then appends attachment URL to the outbox.
   *
   * @param {FileList} fileList
   * @param {function} onComplete  callback({ attachments: [{url,name,size,type}] })
   */
  function handleFileSelect(fileList, onComplete) {
    var files       = Array.prototype.slice.call(fileList);
    var attachments = [];
    var pending     = files.length;

    if (!pending) { onComplete({ attachments: [] }); return; }

    files.forEach(function (file) {
      var tempId = uuid();
      STATE.uploads[tempId] = { name: file.name, progress: 0, url: null };
      renderUploadProgress(tempId, file.name, 0);

      uploadFile(file, function (p) {
        STATE.uploads[tempId].progress = p.percent;
        renderUploadProgress(tempId, file.name, p.percent);
        emitTelemetry('file_upload_progress', { name: file.name, percent: p.percent });
      })
        .then(function (result) {
          STATE.uploads[tempId].url = result.url;
          attachments.push(result);
          renderUploadProgress(tempId, file.name, 100, true);
          pending--;
          if (pending === 0) onComplete({ attachments: attachments });
        })
        .catch(function (err) {
          renderUploadError(tempId, file.name, err.message);
          pending--;
          if (pending === 0) onComplete({ attachments: attachments });
        });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 10. DOM — Inject styles
  // ─────────────────────────────────────────────────────────────────────────
  function injectStyles() {
    var css = [
      ':root{--oc-primary:' + escHtml(CONFIG.theme) + '}',
      '#oc-launcher{position:fixed;z-index:2147483646;width:56px;height:56px;border-radius:50%;',
        'background:var(--oc-primary);border:none;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,.25);',
        'display:flex;align-items:center;justify-content:center;transition:transform .2s;}',
      '#oc-launcher:hover{transform:scale(1.08)}',
      '#oc-launcher svg{width:26px;height:26px;fill:#fff}',
      /* Position */
      CONFIG.position === 'bottom-left'
        ? '#oc-launcher{bottom:24px;left:24px}'
        : '#oc-launcher{bottom:24px;right:24px}',
      /* Badge */
      '#oc-badge{position:absolute;top:-2px;right:-2px;width:12px;height:12px;border-radius:50%;',
        'background:#22c55e;border:2px solid #fff;display:none}',
      '#oc-badge.connected{display:block}',
      /* Window */
      '#oc-window{position:fixed;z-index:2147483645;',
        CONFIG.position === 'bottom-left'
          ? 'bottom:92px;left:24px;'
          : 'bottom:92px;right:24px;',
        'width:360px;max-height:580px;border-radius:16px;overflow:hidden;',
        'box-shadow:0 8px 40px rgba(0,0,0,.18);display:none;flex-direction:column;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
        'font-size:14px;background:#fff;transition:opacity .2s,transform .2s;',
        'opacity:0;transform:translateY(12px) scale(.97)}',
      '#oc-window.open{display:flex;opacity:1;transform:translateY(0) scale(1)}',
      /* Header */
      '#oc-header{background:var(--oc-primary);padding:16px;color:#fff;',
        'display:flex;align-items:center;justify-content:space-between}',
      '#oc-header h2{margin:0;font-size:15px;font-weight:600}',
      '#oc-close{background:none;border:none;color:#fff;cursor:pointer;font-size:20px;',
        'line-height:1;padding:0;opacity:.8}',
      /* Messages */
      '#oc-messages{flex:1;overflow-y:auto;padding:12px;display:flex;',
        'flex-direction:column;gap:8px;background:#f8f9fb}',
      '.oc-msg{max-width:80%;padding:9px 13px;border-radius:14px;',
        'line-height:1.45;word-break:break-word;font-size:13.5px}',
      '.oc-msg.visitor{align-self:flex-end;background:var(--oc-primary);color:#fff;',
        'border-bottom-right-radius:4px}',
      '.oc-msg.bot,.oc-msg.agent{align-self:flex-start;background:#fff;color:#1e1e2e;',
        'border-bottom-left-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.08)}',
      '.oc-msg.system{align-self:center;background:#ede9fe;color:#4c1d95;font-size:12px;',
        'border-radius:20px;padding:5px 12px}',
      '.oc-msg.pending{opacity:.55}',
      /* Typing indicator */
      '#oc-typing{padding:4px 12px;font-size:12px;color:#888;min-height:20px}',
      /* Upload progress */
      '.oc-upload{padding:4px 12px;font-size:12px;color:#555}',
      '.oc-upload-bar{height:3px;background:#e5e7eb;border-radius:2px;margin-top:2px}',
      '.oc-upload-fill{height:3px;background:var(--oc-primary);border-radius:2px;',
        'transition:width .2s}',
      '.oc-upload-error{color:#ef4444}',
      /* Footer */
      '#oc-footer{padding:10px 12px;background:#fff;border-top:1px solid #f1f1f1;',
        'display:flex;align-items:flex-end;gap:8px}',
      '#oc-input{flex:1;resize:none;border:1px solid #e5e7eb;border-radius:10px;',
        'padding:8px 11px;font-size:13.5px;line-height:1.4;max-height:100px;',
        'outline:none;font-family:inherit}',
      '#oc-input:focus{border-color:var(--oc-primary)}',
      '#oc-send,#oc-attach{background:none;border:none;cursor:pointer;',
        'padding:6px;color:var(--oc-primary);border-radius:8px}',
      '#oc-send:hover,#oc-attach:hover{background:#f3f0ff}',
      '#oc-send svg,#oc-attach svg{width:20px;height:20px;fill:currentColor}',
      '#oc-file-input{display:none}',
    ].join('');

    var style = document.createElement('style');
    style.id  = 'oc-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 11. DOM — Build widget HTML
  // ─────────────────────────────────────────────────────────────────────────
  function buildWidget() {
    // Launcher button
    var launcher      = document.createElement('button');
    launcher.id       = 'oc-launcher';
    launcher.title    = 'Open chat';
    launcher.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 ' +
      '2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>' +
      '<span id="oc-badge"></span>';

    // Chat window
    var win      = document.createElement('div');
    win.id       = 'oc-window';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', 'Live chat');
    win.innerHTML =
      '<div id="oc-header">' +
        '<h2>Support Chat</h2>' +
        '<button id="oc-close" aria-label="Close chat">&times;</button>' +
      '</div>' +
      '<div id="oc-messages" aria-live="polite"></div>' +
      '<div id="oc-typing"></div>' +
      '<div id="oc-uploads"></div>' +
      '<div id="oc-footer">' +
        '<label id="oc-attach" title="Attach file">' +
          '<svg viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5' +
          ' 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H10v9.5a2.5 2.5 0 0 0' +
          ' 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>' +
          '<input type="file" id="oc-file-input" multiple accept="image/*,.pdf,.txt,.doc,.docx">' +
        '</label>' +
        '<textarea id="oc-input" rows="1" placeholder="Type a message…" aria-label="Message input"></textarea>' +
        '<button id="oc-send" aria-label="Send message">' +
          '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
        '</button>' +
      '</div>';

    document.body.appendChild(launcher);
    document.body.appendChild(win);
    return { launcher: launcher, win: win };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 12. DOM — Render helpers
  // ─────────────────────────────────────────────────────────────────────────
  var _msgsEl, _typingEl, _inputEl, _uploadsEl;

  function ensureRefs() {
    _msgsEl    = _msgsEl    || document.getElementById('oc-messages');
    _typingEl  = _typingEl  || document.getElementById('oc-typing');
    _inputEl   = _inputEl   || document.getElementById('oc-input');
    _uploadsEl = _uploadsEl || document.getElementById('oc-uploads');
  }

  function pushMessage(msg) {
    STATE.messages.push(msg);
    ensureRefs();
    var el = document.createElement('div');
    el.id  = 'oc-msg-' + msg.id;
    el.className = 'oc-msg ' + (msg.senderType || 'bot') + (msg.pending ? ' pending' : '');

    var content = escHtml(msg.body || '');

    if (msg.attachments && msg.attachments.length) {
      msg.attachments.forEach(function (a) {
        if (a.url) {
          var isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(a.url);
          content += isImage
            ? '<br><img src="' + escHtml(a.url) + '" style="max-width:100%;border-radius:8px;margin-top:6px" alt="' + escHtml(a.name || 'attachment') + '">'
            : '<br><a href="' + escHtml(a.url) + '" target="_blank" style="color:inherit;opacity:.85">' + escHtml(a.name || 'attachment') + '</a>';
        }
      });
    }

    el.innerHTML = content;
    _msgsEl.appendChild(el);
    _msgsEl.scrollTop = _msgsEl.scrollHeight;
  }

  function markMessageDelivered(tempId, ok) {
    var el = document.getElementById('oc-msg-' + tempId);
    if (!el) return;
    el.classList.remove('pending');
    if (!ok) el.style.opacity = '0.45';
  }

  function appendSystemNotice(text) {
    pushMessage({ id: uuid(), senderType: 'system', body: text, createdAt: new Date().toISOString() });
  }

  function renderTypingIndicator(show) {
    ensureRefs();
    _typingEl.textContent = show
      ? (STATE.agentTypingName || 'Agent') + ' is typing…'
      : '';
  }

  function updateConnectionBadge(online) {
    var badge = document.getElementById('oc-badge');
    if (badge) badge.className = online ? 'connected' : '';
  }

  function renderUploadProgress(tempId, name, percent, done) {
    ensureRefs();
    var elId = 'oc-up-' + tempId;
    var el   = document.getElementById(elId);
    if (!el) {
      el    = document.createElement('div');
      el.id = elId;
      el.className = 'oc-upload';
      _uploadsEl.appendChild(el);
    }
    if (done) {
      el.innerHTML = '✓ ' + escHtml(name);
      return;
    }
    el.innerHTML =
      escHtml(name) +
      '<div class="oc-upload-bar"><div class="oc-upload-fill" style="width:' + percent + '%"></div></div>';
  }

  function renderUploadError(tempId, name, errMsg) {
    ensureRefs();
    var el = document.getElementById('oc-up-' + tempId);
    if (!el) {
      el = document.createElement('div');
      el.id = 'oc-up-' + tempId;
      el.className = 'oc-upload';
      if (_uploadsEl) _uploadsEl.appendChild(el);
    }
    el.innerHTML = '<span class="oc-upload-error">✗ ' + escHtml(name) + ' — ' + escHtml(errMsg) + '</span>';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 13. Event wiring
  // ─────────────────────────────────────────────────────────────────────────
  function wireEvents(elements) {
    var launcher  = elements.launcher;
    var win       = elements.win;
    var closeBtn  = document.getElementById('oc-close');
    var sendBtn   = document.getElementById('oc-send');
    var fileInput = document.getElementById('oc-file-input');
    ensureRefs();

    // Toggle open/close
    launcher.addEventListener('click', function () {
      STATE.isOpen = !STATE.isOpen;
      win.classList.toggle('open', STATE.isOpen);
      launcher.setAttribute('aria-expanded', String(STATE.isOpen));
      if (STATE.isOpen) {
        emitTelemetry('widget_open', { url: location.href });
        _inputEl.focus();
      }
    });

    closeBtn.addEventListener('click', function () {
      STATE.isOpen = false;
      win.classList.remove('open');
      launcher.setAttribute('aria-expanded', 'false');
    });

    // Send on button click or Enter (Shift+Enter = new line)
    sendBtn.addEventListener('click', dispatchSend);
    _inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        dispatchSend();
      }
    });

    // Typing telemetry
    _inputEl.addEventListener('input', function () {
      autoResize(_inputEl);
      emitTyping(true);
      emitTelemetry('visitor_typing', {});
      // Stop typing after 3 s of inactivity
      debounce(function () { emitTyping(false); }, 3000)();
    });

    // Page visibility — send telemetry on page_view
    emitTelemetry('page_view', { url: location.href, title: document.title });
    document.addEventListener('visibilitychange', function () {
      emitTelemetry('visibility_change', { hidden: document.hidden });
    });

    // File selection
    fileInput.addEventListener('change', function () {
      if (!fileInput.files || !fileInput.files.length) return;
      handleFileSelect(fileInput.files, function (result) {
        fileInput.value = '';    // reset input
        if (result.attachments.length) {
          sendMessage('', result.attachments);
        }
      });
    });
  }

  function dispatchSend() {
    ensureRefs();
    var text = _inputEl.value.trim();
    if (!text) return;
    sendMessage(text, []);
    _inputEl.value = '';
    autoResize(_inputEl);
    emitTyping(false);
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SPA URL tracking — patches history.pushState / replaceState and
  // popstate / hashchange so SPAs that never trigger full page loads
  // still emit visitor:page_change telemetry to the agent dashboard.
  // ─────────────────────────────────────────────────────────────────────────
  var _lastTrackedUrl = location.href;

  function trackPageChange() {
    var currentUrl = location.href;
    if (currentUrl === _lastTrackedUrl) return;
    _lastTrackedUrl = currentUrl;
    emitTelemetry('page_view', { url: currentUrl, title: document.title });
    if (STATE.socket && STATE.isConnected && STATE.conversationId) {
      STATE.socket.emit('visitor:page_change', {
        conversationId: STATE.conversationId,
        url:  currentUrl,
        path: location.pathname + location.search,
      });
    }
  }

  (function patchHistory() {
    var _push    = history.pushState;
    var _replace = history.replaceState;
    history.pushState = function () {
      _push.apply(history, arguments);
      debounce(trackPageChange, 100)();
    };
    history.replaceState = function () {
      _replace.apply(history, arguments);
      debounce(trackPageChange, 100)();
    };
    global.addEventListener('popstate',    function () { debounce(trackPageChange, 100)(); });
    global.addEventListener('hashchange',  function () { debounce(trackPageChange, 100)(); });
  })();

  // ─────────────────────────────────────────────────────────────────────────
  // 14. Boot sequence
  // ─────────────────────────────────────────────────────────────────────────
  function boot() {
    injectStyles();
    var elements = buildWidget();
    wireEvents(elements);

    initSession()
      .then(function () {
        // Show welcome message
        pushMessage({
          id:         uuid(),
          senderType: 'bot',
          body:       CONFIG.welcomeMsg,
          createdAt:  new Date().toISOString(),
        });

        // Load and connect Socket.io
        loadSocketIO(function () {
          if (!global.io) return;
          connectSocket();
        });
      })
      .catch(function (err) {
        console.error('[OmniCore] Session init failed', err);
        pushMessage({
          id:         uuid(),
          senderType: 'system',
          body:       'Unable to connect to support. Please refresh and try again.',
          createdAt:  new Date().toISOString(),
        });
      });
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(typeof globalThis !== 'undefined' ? globalThis : window);
