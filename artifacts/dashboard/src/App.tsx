import { useState, useEffect, useRef, useCallback } from 'react'
import {
  MessageSquare, Building2, CreditCard, Settings,
  Search, Send, FileDown, Menu, X, Bot, User,
  Inbox, Sparkles, LogOut, Bell, RefreshCw,
  AlertTriangle, CheckCircle2, Clock, Circle,
  ChevronRight, Hash, Mail, Globe, Zap, MoreHorizontal,
  Eye, EyeOff, Wifi, WifiOff, Copy, Check, ArrowLeft,
  UserPlus, Building, Lock, Plus,
} from 'lucide-react'
// @ts-ignore — JSX context file, types come from React
import { useAuth } from './context/AuthContext'
import { io, type Socket } from 'socket.io-client'

// ─── Types ────────────────────────────────────────────────────────────────────
type Status      = 'open' | 'closed' | 'pending' | 'ai_handling'
type Channel     = 'email' | 'widget' | 'api'
type Priority    = 'low' | 'normal' | 'high' | 'urgent'
type Sender      = 'agent' | 'visitor' | 'bot' | 'system'
type Section     = 'conversations' | 'brands' | 'billing' | 'settings'
type StatusFilter = 'all' | Status
type AuthView    = 'login' | 'signup'

interface Conversation {
  id: string; subject: string | null; status: Status; channel: Channel
  priority: Priority; visitor_name: string; visitor_email: string | null
  agent_name?: string | null; brand_name: string; updated_at: string
  sla_breach_at?: string | null; unread?: number
}

interface Message {
  id: string; conversation_id: string; sender_type: Sender
  sender_name: string; message_body: string; is_internal_note: boolean
  created_at: string
}

interface Brand {
  id: string; brand_name: string
  widget_config_json?: { website_url?: string; support_email?: string; color?: string } | null
  allowed_domains_array?: string[]; inbound_email_prefix?: string | null
  created_at?: string
}

// ─── API Layer ────────────────────────────────────────────────────────────────
const API = '/api'

function useApi() {
  const { authFetch, agent } = useAuth() as {
    authFetch: (url: string, opts?: RequestInit) => Promise<Response>
    agent: { id: string; name: string; email: string; tenantId: string; role: string } | null
  }
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
        method: 'POST', body: JSON.stringify({ body }),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<Message>
    },
    patchConversation: async (id: string, patch: Record<string, string>): Promise<Conversation> => {
      const r = await authFetch(`${API}/conversations/${id}`, {
        method: 'PATCH', body: JSON.stringify(patch),
      })
      return r.json() as Promise<Conversation>
    },
    exportPdf: async (id: string): Promise<string> => {
      const r = await authFetch(`${API}/conversations/${id}/export`)
      if (!r.ok) throw new Error('Export failed')
      const ct = r.headers.get('content-type') || ''
      if (ct.includes('application/pdf')) {
        const blob = await r.blob()
        return URL.createObjectURL(blob)
      }
      const d = await r.json() as { downloadUrl?: string; url?: string }
      return d.downloadUrl ?? d.url ?? ''
    },
    listBrands: async (): Promise<Brand[]> => {
      if (!agent?.tenantId) return []
      const r = await authFetch(`${API}/tenants/${agent.tenantId}/brands`)
      if (!r.ok) return []
      const d = await r.json() as Brand[] | { brands: Brand[] }
      return Array.isArray(d) ? d : (d.brands ?? [])
    },
    createBrand: async (name: string, websiteUrl: string, supportEmail: string): Promise<Brand> => {
      if (!agent?.tenantId) throw new Error('Not authenticated')
      const r = await authFetch(`${API}/tenants/${agent.tenantId}/brands`, {
        method: 'POST',
        body: JSON.stringify({
          brand_name: name,
          widget_config_json: {
            website_url: websiteUrl || undefined,
            support_email: supportEmail || undefined,
          },
        }),
      })
      if (!r.ok) {
        const err = await r.json() as { error?: string }
        throw new Error(err.error ?? 'Failed to create brand')
      }
      return r.json() as Promise<Brand>
    },
    rephraseText: async (draft: string, tone = 'professional'): Promise<string> => {
      const r = await authFetch(`${API}/ai/rephrase`, {
        method: 'POST', body: JSON.stringify({ draft, tone }),
      })
      if (!r.ok) throw new Error('AI unavailable')
      const d = await r.json() as { rephrased: string }
      return d.rephrased
    },
  }), [authFetch, agent?.tenantId])()
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

// ─── Logo ─────────────────────────────────────────────────────────────────────
function OmniLogo({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const s = size === 'sm' ? 'w-7 h-7' : 'w-9 h-9'
  const i = size === 'sm' ? 14 : 18
  return (
    <div className={`${s} bg-sky-500 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/30`}>
      <Sparkles size={i} className="text-white" />
    </div>
  )
}

// ─── Signup Page ──────────────────────────────────────────────────────────────
function SignupPage({ onGoLogin }: { onGoLogin: (successMsg?: string) => void }) {
  const [form, setForm] = useState({ companyName: '', adminName: '', adminEmail: '', password: '' })
  const [showPw, setShowPw]     = useState(false)
  const [submitting, setSub]    = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSub(true)
    try {
      const res = await fetch(`${API}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json() as { error?: string; tenantId?: string }
      if (!res.ok) throw new Error(data.error ?? 'Signup failed')
      onGoLogin('Account created! Sign in below.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSub(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <OmniLogo />
          <div>
            <p className="text-white font-bold tracking-wide">OmniCore</p>
            <p className="text-slate-500 text-xs">Atelier — Create your account</p>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <h1 className="text-slate-100 text-lg font-semibold mb-1">Start for free</h1>
          <p className="text-slate-500 text-xs mb-5">Set up your team workspace in seconds</p>

          {error && (
            <div className="mb-4 p-3 bg-red-950/50 border border-red-900 rounded-lg text-xs text-red-400 flex items-center gap-2">
              <AlertTriangle size={13} className="shrink-0" /> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                <span className="inline-flex items-center gap-1.5"><Building size={11} /> Company name</span>
              </label>
              <input type="text" value={form.companyName} onChange={set('companyName')} required
                placeholder="Acme Inc."
                className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                <span className="inline-flex items-center gap-1.5"><User size={11} /> Your name</span>
              </label>
              <input type="text" value={form.adminName} onChange={set('adminName')} required
                placeholder="Alex Johnson"
                className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                <span className="inline-flex items-center gap-1.5"><Mail size={11} /> Work email</span>
              </label>
              <input type="email" value={form.adminEmail} onChange={set('adminEmail')} required
                placeholder="alex@acme.com"
                className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                <span className="inline-flex items-center gap-1.5"><Lock size={11} /> Password</span>
              </label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')} required
                  placeholder="Min 8 characters"
                  className="w-full px-3 py-2.5 pr-10 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" />
                <button type="button" onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={submitting}
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 mt-1">
              {submitting ? <><RefreshCw size={13} className="animate-spin" /> Creating account…</> : <><UserPlus size={14} /> Create free account</>}
            </button>
          </form>
        </div>

        <button onClick={() => onGoLogin()} className="mt-4 w-full flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors">
          <ArrowLeft size={12} /> Already have an account? Sign in
        </button>
      </div>
    </div>
  )
}

// ─── Login Page ───────────────────────────────────────────────────────────────
function LoginPage({ onGoSignup, successMsg }: { onGoSignup: () => void; successMsg?: string }) {
  const { login, error, clearError } = useAuth() as {
    login: (creds: { email: string; password: string }) => Promise<void>
    error: string | null
    clearError: () => void
  }
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [submitting, setSub]    = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); clearError(); setSub(true)
    try { await login({ email, password }) } finally { setSub(false) }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <OmniLogo />
          <div>
            <p className="text-white font-bold tracking-wide">OmniCore</p>
            <p className="text-slate-500 text-xs">Atelier — Agent Dashboard</p>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <h1 className="text-slate-100 text-lg font-semibold mb-1">Sign in</h1>
          <p className="text-slate-500 text-xs mb-5">Enter your agent credentials</p>

          {successMsg && (
            <div className="mb-4 p-3 bg-emerald-950/60 border border-emerald-800 rounded-lg text-xs text-emerald-400 flex items-center gap-2">
              <CheckCircle2 size={13} className="shrink-0" /> {successMsg}
            </div>
          )}
          {error && (
            <div className="mb-4 p-3 bg-red-950/50 border border-red-900 rounded-lg text-xs text-red-400 flex items-center gap-2">
              <AlertTriangle size={13} className="shrink-0" /> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@company.com" autoComplete="email"
                className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                  placeholder="••••••••" autoComplete="current-password"
                  className="w-full px-3 py-2.5 pr-10 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" />
                <button type="button" onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={submitting}
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">
              {submitting && <RefreshCw size={13} className="animate-spin" />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-slate-800 text-center">
            <button onClick={onGoSignup}
              className="text-xs text-sky-500 hover:text-sky-400 transition-colors">
              New to OmniCore? Create a free account →
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-700 mt-4">
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
    <button onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-slate-100 transition-colors ${isActive ? 'bg-slate-50 border-l-2 border-l-sky-500' : 'hover:bg-slate-50/70 border-l-2 border-l-transparent'}`}>
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
              {breached && <AlertTriangle size={9} />} SLA
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
          <input type="text" placeholder="Search conversations…" value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" />
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
  const isAgent = msg.sender_type === 'agent'
  const isBot   = msg.sender_type === 'bot'
  const isNote  = msg.is_internal_note
  const name    = msg.sender_name || (isAgent ? 'Agent' : isBot ? 'AI' : visitorName)

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

// ─── Visitor Info Panel ───────────────────────────────────────────────────────
function VisitorInfoPanel({ conv }: { conv: Conversation }) {
  const ext = conv as Conversation & { ip_address?: string; current_page_url?: string }
  return (
    <div className="w-56 border-l border-slate-200 bg-white shrink-0 overflow-y-auto">
      <div className="px-4 py-3 border-b border-slate-100">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Visitor</p>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div>
          <p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Name</p>
          <p className="text-xs text-slate-800 font-medium">{conv.visitor_name}</p>
        </div>
        {conv.visitor_email && (
          <div>
            <p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Email</p>
            <p className="text-xs text-slate-700 break-all">{conv.visitor_email}</p>
          </div>
        )}
        {ext.ip_address && (
          <div>
            <p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">IP Address</p>
            <p className="text-xs text-slate-700 font-mono">{ext.ip_address}</p>
          </div>
        )}
        {ext.current_page_url && (
          <div>
            <p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Current Page</p>
            <a href={ext.current_page_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-sky-600 hover:underline break-all">{ext.current_page_url}</a>
          </div>
        )}
        <div>
          <p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Channel</p>
          <p className="text-xs text-slate-700 capitalize">{conv.channel}</p>
        </div>
        <div>
          <p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Brand</p>
          <p className="text-xs text-slate-700">{conv.brand_name}</p>
        </div>
        {conv.sla_breach_at && (
          <div>
            <p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">SLA</p>
            <p className={`text-xs ${slaColor(conv.sla_breach_at)}`}>
              {new Date(conv.sla_breach_at).getTime() < Date.now() ? 'Breached' : `Due ${timeAgo(conv.sla_breach_at)}`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────
function ChatPanel({
  conv, messages, onSend, onStatusChange, socketConnected,
}: {
  conv: Conversation; messages: Message[]
  onSend: (body: string) => Promise<void>
  onStatusChange: (status: Status) => void
  socketConnected: boolean
}) {
  const [draft, setDraft]         = useState('')
  const [sending, setSending]     = useState(false)
  const [rephrasing, setRephrase] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [toast, setToast]         = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const api = useApi()

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 5000)
  }

  const handleSend = async () => {
    const body = draft.trim()
    if (!body || sending) return
    setDraft(''); setSending(true)
    try { await onSend(body) } catch { showToast('error', 'Failed to send') } finally { setSending(false) }
    textareaRef.current?.focus()
  }

  const handleRephrase = async () => {
    const body = draft.trim()
    if (!body || rephrasing) return
    setRephrase(true)
    try {
      const improved = await api.rephraseText(body)
      setDraft(improved)
    } catch {
      showToast('error', 'AI rephrase unavailable')
    } finally {
      setRephrase(false)
      textareaRef.current?.focus()
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const url = await api.exportPdf(conv.id)
      if (url) {
        window.open(url, '_blank')
        showToast('success', 'PDF export opened in new tab')
      }
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
            <span title={socketConnected ? 'Real-time connected' : 'Reconnecting…'}>
              {socketConnected ? <Wifi size={11} className="text-emerald-400" /> : <WifiOff size={11} className="text-slate-300" />}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="font-medium text-slate-600">{conv.visitor_name}</span>
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
            <button onClick={() => onStatusChange(nextStatus[conv.status]!)}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-all">
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
          <span>{toast.msg}</span>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
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

        {/* Visitor info sidebar */}
        <VisitorInfoPanel conv={conv} />
      </div>

      {/* Compose */}
      <div className="px-4 py-3 bg-white border-t border-slate-200 shrink-0">
        <div className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-500/20 transition-all">
          <textarea ref={textareaRef} rows={2} value={draft}
            onChange={e => setDraft(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={conv.status === 'closed' ? 'Conversation closed — reopen to reply' : 'Reply… (Enter to send, Shift+Enter for newline)'}
            className="flex-1 bg-transparent text-sm text-slate-700 placeholder-slate-400 resize-none focus:outline-none leading-relaxed"
            disabled={conv.status === 'closed'} />
          <div className="flex items-center gap-1.5 shrink-0 pb-0.5">
            <button onClick={handleRephrase} disabled={!draft.trim() || rephrasing || conv.status === 'closed'}
              title="AI rephrase (improve draft)"
              className="p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              {rephrasing ? <RefreshCw size={14} className="animate-spin text-violet-500" /> : <Sparkles size={14} />}
            </button>
            <button onClick={handleSend} disabled={!draft.trim() || sending || conv.status === 'closed'}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {sending ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
              Send
            </button>
          </div>
        </div>
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
      <p className="text-xs text-slate-400 max-w-xs">Choose a conversation from the list to start replying</p>
    </div>
  )
}

// ─── Copy Snippet button ──────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={handle}
      className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-400 hover:text-slate-200 transition-colors rounded">
      {copied ? <><Check size={10} className="text-emerald-400" /> Copied</> : <><Copy size={10} /> Copy</>}
    </button>
  )
}

// ─── Add Brand Modal ──────────────────────────────────────────────────────────
function AddBrandModal({ onClose, onCreated }: { onClose: () => void; onCreated: (b: Brand) => void }) {
  const api = useApi()
  const [form, setForm] = useState({ name: '', website: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!form.name.trim()) { setError('Brand name is required'); return }
    setSaving(true); setError(null)
    try {
      const brand = await api.createBrand(form.name.trim(), form.website.trim(), form.email.trim())
      onCreated(brand)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-slate-900">Add Brand</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-center gap-2">
            <AlertTriangle size={12} className="shrink-0" /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Brand Name *</label>
            <input type="text" value={form.name} onChange={set('name')} required
              placeholder="Acme Help Center"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Website URL</label>
            <input type="url" value={form.website} onChange={set('website')}
              placeholder="https://acme.com"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Support Email</label>
            <input type="email" value={form.email} onChange={set('email')}
              placeholder="support@acme.com"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-1.5">
              {saving ? <><RefreshCw size={11} className="animate-spin" /> Creating…</> : <><Plus size={11} /> Create Brand</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Brands Section ───────────────────────────────────────────────────────────
function BrandsSection() {
  const api = useApi()
  const [brands, setBrands]       = useState<Brand[]>([])
  const [loading, setLoading]     = useState(true)
  const [showModal, setShowModal] = useState(false)
  const origin = window.location.origin

  useEffect(() => {
    api.listBrands()
      .then(list => { setBrands(list); setLoading(false) })
      .catch(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBrandCreated = (b: Brand) => {
    setBrands(prev => [...prev, b])
    setShowModal(false)
  }

  return (
    <>
      {showModal && <AddBrandModal onClose={() => setShowModal(false)} onCreated={handleBrandCreated} />}

      <div className="flex-1 overflow-auto p-6 bg-slate-50">
        <div className="max-w-2xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Brands</h2>
              <p className="text-xs text-slate-500 mt-0.5">Manage branded help centers and embed your widget</p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-md hover:bg-sky-700 transition-colors">
              <Plus size={13} /> Add Brand
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-slate-400 text-sm">
              <RefreshCw size={16} className="animate-spin" /> Loading…
            </div>
          ) : brands.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Building2 size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm">No brands yet</p>
              <p className="text-xs mt-1">Click "Add Brand" to create your first brand</p>
            </div>
          ) : (
            <div className="space-y-4">
              {brands.map(b => {
                const snippet = `<script\n  src="${origin}/api/widget/widget.js"\n  data-brand-id="${b.id}"\n  data-label="${b.brand_name}"\n  defer\n></script>`
                return (
                  <div key={b.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-slate-300 transition-colors">
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <div className="w-8 h-8 bg-gradient-to-br from-sky-400 to-sky-600 rounded-lg flex items-center justify-center text-white text-xs font-bold">
                              {b.brand_name[0]}
                            </div>
                            <span className="text-sm font-semibold text-slate-800">{b.brand_name}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500 ml-10">
                            {b.widget_config_json?.website_url && <span className="flex items-center gap-1"><Globe size={10} />{b.widget_config_json.website_url}</span>}
                            {b.widget_config_json?.support_email && <span className="flex items-center gap-1"><Mail size={10} />{b.widget_config_json.support_email}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {b.widget_config_json && (
                            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold px-2 py-0.5 rounded">
                              Widget active
                            </span>
                          )}
                          <button className="text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-md px-2.5 py-1 hover:bg-slate-50 transition-colors">
                            Edit
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Embed snippet */}
                    <div className="border-t border-slate-100 bg-slate-950 mx-0">
                      <div className="flex items-center justify-between px-4 pt-2.5 pb-1">
                        <span className="text-[10px] text-slate-500 font-medium tracking-wide uppercase">Widget embed</span>
                        <CopyButton text={snippet} />
                      </div>
                      <pre className="px-4 pb-3 text-[11px] text-sky-300 overflow-x-auto leading-relaxed">
                        {snippet}
                      </pre>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Widget demo link */}
          <div className="mt-6 p-4 bg-violet-50 border border-violet-200 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-violet-900">Test the widget live</p>
              <p className="text-xs text-violet-600 mt-0.5">Open the demo page to see the chat bubble in action</p>
            </div>
            <a href="/api/widget/demo" target="_blank" rel="noopener noreferrer"
              className="px-3 py-1.5 bg-violet-600 text-white text-xs font-medium rounded-md hover:bg-violet-700 transition-colors whitespace-nowrap">
              Open demo →
            </a>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Billing Section ──────────────────────────────────────────────────────────
function BillingSection() {
  const handleUpgrade = () => {
    window.open('https://app.lemonsqueezy.com', '_blank')
  }
  const handleManageBilling = () => {
    window.open('https://app.lemonsqueezy.com/billing', '_blank')
  }

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
            <button onClick={handleUpgrade} className="px-3 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-md hover:bg-sky-700 transition-colors">Upgrade Plan</button>
            <button onClick={handleManageBilling} className="px-3 py-1.5 text-slate-600 border border-slate-200 text-xs font-medium rounded-md hover:bg-slate-50 transition-colors">Manage Billing</button>
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
                  <button onClick={() => alert('Invoice PDF download requires Lemon Squeezy integration')}
                    className="text-[11px] text-sky-600 hover:underline">PDF</button>
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
  const [activePanel, setActivePanel] = useState<string | null>(null)

  const panels: { label: string; desc: string; icon: React.ReactNode; key: string }[] = [
    { key: 'team',          label: 'Team Members',   desc: '2 active agents',            icon: <User size={14} /> },
    { key: 'notifications', label: 'Notifications',  desc: 'Email + in-app alerts',      icon: <Bell size={14} /> },
    { key: 'api',           label: 'API & Webhooks', desc: '0 webhooks configured',      icon: <Zap size={14} /> },
    { key: 'security',      label: 'Security & SSO', desc: 'Password auth · 2FA off',    icon: <Settings size={14} /> },
  ]

  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-2xl">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Settings</h2>
        <p className="text-xs text-slate-500 mb-6">Workspace and account preferences</p>
        <div className="space-y-3">
          {panels.map(item => (
            <button key={item.key}
              onClick={() => setActivePanel(prev => prev === item.key ? null : item.key)}
              className="w-full flex items-center justify-between bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors text-left">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-600">{item.icon}</div>
                <div>
                  <p className="text-sm font-medium text-slate-800">{item.label}</p>
                  <p className="text-xs text-slate-400">{item.desc}</p>
                </div>
              </div>
              <ChevronRight size={14} className={`text-slate-400 transition-transform ${activePanel === item.key ? 'rotate-90' : ''}`} />
            </button>
          ))}
        </div>
        {activePanel && (
          <div className="mt-4 p-4 bg-white border border-slate-200 rounded-xl">
            <p className="text-xs text-slate-500 text-center">
              {activePanel === 'team' && 'Team management panel — invite agents, set roles, and manage access.'}
              {activePanel === 'notifications' && 'Configure email and in-app notification preferences.'}
              {activePanel === 'api' && 'Generate API keys and configure webhook endpoints.'}
              {activePanel === 'security' && 'Manage password policy, two-factor auth, and SSO providers.'}
              {' '}(Coming soon)
            </p>
          </div>
        )}
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
  agent: { name: string; email: string; role: string } | null; onLogout: () => void
}) {
  return (
    <nav className="flex flex-col w-56 bg-slate-900 h-full shrink-0">
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <OmniLogo size="sm" />
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
        {agent?.role === 'admin' && (
          <div className="px-2 py-1 mb-2">
            <span className="text-[10px] font-semibold text-sky-500 bg-sky-500/10 px-2 py-0.5 rounded uppercase tracking-wide">Admin</span>
          </div>
        )}
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

  const [section, setSection]     = useState<Section>('conversations')
  const [convs, setConvs]         = useState<Conversation[]>([])
  const [activeId, setActiveId]   = useState<string | null>(null)
  const [messages, setMessages]   = useState<Record<string, Message[]>>({})
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [sidebarOpen, setSidebar] = useState(false)
  const [socketOk, setSocketOk]   = useState(false)
  const socketRef                 = useRef<Socket | null>(null)

  // ── Load conversations on mount ───────────────────────────────────────────
  useEffect(() => {
    api.listConversations()
      .then(list => { setConvs(list); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Socket.io connection ──────────────────────────────────────────────────
  useEffect(() => {
    if (!accessToken) return
    const socket: Socket = io({
      path: '/api/socket.io',
      auth: { agentToken: accessToken },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    })
    socketRef.current = socket
    socket.on('connect',       () => setSocketOk(true))
    socket.on('disconnect',    () => setSocketOk(false))
    socket.on('connect_error', () => setSocketOk(false))
    socket.on('server:new_message', (msg: Message) => {
      setMessages(prev => {
        const existing = prev[msg.conversation_id] ?? []
        if (existing.some(m => m.id === msg.id)) return prev
        return { ...prev, [msg.conversation_id]: [...existing, msg] }
      })
      setConvs(prev => prev.map(c =>
        c.id === msg.conversation_id
          ? { ...c, updated_at: msg.created_at, unread: (c.unread ?? 0) + 1 }
          : c
      ))
    })
    return () => { socket.disconnect(); socketRef.current = null }
  }, [accessToken])

  // ── Join conversation room when active conversation changes ───────────────
  useEffect(() => {
    if (activeId && socketRef.current?.connected) {
      socketRef.current.emit('join:conversation', { conversationId: activeId })
    }
  }, [activeId])

  // ── Fetch messages for newly selected conversation ────────────────────────
  useEffect(() => {
    if (!activeId || messages[activeId] !== undefined) return
    api.getMessages(activeId)
      .then(msgs => setMessages(prev => ({ ...prev, [activeId]: msgs })))
      .catch(() => setMessages(prev => ({ ...prev, [activeId]: [] })))
    // Clear unread badge
    setConvs(prev => prev.map(c => c.id === activeId ? { ...c, unread: 0 } : c))
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Select conversation and navigate to conversations section ─────────────
  const handleSelectConversation = useCallback((id: string) => {
    setActiveId(id)
    setSection('conversations')
    setConvs(prev => prev.map(c => c.id === id ? { ...c, unread: 0 } : c))
  }, [])

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

  const handleStatusChange = useCallback(async (status: Status) => {
    if (!activeId) return
    await api.patchConversation(activeId, { status })
    setConvs(prev => prev.map(c => c.id === activeId ? { ...c, status } : c))
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalUnread = convs.reduce((n, c) => n + (c.unread ?? 0), 0)
  const activeConv  = convs.find(c => c.id === activeId)

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebar(false)} />
          <div className="absolute left-0 top-0 bottom-0 z-50">
            <Sidebar active={section} onNavigate={s => { setSection(s); setSidebar(false) }} unread={totalUnread} agent={agent} onLogout={logout} />
          </div>
        </div>
      )}
      <div className="hidden lg:flex">
        <Sidebar active={section} onNavigate={setSection} unread={totalUnread} agent={agent} onLogout={logout} />
      </div>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 lg:hidden">
          <button onClick={() => setSidebar(true)} className="text-slate-500 hover:text-slate-800"><Menu size={20} /></button>
          <span className="text-sm font-semibold text-slate-800 capitalize">{section}</span>
          {totalUnread > 0 && <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{totalUnread}</span>}
        </div>

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
                <ConversationsList convs={convs} activeId={activeId} onSelect={handleSelectConversation} />
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
  const [view, setView]         = useState<AuthView>('login')
  const [successMsg, setSuccess] = useState<string | undefined>()

  const goSignup = () => { setSuccess(undefined); setView('signup') }
  const goLogin  = (msg?: string) => { setSuccess(msg); setView('login') }

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

  if (isAuthenticated) return <Dashboard />

  return view === 'signup'
    ? <SignupPage onGoLogin={goLogin} />
    : <LoginPage onGoSignup={goSignup} successMsg={successMsg} />
}
