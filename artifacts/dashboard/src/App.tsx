import { useState, useEffect, useRef, useCallback } from 'react'
import {
  MessageSquare, Building2, CreditCard, Settings,
  Search, Send, FileDown, Menu, X, Bot, User,
  Inbox, Sparkles, LogOut, Bell, RefreshCw,
  AlertTriangle, CheckCircle2, Clock, Circle,
  ChevronRight, Hash, Mail, Globe, Zap, MoreHorizontal,
  Eye, EyeOff, Wifi, WifiOff,
} from 'lucide-react'
// @ts-ignore — JSX context file, types come from React
import { useAuth } from './context/AuthContext'
import { io, type Socket } from 'socket.io-client'

// ─── Types ────────────────────────────────────────────────────────────────────
type Status = 'open' | 'closed' | 'pending' | 'ai_handling'
type Channel = 'email' | 'widget' | 'api'
type Priority = 'low' | 'normal' | 'high' | 'urgent'
type Sender = 'agent' | 'visitor' | 'bot' | 'system'
type Section = 'conversations' | 'brands' | 'billing' | 'settings'
type StatusFilter = 'all' | Status

interface Conversation {
  id: string
  subject: string | null
  status: Status
  channel: Channel
  priority: Priority
  visitor_name: string
  visitor_email: string | null
  agent_name?: string | null
  brand_name: string
  updated_at: string
  sla_breach_at?: string | null
  unread?: number
}

interface Message {
  id: string
  conversation_id: string
  sender_type: Sender
  sender_name: string
  message_body: string
  is_internal_note: boolean
  created_at: string
}

// ─── API Layer ────────────────────────────────────────────────────────────────
const API = '/api'

function useApi() {
  const { authFetch } = useAuth() as { authFetch: (url: string, opts?: RequestInit) => Promise<Response> }
  return useCallback(() => ({
    listConversations: async (): Promise<Conversation[]> => {
      const r = await authFetch(`${API}/conversations`)
      if (!r.ok) throw new Error(`${r.status}`)
      const d = await r.json() as { conversations: Conversation[] }
      return d.conversations
    },
    getMessages: async (id: string): Promise<Message[]> => {
      const r = await authFetch(`${API}/conversations/${id}/messages`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<Message[]>
    },
    sendMessage: async (id: string, body: string): Promise<Message> => {
      const r = await authFetch(`${API}/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<Message>
    },
    patchConversation: async (id: string, patch: Record<string, string>): Promise<Conversation> => {
      const r = await authFetch(`${API}/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      return r.json() as Promise<Conversation>
    },
    exportPdf: async (id: string): Promise<string> => {
      const r = await authFetch(`${API}/conversations/${id}/export`)
      if (!r.ok) throw new Error('Export failed — R2 not configured yet')
      const d = await r.json() as { url: string }
      return d.url
    },
  }), [authFetch])()
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const MIN = 60_000, HR = 3_600_000
  if (diff < MIN) return 'just now'
  if (diff < HR) return `${Math.floor(diff / MIN)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / HR)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function slaColor(breachAt?: string | null): string {
  if (!breachAt) return ''
  const diff = new Date(breachAt).getTime() - Date.now()
  if (diff < 0) return 'text-red-500'
  if (diff < 3_600_000) return 'text-amber-500'
  return 'text-slate-400'
}

// ─── Login Page ───────────────────────────────────────────────────────────────
function LoginPage() {
  const { login, error, clearError } = useAuth() as {
    login: (creds: { email: string; password: string }) => Promise<void>
    error: string | null
    clearError: () => void
  }
  const [email, setEmail]         = useState('admin@omnicore.test')
  const [password, setPassword]   = useState('Admin123!')
  const [showPw, setShowPw]       = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    setSubmitting(true)
    try { await login({ email, password }) } finally { setSubmitting(false) }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-9 h-9 bg-sky-500 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/30">
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold tracking-wide">OmniCore</p>
            <p className="text-slate-500 text-xs">Atelier — Agent Dashboard</p>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <h1 className="text-slate-100 text-lg font-semibold mb-1">Sign in</h1>
          <p className="text-slate-500 text-xs mb-5">Agent credentials required</p>

          {error && (
            <div className="mb-4 p-3 bg-red-950/50 border border-red-900 rounded-lg text-xs text-red-400 flex items-center gap-2">
              <AlertTriangle size={13} className="shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 pr-10 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {submitting && <RefreshCw size={13} className="animate-spin" />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-600 mt-4">
          Demo: admin@omnicore.test / Admin123!
        </p>
      </div>
    </div>
  )
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string; icon: React.ReactNode }> = {
    open:        { label: 'Open',    cls: 'bg-sky-100 text-sky-700 border border-sky-200',          icon: <Circle size={6} className="fill-sky-500 text-sky-500" /> },
    pending:     { label: 'Pending', cls: 'bg-amber-50 text-amber-700 border border-amber-200',     icon: <Clock size={10} /> },
    ai_handling: { label: 'AI',      cls: 'bg-violet-100 text-violet-700 border border-violet-200', icon: <Sparkles size={10} /> },
    closed:      { label: 'Closed',  cls: 'bg-slate-100 text-slate-500 border border-slate-200',    icon: <CheckCircle2 size={10} /> },
  }
  const { label, cls, icon } = map[status]
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${cls}`}>
      {icon}{label}
    </span>
  )
}

function PriorityDot({ priority }: { priority: Priority }) {
  const colors: Record<Priority, string> = { urgent: 'bg-red-500', high: 'bg-red-400', normal: 'bg-amber-400', low: 'bg-slate-300' }
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${colors[priority]}`} />
}

function ChannelIcon({ channel }: { channel: Channel }) {
  if (channel === 'email') return <Mail size={11} className="text-slate-400" />
  if (channel === 'api')   return <Hash size={11} className="text-slate-400" />
  return <Globe size={11} className="text-slate-400" />
}

// ─── Conversation Row ─────────────────────────────────────────────────────────
function ConversationRow({ conv, isActive, onClick }: { conv: Conversation; isActive: boolean; onClick: () => void }) {
  const breached = conv.sla_breach_at && new Date(conv.sla_breach_at).getTime() < Date.now()
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-slate-100 transition-colors ${isActive ? 'bg-slate-50 border-l-2 border-l-sky-500' : 'hover:bg-slate-50/70 border-l-2 border-l-transparent'}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <PriorityDot priority={conv.priority} />
          <span className={`text-sm font-medium truncate ${isActive ? 'text-slate-900' : 'text-slate-700'}`}>
            {conv.visitor_name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {conv.unread ? <span className="bg-sky-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{conv.unread}</span> : null}
          <span className="text-[11px] text-slate-400">{timeAgo(conv.updated_at)}</span>
        </div>
      </div>
      <p className={`text-xs mb-1.5 truncate ${isActive ? 'text-slate-700 font-medium' : 'text-slate-600'}`}>
        {conv.subject || '(No subject)'}
      </p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusBadge status={conv.status} />
          <ChannelIcon channel={conv.channel} />
          {conv.sla_breach_at && (
            <span className={`text-[10px] flex items-center gap-0.5 ${slaColor(conv.sla_breach_at)}`}>
              {breached && <AlertTriangle size={9} />}
              SLA
            </span>
          )}
        </div>
        {conv.agent_name && <span className="text-[10px] text-slate-400 truncate shrink-0">{conv.agent_name}</span>}
      </div>
    </button>
  )
}

// ─── Conversations List ───────────────────────────────────────────────────────
const FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' }, { label: 'Open', value: 'open' },
  { label: 'Pending', value: 'pending' }, { label: 'AI', value: 'ai_handling' }, { label: 'Closed', value: 'closed' },
]

function ConversationsList({ convs, activeId, onSelect }: { convs: Conversation[]; activeId: string | null; onSelect: (id: string) => void }) {
  const [query, setQuery]   = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')

  const filtered = convs.filter(c => {
    const matchStatus = filter === 'all' || c.status === filter
    const q = query.toLowerCase()
    const matchQuery = !q || c.visitor_name.toLowerCase().includes(q) || (c.subject ?? '').toLowerCase().includes(q) || (c.visitor_email ?? '').toLowerCase().includes(q)
    return matchStatus && matchQuery
  })

  const counts: Record<StatusFilter, number> = {
    all: convs.length, open: convs.filter(c => c.status === 'open').length,
    pending: convs.filter(c => c.status === 'pending').length,
    ai_handling: convs.filter(c => c.status === 'ai_handling').length,
    closed: convs.filter(c => c.status === 'closed').length,
  }

  return (
    <div className="flex flex-col h-full w-80 border-r border-slate-200 bg-white shrink-0">
      <div className="px-4 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-800">Conversations</h2>
          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{convs.length}</span>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" placeholder="Search conversations…" value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all"
          />
          {query && <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={12} /></button>}
        </div>
      </div>
      <div className="flex gap-0.5 px-3 py-2 bg-slate-50/80 border-b border-slate-100 overflow-x-auto">
        {FILTERS.map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${filter === f.value ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
            {f.label}
            <span className={`text-[10px] ${filter === f.value ? 'text-sky-600' : 'text-slate-400'}`}>{counts[f.value]}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <Inbox size={28} className="text-slate-300 mb-2" />
            <p className="text-sm text-slate-400">{query ? 'No matches' : 'No conversations'}</p>
          </div>
        ) : filtered.map(c => (
          <ConversationRow key={c.id} conv={c} isActive={c.id === activeId} onClick={() => onSelect(c.id)} />
        ))}
      </div>
    </div>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg, visitorName }: { msg: Message; visitorName: string }) {
  const isAgent   = msg.sender_type === 'agent'
  const isBot     = msg.sender_type === 'bot'
  const isNote    = msg.is_internal_note
  const name      = msg.sender_name || (isAgent ? 'Agent' : isBot ? 'AI' : visitorName)

  if (isNote) {
    return (
      <div className="flex justify-center my-1">
        <div className="max-w-lg bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold mr-1">🔒 Internal · {name}</span>
          {msg.message_body}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex items-end gap-2 ${isAgent ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isAgent ? 'bg-sky-600 text-white' : isBot ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
        {isAgent ? <User size={13} /> : isBot ? <Bot size={13} /> : <span className="text-xs font-semibold">{name[0]?.toUpperCase()}</span>}
      </div>
      <div className={`max-w-sm lg:max-w-md xl:max-w-lg`}>
        <div className={`text-[10px] mb-1 text-slate-400 ${isAgent ? 'text-right' : 'text-left'}`}>
          {name} · {timeAgo(msg.created_at)}
        </div>
        <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
          isAgent ? 'bg-sky-600 text-white rounded-br-sm'
          : isBot  ? 'bg-violet-100 text-violet-900 border border-violet-200 rounded-bl-sm'
                   : 'bg-white text-slate-800 border border-slate-200 shadow-sm rounded-bl-sm'
        }`}>
          {msg.message_body}
        </div>
      </div>
    </div>
  )
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────
function ChatPanel({
  conv, messages, onSend, onStatusChange, socketConnected,
}: {
  conv: Conversation
  messages: Message[]
  onSend: (body: string) => Promise<void>
  onStatusChange: (status: Status) => void
  socketConnected: boolean
}) {
  const [draft, setDraft]         = useState('')
  const [sending, setSending]     = useState(false)
  const [exporting, setExporting] = useState(false)
  const [toast, setToast]         = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const api = useApi()

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  const handleSend = async () => {
    const body = draft.trim()
    if (!body || sending) return
    setDraft(''); setSending(true)
    try { await onSend(body) } catch { showToast('error', 'Failed to send') } finally { setSending(false) }
    textareaRef.current?.focus()
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const url = await api.exportPdf(conv.id)
      showToast('success', `PDF ready — <a href="${url}" target="_blank" class="underline">Download</a>`)
    } catch (e) {
      showToast('error', (e as Error).message || 'Export unavailable')
    } finally { setExporting(false) }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const nextStatus: Partial<Record<Status, Status>> = {
    open: 'closed', pending: 'open', ai_handling: 'open', closed: 'open',
  }
  const statusActionLabel: Partial<Record<Status, string>> = {
    open: 'Close', pending: 'Reopen', ai_handling: 'Take over', closed: 'Reopen',
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-slate-900 truncate">{conv.subject || '(No subject)'}</h3>
            <StatusBadge status={conv.status} />
            <span title={socketConnected ? 'Real-time connected' : 'Real-time disconnected'}>
              {socketConnected ? <Wifi size={11} className="text-emerald-400" /> : <WifiOff size={11} className="text-slate-300" />}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span>{conv.visitor_name}</span>
            {conv.visitor_email && <><span>·</span><span>{conv.visitor_email}</span></>}
            <span>·</span><span className="capitalize">{conv.channel}</span>
            {conv.sla_breach_at && (
              <span className={`flex items-center gap-0.5 ${slaColor(conv.sla_breach_at)}`}>
                <Clock size={10} /> SLA {new Date(conv.sla_breach_at).getTime() < Date.now() ? 'breached' : timeAgo(conv.sla_breach_at)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {nextStatus[conv.status] && (
            <button
              onClick={() => onStatusChange(nextStatus[conv.status]!)}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-all"
            >
              {statusActionLabel[conv.status]}
            </button>
          )}
          <button onClick={handleExport} disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-all">
            {exporting ? <RefreshCw size={12} className="animate-spin" /> : <FileDown size={12} />}
            Export PDF
          </button>
          <button className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors">
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`mx-4 mt-3 p-3 rounded-lg text-xs flex items-center gap-2 ${toast.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {toast.type === 'success' ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0" /> : <AlertTriangle size={14} className="text-red-500 shrink-0" />}
          <span dangerouslySetInnerHTML={{ __html: toast.msg }} />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare size={32} className="text-slate-200 mb-2" />
            <p className="text-sm text-slate-400">No messages yet</p>
            <p className="text-xs text-slate-300">Start the conversation below</p>
          </div>
        ) : messages.map(m => <MessageBubble key={m.id} msg={m} visitorName={conv.visitor_name} />)}
        <div ref={bottomRef} />
      </div>

      {/* Compose */}
      <div className="px-4 py-3 bg-white border-t border-slate-200 shrink-0">
        <div className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-500/20 transition-all">
          <textarea
            ref={textareaRef} rows={2} value={draft}
            onChange={e => setDraft(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Reply… (Enter to send, Shift+Enter for newline)"
            className="flex-1 bg-transparent text-sm text-slate-700 placeholder-slate-400 resize-none focus:outline-none leading-relaxed"
            disabled={conv.status === 'closed'}
          />
          <div className="flex items-center gap-1.5 shrink-0 pb-0.5">
            <button className="p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors" title="AI Rephrase">
              <Sparkles size={14} />
            </button>
            <button onClick={handleSend} disabled={!draft.trim() || sending || conv.status === 'closed'}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {sending ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
              Send
            </button>
          </div>
        </div>
        {conv.status === 'closed' && (
          <p className="text-[10px] text-slate-400 mt-1 px-1">Conversation is closed — reopen to reply</p>
        )}
      </div>
    </div>
  )
}

// ─── Empty chat ───────────────────────────────────────────────────────────────
function EmptyChat() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center bg-slate-50 p-8">
      <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
        <MessageSquare size={24} className="text-slate-400" />
      </div>
      <h3 className="text-sm font-semibold text-slate-700 mb-1">Select a conversation</h3>
      <p className="text-xs text-slate-400 max-w-xs">Choose from the list to start replying</p>
    </div>
  )
}

// ─── Brands Section ───────────────────────────────────────────────────────────
function BrandsSection() {
  const brands = [
    { name: 'Acme Help Center', domain: 'help.acme.com', widget: true, email: 'support@acme.com', convs: 42 },
    { name: 'DevCo Support', domain: 'support.devco.com', widget: false, email: 'help@devco.com', convs: 18 },
  ]
  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Brands</h2>
            <p className="text-xs text-slate-500 mt-0.5">Manage branded help centers and widget configs</p>
          </div>
          <button className="px-3 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-md hover:bg-sky-700 transition-colors">+ Add Brand</button>
        </div>
        <div className="space-y-3">
          {brands.map(b => (
            <div key={b.name} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 bg-gradient-to-br from-sky-400 to-sky-600 rounded-lg flex items-center justify-center text-white text-xs font-bold">{b.name[0]}</div>
                    <span className="text-sm font-semibold text-slate-800">{b.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 ml-10">
                    <span className="flex items-center gap-1"><Globe size={10} />{b.domain}</span>
                    <span className="flex items-center gap-1"><Mail size={10} />{b.email}</span>
                    <span className="flex items-center gap-1"><MessageSquare size={10} />{b.convs} conversations</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {b.widget && <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold px-2 py-0.5 rounded">Widget active</span>}
                  <button className="text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-md px-2.5 py-1 hover:bg-slate-50 transition-colors">Edit</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Billing Section ──────────────────────────────────────────────────────────
function BillingSection() {
  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-2xl">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Billing</h2>
        <p className="text-xs text-slate-500 mb-6">Subscription and usage</p>
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-slate-900">Growth Plan</span>
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold px-2 py-0.5 rounded">Active</span>
              </div>
              <p className="text-xs text-slate-500">Billed monthly · Next invoice Jul 1, 2026</p>
            </div>
            <span className="text-xl font-bold text-slate-900">$99<span className="text-sm font-normal text-slate-500">/mo</span></span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[{ label: 'Conversations', used: 842, limit: 2000 }, { label: 'Agents', used: 4, limit: 10 }, { label: 'Brands', used: 2, limit: 5 }].map(m => (
              <div key={m.label} className="bg-slate-50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-slate-500">{m.label}</span>
                  <span className="text-xs font-semibold text-slate-700">{m.used}/{m.limit}</span>
                </div>
                <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-sky-500 rounded-full" style={{ width: `${(m.used / m.limit) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <button className="px-3 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-md hover:bg-sky-700 transition-colors">Upgrade Plan</button>
            <button className="px-3 py-1.5 text-slate-600 border border-slate-200 text-xs font-medium rounded-md hover:bg-slate-50 transition-colors">Manage Billing</button>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-xs font-semibold text-slate-700 mb-3">Recent Invoices</h3>
          <div className="space-y-2">
            {[{ date: 'Jun 1, 2026', amount: '$99.00' }, { date: 'May 1, 2026', amount: '$99.00' }, { date: 'Apr 1, 2026', amount: '$79.00' }].map(inv => (
              <div key={inv.date} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <span className="text-xs text-slate-700 font-medium">{inv.date}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">{inv.amount}</span>
                  <span className="bg-emerald-50 text-emerald-700 text-[10px] font-semibold px-2 py-0.5 rounded">Paid</span>
                  <button className="text-[11px] text-sky-600 hover:underline">PDF</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Settings Section ─────────────────────────────────────────────────────────
function SettingsSection() {
  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-2xl">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Settings</h2>
        <p className="text-xs text-slate-500 mb-6">Workspace and account preferences</p>
        <div className="space-y-3">
          {[
            { label: 'Team Members', desc: '2 active agents', icon: <User size={14} /> },
            { label: 'Notifications', desc: 'Email + in-app alerts enabled', icon: <Bell size={14} /> },
            { label: 'API & Webhooks', desc: '0 webhooks configured', icon: <Zap size={14} /> },
            { label: 'Security & SSO', desc: 'Password auth · 2FA off', icon: <Settings size={14} /> },
          ].map(item => (
            <button key={item.label} className="w-full flex items-center justify-between bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors text-left">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-600">{item.icon}</div>
                <div>
                  <p className="text-sm font-medium text-slate-800">{item.label}</p>
                  <p className="text-xs text-slate-400">{item.desc}</p>
                </div>
              </div>
              <ChevronRight size={14} className="text-slate-400" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
const NAV: { section: Section; icon: React.ReactNode; label: string }[] = [
  { section: 'conversations', icon: <MessageSquare size={17} />, label: 'Conversations' },
  { section: 'brands',        icon: <Building2 size={17} />,    label: 'Brands' },
  { section: 'billing',       icon: <CreditCard size={17} />,   label: 'Billing' },
  { section: 'settings',      icon: <Settings size={17} />,     label: 'Settings' },
]

function Sidebar({ active, onNavigate, unread, agent, onLogout }: {
  active: Section; onNavigate: (s: Section) => void; unread: number
  agent: { name: string; email: string } | null; onLogout: () => void
}) {
  return (
    <nav className="flex flex-col w-56 bg-slate-900 h-full shrink-0">
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-sky-500 rounded-lg flex items-center justify-center">
            <Sparkles size={14} className="text-white" />
          </div>
          <div>
            <p className="text-xs font-bold text-white tracking-wide">OmniCore</p>
            <p className="text-[10px] text-slate-500">Atelier</p>
          </div>
        </div>
      </div>
      <div className="flex-1 px-2 py-3 space-y-0.5">
        {NAV.map(n => {
          const isActive = n.section === active
          return (
            <button key={n.section} onClick={() => onNavigate(n.section)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive ? 'bg-sky-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'}`}>
              {n.icon}
              <span>{n.label}</span>
              {n.section === 'conversations' && unread > 0 && (
                <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{unread}</span>
              )}
            </button>
          )
        })}
      </div>
      <div className="px-3 py-3 border-t border-slate-800">
        <button onClick={onLogout} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors group">
          <div className="w-7 h-7 bg-sky-600 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">
            {agent?.name?.[0]?.toUpperCase() ?? 'A'}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-xs font-medium text-slate-200 truncate">{agent?.name ?? 'Agent'}</p>
            <p className="text-[10px] text-slate-500 truncate">{agent?.email ?? ''}</p>
          </div>
          <LogOut size={13} className="text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
        </button>
      </div>
    </nav>
  )
}

// ─── Dashboard (authenticated) ────────────────────────────────────────────────
function Dashboard() {
  const { accessToken, agent, logout } = useAuth() as {
    accessToken: string | null
    agent: { id: string; name: string; email: string; tenantId: string; role: string } | null
    logout: () => Promise<void>
  }
  const api = useApi()

  const [section, setSection]       = useState<Section>('conversations')
  const [convs, setConvs]           = useState<Conversation[]>([])
  const [activeId, setActiveId]     = useState<string | null>(null)
  const [messages, setMessages]     = useState<Record<string, Message[]>>({})
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [sidebarOpen, setSidebar]   = useState(false)
  const [socketOk, setSocketOk]     = useState(false)
  const socketRef                   = useRef<Socket | null>(null)

  // Load conversations
  useEffect(() => {
    api.listConversations()
      .then(list => { setConvs(list); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Socket.io
  useEffect(() => {
    if (!accessToken) return
    const socket: Socket = io({
      path: '/api/socket.io',
      auth: { agentToken: accessToken },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    })
    socketRef.current = socket

    socket.on('connect',    () => setSocketOk(true))
    socket.on('disconnect', () => setSocketOk(false))
    socket.on('connect_error', () => setSocketOk(false))

    socket.on('server:new_message', (msg: Message) => {
      setMessages(prev => {
        const existing = prev[msg.conversation_id] ?? []
        if (existing.some(m => m.id === msg.id)) return prev
        return { ...prev, [msg.conversation_id]: [...existing, msg] }
      })
      setConvs(prev => prev.map(c =>
        c.id === msg.conversation_id ? { ...c, updated_at: msg.created_at } : c
      ))
    })

    return () => { socket.disconnect(); socketRef.current = null }
  }, [accessToken])

  // Join socket room on conversation select
  useEffect(() => {
    if (activeId && socketRef.current?.connected) {
      socketRef.current.emit('join:conversation', { conversationId: activeId })
    }
  }, [activeId])

  // Load messages lazily
  useEffect(() => {
    if (!activeId || messages[activeId] !== undefined) return
    api.getMessages(activeId)
      .then(msgs => setMessages(prev => ({ ...prev, [activeId]: msgs })))
      .catch(() => setMessages(prev => ({ ...prev, [activeId]: [] })))
    // Clear unread
    setConvs(prev => prev.map(c => c.id === activeId ? { ...c, unread: 0 } : c))
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Send message
  const handleSend = useCallback(async (body: string) => {
    if (!activeId) return
    const msg = await api.sendMessage(activeId, body)
    setMessages(prev => {
      const existing = prev[activeId] ?? []
      if (existing.some(m => m.id === msg.id)) return prev
      return { ...prev, [activeId]: [...existing, msg] }
    })
    setConvs(prev => prev.map(c => c.id === activeId ? { ...c, updated_at: msg.created_at } : c))
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Status change
  const handleStatusChange = useCallback(async (status: Status) => {
    if (!activeId) return
    await api.patchConversation(activeId, { status })
    setConvs(prev => prev.map(c => c.id === activeId ? { ...c, status } : c))
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalUnread = convs.reduce((n, c) => n + (c.unread ?? 0), 0)
  const activeConv  = convs.find(c => c.id === activeId)

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebar(false)} />
          <div className="absolute left-0 top-0 bottom-0 z-50">
            <Sidebar active={section} onNavigate={s => { setSection(s); setSidebar(false) }} unread={totalUnread} agent={agent} onLogout={logout} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="hidden lg:flex">
        <Sidebar active={section} onNavigate={setSection} unread={totalUnread} agent={agent} onLogout={logout} />
      </div>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 lg:hidden">
          <button onClick={() => setSidebar(true)} className="text-slate-500 hover:text-slate-800"><Menu size={20} /></button>
          <span className="text-sm font-semibold text-slate-800 capitalize">{section}</span>
          {totalUnread > 0 && <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{totalUnread}</span>}
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {section === 'conversations' && (
            loading ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <RefreshCw size={20} className="animate-spin text-slate-300" />
                <span className="text-xs text-slate-400">Loading conversations…</span>
              </div>
            ) : error ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
                <AlertTriangle size={28} className="text-amber-400" />
                <p className="text-sm font-medium text-slate-700">Could not load conversations</p>
                <p className="text-xs text-slate-400">{error}</p>
                <button onClick={() => window.location.reload()} className="text-xs text-sky-600 underline">Retry</button>
              </div>
            ) : (
              <>
                <ConversationsList convs={convs} activeId={activeId} onSelect={setActiveId} />
                {activeConv
                  ? <ChatPanel conv={activeConv} messages={messages[activeId!] ?? []} onSend={handleSend} onStatusChange={handleStatusChange} socketConnected={socketOk} />
                  : <EmptyChat />
                }
              </>
            )
          )}
          {section === 'brands'   && <BrandsSection />}
          {section === 'billing'  && <BillingSection />}
          {section === 'settings' && <SettingsSection />}
        </div>
      </div>
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { isAuthenticated, isLoading } = useAuth() as { isAuthenticated: boolean; isLoading: boolean }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 bg-sky-500 rounded-xl flex items-center justify-center animate-pulse">
            <Sparkles size={18} className="text-white" />
          </div>
          <p className="text-slate-500 text-xs">Loading…</p>
        </div>
      </div>
    )
  }

  return isAuthenticated ? <Dashboard /> : <LoginPage />
}
