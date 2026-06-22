import { useState, useEffect, useRef, useCallback } from 'react'
import {
  MessageSquare, Building2, CreditCard, Settings,
  Search, Send, FileDown, Menu, X, Bot, User,
  Inbox, Sparkles, LogOut, Bell, RefreshCw,
  AlertTriangle, CheckCircle2, Clock, Circle,
  ChevronRight, Hash, Mail, Globe, Zap, MoreHorizontal,
  Eye, EyeOff, Wifi, WifiOff, Copy, Check, ArrowLeft,
  UserPlus, Building, Lock, Plus, Trash2, Pencil,
  Users, Shield, ToggleLeft, ToggleRight, Send as SendIcon,
  Tag, UserCheck,
} from 'lucide-react'
// @ts-ignore
import { useAuth } from './context/AuthContext'
import { io, type Socket } from 'socket.io-client'

// ─── Types ────────────────────────────────────────────────────────────────────
type Status      = 'open' | 'closed' | 'pending' | 'ai_handling'
type Channel     = 'email' | 'widget' | 'api'
type Priority    = 'low' | 'normal' | 'high' | 'urgent'
type Sender      = 'agent' | 'visitor' | 'bot' | 'system'
type Section     = 'conversations' | 'tickets' | 'brands' | 'billing' | 'settings' | 'team' | 'superadmin'
type StatusFilter = 'all' | Status
type AuthView    = 'login' | 'signup'

interface Conversation {
  id: string; subject: string | null; status: Status; channel: Channel
  priority: Priority; visitor_name: string; visitor_email: string | null
  agent_name?: string | null; brand_name: string; updated_at: string
  sla_breach_at?: string | null; unread?: number
  is_ticket?: boolean; assigned_agent_id?: string | null
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

interface AgentRow {
  id: string; name: string; email: string; role: string
  is_active: boolean; created_at: string
}

interface SANTenant {
  id: string; company_name: string; account_status: string
  subscription_status: string; plan: string; created_at: string
  agent_count: number; max_brands_allowed: number
}

interface UpgradeRequest {
  id: string; tenant_id: string; company_name: string
  agent_name: string; agent_email: string; requested_plan: string
  company_size: string | null; notes: string | null; status: string; created_at: string
}

// ─── API Layer ────────────────────────────────────────────────────────────────
const API = '/api'

function useApi() {
  const { authFetch, agent } = useAuth() as {
    authFetch: (url: string, opts?: RequestInit) => Promise<Response>
    agent: { id: string; name: string; email: string; tenantId: string; role: string; isSuperAdmin?: boolean } | null
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
    patchConversation: async (id: string, patch: Record<string, unknown>): Promise<Conversation> => {
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
    editBrand: async (brandId: string, patch: { brand_name?: string; website_url?: string; support_email?: string; color?: string }): Promise<Brand> => {
      if (!agent?.tenantId) throw new Error('Not authenticated')
      const widget_config_json: Record<string, string> = {}
      if (patch.website_url !== undefined) widget_config_json.website_url = patch.website_url
      if (patch.support_email !== undefined) widget_config_json.support_email = patch.support_email
      if (patch.color !== undefined) widget_config_json.color = patch.color
      const body: Record<string, unknown> = {}
      if (patch.brand_name) body.brand_name = patch.brand_name
      if (Object.keys(widget_config_json).length) body.widget_config_json = widget_config_json
      const r = await authFetch(`${API}/tenants/${agent.tenantId}/brands/${brandId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json() as { error?: string }
        throw new Error(err.error ?? 'Failed to update brand')
      }
      return r.json() as Promise<Brand>
    },
    deleteBrand: async (brandId: string): Promise<void> => {
      if (!agent?.tenantId) throw new Error('Not authenticated')
      const r = await authFetch(`${API}/tenants/${agent.tenantId}/brands/${brandId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete brand')
    },
    rephraseText: async (draft: string, tone = 'professional'): Promise<string> => {
      const r = await authFetch(`${API}/ai/rephrase`, {
        method: 'POST', body: JSON.stringify({ draft, tone }),
      })
      if (!r.ok) throw new Error('AI unavailable')
      const d = await r.json() as { rephrased: string }
      return d.rephrased
    },
    listAgents: async (): Promise<AgentRow[]> => {
      const r = await authFetch(`${API}/agents`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<AgentRow[]>
    },
    inviteAgent: async (name: string, email: string, role: string): Promise<AgentRow> => {
      const r = await authFetch(`${API}/agents`, {
        method: 'POST', body: JSON.stringify({ name, email, role }),
      })
      if (!r.ok) {
        const err = await r.json() as { error?: string }
        throw new Error(err.error ?? 'Failed to invite agent')
      }
      return r.json() as Promise<AgentRow>
    },
    removeAgent: async (id: string): Promise<void> => {
      const r = await authFetch(`${API}/agents/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to remove agent')
    },
    updateProfile: async (name?: string, password?: string): Promise<void> => {
      const r = await authFetch(`${API}/agents/me`, {
        method: 'PATCH', body: JSON.stringify({ name, password }),
      })
      if (!r.ok) {
        const err = await r.json() as { error?: string }
        throw new Error(err.error ?? 'Failed to update profile')
      }
    },
    createUpgradeRequest: async (requested_plan: string, company_size: string, notes: string): Promise<void> => {
      const r = await authFetch(`${API}/billing/upgrade-request`, {
        method: 'POST', body: JSON.stringify({ requested_plan, company_size, notes }),
      })
      if (!r.ok) {
        const err = await r.json() as { error?: string }
        throw new Error(err.error ?? 'Failed to submit request')
      }
    },
    listSANTenants: async (): Promise<SANTenant[]> => {
      const r = await authFetch(`${API}/super-admin/tenants`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<SANTenant[]>
    },
    listUpgradeRequests: async (): Promise<UpgradeRequest[]> => {
      const r = await authFetch(`${API}/super-admin/upgrade-requests`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<UpgradeRequest[]>
    },
    patchTenantStatus: async (id: string, account_status: string): Promise<void> => {
      const r = await authFetch(`${API}/super-admin/tenants/${id}/status`, {
        method: 'PATCH', body: JSON.stringify({ account_status }),
      })
      if (!r.ok) throw new Error('Failed to update status')
    },
    patchTenantBilling: async (id: string, plan: string, subscription_status: string): Promise<void> => {
      const r = await authFetch(`${API}/super-admin/tenants/${id}/billing`, {
        method: 'PATCH', body: JSON.stringify({ plan, subscription_status }),
      })
      if (!r.ok) throw new Error('Failed to update billing')
    },
    purgeTenant: async (id: string, confirm_name: string): Promise<void> => {
      const r = await authFetch(`${API}/super-admin/tenants/${id}/purge`, {
        method: 'DELETE', body: JSON.stringify({ confirm_name }),
      })
      if (!r.ok) {
        const err = await r.json() as { error?: string }
        throw new Error(err.error ?? 'Purge failed')
      }
    },
    patchTenantLimits: async (id: string, max_brands_allowed: number): Promise<void> => {
      const r = await authFetch(`${API}/super-admin/tenants/${id}/limits`, {
        method: 'PATCH', body: JSON.stringify({ max_brands_allowed }),
      })
      if (!r.ok) {
        const err = await r.json() as { error?: string }
        throw new Error(err.error ?? 'Failed to update limits')
      }
    },
    updateWorkspace: async (patch: { company_name?: string; default_timezone?: string; ai_auto_reply_enabled?: boolean; custom_domain?: string; smtp_config_json?: object }): Promise<void> => {
      const r = await authFetch(`${API}/tenants/settings`, {
        method: 'PATCH', body: JSON.stringify(patch),
      })
      if (!r.ok) {
        const err = await r.json() as { error?: string }
        throw new Error(err.error ?? 'Failed to update workspace')
      }
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
    e.preventDefault(); setError(null); setSub(true)
    try {
      const res = await fetch(`${API}/auth/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Signup failed')
      onGoLogin('Account created! Sign in below.')
    } catch (err) { setError((err as Error).message) } finally { setSub(false) }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <OmniLogo /><div><p className="text-white font-bold tracking-wide">OmniCore</p><p className="text-slate-500 text-xs">Atelier — Create your account</p></div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <h1 className="text-slate-100 text-lg font-semibold mb-1">Start for free</h1>
          <p className="text-slate-500 text-xs mb-5">Set up your team workspace in seconds</p>
          {error && <div className="mb-4 p-3 bg-red-950/50 border border-red-900 rounded-lg text-xs text-red-400 flex items-center gap-2"><AlertTriangle size={13} className="shrink-0" /> {error}</div>}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="block text-xs font-medium text-slate-400 mb-1.5"><span className="inline-flex items-center gap-1.5"><Building size={11} /> Company name</span></label>
              <input type="text" value={form.companyName} onChange={set('companyName')} required placeholder="Acme Inc." className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1.5"><span className="inline-flex items-center gap-1.5"><User size={11} /> Your name</span></label>
              <input type="text" value={form.adminName} onChange={set('adminName')} required placeholder="Alex Johnson" className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1.5"><span className="inline-flex items-center gap-1.5"><Mail size={11} /> Work email</span></label>
              <input type="email" value={form.adminEmail} onChange={set('adminEmail')} required placeholder="alex@acme.com" className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1.5"><span className="inline-flex items-center gap-1.5"><Lock size={11} /> Password</span></label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')} required placeholder="Min 8 characters" className="w-full px-3 py-2.5 pr-10 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" />
                <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">{showPw ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              </div>
            </div>
            <button type="submit" disabled={submitting} className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 mt-1">
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
  const { login, error, clearError } = useAuth() as { login: (creds: { email: string; password: string }) => Promise<void>; error: string | null; clearError: () => void }
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
          <OmniLogo /><div><p className="text-white font-bold tracking-wide">OmniCore</p><p className="text-slate-500 text-xs">Atelier — Agent Dashboard</p></div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <h1 className="text-slate-100 text-lg font-semibold mb-1">Sign in</h1>
          <p className="text-slate-500 text-xs mb-5">Enter your agent credentials</p>
          {successMsg && <div className="mb-4 p-3 bg-emerald-950/60 border border-emerald-800 rounded-lg text-xs text-emerald-400 flex items-center gap-2"><CheckCircle2 size={13} className="shrink-0" /> {successMsg}</div>}
          {error && <div className="mb-4 p-3 bg-red-950/50 border border-red-900 rounded-lg text-xs text-red-400 flex items-center gap-2"><AlertTriangle size={13} className="shrink-0" /> {error}</div>}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="email" className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" autoComplete="current-password" className="w-full px-3 py-2.5 pr-10 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" />
                <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">{showPw ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              </div>
            </div>
            <button type="submit" disabled={submitting} className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">
              {submitting && <RefreshCw size={13} className="animate-spin" />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <div className="mt-4 pt-4 border-t border-slate-800 text-center">
            <button onClick={onGoSignup} className="text-xs text-sky-500 hover:text-sky-400 transition-colors">New to OmniCore? Create a free account →</button>
          </div>
        </div>
        <p className="text-center text-xs text-slate-700 mt-4">Demo: admin@omnicore.test / Admin123!</p>
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
  return <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${cls}`}>{icon}{label}</span>
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
    <button onClick={onClick} className={`w-full text-left px-4 py-3 border-b border-slate-100 transition-colors ${isActive ? 'bg-slate-50 border-l-2 border-l-sky-500' : 'hover:bg-slate-50/70 border-l-2 border-l-transparent'}`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0"><PriorityDot priority={conv.priority} /><span className={`text-sm font-medium truncate ${isActive ? 'text-slate-900' : 'text-slate-700'}`}>{conv.visitor_name}</span></div>
        <div className="flex items-center gap-1.5 shrink-0">
          {conv.unread ? <span className="bg-sky-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{conv.unread}</span> : null}
          <span className="text-[11px] text-slate-400">{timeAgo(conv.updated_at)}</span>
        </div>
      </div>
      <p className={`text-xs mb-1.5 truncate ${isActive ? 'text-slate-700 font-medium' : 'text-slate-600'}`}>{conv.subject || '(No subject)'}</p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0"><StatusBadge status={conv.status} /><ChannelIcon channel={conv.channel} />
          {conv.sla_breach_at && <span className={`text-[10px] flex items-center gap-0.5 ${slaColor(conv.sla_breach_at)}`}>{breached && <AlertTriangle size={9} />} SLA</span>}
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
          <input type="text" placeholder="Search conversations…" value={query} onChange={e => setQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" />
          {query && <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={12} /></button>}
        </div>
      </div>
      <div className="flex gap-0.5 px-3 py-2 bg-slate-50/80 border-b border-slate-100 overflow-x-auto">
        {FILTERS.map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${filter === f.value ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
            {f.label}<span className={`text-[10px] ${filter === f.value ? 'text-sky-600' : 'text-slate-400'}`}>{counts[f.value]}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <Inbox size={28} className="text-slate-300 mb-2" />
            <p className="text-sm text-slate-400">{query ? 'No matches' : 'No conversations'}</p>
          </div>
        ) : filtered.map(c => <ConversationRow key={c.id} conv={c} isActive={c.id === activeId} onClick={() => onSelect(c.id)} />)}
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

  if (isNote) return (
    <div className="flex justify-center my-1">
      <div className="max-w-lg bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
        <span className="font-semibold mr-1">🔒 Internal · {name}</span>{msg.message_body}
      </div>
    </div>
  )

  return (
    <div className={`flex items-end gap-2 ${isAgent ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isAgent ? 'bg-sky-600 text-white' : isBot ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
        {isAgent ? <User size={13} /> : isBot ? <Bot size={13} /> : <span className="text-xs font-semibold">{name[0]?.toUpperCase()}</span>}
      </div>
      <div className="max-w-sm lg:max-w-md xl:max-w-lg">
        <div className={`text-[10px] mb-1 text-slate-400 ${isAgent ? 'text-right' : 'text-left'}`}>{name} · {timeAgo(msg.created_at)}</div>
        <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${isAgent ? 'bg-sky-600 text-white rounded-br-sm' : isBot ? 'bg-violet-100 text-violet-900 border border-violet-200 rounded-bl-sm' : 'bg-white text-slate-800 border border-slate-200 shadow-sm rounded-bl-sm'}`}>{msg.message_body}</div>
      </div>
    </div>
  )
}

// ─── Visitor Info Panel ───────────────────────────────────────────────────────
function VisitorInfoPanel({ conv, currentPage }: { conv: Conversation; currentPage: string | null }) {
  const ext = conv as Conversation & { ip_address?: string }
  return (
    <div className="w-56 border-l border-slate-200 bg-white shrink-0 overflow-y-auto">
      <div className="px-4 py-3 border-b border-slate-100"><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Visitor</p></div>
      <div className="px-4 py-3 space-y-3">
        <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Name</p><p className="text-xs text-slate-800 font-medium">{conv.visitor_name}</p></div>
        {conv.visitor_email && <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Email</p><p className="text-xs text-slate-700 break-all">{conv.visitor_email}</p></div>}
        {ext.ip_address && <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">IP Address</p><p className="text-xs text-slate-700 font-mono">{ext.ip_address}</p></div>}
        {currentPage && (
          <div>
            <p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5 flex items-center gap-1"><Globe size={9} />Current Page</p>
            <a href={currentPage} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-600 hover:underline break-all">{currentPage}</a>
          </div>
        )}
        <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Channel</p><p className="text-xs text-slate-700 capitalize">{conv.channel}</p></div>
        <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Brand</p><p className="text-xs text-slate-700">{conv.brand_name}</p></div>
        {conv.sla_breach_at && <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">SLA</p><p className={`text-xs ${slaColor(conv.sla_breach_at)}`}>{new Date(conv.sla_breach_at).getTime() < Date.now() ? 'Breached' : `Due ${timeAgo(conv.sla_breach_at)}`}</p></div>}
      </div>
    </div>
  )
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────
function ChatPanel({ conv, messages, onSend, onStatusChange, onConvertToTicket, onAssign, agents, currentPage, socketConnected }: {
  conv: Conversation; messages: Message[]
  onSend: (body: string) => Promise<void>
  onStatusChange: (status: Status) => void
  onConvertToTicket: () => Promise<void>
  onAssign: (agentId: string | null) => Promise<void>
  agents: AgentRow[]
  currentPage: string | null
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
    setToast({ type, msg }); setTimeout(() => setToast(null), 5000)
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
    try { const improved = await api.rephraseText(body); setDraft(improved) }
    catch { showToast('error', 'AI rephrase unavailable') }
    finally { setRephrase(false); textareaRef.current?.focus() }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const url = await api.exportPdf(conv.id)
      if (url) { window.open(url, '_blank'); showToast('success', 'PDF export opened in new tab') }
    } catch (e) { showToast('error', (e as Error).message || 'Export unavailable') }
    finally { setExporting(false) }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const nextStatus: Partial<Record<Status, Status>> = { open: 'closed', pending: 'open', ai_handling: 'open', closed: 'open' }
  const statusActionLabel: Partial<Record<Status, string>> = { open: 'Close', pending: 'Reopen', ai_handling: 'Take over', closed: 'Reopen' }

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full bg-slate-50">
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-slate-900 truncate">{conv.subject || '(No subject)'}</h3>
            <StatusBadge status={conv.status} />
            <span title={socketConnected ? 'Real-time connected' : 'Reconnecting…'}>{socketConnected ? <Wifi size={11} className="text-emerald-400" /> : <WifiOff size={11} className="text-slate-300" />}</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="font-medium text-slate-600">{conv.visitor_name}</span>
            {conv.visitor_email && <><span>·</span><span>{conv.visitor_email}</span></>}
            <span>·</span><span className="capitalize">{conv.channel}</span>
            {conv.sla_breach_at && <span className={`flex items-center gap-0.5 ${slaColor(conv.sla_breach_at)}`}><Clock size={10} /> SLA {new Date(conv.sla_breach_at).getTime() < Date.now() ? 'breached' : timeAgo(conv.sla_breach_at)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {!conv.is_ticket && (
            <button onClick={onConvertToTicket} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 transition-all">
              <Tag size={12} />Convert to Ticket
            </button>
          )}
          {conv.is_ticket && (
            <span className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-md">
              <Tag size={10} />Ticket
            </span>
          )}
          <select
            value={conv.assigned_agent_id ?? ''}
            onChange={e => onAssign(e.target.value || null)}
            className="text-xs text-slate-600 bg-white border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 cursor-pointer"
          >
            <option value="">Unassigned</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {nextStatus[conv.status] && <button onClick={() => onStatusChange(nextStatus[conv.status]!)} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-all">{statusActionLabel[conv.status]}</button>}
          <button onClick={handleExport} disabled={exporting} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-all">{exporting ? <RefreshCw size={12} className="animate-spin" /> : <FileDown size={12} />}Export PDF</button>
          <button className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"><MoreHorizontal size={16} /></button>
        </div>
      </div>
      {toast && <div className={`mx-4 mt-3 p-3 rounded-lg text-xs flex items-center gap-2 ${toast.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>{toast.type === 'success' ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0" /> : <AlertTriangle size={14} className="text-red-500 shrink-0" />}<span>{toast.msg}</span></div>}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center"><MessageSquare size={32} className="text-slate-200 mb-2" /><p className="text-sm text-slate-400">No messages yet</p><p className="text-xs text-slate-300">Start the conversation below</p></div>
          ) : messages.map(m => <MessageBubble key={m.id} msg={m} visitorName={conv.visitor_name} />)}
          <div ref={bottomRef} />
        </div>
        <VisitorInfoPanel conv={conv} currentPage={currentPage} />
      </div>
      <div className="px-4 py-3 bg-white border-t border-slate-200 shrink-0">
        <div className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-500/20 transition-all">
          <textarea ref={textareaRef} rows={2} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={conv.status === 'closed' ? 'Conversation closed — reopen to reply' : 'Reply… (Enter to send, Shift+Enter for newline)'}
            className="flex-1 bg-transparent text-sm text-slate-700 placeholder-slate-400 resize-none focus:outline-none leading-relaxed" disabled={conv.status === 'closed'} />
          <div className="flex items-center gap-1.5 shrink-0 pb-0.5">
            <button onClick={handleRephrase} disabled={!draft.trim() || rephrasing || conv.status === 'closed'} title="AI rephrase" className="p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed">{rephrasing ? <RefreshCw size={14} className="animate-spin text-violet-500" /> : <Sparkles size={14} />}</button>
            <button onClick={handleSend} disabled={!draft.trim() || sending || conv.status === 'closed'} className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">{sending ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}Send</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyChat() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center bg-slate-50 p-8">
      <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-4"><MessageSquare size={24} className="text-slate-400" /></div>
      <h3 className="text-sm font-semibold text-slate-700 mb-1">Select a conversation</h3>
      <p className="text-xs text-slate-400 max-w-xs">Choose a conversation from the list to start replying</p>
    </div>
  )
}

// ─── Copy Snippet ─────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  return <button onClick={handle} className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-400 hover:text-slate-200 transition-colors rounded">{copied ? <><Check size={10} className="text-emerald-400" /> Copied</> : <><Copy size={10} /> Copy</>}</button>
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────
function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">{children}</div>
    </div>
  )
}

// ─── Add Brand Modal ──────────────────────────────────────────────────────────
function AddBrandModal({ onClose, onCreated }: { onClose: () => void; onCreated: (b: Brand) => void }) {
  const api = useApi()
  const [form, setForm] = useState({ name: '', website: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!form.name.trim()) { setError('Brand name is required'); return }
    setSaving(true); setError(null)
    try { const brand = await api.createBrand(form.name.trim(), form.website.trim(), form.email.trim()); onCreated(brand) }
    catch (err) { setError((err as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between mb-5"><h2 className="text-base font-semibold text-slate-900">Add Brand</h2><button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-center gap-2"><AlertTriangle size={12} className="shrink-0" /> {error}</div>}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Brand Name *</label><input type="text" value={form.name} onChange={set('name')} required placeholder="Acme Help Center" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
        <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Website URL</label><input type="url" value={form.website} onChange={set('website')} placeholder="https://acme.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
        <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Support Email</label><input type="email" value={form.email} onChange={set('email')} placeholder="support@acme.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-1.5">{saving ? <><RefreshCw size={11} className="animate-spin" /> Creating…</> : <><Plus size={11} /> Create Brand</>}</button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Edit Brand Modal ─────────────────────────────────────────────────────────
function EditBrandModal({ brand, onClose, onSaved }: { brand: Brand; onClose: () => void; onSaved: (b: Brand) => void }) {
  const api = useApi()
  const cfg = brand.widget_config_json ?? {}
  const [form, setForm] = useState({ name: brand.brand_name, website: cfg.website_url ?? '', email: cfg.support_email ?? '', color: cfg.color ?? '#0ea5e9' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!form.name.trim()) { setError('Brand name is required'); return }
    setSaving(true); setError(null)
    try {
      const updated = await api.editBrand(brand.id, { brand_name: form.name.trim(), website_url: form.website.trim(), support_email: form.email.trim(), color: form.color })
      onSaved({ ...brand, ...updated, widget_config_json: { website_url: form.website.trim(), support_email: form.email.trim(), color: form.color } })
    }
    catch (err) { setError((err as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between mb-5"><h2 className="text-base font-semibold text-slate-900">Edit Brand</h2><button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-center gap-2"><AlertTriangle size={12} className="shrink-0" /> {error}</div>}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Brand Name *</label><input type="text" value={form.name} onChange={set('name')} required className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
        <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Website URL</label><input type="url" value={form.website} onChange={set('website')} placeholder="https://acme.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
        <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Support Email</label><input type="email" value={form.email} onChange={set('email')} placeholder="support@acme.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Widget Color</label>
          <div className="flex items-center gap-3"><input type="color" value={form.color} onChange={set('color')} className="w-10 h-9 rounded border border-slate-200 cursor-pointer" /><span className="text-xs text-slate-500">{form.color}</span></div>
        </div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-1.5">{saving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : 'Save Changes'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Brands Section ───────────────────────────────────────────────────────────
function BrandsSection() {
  const api = useApi()
  const [brands, setBrands]           = useState<Brand[]>([])
  const [loading, setLoading]         = useState(true)
  const [showAdd, setShowAdd]         = useState(false)
  const [editBrand, setEditBrand]     = useState<Brand | null>(null)
  const [deleteBrand, setDeleteBrand] = useState<Brand | null>(null)
  const [deleting, setDeleting]       = useState(false)
  const [delError, setDelError]       = useState<string | null>(null)
  const origin = window.location.origin

  useEffect(() => {
    api.listBrands().then(list => { setBrands(list); setLoading(false) }).catch(() => setLoading(false))
  }, []) // eslint-disable-line

  const handleBrandCreated = (b: Brand) => { setBrands(prev => [...prev, b]); setShowAdd(false) }
  const handleBrandSaved   = (b: Brand) => { setBrands(prev => prev.map(x => x.id === b.id ? b : x)); setEditBrand(null) }

  const handleDelete = async () => {
    if (!deleteBrand) return
    setDeleting(true); setDelError(null)
    try { await api.deleteBrand(deleteBrand.id); setBrands(prev => prev.filter(x => x.id !== deleteBrand.id)); setDeleteBrand(null) }
    catch (e) { setDelError((e as Error).message) }
    finally { setDeleting(false) }
  }

  return (
    <>
      {showAdd    && <AddBrandModal onClose={() => setShowAdd(false)} onCreated={handleBrandCreated} />}
      {editBrand  && <EditBrandModal brand={editBrand} onClose={() => setEditBrand(null)} onSaved={handleBrandSaved} />}
      {deleteBrand && (
        <Modal onClose={() => { setDeleteBrand(null); setDelError(null) }}>
          <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center"><Trash2 size={18} className="text-red-600" /></div><div><p className="text-sm font-semibold text-slate-900">Delete Brand</p><p className="text-xs text-slate-500">This cannot be undone</p></div></div>
          <p className="text-sm text-slate-600 mb-4">Are you sure you want to delete <span className="font-semibold">{deleteBrand.brand_name}</span>? All widget sessions and conversations under this brand will be removed.</p>
          {delError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{delError}</div>}
          <div className="flex gap-2">
            <button onClick={() => { setDeleteBrand(null); setDelError(null) }} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={handleDelete} disabled={deleting} className="flex-1 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-1.5">{deleting ? <><RefreshCw size={11} className="animate-spin" /> Deleting…</> : <><Trash2 size={11} /> Delete</>}</button>
          </div>
        </Modal>
      )}

      <div className="flex-1 overflow-auto p-6 bg-slate-50">
        <div className="max-w-2xl">
          <div className="flex items-center justify-between mb-6">
            <div><h2 className="text-base font-semibold text-slate-900">Brands</h2><p className="text-xs text-slate-500 mt-0.5">Manage branded help centers and embed your widget</p></div>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-md hover:bg-sky-700 transition-colors"><Plus size={13} /> Add Brand</button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-slate-400 text-sm"><RefreshCw size={16} className="animate-spin" /> Loading…</div>
          ) : brands.length === 0 ? (
            <div className="text-center py-12 text-slate-400"><Building2 size={32} className="mx-auto mb-3 text-slate-300" /><p className="text-sm">No brands yet</p></div>
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
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: b.widget_config_json?.color ?? '#0ea5e9' }}>{b.brand_name[0]}</div>
                            <span className="text-sm font-semibold text-slate-800">{b.brand_name}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500 ml-10">
                            {b.widget_config_json?.website_url && <span className="flex items-center gap-1"><Globe size={10} />{b.widget_config_json.website_url}</span>}
                            {b.widget_config_json?.support_email && <span className="flex items-center gap-1"><Mail size={10} />{b.widget_config_json.support_email}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {b.widget_config_json && <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold px-2 py-0.5 rounded">Widget active</span>}
                          <button onClick={() => setEditBrand(b)} className="text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-md px-2.5 py-1 hover:bg-slate-50 transition-colors flex items-center gap-1"><Pencil size={10} /> Edit</button>
                          <button onClick={() => setDeleteBrand(b)} className="text-xs text-red-500 hover:text-red-700 border border-red-100 rounded-md px-2.5 py-1 hover:bg-red-50 transition-colors flex items-center gap-1"><Trash2 size={10} /> Delete</button>
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-slate-100 bg-slate-950">
                      <div className="flex items-center justify-between px-4 pt-2.5 pb-1"><span className="text-[10px] text-slate-500 font-medium tracking-wide uppercase">Widget embed</span><CopyButton text={snippet} /></div>
                      <pre className="px-4 pb-3 text-[11px] text-sky-300 overflow-x-auto leading-relaxed">{snippet}</pre>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="mt-6 p-4 bg-violet-50 border border-violet-200 rounded-xl flex items-center justify-between">
            <div><p className="text-sm font-medium text-violet-900">Test the widget live</p><p className="text-xs text-violet-600 mt-0.5">Open the demo page to see the chat bubble in action</p></div>
            <a href="/api/widget/demo" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-700 bg-violet-100 border border-violet-300 rounded-md hover:bg-violet-200 transition-colors"><Globe size={12} /> Open demo</a>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Billing Section ──────────────────────────────────────────────────────────
function BillingSection() {
  const api = useApi()
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [form, setForm] = useState({ plan: 'Pro', size: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  const PLANS = [
    { id: 'Starter', price: '$49/mo', features: ['3 agents', '500 conversations/mo', '1 brand', 'Email support'] },
    { id: 'Pro',     price: '$149/mo', features: ['10 agents', '5,000 conversations/mo', '5 brands', 'AI auto-reply', 'Priority support'] },
    { id: 'Enterprise', price: 'Custom', features: ['Unlimited agents', 'Unlimited conversations', 'Unlimited brands', 'Custom AI training', 'Dedicated CSM'] },
  ]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setSubmitting(true)
    try { await api.createUpgradeRequest(form.plan, form.size, form.notes); setSubmitted(true) }
    catch (err) { setError((err as Error).message) }
    finally { setSubmitting(false) }
  }

  return (
    <>
      {showUpgrade && (
        <Modal onClose={() => { setShowUpgrade(false); setSubmitted(false); setError(null) }}>
          <div className="flex items-center justify-between mb-5"><h2 className="text-base font-semibold text-slate-900">Upgrade / Contact Sales</h2><button onClick={() => { setShowUpgrade(false); setSubmitted(false); setError(null) }} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
          {submitted ? (
            <div className="text-center py-6">
              <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-3" />
              <p className="text-sm font-semibold text-slate-800 mb-1">Request received!</p>
              <p className="text-xs text-slate-500">Our sales team will reach out within 1 business day.</p>
              <button onClick={() => { setShowUpgrade(false); setSubmitted(false) }} className="mt-4 px-4 py-2 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 transition-colors">Done</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Requested Plan</label>
                <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400">
                  {PLANS.map(p => <option key={p.id}>{p.id}</option>)}
                </select>
              </div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Company Size</label><input type="text" value={form.size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))} placeholder="e.g. 50 employees" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Notes (optional)</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Any specific requirements or questions?" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 resize-none" /></div>
              {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{error}</div>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowUpgrade(false)} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{submitting ? <><RefreshCw size={11} className="animate-spin" /> Sending…</> : <><SendIcon size={11} /> Send Request</>}</button>
              </div>
            </form>
          )}
        </Modal>
      )}

      <div className="flex-1 overflow-auto p-6 bg-slate-50">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold text-slate-900 mb-1">Billing & Plans</h2>
          <p className="text-xs text-slate-500 mb-6">Choose the plan that fits your team</p>
          <div className="grid gap-4 mb-6">
            {PLANS.map(p => (
              <div key={p.id} className={`bg-white border rounded-xl p-5 flex items-start justify-between ${p.id === 'Pro' ? 'border-sky-300 ring-1 ring-sky-200' : 'border-slate-200'}`}>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-slate-900">{p.id}</p>
                    {p.id === 'Pro' && <span className="text-[10px] font-bold bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded uppercase tracking-wide">Most popular</span>}
                  </div>
                  <p className="text-lg font-bold text-slate-800 mb-2">{p.price}</p>
                  <ul className="space-y-1">
                    {p.features.map(f => <li key={f} className="flex items-center gap-1.5 text-xs text-slate-600"><CheckCircle2 size={11} className="text-emerald-500 shrink-0" />{f}</li>)}
                  </ul>
                </div>
                <button onClick={() => { setForm(x => ({ ...x, plan: p.id })); setShowUpgrade(true) }} className={`ml-4 shrink-0 px-4 py-2 text-xs font-medium rounded-lg transition-colors ${p.id === 'Pro' ? 'bg-sky-600 text-white hover:bg-sky-700' : 'border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                  {p.id === 'Enterprise' ? 'Contact Sales' : 'Upgrade'}
                </button>
              </div>
            ))}
          </div>
          <div className="bg-slate-100 rounded-xl p-4 text-xs text-slate-500">
            <p className="font-medium text-slate-700 mb-1">How it works</p>
            <p>Submit your upgrade request and our sales team will contact you within 1 business day to set up your plan and issue an invoice.</p>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Settings Section ─────────────────────────────────────────────────────────
function SettingsSection() {
  const api = useApi()
  const { agent } = useAuth() as { agent: { name: string; email: string; role: string } | null }
  const [panel, setPanel] = useState<'profile' | 'workspace' | 'smtp' | null>(null)

  const [profileForm, setProfile] = useState({ name: agent?.name ?? '', password: '', confirm: '' })
  const [profileSaving, setPS] = useState(false)
  const [profileMsg, setPMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [wsForm, setWs] = useState({ company_name: '', default_timezone: 'UTC', ai_auto_reply_enabled: false, custom_domain: '' })
  const [wsSaving, setWS] = useState(false)
  const [wsMsg, setWsMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [smtpForm, setSmtp] = useState({ host: '', port: '587', user: '', pass: '', from_email: '', enabled: false })
  const [smtpSaving, setSmtpSaving] = useState(false)
  const [smtpMsg, setSmtpMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault(); setPMsg(null)
    if (profileForm.password && profileForm.password !== profileForm.confirm) { setPMsg({ ok: false, text: 'Passwords do not match' }); return }
    setPS(true)
    try {
      await api.updateProfile(profileForm.name.trim() || undefined, profileForm.password || undefined)
      setPMsg({ ok: true, text: 'Profile updated! Re-login to see name changes.' })
      setProfile(f => ({ ...f, password: '', confirm: '' }))
    } catch (err) { setPMsg({ ok: false, text: (err as Error).message }) }
    finally { setPS(false) }
  }

  const handleWsSave = async (e: React.FormEvent) => {
    e.preventDefault(); setWsMsg(null); setWS(true)
    try {
      await api.updateWorkspace({
        company_name: wsForm.company_name || undefined,
        default_timezone: wsForm.default_timezone,
        ai_auto_reply_enabled: wsForm.ai_auto_reply_enabled,
        custom_domain: wsForm.custom_domain || undefined,
      })
      setWsMsg({ ok: true, text: 'Workspace settings saved.' })
    }
    catch (err) { setWsMsg({ ok: false, text: (err as Error).message }) }
    finally { setWS(false) }
  }

  const handleSmtpSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSmtpMsg(null); setSmtpSaving(true)
    try {
      await api.updateWorkspace({
        smtp_config_json: {
          host: smtpForm.host.trim(),
          port: parseInt(smtpForm.port, 10) || 587,
          user: smtpForm.user.trim(),
          pass: smtpForm.pass,
          from_email: smtpForm.from_email.trim(),
          enabled: smtpForm.enabled,
        }
      })
      setSmtpMsg({ ok: true, text: 'SMTP configuration saved. Status-change emails will now use these settings.' })
    }
    catch (err) { setSmtpMsg({ ok: false, text: (err as Error).message }) }
    finally { setSmtpSaving(false) }
  }

  const panels: { key: 'profile' | 'workspace' | 'smtp'; label: string; desc: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { key: 'profile',   label: 'Profile',            desc: 'Update your name and password',                     icon: <User size={14} /> },
    { key: 'workspace', label: 'Workspace Settings', desc: 'Company name, timezone, custom domain, AI reply',  icon: <Building size={14} />, adminOnly: true },
    { key: 'smtp',      label: 'SMTP / Email Config',desc: 'Send ticket alerts via your own mail server',       icon: <Mail size={14} />, adminOnly: true },
  ]

  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-2xl">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Settings</h2>
        <p className="text-xs text-slate-500 mb-6">Workspace and account preferences</p>
        <div className="space-y-3">
          {panels.filter(p => !p.adminOnly || agent?.role === 'admin').map(item => (
            <div key={item.key}>
              <button onClick={() => setPanel(prev => prev === item.key ? null : item.key)}
                className="w-full flex items-center justify-between bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors text-left">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-600">{item.icon}</div>
                  <div><p className="text-sm font-medium text-slate-800">{item.label}</p><p className="text-xs text-slate-400">{item.desc}</p></div>
                </div>
                <ChevronRight size={14} className={`text-slate-400 transition-transform ${panel === item.key ? 'rotate-90' : ''}`} />
              </button>

              {panel === 'profile' && item.key === 'profile' && (
                <div className="mt-2 p-5 bg-white border border-slate-200 rounded-xl">
                  {profileMsg && <div className={`mb-3 p-2 rounded text-xs ${profileMsg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>{profileMsg.text}</div>}
                  <form onSubmit={handleProfileSave} className="space-y-3">
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Display Name</label><input type="text" value={profileForm.name} onChange={e => setProfile(f => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">New Password <span className="text-slate-400 font-normal">(leave blank to keep current)</span></label><input type="password" value={profileForm.password} onChange={e => setProfile(f => ({ ...f, password: e.target.value }))} placeholder="Min 8 characters" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                    {profileForm.password && <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Confirm Password</label><input type="password" value={profileForm.confirm} onChange={e => setProfile(f => ({ ...f, confirm: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>}
                    <button type="submit" disabled={profileSaving} className="px-4 py-2 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5">{profileSaving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : 'Save Profile'}</button>
                  </form>
                </div>
              )}

              {panel === 'workspace' && item.key === 'workspace' && (
                <div className="mt-2 p-5 bg-white border border-slate-200 rounded-xl">
                  {wsMsg && <div className={`mb-3 p-2 rounded text-xs ${wsMsg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>{wsMsg.text}</div>}
                  <form onSubmit={handleWsSave} className="space-y-3">
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Company Name</label><input type="text" value={wsForm.company_name} onChange={e => setWs(f => ({ ...f, company_name: e.target.value }))} placeholder="Acme Inc." className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Custom Domain <span className="text-slate-400 font-normal">(e.g. support.acme.com)</span></label><input type="text" value={wsForm.custom_domain} onChange={e => setWs(f => ({ ...f, custom_domain: e.target.value }))} placeholder="support.acme.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">Default Timezone</label>
                      <select value={wsForm.default_timezone} onChange={e => setWs(f => ({ ...f, default_timezone: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400">
                        {['UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Singapore'].map(tz => <option key={tz}>{tz}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div><p className="text-xs font-medium text-slate-700">AI Auto-Reply</p><p className="text-[11px] text-slate-400">Automatically reply to new conversations with AI</p></div>
                      <button type="button" onClick={() => setWs(f => ({ ...f, ai_auto_reply_enabled: !f.ai_auto_reply_enabled }))} className={`${wsForm.ai_auto_reply_enabled ? 'text-sky-500' : 'text-slate-400'} transition-colors`}>{wsForm.ai_auto_reply_enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}</button>
                    </div>
                    <button type="submit" disabled={wsSaving} className="px-4 py-2 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5">{wsSaving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : 'Save Settings'}</button>
                  </form>
                </div>
              )}

              {panel === 'smtp' && item.key === 'smtp' && (
                <div className="mt-2 p-5 bg-white border border-slate-200 rounded-xl">
                  <p className="text-xs text-slate-500 mb-4">Configure your outbound SMTP server. OmniCore will use these credentials to send ticket status-change alerts to visitors.</p>
                  {smtpMsg && <div className={`mb-3 p-2 rounded text-xs ${smtpMsg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>{smtpMsg.text}</div>}
                  <form onSubmit={handleSmtpSave} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="block text-xs font-medium text-slate-600 mb-1.5">SMTP Host</label><input type="text" value={smtpForm.host} onChange={e => setSmtp(f => ({ ...f, host: e.target.value }))} placeholder="smtp.sendgrid.net" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                      <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Port</label><input type="number" value={smtpForm.port} onChange={e => setSmtp(f => ({ ...f, port: e.target.value }))} placeholder="587" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                    </div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">SMTP Username</label><input type="text" value={smtpForm.user} onChange={e => setSmtp(f => ({ ...f, user: e.target.value }))} placeholder="apikey or your@email.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">SMTP Password / API Key</label><input type="password" value={smtpForm.pass} onChange={e => setSmtp(f => ({ ...f, pass: e.target.value }))} placeholder="••••••••••••" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">From Email</label><input type="email" value={smtpForm.from_email} onChange={e => setSmtp(f => ({ ...f, from_email: e.target.value }))} placeholder="support@acme.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div><p className="text-xs font-medium text-slate-700">Enable SMTP Alerts</p><p className="text-[11px] text-slate-400">Send email on ticket status changes</p></div>
                      <button type="button" onClick={() => setSmtp(f => ({ ...f, enabled: !f.enabled }))} className={`${smtpForm.enabled ? 'text-sky-500' : 'text-slate-400'} transition-colors`}>{smtpForm.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}</button>
                    </div>
                    <button type="submit" disabled={smtpSaving} className="px-4 py-2 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5">{smtpSaving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : 'Save SMTP Config'}</button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Team Section ─────────────────────────────────────────────────────────────
function TeamSection() {
  const api = useApi()
  const { agent: me } = useAuth() as { agent: { id: string } | null }
  const [agents, setAgents]       = useState<AgentRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'agent' })
  const [inviting, setInviting]   = useState(false)
  const [inviteErr, setInviteErr] = useState<string | null>(null)
  const [removing, setRemoving]   = useState<string | null>(null)

  useEffect(() => {
    api.listAgents().then(list => { setAgents(list); setLoading(false) }).catch(() => setLoading(false))
  }, []) // eslint-disable-line

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault(); setInviteErr(null); setInviting(true)
    try {
      const a = await api.inviteAgent(inviteForm.name, inviteForm.email, inviteForm.role)
      setAgents(prev => [...prev, a]); setShowInvite(false); setInviteForm({ name: '', email: '', role: 'agent' })
    } catch (err) { setInviteErr((err as Error).message) }
    finally { setInviting(false) }
  }

  const handleRemove = async (id: string) => {
    if (!window.confirm('Remove this agent? They will lose access immediately.')) return
    setRemoving(id)
    try { await api.removeAgent(id); setAgents(prev => prev.filter(a => a.id !== id)) }
    catch { /* ignore */ }
    finally { setRemoving(null) }
  }

  return (
    <>
      {showInvite && (
        <Modal onClose={() => { setShowInvite(false); setInviteErr(null) }}>
          <div className="flex items-center justify-between mb-5"><h2 className="text-base font-semibold text-slate-900">Invite Agent</h2><button onClick={() => { setShowInvite(false); setInviteErr(null) }} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
          {inviteErr && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{inviteErr}</div>}
          <form onSubmit={handleInvite} className="space-y-3">
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Name *</label><input type="text" value={inviteForm.name} onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} required className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Email *</label><input type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} required className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Role</label>
              <select value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400">
                <option value="agent">Agent</option><option value="admin">Admin</option>
              </select>
            </div>
            <p className="text-[11px] text-slate-400">A temporary password of <code className="bg-slate-100 px-1 rounded">Welcome1!</code> will be set. Ask the agent to change it on first login.</p>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowInvite(false)} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={inviting} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{inviting ? <><RefreshCw size={11} className="animate-spin" /> Inviting…</> : <><UserPlus size={11} /> Invite</>}</button>
            </div>
          </form>
        </Modal>
      )}

      <div className="flex-1 overflow-auto p-6 bg-slate-50">
        <div className="max-w-2xl">
          <div className="flex items-center justify-between mb-6">
            <div><h2 className="text-base font-semibold text-slate-900">Team</h2><p className="text-xs text-slate-500 mt-0.5">Manage agents and their access</p></div>
            <button onClick={() => setShowInvite(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-md hover:bg-sky-700 transition-colors"><UserPlus size={13} /> Invite Agent</button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-slate-400 text-sm"><RefreshCw size={16} className="animate-spin" /> Loading…</div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {agents.length === 0 ? (
                <div className="text-center py-12 text-slate-400"><Users size={28} className="mx-auto mb-2 text-slate-300" /><p className="text-sm">No agents yet</p></div>
              ) : agents.map((a, i) => (
                <div key={a.id} className={`flex items-center justify-between px-4 py-3 ${i < agents.length - 1 ? 'border-b border-slate-100' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-sky-600 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">{a.name[0]?.toUpperCase()}</div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{a.name} {a.id === me?.id && <span className="text-[10px] text-sky-600 font-semibold">(you)</span>}</p>
                      <p className="text-xs text-slate-400">{a.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide ${a.role === 'admin' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>{a.role}</span>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${a.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{a.is_active ? 'Active' : 'Inactive'}</span>
                    {a.id !== me?.id && (
                      <button onClick={() => handleRemove(a.id)} disabled={removing === a.id} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-40">
                        {removing === a.id ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Super Admin Section ──────────────────────────────────────────────────────
function SuperAdminSection() {
  const api = useApi()
  const [tenants, setTenants]       = useState<SANTenant[]>([])
  const [requests, setRequests]     = useState<UpgradeRequest[]>([])
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState<'tenants' | 'requests'>('tenants')
  const [actionTenant, setAction]   = useState<SANTenant | null>(null)
  const [purgeTarget, setPurge]     = useState<SANTenant | null>(null)
  const [purgeConfirm, setPConf]    = useState('')
  const [purging, setPurging]       = useState(false)
  const [purgeErr, setPurgeErr]     = useState<string | null>(null)
  const [billingTarget, setBilling] = useState<SANTenant | null>(null)
  const [billingForm, setBForm]     = useState({ plan: 'free', subscription_status: 'active' })
  const [saving, setSaving]         = useState(false)
  const [limitsTarget, setLimits]   = useState<SANTenant | null>(null)
  const [limitsForm, setLimitsForm] = useState({ max_brands_allowed: 3 })
  const [limitsSaving, setLSaving]  = useState(false)
  const [limitsErr, setLimitsErr]   = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.listSANTenants(), api.listUpgradeRequests()])
      .then(([t, r]) => { setTenants(t); setRequests(r) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line

  const toggleStatus = async (t: SANTenant) => {
    const next = t.account_status === 'active' ? 'suspended' : 'active'
    try { await api.patchTenantStatus(t.id, next); setTenants(prev => prev.map(x => x.id === t.id ? { ...x, account_status: next } : x)) }
    catch { /* ignore */ }
    setAction(null)
  }

  const handleBillingSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!billingTarget) return
    setSaving(true)
    try { await api.patchTenantBilling(billingTarget.id, billingForm.plan, billingForm.subscription_status); setTenants(prev => prev.map(x => x.id === billingTarget.id ? { ...x, plan: billingForm.plan, subscription_status: billingForm.subscription_status } : x)); setBilling(null) }
    catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const handleLimitsSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!limitsTarget) return
    setLimitsErr(null); setLSaving(true)
    try {
      await api.patchTenantLimits(limitsTarget.id, limitsForm.max_brands_allowed)
      setTenants(prev => prev.map(x => x.id === limitsTarget.id ? { ...x, max_brands_allowed: limitsForm.max_brands_allowed } : x))
      setLimits(null)
    }
    catch (err) { setLimitsErr((err as Error).message) }
    finally { setLSaving(false) }
  }

  const handlePurge = async () => {
    if (!purgeTarget) return
    setPurgeErr(null); setPurging(true)
    try { await api.purgeTenant(purgeTarget.id, purgeConfirm); setTenants(prev => prev.filter(x => x.id !== purgeTarget.id)); setPurge(null); setPConf('') }
    catch (e) { setPurgeErr((e as Error).message) }
    finally { setPurging(false) }
  }

  const statusColor = (s: string) => s === 'active' ? 'bg-emerald-50 text-emerald-700' : s === 'suspended' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'

  return (
    <>
      {limitsTarget && (
        <Modal onClose={() => { setLimits(null); setLimitsErr(null) }}>
          <div className="flex items-center justify-between mb-5"><h2 className="text-sm font-semibold text-slate-900">Brand Limits — {limitsTarget.company_name}</h2><button onClick={() => setLimits(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
          <form onSubmit={handleLimitsSave} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Max Brands Allowed</label>
              <input type="number" min={1} max={1000} value={limitsForm.max_brands_allowed} onChange={e => setLimitsForm({ max_brands_allowed: parseInt(e.target.value, 10) || 1 })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" />
              <p className="mt-1 text-[11px] text-slate-400">Controls how many brands this tenant can create. Starter=1, Pro=5, Enterprise=unlimited.</p>
            </div>
            {limitsErr && <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{limitsErr}</div>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setLimits(null)} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={limitsSaving} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{limitsSaving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {billingTarget && (
        <Modal onClose={() => setBilling(null)}>
          <div className="flex items-center justify-between mb-5"><h2 className="text-sm font-semibold text-slate-900">Manage Billing — {billingTarget.company_name}</h2><button onClick={() => setBilling(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
          <form onSubmit={handleBillingSave} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Plan</label>
              <select value={billingForm.plan} onChange={e => setBForm(f => ({ ...f, plan: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none">
                {['free', 'starter', 'pro', 'enterprise'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Subscription Status</label>
              <select value={billingForm.subscription_status} onChange={e => setBForm(f => ({ ...f, subscription_status: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none">
                {['active', 'trialing', 'past_due', 'cancelled', 'paused', 'revoked'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setBilling(null)} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{saving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {purgeTarget && (
        <Modal onClose={() => { setPurge(null); setPConf(''); setPurgeErr(null) }}>
          <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center"><Trash2 size={18} className="text-red-600" /></div><div><p className="text-sm font-semibold text-slate-900">Purge Tenant</p><p className="text-xs text-red-500">This permanently deletes all data</p></div></div>
          <p className="text-xs text-slate-600 mb-3">Type the tenant company name to confirm: <span className="font-semibold">{purgeTarget.company_name}</span></p>
          <input type="text" value={purgeConfirm} onChange={e => setPConf(e.target.value)} placeholder={purgeTarget.company_name} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 mb-3" />
          {purgeErr && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{purgeErr}</div>}
          <div className="flex gap-2">
            <button onClick={() => { setPurge(null); setPConf(''); setPurgeErr(null) }} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={handlePurge} disabled={purgeConfirm !== purgeTarget.company_name || purging} className="flex-1 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-lg flex items-center justify-center gap-1.5">{purging ? <><RefreshCw size={11} className="animate-spin" /> Purging…</> : 'Confirm Purge'}</button>
          </div>
        </Modal>
      )}

      <div className="flex-1 overflow-auto p-6 bg-slate-50">
        <div className="max-w-4xl">
          <div className="flex items-center gap-2 mb-1">
            <Shield size={16} className="text-red-500" />
            <h2 className="text-base font-semibold text-slate-900">Super Admin Panel</h2>
            <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded uppercase tracking-wide">God View</span>
          </div>
          <p className="text-xs text-slate-500 mb-5">Full control over all tenants and billing</p>

          <div className="flex gap-1 mb-5 bg-slate-100 p-1 rounded-lg w-fit">
            {(['tenants', 'requests'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{t === 'tenants' ? `Tenants (${tenants.length})` : `Upgrade Requests (${requests.length})`}</button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-slate-400 text-sm"><RefreshCw size={16} className="animate-spin" /> Loading…</div>
          ) : tab === 'tenants' ? (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-slate-100 bg-slate-50">{['Company', 'Plan', 'Billing', 'Account', 'Agents', 'Brand Limit', 'Created', 'Actions'].map(h => <th key={h} className="text-left px-4 py-2.5 text-slate-500 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {tenants.map((t, i) => (
                    <tr key={t.id} className={`border-b border-slate-50 hover:bg-slate-50/50 ${i === tenants.length - 1 ? 'border-0' : ''}`}>
                      <td className="px-4 py-3 font-medium text-slate-800">{t.company_name}</td>
                      <td className="px-4 py-3 text-slate-600 capitalize">{t.plan || 'free'}</td>
                      <td className="px-4 py-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusColor(t.subscription_status)}`}>{t.subscription_status}</span></td>
                      <td className="px-4 py-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusColor(t.account_status)}`}>{t.account_status}</span></td>
                      <td className="px-4 py-3 text-slate-600">{t.agent_count}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => { setLimits(t); setLimitsForm({ max_brands_allowed: t.max_brands_allowed ?? 3 }); setLimitsErr(null) }} className="flex items-center gap-1 text-slate-600 hover:text-sky-600 transition-colors" title="Edit brand limit">
                          <span className="font-semibold">{t.max_brands_allowed ?? 3}</span>
                          <Pencil size={10} className="text-slate-400" />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{new Date(t.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => toggleStatus(t)} title={t.account_status === 'active' ? 'Suspend' : 'Activate'} className={`p-1.5 rounded hover:bg-slate-100 transition-colors ${t.account_status === 'active' ? 'text-amber-500' : 'text-emerald-500'}`}>{t.account_status === 'active' ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}</button>
                          <button onClick={() => { setBilling(t); setBForm({ plan: t.plan || 'free', subscription_status: t.subscription_status || 'active' }) }} title="Manage Billing" className="p-1.5 rounded hover:bg-slate-100 text-slate-500 transition-colors"><CreditCard size={14} /></button>
                          <button onClick={() => setPurge(t)} title="Purge Data" className="p-1.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tenants.length === 0 && <div className="text-center py-8 text-slate-400"><p className="text-sm">No tenants</p></div>}
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-slate-100 bg-slate-50">{['Company', 'Agent', 'Plan', 'Size', 'Notes', 'Status', 'Date'].map(h => <th key={h} className="text-left px-4 py-2.5 text-slate-500 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {requests.map((r, i) => (
                    <tr key={r.id} className={`border-b border-slate-50 hover:bg-slate-50/50 ${i === requests.length - 1 ? 'border-0' : ''}`}>
                      <td className="px-4 py-3 font-medium text-slate-800">{r.company_name}</td>
                      <td className="px-4 py-3 text-slate-600">{r.agent_name}<br /><span className="text-slate-400">{r.agent_email}</span></td>
                      <td className="px-4 py-3"><span className="bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded font-semibold">{r.requested_plan}</span></td>
                      <td className="px-4 py-3 text-slate-500">{r.company_size || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{r.notes || '—'}</td>
                      <td className="px-4 py-3"><span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize">{r.status}</span></td>
                      <td className="px-4 py-3 text-slate-400">{new Date(r.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {requests.length === 0 && <div className="text-center py-8 text-slate-400"><p className="text-sm">No upgrade requests</p></div>}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ active, onNavigate, unread, agent, onLogout }: {
  active: Section; onNavigate: (s: Section) => void; unread: number
  agent: { name: string; email: string; role: string; isSuperAdmin?: boolean } | null; onLogout: () => void
}) {
  const isAdmin = agent?.role === 'admin'
  const isSA    = agent?.isSuperAdmin

  const NAV: { section: Section; icon: React.ReactNode; label: string; adminOnly?: boolean; superAdminOnly?: boolean }[] = [
    { section: 'conversations', icon: <MessageSquare size={17} />, label: 'Conversations' },
    { section: 'tickets',       icon: <Tag size={17} />,           label: 'Tickets' },
    { section: 'brands',        icon: <Building2 size={17} />,    label: 'Brands',   adminOnly: true },
    { section: 'team',          icon: <Users size={17} />,        label: 'Team',     adminOnly: true },
    { section: 'billing',       icon: <CreditCard size={17} />,  label: 'Billing',  adminOnly: true },
    { section: 'settings',      icon: <Settings size={17} />,    label: 'Settings' },
    { section: 'superadmin',    icon: <Shield size={17} />,      label: 'Super Admin', superAdminOnly: true },
  ]

  const visible = NAV.filter(n => {
    if (n.superAdminOnly) return isSA
    if (n.adminOnly)      return isAdmin
    return true
  })

  return (
    <nav className="flex flex-col w-56 bg-slate-900 h-full shrink-0">
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5"><OmniLogo size="sm" /><div><p className="text-xs font-bold text-white tracking-wide">OmniCore</p><p className="text-[10px] text-slate-500">Atelier</p></div></div>
      </div>
      <div className="flex-1 px-2 py-3 space-y-0.5">
        {visible.map(n => {
          const isActive = n.section === active
          return (
            <button key={n.section} onClick={() => onNavigate(n.section)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive ? (n.section === 'superadmin' ? 'bg-red-600 text-white shadow-md' : 'bg-sky-600 text-white shadow-md') : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'}`}>
              {n.icon}
              <span>{n.label}</span>
              {n.section === 'conversations' && unread > 0 && <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{unread}</span>}
            </button>
          )
        })}
      </div>
      <div className="px-3 py-3 border-t border-slate-800">
        {isSA && <div className="px-2 py-1 mb-1"><span className="text-[10px] font-semibold text-red-400 bg-red-500/10 px-2 py-0.5 rounded uppercase tracking-wide">Super Admin</span></div>}
        {isAdmin && !isSA && <div className="px-2 py-1 mb-1"><span className="text-[10px] font-semibold text-sky-500 bg-sky-500/10 px-2 py-0.5 rounded uppercase tracking-wide">Admin</span></div>}
        <button onClick={onLogout} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors group">
          <div className="w-7 h-7 bg-sky-600 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">{agent?.name?.[0]?.toUpperCase() ?? 'A'}</div>
          <div className="flex-1 min-w-0 text-left"><p className="text-xs font-medium text-slate-200 truncate">{agent?.name ?? 'Agent'}</p><p className="text-[10px] text-slate-500 truncate">{agent?.email ?? ''}</p></div>
          <LogOut size={13} className="text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
        </button>
      </div>
    </nav>
  )
}

// ─── Toast Notification Types ─────────────────────────────────────────────────
interface InboxToast {
  id: string
  convId: string
  visitorName: string
  preview: string
  createdAt: number
}

// ─── Toast Notification Stack ─────────────────────────────────────────────────
function ToastStack({ toasts, onDismiss, onOpen }: {
  toasts: InboxToast[]
  onDismiss: (id: string) => void
  onOpen: (convId: string) => void
}) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 320 }}>
      {toasts.map(t => (
        <div key={t.id}
          className="pointer-events-auto flex items-start gap-3 bg-slate-900 border border-slate-700 shadow-2xl rounded-xl px-4 py-3 animate-in slide-in-from-right-4"
          style={{ animation: 'slideInRight 0.2s ease-out' }}
        >
          <div className="w-8 h-8 rounded-full bg-sky-600 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">
            {t.visitorName[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-100 truncate">{t.visitorName}</p>
            <p className="text-xs text-slate-400 truncate mt-0.5">{t.preview}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => { onOpen(t.convId); onDismiss(t.id) }}
              className="text-[10px] font-semibold text-sky-400 hover:text-sky-300 transition-colors px-1.5 py-1 rounded hover:bg-sky-500/10">
              View
            </button>
            <button onClick={() => onDismiss(t.id)}
              className="text-slate-600 hover:text-slate-300 transition-colors p-1 rounded">
              <X size={11} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Tickets Section ─────────────────────────────────────────────────────────
function TicketsSection({
  tickets, activeId, agents, messages, visitorPages,
  onSelect, onSend, onStatusChange, onConvertToTicket, onAssign, socketConnected,
}: {
  tickets: Conversation[]
  activeId: string | null
  agents: AgentRow[]
  messages: Record<string, Message[]>
  visitorPages: Record<string, string>
  onSelect: (id: string) => void
  onSend: (body: string) => Promise<void>
  onStatusChange: (status: Status) => void
  onConvertToTicket: () => Promise<void>
  onAssign: (agentId: string | null) => Promise<void>
  socketConnected: boolean
}) {
  const activeTicket = tickets.find(t => t.id === activeId)
  return (
    <>
      <div className="flex flex-col w-80 border-r border-slate-200 bg-white shrink-0">
        <div className="px-4 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Tag size={14} className="text-amber-600" />Tickets</h2>
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{tickets.length}</span>
          </div>
          <p className="text-[11px] text-slate-400">Conversations escalated to tickets</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <Tag size={28} className="text-slate-300 mb-2" />
              <p className="text-sm text-slate-400">No tickets yet</p>
              <p className="text-xs text-slate-300 mt-1">Use "Convert to Ticket" inside any conversation</p>
            </div>
          ) : tickets.map(t => (
            <ConversationRow key={t.id} conv={t} isActive={t.id === activeId} onClick={() => onSelect(t.id)} />
          ))}
        </div>
      </div>
      {activeTicket ? (
        <ChatPanel
          conv={activeTicket}
          messages={messages[activeId!] ?? []}
          onSend={onSend}
          onStatusChange={onStatusChange}
          onConvertToTicket={onConvertToTicket}
          onAssign={onAssign}
          agents={agents}
          currentPage={visitorPages[activeId ?? ''] ?? null}
          socketConnected={socketConnected}
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center bg-slate-50 p-8">
          <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center mb-4"><Tag size={24} className="text-amber-400" /></div>
          <h3 className="text-sm font-semibold text-slate-700 mb-1">Select a ticket</h3>
          <p className="text-xs text-slate-400 max-w-xs">Choose a ticket from the list to view and respond</p>
        </div>
      )}
    </>
  )
}

// ─── Dashboard (authenticated) ────────────────────────────────────────────────
function Dashboard() {
  const { accessToken, agent, logout } = useAuth() as {
    accessToken: string | null
    agent: { id: string; name: string; email: string; tenantId: string; role: string; isSuperAdmin?: boolean } | null
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
  const [toasts, setToasts]       = useState<InboxToast[]>([])
  const [agents, setAgents]       = useState<AgentRow[]>([])
  const [visitorPages, setVisitorPages] = useState<Record<string, string>>({})
  const socketRef                 = useRef<Socket | null>(null)
  const activeIdRef               = useRef<string | null>(null)

  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  // Auto-navigate Super Admin to their section immediately after login
  useEffect(() => {
    if (agent?.isSuperAdmin) setSection('superadmin')
  }, [agent?.isSuperAdmin]) // eslint-disable-line

  // Load agent list for the Assign To dropdown (shared by ChatPanel + TicketsSection)
  useEffect(() => {
    api.listAgents().then(setAgents).catch(() => {})
  }, []) // eslint-disable-line

  useEffect(() => {
    api.listConversations()
      .then(list => { setConvs(list); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, []) // eslint-disable-line

  useEffect(() => {
    if (!accessToken) return
    const socket: Socket = io({ path: '/api/socket.io', auth: { agentToken: accessToken }, transports: ['websocket', 'polling'], reconnectionAttempts: 5 })
    socketRef.current = socket
    socket.on('connect',       () => setSocketOk(true))
    socket.on('disconnect',    () => setSocketOk(false))
    socket.on('connect_error', () => setSocketOk(false))
    socket.on('conversation:created', (conv: Conversation) => {
      setConvs(prev => {
        if (prev.some(c => c.id === conv.id)) return prev
        return [{ ...conv, unread: 0 }, ...prev]
      })
    })
    socket.on('server:new_message', (msg: Message) => {
      if (msg.is_internal_note) return
      setMessages(prev => {
        const existing = prev[msg.conversation_id] ?? []
        if (existing.some(m => m.id === msg.id)) return prev
        return { ...prev, [msg.conversation_id]: [...existing, msg] }
      })
      setConvs(prev => prev.map(c => {
        if (c.id !== msg.conversation_id) return c
        const isActive = activeIdRef.current === c.id
        return { ...c, updated_at: msg.created_at, unread: isActive ? (c.unread ?? 0) : (c.unread ?? 0) + 1 }
      }))
      // Show toast only for incoming (non-agent) messages on conversations not currently open
      if (msg.sender_type !== 'agent' && msg.sender_type !== 'system') {
        setConvs(prev => {
          const conv = prev.find(c => c.id === msg.conversation_id)
          if (!conv) return prev
          if (activeIdRef.current === msg.conversation_id) return prev
          const toastId = `${msg.id}-toast`
          const toast: InboxToast = {
            id: toastId,
            convId: msg.conversation_id,
            visitorName: conv.visitor_name,
            preview: msg.message_body.slice(0, 80),
            createdAt: Date.now(),
          }
          setToasts(t => [...t.slice(-4), toast]) // keep max 5 toasts
          setTimeout(() => setToasts(t => t.filter(x => x.id !== toastId)), 6000)
          return prev
        })
      }
    })
    socket.on('visitor:page_change', ({ conversationId, url }: { conversationId: string; url: string }) => {
      setVisitorPages(prev => ({ ...prev, [conversationId]: url }))
    })
    socket.on('conversation:assigned', ({ conversationId, agentId, agentName }: { conversationId: string; agentId: string | null; agentName: string | null }) => {
      setConvs(prev => prev.map(c => c.id === conversationId
        ? { ...c, agent_name: agentName, assigned_agent_id: agentId }
        : c
      ))
    })
    return () => { socket.disconnect(); socketRef.current = null }
  }, [accessToken])

  useEffect(() => {
    if (activeId && socketRef.current?.connected) {
      socketRef.current.emit('join:conversation', { conversationId: activeId })
    }
  }, [activeId])

  useEffect(() => {
    if (!activeId || messages[activeId] !== undefined) return
    api.getMessages(activeId)
      .then(msgs => setMessages(prev => ({ ...prev, [activeId]: msgs })))
      .catch(() => setMessages(prev => ({ ...prev, [activeId]: [] })))
    setConvs(prev => prev.map(c => c.id === activeId ? { ...c, unread: 0 } : c))
  }, [activeId]) // eslint-disable-line

  const handleSelectConversation = useCallback((id: string) => {
    setActiveId(id); setSection('conversations')
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
  }, [activeId]) // eslint-disable-line

  const handleStatusChange = useCallback(async (status: Status) => {
    if (!activeId) return
    await api.patchConversation(activeId, { status })
    setConvs(prev => prev.map(c => c.id === activeId ? { ...c, status } : c))
  }, [activeId]) // eslint-disable-line

  const handleConvertToTicket = useCallback(async () => {
    if (!activeId) return
    await api.patchConversation(activeId, { is_ticket: true })
    setConvs(prev => prev.map(c => c.id === activeId ? { ...c, is_ticket: true } : c))
  }, [activeId]) // eslint-disable-line

  const handleAssign = useCallback(async (agentId: string | null) => {
    if (!activeId) return
    await api.patchConversation(activeId, { assigned_agent_id: agentId })
    const agentName = agents.find(a => a.id === agentId)?.name ?? null
    setConvs(prev => prev.map(c => c.id === activeId
      ? { ...c, agent_name: agentName, assigned_agent_id: agentId }
      : c
    ))
  }, [activeId, agents]) // eslint-disable-line

  const totalUnread = convs.reduce((n, c) => n + (c.unread ?? 0), 0)
  const activeConv  = convs.find(c => c.id === activeId)

  const dismissToast = useCallback((id: string) => setToasts(t => t.filter(x => x.id !== id)), [])
  const openToastConv = useCallback((convId: string) => {
    handleSelectConversation(convId)
    setSection('conversations')
  }, [handleSelectConversation])

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <ToastStack toasts={toasts} onDismiss={dismissToast} onOpen={openToastConv} />
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebar(false)} />
          <div className="absolute left-0 top-0 bottom-0 z-50"><Sidebar active={section} onNavigate={s => { setSection(s); setSidebar(false) }} unread={totalUnread} agent={agent} onLogout={logout} /></div>
        </div>
      )}
      <div className="hidden lg:flex"><Sidebar active={section} onNavigate={setSection} unread={totalUnread} agent={agent} onLogout={logout} /></div>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 lg:hidden">
          <button onClick={() => setSidebar(true)} className="text-slate-500 hover:text-slate-800"><Menu size={20} /></button>
          <span className="text-sm font-semibold text-slate-800 capitalize">{section}</span>
          {totalUnread > 0 && <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{totalUnread}</span>}
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {section === 'conversations' && (
            loading ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3"><RefreshCw size={20} className="animate-spin text-slate-300" /><span className="text-xs text-slate-400">Loading conversations…</span></div>
            ) : error ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8"><AlertTriangle size={28} className="text-amber-400" /><p className="text-sm font-medium text-slate-700">Could not load conversations</p><p className="text-xs text-slate-400">{error}</p><button onClick={() => window.location.reload()} className="text-xs text-sky-600 underline">Retry</button></div>
            ) : (
              <>
                <ConversationsList convs={convs} activeId={activeId} onSelect={handleSelectConversation} />
                {activeConv ? <ChatPanel conv={activeConv} messages={messages[activeId!] ?? []} onSend={handleSend} onStatusChange={handleStatusChange} onConvertToTicket={handleConvertToTicket} onAssign={handleAssign} agents={agents} currentPage={visitorPages[activeId ?? ''] ?? null} socketConnected={socketOk} /> : <EmptyChat />}
              </>
            )
          )}
          {section === 'tickets' && (
            <TicketsSection
              tickets={convs.filter(c => c.is_ticket)}
              activeId={activeId}
              agents={agents}
              messages={messages}
              visitorPages={visitorPages}
              onSelect={handleSelectConversation}
              onSend={handleSend}
              onStatusChange={handleStatusChange}
              onConvertToTicket={handleConvertToTicket}
              onAssign={handleAssign}
              socketConnected={socketOk}
            />
          )}
          {section === 'brands'     && <BrandsSection />}
          {section === 'billing'    && <BillingSection />}
          {section === 'settings'   && <SettingsSection />}
          {section === 'team'       && <TeamSection />}
          {section === 'superadmin' && <SuperAdminSection />}
        </div>
      </div>
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { isAuthenticated, isLoading } = useAuth() as { isAuthenticated: boolean; isLoading: boolean }
  const [view, setView]          = useState<AuthView>('login')
  const [successMsg, setSuccess] = useState<string | undefined>()

  const goSignup = () => { setSuccess(undefined); setView('signup') }
  const goLogin  = (msg?: string) => { setSuccess(msg); setView('login') }

  if (isLoading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-9 h-9 bg-sky-500 rounded-xl flex items-center justify-center animate-pulse"><Sparkles size={18} className="text-white" /></div>
        <p className="text-slate-500 text-xs">Loading…</p>
      </div>
    </div>
  )

  if (isAuthenticated) return <Dashboard />

  return view === 'signup'
    ? <SignupPage onGoLogin={goLogin} />
    : <LoginPage onGoSignup={goSignup} successMsg={successMsg} />
}
