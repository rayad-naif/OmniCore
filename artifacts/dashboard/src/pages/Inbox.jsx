import { useState, useEffect, useRef, useCallback, useReducer } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';

/**
 * Inbox.jsx
 * Atelier OmniCore — 3-column agent inbox
 *
 * Column 1 — Ticket list       (conversations sorted by SLA / recency)
 * Column 2 — Chat panel        (real-time messages via Socket.io)
 * Column 3 — Telemetry sidebar (visitor info, live events, AI copilot)
 *
 * Socket events consumed:
 *   server:new_message          — push message to active thread
 *   server:handover_required    — badge on ticket
 *   agent:is_typing             — show visitor typing indicator
 *   agent:typing_stopped
 *   server:telemetry            — live visitor events
 *   server:conversation_assigned
 *
 * Socket events emitted:
 *   join:conversation
 *   client:send_message
 *   agent:is_typing
 *   client:telemetry_update
 */

const API_URL    = import.meta.env.VITE_API_URL || '/api';
const SOCKET_URL = (import.meta.env.VITE_API_URL || '/api').replace('/api', '');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

function slaColor(breachAt) {
  if (!breachAt) return 'text-slate-400';
  const diff = new Date(breachAt) - new Date();
  if (diff < 0)         return 'text-red-600 font-semibold';
  if (diff < 3_600_000) return 'text-amber-500 font-semibold';
  return 'text-slate-400';
}

function statusBadge(status) {
  const map = {
    ai_handling: 'bg-violet-100 text-violet-700',
    open:        'bg-amber-100 text-amber-700',
    closed:      'bg-slate-100 text-slate-500',
    pending:     'bg-blue-100 text-blue-700',
  };
  return `inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${map[status] || map.open}`;
}

function priorityDot(priority) {
  const map = { urgent: 'bg-red-500', high: 'bg-orange-400', normal: 'bg-slate-300', low: 'bg-slate-200' };
  return `w-2 h-2 rounded-full shrink-0 ${map[priority] || map.normal}`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ─── Ticket list reducer ───────────────────────────────────────────────────────
function ticketsReducer(state, action) {
  switch (action.type) {
    case 'SET':    return action.payload;
    case 'PATCH': {
      return state.map(t => t.id === action.id ? { ...t, ...action.patch } : t);
    }
    case 'PREPEND': return [action.payload, ...state.filter(t => t.id !== action.payload.id)];
    default: return state;
  }
}

// ─── Messages reducer ─────────────────────────────────────────────────────────
function messagesReducer(state, action) {
  switch (action.type) {
    case 'SET':    return action.payload;
    case 'PUSH':   return [...state, action.payload];
    case 'CLEAR':  return [];
    default: return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name = '', size = 'md' }) {
  const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?';
  const sz = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-9 h-9 text-sm';
  return (
    <div className={`${sz} rounded-full bg-violet-600 text-white font-semibold
                    flex items-center justify-center select-none shrink-0`}>
      {initials}
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner({ size = 'md' }) {
  const sz = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6';
  return (
    <svg className={`animate-spin ${sz} text-violet-600`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
  );
}

// ── Column 1: Ticket list ─────────────────────────────────────────────────────
function TicketList({ tickets, activeId, onSelect, loading }) {
  const [filter, setFilter] = useState('open');

  const visible = tickets.filter(t => {
    if (filter === 'all')  return true;
    if (filter === 'mine') return t.assigned_to_me;
    return t.status !== 'closed';
  });

  return (
    <div className="flex flex-col h-full border-r border-slate-200 bg-white">
      {/* Header */}
      <div className="px-4 py-4 border-b border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-900">Inbox</h2>
          <span className="text-xs font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
            {tickets.filter(t => t.status !== 'closed').length}
          </span>
        </div>
        {/* Filter pills */}
        <div className="flex gap-1">
          {['open', 'mine', 'all'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors
                ${filter === f ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center pt-10"><Spinner /></div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-16 text-slate-400">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 opacity-30">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
            <p className="text-sm">No conversations</p>
          </div>
        ) : (
          visible.map(ticket => (
            <button key={ticket.id} onClick={() => onSelect(ticket)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50
                transition-colors relative
                ${activeId === ticket.id ? 'bg-violet-50 border-l-2 border-l-violet-600' : ''}`}>
              {/* Unread dot */}
              {ticket.unread && (
                <span className="absolute top-3.5 right-3 w-2 h-2 rounded-full bg-violet-600" />
              )}
              <div className="flex items-start gap-2.5">
                <span className={priorityDot(ticket.priority)} style={{ marginTop: 6 }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {ticket.visitor_email || ticket.visitor_name || 'Anonymous'}
                    </p>
                    <span className="text-[10px] text-slate-400 shrink-0">{fmtTime(ticket.updated_at)}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate mb-1.5">
                    {ticket.subject || ticket.last_message || 'No messages yet'}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className={statusBadge(ticket.status)}>{ticket.status?.replace('_', ' ')}</span>
                    {ticket.sla_breach_at && (
                      <span className={`text-[10px] ${slaColor(ticket.sla_breach_at)}`}>
                        SLA {new Date(ticket.sla_breach_at) < new Date() ? 'breached' : fmtTime(ticket.sla_breach_at)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }) {
  const isVisitor  = msg.sender_type === 'visitor';
  const isInternal = msg.is_internal_note;
  const isSystem   = msg.sender_type === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-500 text-xs">{msg.message_body}</span>
      </div>
    );
  }

  if (isInternal) {
    return (
      <div className="flex justify-end my-1">
        <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-sm
                       bg-amber-50 border border-amber-200 text-amber-900 text-sm">
          <div className="flex items-center gap-1 mb-1 text-[10px] text-amber-600 font-semibold">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
            Internal Note
          </div>
          <p className="whitespace-pre-wrap">{msg.message_body}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-end gap-2 my-1 ${isVisitor ? 'flex-row' : 'flex-row-reverse'}`}>
      {isVisitor && <Avatar name={msg.sender_name || 'V'} size="sm" />}
      <div className={`max-w-[72%] px-4 py-2.5 text-sm leading-relaxed
        ${isVisitor
          ? 'bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-bl-sm shadow-sm'
          : 'bg-violet-600 text-white rounded-2xl rounded-br-sm'
        }`}>
        <p className="whitespace-pre-wrap">{msg.message_body}</p>
        {Array.isArray(msg.attachments_json) && msg.attachments_json.map((a, i) =>
          a.url ? (
            /\.(png|jpe?g|gif|webp|svg)$/i.test(a.url) ? (
              <img key={i} src={a.url} alt={a.name || 'attachment'}
                className="mt-2 max-w-[220px] rounded-xl border border-white/20 object-cover" />
            ) : (
              <a key={i} href={a.url} target="_blank" rel="noreferrer"
                className="mt-1.5 flex items-center gap-1 text-xs underline opacity-80 hover:opacity-100">
                📎 {a.name || 'attachment'}
              </a>
            )
          ) : null
        )}
        <p className={`text-[10px] mt-1 ${isVisitor ? 'text-slate-400' : 'text-white/60'}`}>
          {fmtTime(msg.created_at)}
        </p>
      </div>
    </div>
  );
}

// ── Column 2: Chat panel ──────────────────────────────────────────────────────
function ChatPanel({
  conversation, messages, msgLoading,
  visitorTyping, socket, onMessageSent,
  onAiRephrase, aiRephrasing,
}) {
  const [draft, setDraft]         = useState('');
  const [isInternal, setInternal] = useState(false);
  const [sending, setSending]     = useState(false);
  const messagesEndRef            = useRef(null);
  const textareaRef               = useRef(null);

  // Debounced typing event
  const emitTyping = useRef(
    debounce((socket, convId, v) => {
      socket?.emit('agent:is_typing', { conversationId: convId, isTyping: v });
    }, 400)
  ).current;

  const stopTyping = useRef(
    debounce((socket, convId) => {
      socket?.emit('agent:is_typing', { conversationId: convId, isTyping: false });
    }, 2500)
  ).current;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, visitorTyping]);

  // Reset draft when switching conversations
  useEffect(() => { setDraft(''); setInternal(false); }, [conversation?.id]);

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  function handleInput(e) {
    setDraft(e.target.value);
    autoResize(e.target);
    if (conversation?.id) {
      emitTyping(socket, conversation.id, true);
      stopTyping(socket, conversation.id);
    }
  }

  async function send() {
    if (!draft.trim() || !conversation || sending) return;
    setSending(true);
    const payload = {
      conversationId: conversation.id,
      body:           draft.trim(),
      isInternalNote: isInternal,
      attachments:    [],
    };
    socket?.emit('client:send_message', payload, () => {});
    onMessageSent(payload);
    setDraft('');
    setInternal(false);
    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }
    setSending(false);
    socket?.emit('agent:is_typing', { conversationId: conversation.id, isTyping: false });
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  async function handleAiRephrase() {
    if (!draft.trim()) return;
    const rephrased = await onAiRephrase(draft);
    if (rephrased) {
      setDraft(rephrased);
      if (textareaRef.current) autoResize(textareaRef.current);
    }
  }

  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 gap-3 text-slate-400">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-14 h-14 opacity-20">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
        </svg>
        <p className="text-sm font-medium">Select a conversation to start</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Chat header */}
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-3">
          <Avatar name={conversation.visitor_email || 'V'} />
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {conversation.visitor_email || conversation.visitor_name || 'Anonymous Visitor'}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={statusBadge(conversation.status)}>
                {conversation.status?.replace('_', ' ')}
              </span>
              {conversation.channel && (
                <span className="text-[10px] text-slate-400 capitalize">via {conversation.channel}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Close conversation */}
          <button className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600
                             bg-slate-100 hover:bg-slate-200 transition-colors">
            Close
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {msgLoading ? (
          <div className="flex justify-center pt-10"><Spinner /></div>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-slate-400 mt-10">No messages yet.</p>
        ) : (
          messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)
        )}

        {/* Visitor typing indicator */}
        {visitorTyping && (
          <div className="flex items-end gap-2 mt-1">
            <Avatar name="V" size="sm" />
            <div className="flex gap-1 px-4 py-3 bg-white border border-slate-200 rounded-2xl rounded-bl-sm shadow-sm">
              {[0, 150, 300].map(delay => (
                <span key={delay}
                  className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
                  style={{ animationDelay: `${delay}ms` }} />
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 bg-white border-t border-slate-200">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          {/* Internal note toggle */}
          <button
            onClick={() => setInternal(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
              ${isInternal
                ? 'bg-amber-100 text-amber-700 border border-amber-300'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
            {isInternal ? 'Internal Note' : 'Note'}
          </button>

          {/* AI Rephrase */}
          <button
            onClick={handleAiRephrase}
            disabled={!draft.trim() || aiRephrasing}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all
              ${draft.trim() && !aiRephrasing
                ? 'bg-violet-100 text-violet-700 hover:bg-violet-200'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
            {aiRephrasing
              ? <Spinner size="sm" />
              : (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                </svg>
              )}
            AI Rephrase
          </button>

          <div className="flex-1" />

          {/* Macro shortcut hint */}
          <span className="text-[10px] text-slate-400">/ for macros  ·  Shift+Enter new line</span>
        </div>

        {/* Textarea */}
        <div className={`mx-4 mb-3 rounded-xl border transition-all
          ${isInternal
            ? 'border-amber-300 bg-amber-50 focus-within:ring-2 focus-within:ring-amber-300'
            : 'border-slate-300 bg-white focus-within:ring-2 focus-within:ring-violet-500 focus-within:border-violet-500'}`}>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={isInternal ? 'Write a private internal note…' : 'Type a reply…'}
            rows={2}
            className="w-full px-4 pt-3 pb-2 text-sm bg-transparent outline-none resize-none
                       placeholder:text-slate-400 text-slate-800"
            style={{ minHeight: 56 }}
          />
          <div className="flex justify-end px-3 pb-2.5">
            <button
              onClick={send}
              disabled={!draft.trim() || sending}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold
                transition-all
                ${draft.trim() && !sending
                  ? 'bg-violet-600 text-white hover:bg-violet-700 active:scale-[.97]'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
              {sending ? <Spinner size="sm" /> : (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              )}
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Column 3: Telemetry sidebar ───────────────────────────────────────────────
function TelemetrySidebar({ conversation, telemetryEvents }) {
  if (!conversation) {
    return (
      <div className="h-full bg-white border-l border-slate-200 flex items-center justify-center">
        <p className="text-sm text-slate-400">No conversation selected</p>
      </div>
    );
  }

  const visitor = conversation;

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200 overflow-y-auto">
      {/* Visitor card */}
      <div className="px-5 py-5 border-b border-slate-100">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Visitor</p>
        <div className="flex items-center gap-3 mb-4">
          <Avatar name={visitor.visitor_email || 'Visitor'} />
          <div>
            <p className="text-sm font-semibold text-slate-900 truncate max-w-[160px]">
              {visitor.visitor_email || 'Anonymous'}
            </p>
            {visitor.visitor_name && (
              <p className="text-xs text-slate-500">{visitor.visitor_name}</p>
            )}
          </div>
        </div>
        <dl className="space-y-2">
          {[
            { label: 'Channel',  value: visitor.channel,         icon: '📡' },
            { label: 'Location', value: visitor.location_city,   icon: '📍' },
            { label: 'IP',       value: visitor.ip_address,      icon: '🌐' },
            { label: 'Brand',    value: visitor.brand_name,      icon: '🏷' },
            { label: 'Priority', value: visitor.priority,        icon: '🔥' },
          ].filter(r => r.value).map(row => (
            <div key={row.label} className="flex items-start justify-between gap-2">
              <dt className="text-xs text-slate-400 flex items-center gap-1">
                <span>{row.icon}</span>{row.label}
              </dt>
              <dd className="text-xs font-medium text-slate-700 text-right capitalize truncate max-w-[120px]">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* SLA */}
      {visitor.sla_breach_at && (
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">SLA Timer</p>
          <div className={`flex items-center gap-2 text-sm font-semibold ${slaColor(visitor.sla_breach_at)}`}>
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
            </svg>
            {new Date(visitor.sla_breach_at) < new Date()
              ? 'SLA Breached'
              : `Due ${fmtTime(visitor.sla_breach_at)}`
            }
          </div>
        </div>
      )}

      {/* Live telemetry events */}
      <div className="px-5 py-4 flex-1">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Live Activity</p>
          <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>

        {telemetryEvents.length === 0 ? (
          <p className="text-xs text-slate-400">Waiting for visitor activity…</p>
        ) : (
          <div className="space-y-2">
            {telemetryEvents.slice(-12).reverse().map((ev, i) => (
              <div key={i} className="flex items-start gap-2 py-1.5 border-b border-slate-100 last:border-0">
                <span className="text-base leading-none mt-0.5">
                  {{ page_view: '🔍', widget_open: '💬', visitor_typing: '⌨️',
                     file_upload_progress: '📎', read_receipt: '✓',
                     visibility_change: '👁' }[ev.event] || '📌'}
                </span>
                <div>
                  <p className="text-xs font-medium text-slate-700 capitalize">
                    {ev.event?.replace(/_/g, ' ')}
                  </p>
                  {ev.meta?.url && (
                    <p className="text-[10px] text-slate-400 truncate max-w-[160px]">{ev.meta.url}</p>
                  )}
                  <p className="text-[10px] text-slate-400">{fmtTime(ev.ts)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Summary section */}
      <div className="px-5 py-4 border-t border-slate-100 bg-violet-50/60">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">AI Summary</p>
        {visitor.ai_summary ? (
          <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{visitor.ai_summary}</p>
        ) : (
          <p className="text-xs text-slate-400 italic">No summary yet. Available once the AI hands over.</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: Inbox
// ─────────────────────────────────────────────────────────────────────────────
export default function Inbox() {
  const { agent, accessToken, authFetch } = useAuth();

  const [tickets,  dispatchTickets]  = useReducer(ticketsReducer,  []);
  const [messages, dispatchMessages] = useReducer(messagesReducer, []);
  const [activeConv,  setActiveConv] = useState(null);
  const [ticketLoading, setTL]       = useState(true);
  const [msgLoading,    setML]       = useState(false);
  const [visitorTyping, setVT]       = useState(false);
  const [aiRephrasing,  setAIR]      = useState(false);
  const [telemetryEvents, setTelEv]  = useState([]);

  const socketRef       = useRef(null);
  const activeConvIdRef = useRef(null);   // stable ref for socket callbacks

  // ── Socket.io setup ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!accessToken) return;

    const socket = io(SOCKET_URL, {
      auth:        { agentToken: accessToken },
      transports:  ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      // Rejoin active conversation room after reconnect
      if (activeConvIdRef.current) {
        socket.emit('join:conversation', { conversationId: activeConvIdRef.current });
      }
    });

    // New message arrives
    socket.on('server:new_message', (msg) => {
      // Only push if it belongs to the currently open conversation
      if (msg.conversation_id === activeConvIdRef.current || msg.conversationId === activeConvIdRef.current) {
        dispatchMessages({ type: 'PUSH', payload: normaliseMsg(msg) });
      }
      // Update ticket list preview
      dispatchTickets({
        type: 'PATCH',
        id:   msg.conversation_id || msg.conversationId,
        patch: { last_message: msg.message_body || msg.messageBody, unread: true, updated_at: msg.created_at },
      });
    });

    // Visitor typing
    socket.on('agent:is_typing', () => {
      setVT(true);
      clearTimeout(socket._vtTimer);
      socket._vtTimer = setTimeout(() => setVT(false), 4000);
    });
    socket.on('agent:typing_stopped', () => setVT(false));

    // Telemetry events
    socket.on('server:telemetry', (ev) => {
      setTelEv(prev => [...prev.slice(-49), ev]);
    });

    // Handover: mark ticket open
    socket.on('server:handover_required', ({ conversationId }) => {
      dispatchTickets({ type: 'PATCH', id: conversationId, patch: { status: 'open' } });
    });

    // New assignment available (for supervisor room events)
    socket.on('server:new_assignment_available', ({ conversationId }) => {
      dispatchTickets({ type: 'PATCH', id: conversationId, patch: { status: 'open', unread: true } });
    });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [accessToken]);

  // ── Fetch ticket list ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!agent?.tenantId) return;
    setTL(true);
    authFetch(`${API_URL}/conversations?limit=50`)
      .then(r => r.json())
      .then(data => dispatchTickets({ type: 'SET', payload: Array.isArray(data) ? data : data.rows || [] }))
      .catch(console.error)
      .finally(() => setTL(false));
  }, [agent?.tenantId, authFetch]);

  // ── Select conversation ──────────────────────────────────────────────────────
  const selectConversation = useCallback(async (ticket) => {
    setActiveConv(ticket);
    activeConvIdRef.current = ticket.id;
    setTelEv([]);
    setVT(false);
    dispatchMessages({ type: 'CLEAR' });

    // Join socket room
    socketRef.current?.emit('join:conversation', { conversationId: ticket.id });

    // Fetch message history
    setML(true);
    try {
      const res  = await authFetch(`${API_URL}/conversations/${ticket.id}/messages`);
      const data = await res.json();
      dispatchMessages({
        type: 'SET',
        payload: (Array.isArray(data) ? data : data.rows || []).map(normaliseMsg),
      });
    } catch (err) {
      console.error('[Inbox] load messages', err);
    } finally {
      setML(false);
    }

    // Mark as read
    dispatchTickets({ type: 'PATCH', id: ticket.id, patch: { unread: false } });

    // Emit widget_open telemetry
    socketRef.current?.emit('client:telemetry_update', {
      conversationId: ticket.id,
      event: 'agent_opened_conversation',
      meta:  { agentId: agent?.id },
    });
  }, [authFetch, agent?.id]);

  // ── Optimistic message add ───────────────────────────────────────────────────
  const handleMessageSent = useCallback((payload) => {
    dispatchMessages({
      type: 'PUSH',
      payload: normaliseMsg({
        id:              `tmp-${Date.now()}`,
        conversation_id: payload.conversationId,
        sender_type:     'agent',
        message_body:    payload.body,
        is_internal_note: payload.isInternalNote || false,
        attachments_json: payload.attachments || [],
        created_at:      new Date().toISOString(),
      }),
    });
  }, []);

  // ── AI Rephrase ──────────────────────────────────────────────────────────────
  const handleAiRephrase = useCallback(async (draft) => {
    setAIR(true);
    try {
      const res  = await authFetch(`${API_URL}/ai/rephrase`, {
        method: 'POST',
        body:   JSON.stringify({ draft, tone: 'professional and empathetic' }),
      });
      const data = await res.json();
      return data.rephrased || null;
    } catch (err) {
      console.error('[Inbox] AI rephrase failed', err);
      return null;
    } finally {
      setAIR(false);
    }
  }, [authFetch]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Col 1: Ticket list — fixed 300 px */}
      <div className="w-[300px] shrink-0 h-full">
        <TicketList
          tickets={tickets}
          activeId={activeConv?.id}
          onSelect={selectConversation}
          loading={ticketLoading}
        />
      </div>

      {/* Col 2: Chat — fluid */}
      <div className="flex-1 min-w-0 h-full">
        <ChatPanel
          conversation={activeConv}
          messages={messages}
          msgLoading={msgLoading}
          visitorTyping={visitorTyping}
          socket={socketRef.current}
          onMessageSent={handleMessageSent}
          onAiRephrase={handleAiRephrase}
          aiRephrasing={aiRephrasing}
        />
      </div>

      {/* Col 3: Telemetry sidebar — fixed 260 px, hidden on < xl */}
      <div className="hidden xl:block w-[260px] shrink-0 h-full">
        <TelemetrySidebar
          conversation={activeConv}
          telemetryEvents={telemetryEvents}
        />
      </div>
    </div>
  );
}

// ─── Msg normaliser — handles both snake_case (REST) and camelCase (socket) ───
function normaliseMsg(m) {
  return {
    id:               m.id,
    conversation_id:  m.conversation_id  || m.conversationId,
    sender_type:      m.sender_type      || m.senderType,
    sender_id:        m.sender_id        || m.senderId,
    message_body:     m.message_body     || m.messageBody || m.body || '',
    is_internal_note: m.is_internal_note || m.isInternalNote || false,
    attachments_json: m.attachments_json || m.attachments  || [],
    created_at:       m.created_at       || m.createdAt    || new Date().toISOString(),
  };
}
