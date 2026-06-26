import { useState, useEffect, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  MessageSquare, Building2, CreditCard, Settings,
  Search, Send, FileDown, Menu, X, Bot, User,
  Inbox, Sparkles, LogOut, Bell, RefreshCw,
  AlertTriangle, CheckCircle2, Clock, Circle,
  ChevronRight, Hash, Mail, Globe, Zap, MoreHorizontal,
  Eye, EyeOff, Wifi, WifiOff, Copy, Check, ArrowLeft,
  UserPlus, Building, Lock, Plus, Trash2, Pencil,
  Users, Shield, ToggleLeft, ToggleRight, Send as SendIcon,
  Tag, UserCheck, BarChart2, Star, Filter, Calendar,
  TrendingUp, Award, MessageCircle, ThumbsUp, ChevronDown,
  Paperclip, Bold, Italic, List, AtSign, Smile,
  Brain, BookOpen, Link2, Webhook,
} from 'lucide-react'
// @ts-ignore
import { useAuth } from './context/AuthContext'
import { io, type Socket } from 'socket.io-client'

// ─── Types ────────────────────────────────────────────────────────────────────
type Status      = 'open' | 'closed' | 'pending' | 'ai_handling' | 'submitted' | 'in_progress' | 'waiting_on_customer' | 'resolved'
type TicketStatus = 'submitted' | 'in_progress' | 'waiting_on_customer' | 'resolved' | 'closed'
type Channel     = 'email' | 'widget' | 'api'
type Priority    = 'low' | 'normal' | 'high' | 'urgent'
type Sender      = 'agent' | 'visitor' | 'bot' | 'system'
type Section     = 'conversations' | 'tickets' | 'brands' | 'billing' | 'settings' | 'team' | 'superadmin' | 'csat'
type StatusFilter = 'all' | Status
type AuthView    = 'login' | 'signup' | 'forgot' | 'reset'

interface Conversation {
  id: string; subject: string | null; status: Status; channel: Channel
  priority: Priority; visitor_name: string; visitor_email: string | null
  agent_name?: string | null; brand_name: string; updated_at: string
  sla_breach_at?: string | null; unread?: number
  is_ticket?: boolean; assigned_agent_id?: string | null
  visitor_id?: string; visitor_timezone?: string | null
  csat_score?: number | null; brand_id?: string
}

interface Attachment { url: string; name: string; type?: string }

interface Message {
  id: string; conversation_id: string; sender_type: Sender
  sender_name: string; message_body: string; is_internal_note: boolean
  created_at: string; attachments_json?: string | Attachment[] | null
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
  max_agents_allowed: number; ai_feature_enabled: boolean
  smtp_feature_enabled: boolean; conversation_limit: number
}

interface UpgradeRequest {
  id: string; tenant_id: string; company_name: string
  agent_name: string; agent_email: string; requested_plan: string
  company_size: string | null; notes: string | null; status: string; created_at: string
}

interface KnowledgeArticle {
  id: string; title: string; content: string; tags: string[]
  brand_id: string | null; is_active: boolean; created_at: string; updated_at: string
}
interface SuperAdminEntry {
  id: string; email: string; added_by: string; is_active: boolean; created_at: string
}
interface AIBrandSetting {
  id: string; brand_name: string; ai_system_prompt: string | null
}

interface CsatAgent {
  agent_id: string; agent_name: string; agent_email: string
  total_assigned: number; closed_count: number
  avg_csat_score: number | null; positive_ratings: number
  five_star: number; four_star: number; three_star: number; two_star: number; one_star: number
  rated_count: number; avg_first_response_minutes: number | null
  closed_today: number; participated_today: number
}

// ─── API Layer ────────────────────────────────────────────────────────────────
const API = '/api'

function useApi() {
  const { authFetch, agent } = useAuth() as {
    authFetch: (url: string, opts?: RequestInit) => Promise<Response>
    agent: { id: string; name: string; email: string; tenantId: string; role: string; isSuperAdmin?: boolean } | null
  }
  return useCallback(() => ({
    listConversations: async (params?: Record<string, string>): Promise<Conversation[]> => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      const r = await authFetch(`${API}/conversations${qs}`)
      if (!r.ok) throw new Error(`${r.status}`)
      const d = await r.json() as { conversations: Conversation[] }
      return d.conversations
    },
    getMessages: async (id: string): Promise<Message[]> => {
      const r = await authFetch(`${API}/conversations/${id}/messages`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<Message[]>
    },
    sendMessage: async (id: string, body: string, isInternalNote = false, attachments: Attachment[] = []): Promise<Message> => {
      const r = await authFetch(`${API}/conversations/${id}/messages`, {
        method: 'POST', body: JSON.stringify({ body, isInternalNote, attachments }),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<Message>
    },
    uploadFile: async (filename: string, mimeType: string, data: string): Promise<Attachment> => {
      const r = await authFetch(`${API}/conversations/upload`, {
        method: 'POST', body: JSON.stringify({ filename, mimeType, data }),
      })
      if (!r.ok) throw new Error('Upload failed')
      return r.json() as Promise<Attachment>
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
        body: JSON.stringify({ brand_name: name, widget_config_json: { website_url: websiteUrl || undefined, support_email: supportEmail || undefined } }),
      })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to create brand') }
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
      const r = await authFetch(`${API}/tenants/${agent.tenantId}/brands/${brandId}`, { method: 'PATCH', body: JSON.stringify(body) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to update brand') }
      return r.json() as Promise<Brand>
    },
    deleteBrand: async (brandId: string): Promise<void> => {
      if (!agent?.tenantId) throw new Error('Not authenticated')
      const r = await authFetch(`${API}/tenants/${agent.tenantId}/brands/${brandId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete brand')
    },
    rephraseText: async (draft: string, tone = 'professional'): Promise<string> => {
      const r = await authFetch(`${API}/ai/rephrase`, { method: 'POST', body: JSON.stringify({ draft, tone }) })
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
      const r = await authFetch(`${API}/agents`, { method: 'POST', body: JSON.stringify({ name, email, role }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to invite agent') }
      return r.json() as Promise<AgentRow>
    },
    removeAgent: async (id: string): Promise<void> => {
      const r = await authFetch(`${API}/agents/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to remove agent')
    },
    updateProfile: async (name?: string, password?: string): Promise<void> => {
      const r = await authFetch(`${API}/agents/me`, { method: 'PATCH', body: JSON.stringify({ name, password }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to update profile') }
    },
    createUpgradeRequest: async (requested_plan: string, company_size: string, notes: string): Promise<void> => {
      const r = await authFetch(`${API}/billing/upgrade-request`, { method: 'POST', body: JSON.stringify({ requested_plan, company_size, notes }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to submit request') }
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
      const r = await authFetch(`${API}/super-admin/tenants/${id}/status`, { method: 'PATCH', body: JSON.stringify({ account_status }) })
      if (!r.ok) throw new Error('Failed to update status')
    },
    patchTenantBilling: async (id: string, plan: string, subscription_status: string): Promise<void> => {
      const r = await authFetch(`${API}/super-admin/tenants/${id}/billing`, { method: 'PATCH', body: JSON.stringify({ plan, subscription_status }) })
      if (!r.ok) throw new Error('Failed to update billing')
    },
    purgeTenant: async (id: string, confirm_name: string): Promise<void> => {
      const r = await authFetch(`${API}/super-admin/tenants/${id}/purge`, { method: 'DELETE', body: JSON.stringify({ confirm_name }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Purge failed') }
    },
    patchTenantLimits: async (id: string, limits: Partial<{ max_brands_allowed: number; max_agents_allowed: number; ai_feature_enabled: boolean; smtp_feature_enabled: boolean; conversation_limit: number }>): Promise<void> => {
      const r = await authFetch(`${API}/super-admin/tenants/${id}/limits`, { method: 'PATCH', body: JSON.stringify(limits) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to update limits') }
    },
    provisionTenant: async (company_name: string, admin_name: string, admin_email: string, admin_password: string): Promise<{ tenant: SANTenant; agent: AgentRow; temp_password: string }> => {
      const r = await authFetch(`${API}/tenants/provision`, { method: 'POST', body: JSON.stringify({ company_name, admin_name, admin_email, admin_password }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to provision tenant') }
      return r.json() as Promise<{ tenant: SANTenant; agent: AgentRow; temp_password: string }>
    },
    listSuperAdmins: async (): Promise<{ primary: string | null; list: SuperAdminEntry[] }> => {
      const r = await authFetch(`${API}/super-admin/super-admins`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<{ primary: string | null; list: SuperAdminEntry[] }>
    },
    addSuperAdmin: async (email: string): Promise<SuperAdminEntry> => {
      const r = await authFetch(`${API}/super-admin/super-admins`, { method: 'POST', body: JSON.stringify({ email }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed') }
      return r.json() as Promise<SuperAdminEntry>
    },
    removeSuperAdmin: async (id: string): Promise<void> => {
      const r = await authFetch(`${API}/super-admin/super-admins/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to remove super admin')
    },
    listKnowledge: async (): Promise<KnowledgeArticle[]> => {
      const r = await authFetch(`${API}/ai/knowledge-base`)
      if (!r.ok) return []
      return r.json() as Promise<KnowledgeArticle[]>
    },
    createKnowledge: async (data: { title: string; content: string; tags?: string[] }): Promise<KnowledgeArticle> => {
      const r = await authFetch(`${API}/ai/knowledge-base`, { method: 'POST', body: JSON.stringify(data) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed') }
      return r.json() as Promise<KnowledgeArticle>
    },
    updateKnowledge: async (id: string, data: Partial<{ title: string; content: string; tags: string[]; is_active: boolean }>): Promise<KnowledgeArticle> => {
      const r = await authFetch(`${API}/ai/knowledge-base/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
      if (!r.ok) throw new Error('Failed to update article')
      return r.json() as Promise<KnowledgeArticle>
    },
    deleteKnowledge: async (id: string): Promise<void> => {
      const r = await authFetch(`${API}/ai/knowledge-base/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete article')
    },
    listAISettings: async (): Promise<AIBrandSetting[]> => {
      const r = await authFetch(`${API}/ai/settings`)
      if (!r.ok) return []
      return r.json() as Promise<AIBrandSetting[]>
    },
    updateAISettings: async (brandId: string, prompt: string | null): Promise<void> => {
      const r = await authFetch(`${API}/ai/settings/${brandId}`, { method: 'PATCH', body: JSON.stringify({ ai_system_prompt: prompt }) })
      if (!r.ok) throw new Error('Failed to update AI settings')
    },
    getWorkspaceSettings: async (): Promise<{ company_name?: string; default_timezone?: string; ai_auto_reply_enabled?: boolean; ai_feature_enabled?: boolean; smtp_feature_enabled?: boolean; custom_domain?: string; smtp_config_json?: Record<string, unknown>; imap_config_json?: Record<string, unknown>; webhook_config_json?: Record<string, unknown> }> => {
      const r = await authFetch(`${API}/tenants/settings/current`)
      if (!r.ok) return {}
      return r.json()
    },
    updateWorkspace: async (patch: { company_name?: string; default_timezone?: string; ai_auto_reply_enabled?: boolean; custom_domain?: string; smtp_config_json?: object; imap_config_json?: object; webhook_config_json?: object; ai_feature_enabled?: boolean; smtp_feature_enabled?: boolean }): Promise<void> => {
      const r = await authFetch(`${API}/tenants/settings`, { method: 'PATCH', body: JSON.stringify(patch) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to update workspace') }
    },
    editMessage: async (convId: string, msgId: string, body: string): Promise<void> => {
      const r = await authFetch(`${API}/conversations/${convId}/messages/${msgId}`, { method: 'PATCH', body: JSON.stringify({ body }) })
      if (!r.ok) throw new Error('Failed to edit message')
    },
    deleteMessage: async (convId: string, msgId: string): Promise<void> => {
      const r = await authFetch(`${API}/conversations/${convId}/messages/${msgId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete message')
    },
    visitorHistory: async (convId: string): Promise<Array<{ id: string; status: string; subject: string | null; created_at: string }>> => {
      const r = await authFetch(`${API}/conversations/${convId}/visitor-history`)
      if (!r.ok) return []
      return r.json() as Promise<Array<{ id: string; status: string; subject: string | null; created_at: string }>>
    },
    getCsatReport: async (params?: { brand_id?: string; date_from?: string; date_to?: string }): Promise<CsatAgent[]> => {
      const qs = params ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v))).toString() : ''
      const r = await authFetch(`${API}/conversations/csat${qs}`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<CsatAgent[]>
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

function StarRating({ score, size = 'sm' }: { score: number | null | undefined; size?: 'sm' | 'lg' }) {
  const s = size === 'lg' ? 14 : 10
  return (
    <span className="inline-flex gap-0.5">
      {[1,2,3,4,5].map(n => (
        <Star key={n} size={s} className={n <= (score ?? 0) ? 'text-amber-400 fill-amber-400' : 'text-slate-200 fill-slate-200'} />
      ))}
    </span>
  )
}

// ─── Audio notification chime (Web Audio API, no external files) ─────────────
function playChime() {
  try {
    const ctx = new AudioContext()
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9)
    const osc = ctx.createOscillator()
    osc.connect(gain)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.12)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.55)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.9)
    osc.onended = () => ctx.close()
  } catch { /* AudioContext unavailable */ }
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
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setSub(true)
    try {
      const res = await fetch(`${API}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Signup failed')
      onGoLogin('Account created! Sign in below.')
    } catch (err) { setError((err as Error).message) } finally { setSub(false) }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center"><OmniLogo /><div><p className="text-white font-bold tracking-wide">OmniCore</p><p className="text-slate-500 text-xs">Atelier — Create your account</p></div></div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <h1 className="text-slate-100 text-lg font-semibold mb-1">Start for free</h1>
          <p className="text-slate-500 text-xs mb-5">Set up your team workspace in seconds</p>
          {error && <div className="mb-4 p-3 bg-red-950/50 border border-red-900 rounded-lg text-xs text-red-400 flex items-center gap-2"><AlertTriangle size={13} className="shrink-0" /> {error}</div>}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="block text-xs font-medium text-slate-400 mb-1.5"><span className="inline-flex items-center gap-1.5"><Building size={11} /> Company name</span></label><input type="text" value={form.companyName} onChange={set('companyName')} required placeholder="Acme Inc." className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1.5"><span className="inline-flex items-center gap-1.5"><User size={11} /> Your name</span></label><input type="text" value={form.adminName} onChange={set('adminName')} required placeholder="Alex Johnson" className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1.5"><span className="inline-flex items-center gap-1.5"><Mail size={11} /> Work email</span></label><input type="email" value={form.adminEmail} onChange={set('adminEmail')} required placeholder="alex@acme.com" className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1.5"><span className="inline-flex items-center gap-1.5"><Lock size={11} /> Password</span></label>
              <div className="relative"><input type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')} required placeholder="Min 8 characters" className="w-full px-3 py-2.5 pr-10 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" /><button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">{showPw ? <EyeOff size={14} /> : <Eye size={14} />}</button></div>
            </div>
            <button type="submit" disabled={submitting} className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 mt-1">{submitting ? <><RefreshCw size={13} className="animate-spin" /> Creating account…</> : <><UserPlus size={14} /> Create free account</>}</button>
          </form>
        </div>
        <button onClick={() => onGoLogin()} className="mt-4 w-full flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"><ArrowLeft size={12} /> Already have an account? Sign in</button>
      </div>
    </div>
  )
}

// ─── Forgot Password Page ─────────────────────────────────────────────────────
function ForgotPasswordPage({ onGoLogin }: { onGoLogin: (msg?: string) => void }) {
  const [email, setEmail]     = useState('')
  const [submitting, setSub]  = useState(false)
  const [msg, setMsg]         = useState<{ ok: boolean; text: string; link?: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSub(true); setMsg(null)
    try {
      const res = await fetch(`${API}/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      const d = await res.json() as { ok?: boolean; message?: string; reset_link?: string; error?: string }
      if (!res.ok) { setMsg({ ok: false, text: d.error ?? 'Request failed' }); return }
      setMsg({ ok: true, text: d.message ?? 'Reset link sent.', link: d.reset_link })
    } catch { setMsg({ ok: false, text: 'Network error. Please try again.' }) }
    finally { setSub(false) }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center"><OmniLogo /><div><p className="text-white font-bold tracking-wide">OmniCore</p><p className="text-slate-500 text-xs">Atelier — Password Reset</p></div></div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <h1 className="text-slate-100 text-lg font-semibold mb-1">Forgot password?</h1>
          <p className="text-slate-500 text-xs mb-5">Enter your email and we'll send a reset link.</p>
          {msg && (
            <div className={`mb-4 p-3 rounded-lg text-xs flex flex-col gap-1.5 ${msg.ok ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-400' : 'bg-red-950/50 border border-red-900 text-red-400'}`}>
              <span className="flex items-center gap-2">{msg.ok ? <CheckCircle2 size={13} className="shrink-0" /> : <AlertTriangle size={13} className="shrink-0" />}{msg.text}</span>
              {msg.link && <a href={msg.link} className="underline text-sky-400 break-all mt-1 text-[11px]">Click here to reset password (dev mode)</a>}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="block text-xs font-medium text-slate-400 mb-1.5">Email address</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="email" className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" /></div>
            <button type="submit" disabled={submitting} className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">{submitting && <RefreshCw size={13} className="animate-spin" />}{submitting ? 'Sending…' : 'Send reset link'}</button>
          </form>
        </div>
        <button onClick={() => onGoLogin()} className="mt-4 w-full flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"><ArrowLeft size={12} /> Back to sign in</button>
      </div>
    </div>
  )
}

// ─── Reset Password Page ──────────────────────────────────────────────────────
function ResetPasswordPage({ token, onGoLogin }: { token: string; onGoLogin: (msg?: string) => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [submitting, setSub]    = useState(false)
  const [msg, setMsg]           = useState<{ ok: boolean; text: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setMsg({ ok: false, text: 'Passwords do not match.' }); return }
    if (password.length < 8) { setMsg({ ok: false, text: 'Password must be at least 8 characters.' }); return }
    setSub(true); setMsg(null)
    try {
      const res = await fetch(`${API}/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) })
      const d = await res.json() as { ok?: boolean; message?: string; error?: string }
      if (!res.ok) { setMsg({ ok: false, text: d.error ?? 'Reset failed' }); return }
      onGoLogin(d.message ?? 'Password updated! Sign in with your new password.')
    } catch { setMsg({ ok: false, text: 'Network error. Please try again.' }) }
    finally { setSub(false) }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center"><OmniLogo /><div><p className="text-white font-bold tracking-wide">OmniCore</p><p className="text-slate-500 text-xs">Atelier — Set new password</p></div></div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <h1 className="text-slate-100 text-lg font-semibold mb-1">Set new password</h1>
          <p className="text-slate-500 text-xs mb-5">Choose a strong password (min 8 characters).</p>
          {msg && <div className={`mb-4 p-3 rounded-lg text-xs flex items-center gap-2 ${msg.ok ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-400' : 'bg-red-950/50 border border-red-900 text-red-400'}`}>{msg.ok ? <CheckCircle2 size={13} className="shrink-0" /> : <AlertTriangle size={13} className="shrink-0" />}{msg.text}</div>}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="block text-xs font-medium text-slate-400 mb-1.5">New password</label>
              <div className="relative"><input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required placeholder="Min 8 characters" className="w-full px-3 py-2.5 pr-10 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" /><button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">{showPw ? <EyeOff size={14} /> : <Eye size={14} />}</button></div>
            </div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1.5">Confirm password</label><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required placeholder="Repeat password" className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" /></div>
            <button type="submit" disabled={submitting} className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">{submitting && <RefreshCw size={13} className="animate-spin" />}{submitting ? 'Updating…' : 'Update password'}</button>
          </form>
        </div>
        <button onClick={() => onGoLogin()} className="mt-4 w-full flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"><ArrowLeft size={12} /> Back to sign in</button>
      </div>
    </div>
  )
}

// ─── Login Page ───────────────────────────────────────────────────────────────
function LoginPage({ onGoSignup, onGoForgot, successMsg }: { onGoSignup: () => void; onGoForgot: () => void; successMsg?: string }) {
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
        <div className="flex items-center gap-3 mb-8 justify-center"><OmniLogo /><div><p className="text-white font-bold tracking-wide">OmniCore</p><p className="text-slate-500 text-xs">Atelier — Agent Dashboard</p></div></div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <h1 className="text-slate-100 text-lg font-semibold mb-1">Sign in</h1>
          <p className="text-slate-500 text-xs mb-5">Enter your agent credentials</p>
          {successMsg && <div className="mb-4 p-3 bg-emerald-950/60 border border-emerald-800 rounded-lg text-xs text-emerald-400 flex items-center gap-2"><CheckCircle2 size={13} className="shrink-0" /> {successMsg}</div>}
          {error && <div className="mb-4 p-3 bg-red-950/50 border border-red-900 rounded-lg text-xs text-red-400 flex items-center gap-2"><AlertTriangle size={13} className="shrink-0" /> {error}</div>}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="email" className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" /></div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-400">Password</label>
                <button type="button" onClick={onGoForgot} className="text-[11px] text-sky-500 hover:text-sky-400 transition-colors">Forgot password?</button>
              </div>
              <div className="relative"><input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" autoComplete="current-password" className="w-full px-3 py-2.5 pr-10 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all" /><button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">{showPw ? <EyeOff size={14} /> : <Eye size={14} />}</button></div>
            </div>
            <button type="submit" disabled={submitting} className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">{submitting && <RefreshCw size={13} className="animate-spin" />}{submitting ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <div className="mt-4 pt-4 border-t border-slate-800 text-center"><button onClick={onGoSignup} className="text-xs text-sky-500 hover:text-sky-400 transition-colors">New to OmniCore? Create a free account →</button></div>
        </div>
        <p className="text-center text-xs text-slate-700 mt-4">Demo: admin@omnicore.test / Admin123!</p>
      </div>
    </div>
  )
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string; icon: React.ReactNode }> = {
    open:                  { label: 'Open',            cls: 'bg-sky-100 text-sky-700 border border-sky-200',            icon: <Circle size={6} className="fill-sky-500 text-sky-500" /> },
    pending:               { label: 'Pending',         cls: 'bg-amber-50 text-amber-700 border border-amber-200',       icon: <Clock size={10} /> },
    ai_handling:           { label: 'AI',              cls: 'bg-violet-100 text-violet-700 border border-violet-200',   icon: <Sparkles size={10} /> },
    closed:                { label: 'Closed',          cls: 'bg-slate-100 text-slate-500 border border-slate-200',      icon: <CheckCircle2 size={10} /> },
    submitted:             { label: 'Submitted',       cls: 'bg-blue-50 text-blue-700 border border-blue-200',          icon: <Tag size={10} /> },
    in_progress:           { label: 'In Progress',     cls: 'bg-indigo-50 text-indigo-700 border border-indigo-200',    icon: <RefreshCw size={10} /> },
    waiting_on_customer:   { label: 'Waiting',         cls: 'bg-orange-50 text-orange-700 border border-orange-200',    icon: <Clock size={10} /> },
    resolved:              { label: 'Resolved',        cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200', icon: <CheckCircle2 size={10} /> },
  }
  const { label, cls, icon } = map[status] ?? map.open
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
        <div className="flex items-center gap-2 min-w-0">
          <StatusBadge status={conv.status} /><ChannelIcon channel={conv.channel} />
          {conv.csat_score && <StarRating score={conv.csat_score} />}
          {conv.sla_breach_at && <span className={`text-[10px] flex items-center gap-0.5 ${slaColor(conv.sla_breach_at)}`}>{breached && <AlertTriangle size={9} />} SLA</span>}
        </div>
        {conv.agent_name && <span className="text-[10px] text-slate-400 truncate shrink-0">{conv.agent_name}</span>}
      </div>
    </button>
  )
}

// ─── Conversations List ───────────────────────────────────────────────────────
const CONV_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' }, { label: 'Open', value: 'open' },
  { label: 'Pending', value: 'pending' }, { label: 'AI', value: 'ai_handling' },
  { label: 'Closed', value: 'closed' },
]

function ConversationsList({ convs, activeId, onSelect, brands, agents }: {
  convs: Conversation[]; activeId: string | null; onSelect: (id: string) => void
  brands: Brand[]; agents: AgentRow[]
}) {
  const [query, setQuery]       = useState('')
  const [filter, setFilter]     = useState<StatusFilter>('all')
  const [brandFilter, setBrand] = useState('')
  const [agentFilter, setAgent] = useState('')
  const [ratingFilter, setRating] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const filtered = convs
    .filter(c => !c.is_ticket)
    .filter(c => filter === 'all' || c.status === filter)
    .filter(c => !brandFilter || c.brand_id === brandFilter)
    .filter(c => !agentFilter || c.assigned_agent_id === agentFilter)
    .filter(c => !ratingFilter || String(c.csat_score) === ratingFilter)
    .filter(c => !dateFrom || new Date(c.updated_at) >= new Date(dateFrom))
    .filter(c => !dateTo   || new Date(c.updated_at) <= new Date(dateTo + 'T23:59:59'))
    .filter(c => {
      if (!query) return true
      const q = query.toLowerCase()
      return c.visitor_name.toLowerCase().includes(q) || (c.subject ?? '').toLowerCase().includes(q) || (c.visitor_email ?? '').toLowerCase().includes(q)
    })
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  const hasFilters = brandFilter || agentFilter || ratingFilter || dateFrom || dateTo

  return (
    <div className="flex flex-col h-full w-80 border-r border-slate-200 bg-white shrink-0">
      <div className="px-4 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-800">Inbox</h2>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{filtered.length}</span>
            <button onClick={() => setShowFilters(f => !f)} className={`p-1 rounded-md transition-colors ${hasFilters ? 'text-sky-600 bg-sky-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`} title="Filters"><Filter size={13} /></button>
          </div>
        </div>
        <div className="relative mb-2">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Search by name, email, content…" value={query} onChange={e => setQuery(e.target.value)} className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" />
        </div>
        {showFilters && (
          <div className="space-y-2 pt-2 border-t border-slate-100 mt-2">
            <select value={brandFilter} onChange={e => setBrand(e.target.value)} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400">
              <option value="">All Brands</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
            </select>
            <select value={agentFilter} onChange={e => setAgent(e.target.value)} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400">
              <option value="">All Agents</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select value={ratingFilter} onChange={e => setRating(e.target.value)} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400">
              <option value="">All Ratings</option>
              {[5,4,3,2,1].map(n => <option key={n} value={String(n)}>{n} ★</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400" placeholder="From" />
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400" placeholder="To" />
            </div>
            {hasFilters && <button onClick={() => { setBrand(''); setAgent(''); setRating(''); setDateFrom(''); setDateTo('') }} className="text-xs text-red-500 hover:text-red-600">Clear filters</button>}
          </div>
        )}
        <div className="flex gap-1 mt-2 overflow-x-auto pb-1 scrollbar-none">
          {CONV_FILTERS.map(f => (
            <button key={f.value} onClick={() => setFilter(f.value)} className={`shrink-0 px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${filter === f.value ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{f.label}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8"><Inbox size={28} className="text-slate-200 mb-2" /><p className="text-xs text-slate-400">No conversations match</p></div>
        ) : filtered.map(c => <ConversationRow key={c.id} conv={c} isActive={c.id === activeId} onClick={() => onSelect(c.id)} />)}
      </div>
    </div>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg, visitorName, onEdit, onDelete, isLastAgentMsg, readAt }: {
  msg: Message; visitorName: string
  onEdit?: (msgId: string, newBody: string) => Promise<void>
  onDelete?: (msgId: string) => Promise<void>
  isLastAgentMsg?: boolean
  readAt?: string | null
}) {
  const [editing, setEditing]   = useState(false)
  const [editDraft, setDraft]   = useState(msg.message_body)
  const [saving, setSaving]     = useState(false)
  const [hovered, setHovered]   = useState(false)

  const isAgent   = msg.sender_type === 'agent'
  const isBot     = msg.sender_type === 'bot'
  const isSystem  = msg.sender_type === 'system'
  const isInternal = msg.is_internal_note

  if (isSystem) return (
    <div className="flex justify-center">
      <span className="text-[10px] text-slate-400 bg-slate-100 px-3 py-1 rounded-full">{msg.message_body}</span>
    </div>
  )

  const handleSave = async () => {
    if (!editDraft.trim() || !onEdit) return
    setSaving(true)
    try { await onEdit(msg.id, editDraft.trim()); setEditing(false) }
    catch { /* ignore */ }
    finally { setSaving(false) }
  }

  // Parse attachments — handle both JSON string (REST) and already-parsed array (socket)
  let attachments: Attachment[] = []
  try {
    if (msg.attachments_json) {
      const raw = typeof msg.attachments_json === 'string' ? JSON.parse(msg.attachments_json) : msg.attachments_json
      if (Array.isArray(raw)) attachments = raw
    }
  } catch { /* ignore malformed */ }

  const seenAt = isLastAgentMsg && readAt && new Date(readAt) > new Date(msg.created_at) ? readAt : null

  return (
    <div className={`flex gap-2.5 ${isAgent || isBot ? 'flex-row-reverse' : 'flex-row'}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-1 ${isAgent ? 'bg-sky-600 text-white' : isBot ? 'bg-violet-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
        {isBot ? <Bot size={12} /> : isAgent ? <User size={12} /> : visitorName[0]?.toUpperCase()}
      </div>
      <div className={`max-w-[70%] ${isAgent || isBot ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {isInternal && <span className="text-[9px] text-amber-600 font-semibold uppercase tracking-wide bg-amber-50 px-1.5 py-0.5 rounded-sm border border-amber-200">Internal note</span>}
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <textarea value={editDraft} onChange={e => setDraft(e.target.value)} rows={3} className="px-3 py-2 bg-white border border-sky-300 rounded-xl text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-sky-400/30 w-64" />
            <div className="flex gap-1.5">
              <button onClick={handleSave} disabled={saving} className="px-2.5 py-1 text-xs bg-sky-600 text-white rounded-lg disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => setEditing(false)} className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {(msg.message_body || attachments.length === 0) && (
              <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${isInternal ? 'bg-amber-50 border border-amber-200 text-amber-900' : isAgent ? 'bg-sky-600 text-white' : isBot ? 'bg-violet-50 border border-violet-200 text-violet-900' : 'bg-white border border-slate-200 text-slate-800'}`}>
                {msg.message_body.trimStart().startsWith('<') ? (
                  <div className="msg-html" dangerouslySetInnerHTML={{ __html: msg.message_body }} />
                ) : (
                  msg.message_body
                )}
              </div>
            )}
            {attachments.length > 0 && (
              <div className="flex flex-col gap-1.5 mt-0.5">
                {attachments.map((att, i) => att.type?.startsWith('image/') ? (
                  <a key={i} href={att.url} target="_blank" rel="noopener noreferrer">
                    <img src={att.url} alt={att.name} className="max-w-[200px] max-h-[160px] rounded-xl object-cover border border-slate-200 hover:opacity-90 transition-opacity cursor-pointer" />
                  </a>
                ) : (
                  <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${isAgent ? 'bg-sky-500 text-white hover:bg-sky-400' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                    <Paperclip size={11} />{att.name || 'File'}
                  </a>
                ))}
              </div>
            )}
          </>
        )}
        <div className={`flex flex-col ${isAgent ? 'items-end' : 'items-start'} gap-0.5`}>
          <div className={`flex items-center gap-2 ${isAgent ? 'flex-row-reverse' : ''}`}>
            <span className="text-[10px] text-slate-400">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            {hovered && !editing && isAgent && (
              <div className="flex items-center gap-1">
                {onEdit && <button onClick={() => setEditing(true)} className="p-0.5 text-slate-400 hover:text-slate-600 rounded"><Pencil size={10} /></button>}
                {onDelete && <button onClick={() => window.confirm('Delete this message?') && onDelete(msg.id)} className="p-0.5 text-slate-400 hover:text-red-500 rounded"><Trash2 size={10} /></button>}
              </div>
            )}
          </div>
          {seenAt && (
            <span className="text-[9px] text-sky-400 flex items-center gap-0.5">
              <CheckCircle2 size={9} />Seen
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Visitor Info Panel ────────────────────────────────────────────────────────
function VisitorInfoPanel({ conv, currentPage }: { conv: Conversation; currentPage: string | null }) {
  const api = useApi()
  const [ext, setExt] = useState<{ ip_address?: string }>({})
  const [history, setHistory] = useState<Array<{ id: string; status: string; subject: string | null; created_at: string }>>([])
  const [tick, setTick] = useState(0)
  const tz = conv.visitor_timezone

  useEffect(() => {
    api.visitorHistory(conv.id).then(setHistory).catch(() => {})
  }, [conv.id]) // eslint-disable-line

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const localTime = (tz && tick >= 0)
    ? (() => { try { return new Date().toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) } catch { return null } })()
    : null

  return (
    <div className="w-56 border-l border-slate-200 bg-white shrink-0 overflow-y-auto">
      <div className="px-4 py-3 border-b border-slate-100"><p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Contact</p></div>
      <div className="px-4 py-3 space-y-3">
        <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Name</p><p className="text-xs text-slate-800 font-medium">{conv.visitor_name}</p></div>
        {conv.visitor_email && <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Email</p><p className="text-xs text-slate-700 break-all">{conv.visitor_email}</p></div>}
        {tz && <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5 flex items-center gap-1"><Clock size={9} />Timezone</p><p className="text-xs text-slate-700">{tz}</p>{localTime && <p className="text-[10px] text-emerald-600 font-medium mt-0.5">🕐 {localTime} local</p>}</div>}
        {currentPage && <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5 flex items-center gap-1"><Globe size={9} />Current Page</p><a href={currentPage} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-600 hover:underline break-all leading-relaxed">{currentPage}</a></div>}
        <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Channel</p><p className="text-xs text-slate-700 capitalize">{conv.channel}</p></div>
        <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Brand</p><p className="text-xs text-slate-700">{conv.brand_name}</p></div>
        {conv.csat_score && <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">CSAT</p><StarRating score={conv.csat_score} /></div>}
        {conv.sla_breach_at && <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">SLA</p><p className={`text-xs ${slaColor(conv.sla_breach_at)}`}>{new Date(conv.sla_breach_at).getTime() < Date.now() ? 'Breached' : `Due ${timeAgo(conv.sla_breach_at)}`}</p></div>}
        {history.length > 0 && (
          <div>
            <p className="text-[10px] text-slate-400 font-medium uppercase mb-1.5">Past Conversations ({history.length})</p>
            <div className="space-y-1.5">
              {history.slice(0, 5).map(h => (
                <div key={h.id} className="text-[10px] p-1.5 bg-slate-50 rounded border border-slate-100">
                  <span className={`inline-block px-1 py-0.5 rounded text-[9px] font-semibold mr-1 ${h.status === 'open' ? 'bg-emerald-100 text-emerald-700' : h.status === 'closed' ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700'}`}>{h.status}</span>
                  <span className="text-slate-500">{h.subject || '(No subject)'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Email-style Compose Box (rich-text via TipTap) ───────────────────────────
function EmailComposeBox({ conv, onSend, disabled }: {
  conv: Conversation
  onSend: (body: string, isInternalNote?: boolean, attachments?: Attachment[]) => Promise<void>
  disabled?: boolean
}) {
  const [sending, setSending]       = useState(false)
  const [isNote, setIsNote]         = useState(false)
  const [rephrasing, setRephrase]   = useState(false)
  const [pendingFile, setPending]   = useState<{ name: string; type: string; dataUrl: string } | null>(null)
  const fileInputRef                = useRef<HTMLInputElement>(null)
  const api = useApi()

  const isClosed = conv.status === 'closed' || disabled

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: isClosed
          ? 'Conversation closed — reopen to reply'
          : isNote
          ? 'Write an internal note (not visible to visitor)…'
          : 'Write your reply… (Ctrl+Enter to send)',
      }),
    ],
    editable: !isClosed,
  })

  const canSend = !isClosed && !sending && (pendingFile !== null || (editor !== null && !(editor?.isEmpty ?? true)))

  const handleSend = async () => {
    if (isClosed || sending || (!pendingFile && (!editor || editor.isEmpty))) return
    const body = editor ? editor.getHTML() : ''
    const captured = pendingFile
    editor?.commands.clearContent(true)
    setPending(null)
    setSending(true)
    try {
      let attachments: Attachment[] = []
      if (captured) {
        const comma  = captured.dataUrl.indexOf(',')
        const b64    = comma >= 0 ? captured.dataUrl.slice(comma + 1) : captured.dataUrl
        const att    = await api.uploadFile(captured.name, captured.type, b64)
        attachments  = [att]
      }
      await onSend(body, isNote, attachments)
    } catch { /* ignore */ } finally { setSending(false) }
    editor?.commands.focus()
  }

  const handleRephrase = async () => {
    if (!editor || editor.isEmpty || rephrasing) return
    const text = editor.getText()
    setRephrase(true)
    try {
      const improved = await api.rephraseText(text)
      editor.commands.setContent(improved)
    } catch { /* ignore */ }
    finally { setRephrase(false); editor.commands.focus() }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { alert('File too large — max 10 MB'); return }
    const reader = new FileReader()
    reader.onload = ev => setPending({ name: file.name, type: file.type, dataUrl: ev.target!.result as string })
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile()
        if (!file) continue
        e.preventDefault()
        const reader = new FileReader()
        reader.onload = ev => setPending({ name: `paste-${Date.now()}.png`, type: file.type, dataUrl: ev.target!.result as string })
        reader.readAsDataURL(file)
        break
      }
    }
  }

  const isActive = (fmt: string) => editor?.isActive(fmt) ?? false

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mx-4 mb-4 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-500/20 transition-all ${isNote ? 'border-amber-200 focus-within:border-amber-400 focus-within:ring-amber-400/20' : ''}`}>
      {/* Email header fields */}
      <div className="border-b border-slate-100">
        <div className="flex items-center px-4 py-2 border-b border-slate-100">
          <span className="text-xs font-medium text-slate-400 w-10 shrink-0">To</span>
          <span className="text-xs text-slate-700 flex-1">{conv.visitor_email || conv.visitor_name}</span>
          {conv.visitor_email && <span className="text-[10px] text-slate-400">{conv.visitor_name}</span>}
        </div>
        <div className="flex items-center px-4 py-2">
          <span className="text-xs font-medium text-slate-400 w-10 shrink-0">Subj</span>
          <span className="text-xs text-slate-600 flex-1 truncate">{conv.subject || '(No subject)'}</span>
          <div className="flex items-center gap-2 ml-2">
            <button onClick={() => setIsNote(false)} className={`text-[10px] font-medium px-2 py-0.5 rounded transition-colors ${!isNote ? 'bg-sky-100 text-sky-700' : 'text-slate-400 hover:text-slate-600'}`}>Reply</button>
            <button onClick={() => setIsNote(true)} className={`text-[10px] font-medium px-2 py-0.5 rounded transition-colors ${isNote ? 'bg-amber-100 text-amber-700' : 'text-slate-400 hover:text-slate-600'}`}>Note</button>
          </div>
        </div>
      </div>
      {/* Rich-text body */}
      <div
        className={`tiptap-compose ${isNote ? 'bg-amber-50/20' : ''}`}
        onClick={() => editor?.commands.focus()}
        onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSend() } }}
        onPaste={handlePaste}
      >
        <EditorContent editor={editor} />
      </div>
      {/* Pending file preview */}
      {pendingFile && (
        <div className="flex items-center gap-2 px-4 py-2 bg-sky-50 border-t border-sky-100">
          {pendingFile.type.startsWith('image/') ? (
            <img src={pendingFile.dataUrl} alt="preview" className="w-8 h-8 rounded object-cover shrink-0 border border-sky-200" />
          ) : (
            <Paperclip size={14} className="text-sky-500 shrink-0" />
          )}
          <span className="text-xs text-sky-700 flex-1 truncate font-medium">{pendingFile.name}</span>
          <button onClick={() => setPending(null)} className="text-sky-400 hover:text-sky-600 font-bold text-base leading-none">×</button>
        </div>
      )}
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" className="hidden"
        accept="image/*,.pdf,.csv,.doc,.docx,.xls,.xlsx,.txt"
        onChange={handleFileChange} />
      {/* Formatting toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-0.5">
          <button onClick={() => editor?.chain().focus().toggleBold().run()} disabled={isClosed}
            className={`p-1.5 rounded-lg transition-colors ${isActive('bold') ? 'text-sky-600 bg-sky-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`} title="Bold (Ctrl+B)">
            <Bold size={13} />
          </button>
          <button onClick={() => editor?.chain().focus().toggleItalic().run()} disabled={isClosed}
            className={`p-1.5 rounded-lg transition-colors ${isActive('italic') ? 'text-sky-600 bg-sky-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`} title="Italic (Ctrl+I)">
            <Italic size={13} />
          </button>
          <button onClick={() => editor?.chain().focus().toggleBulletList().run()} disabled={isClosed}
            className={`p-1.5 rounded-lg transition-colors ${isActive('bulletList') ? 'text-sky-600 bg-sky-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`} title="Bullet list">
            <List size={13} />
          </button>
          <div className="w-px h-4 bg-slate-200 mx-1" />
          <button onClick={() => fileInputRef.current?.click()} disabled={isClosed}
            title="Attach file (or paste image)"
            className={`p-1.5 rounded-lg transition-colors ${pendingFile ? 'text-sky-600 bg-sky-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'} disabled:opacity-30 disabled:cursor-not-allowed`}>
            <Paperclip size={13} />
          </button>
          <div className="w-px h-4 bg-slate-200 mx-1" />
          <button onClick={handleRephrase} disabled={!editor || editor.isEmpty || rephrasing || isClosed}
            title="AI rephrase" className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
            {rephrasing ? <RefreshCw size={14} className="animate-spin text-violet-500" /> : <Sparkles size={14} />}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-300 hidden sm:block">Ctrl+Enter · Paste image</span>
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isNote ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-sky-600 hover:bg-sky-700 text-white'}`}
          >
            {sending ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
            {isNote ? 'Add Note' : 'Send Reply'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────
function ChatPanel({ conv, messages, onSend, onStatusChange, onConvertToTicket, onAssign, onEditMessage, onDeleteMessage, onPriorityChange, agents, currentPage, socketConnected, typingWho, visitorOnline, visitorReadAt }: {
  conv: Conversation; messages: Message[]
  onSend: (body: string, isInternalNote?: boolean, attachments?: Attachment[]) => Promise<void>
  onStatusChange: (status: Status, triggerCsat?: boolean) => void
  onConvertToTicket: () => Promise<void>
  onAssign: (agentId: string | null) => Promise<void>
  onEditMessage?: (msgId: string, newBody: string) => Promise<void>
  onDeleteMessage?: (msgId: string) => Promise<void>
  onPriorityChange?: (priority: Priority) => Promise<void>
  agents: AgentRow[]
  currentPage: string | null
  socketConnected: boolean
  typingWho?: string | null
  visitorOnline?: boolean
  visitorReadAt?: string | null
}) {
  const [exporting, setExporting] = useState(false)
  const [toast, setToast]         = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [menuOpen, setMenuOpen]   = useState(false)
  const [csatScore, setCsatScore] = useState<number>(conv.csat_score ?? 0)
  const [ticketStatus, setTicketStatus] = useState<Status>(conv.status)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const menuRef     = useRef<HTMLDivElement>(null)
  const api = useApi()

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { setTicketStatus(conv.status) }, [conv.status])

  const showToast = (type: 'success' | 'error', msg: string) => { setToast({ type, msg }); setTimeout(() => setToast(null), 5000) }

  const handleExport = async () => {
    setExporting(true)
    try { const url = await api.exportPdf(conv.id); if (url) { window.open(url, '_blank'); showToast('success', 'PDF export opened') } }
    catch (e) { showToast('error', (e as Error).message || 'Export unavailable') }
    finally { setExporting(false) }
  }

  const handleCsatSet = async (score: number) => {
    setCsatScore(score)
    try { await api.patchConversation(conv.id, { csat_score: score }) }
    catch { /* ignore */ }
  }

  const handleTicketStatusChange = async (status: Status) => {
    setTicketStatus(status)
    onStatusChange(status)
  }

  const TICKET_STATUSES: { value: Status; label: string }[] = [
    { value: 'submitted', label: 'Submitted' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'waiting_on_customer', label: 'Waiting on Customer' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'closed', label: 'Closed' },
  ]

  const nextStatus: Partial<Record<Status, Status>> = { open: 'closed', pending: 'open', ai_handling: 'open', closed: 'open', submitted: 'in_progress', in_progress: 'resolved', waiting_on_customer: 'in_progress', resolved: 'closed' }
  const statusActionLabel: Partial<Record<Status, string>> = { open: 'Close', pending: 'Reopen', ai_handling: 'Take over', closed: 'Reopen', submitted: 'Start', in_progress: 'Resolve', waiting_on_customer: 'Resume', resolved: 'Close' }
  const [csatDialog, setCsatDialog] = useState(false)

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-slate-900 truncate">{conv.subject || '(No subject)'}</h3>
            <StatusBadge status={conv.status} />
            <span title={socketConnected ? 'Real-time connected' : 'Reconnecting…'}>{socketConnected ? <Wifi size={11} className="text-emerald-400" /> : <WifiOff size={11} className="text-slate-300" />}</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="font-medium text-slate-600 flex items-center gap-1.5">
              {conv.visitor_name}
              {visitorOnline && <span className="flex items-center gap-0.5 text-[10px] font-semibold text-emerald-500"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />Online</span>}
            </span>
            {conv.visitor_email && <><span>·</span><span>{conv.visitor_email}</span></>}
            <span>·</span><span className="capitalize">{conv.channel}</span>
            {conv.sla_breach_at && <span className={`flex items-center gap-0.5 ${slaColor(conv.sla_breach_at)}`}><Clock size={10} /> SLA {new Date(conv.sla_breach_at).getTime() < Date.now() ? 'breached' : timeAgo(conv.sla_breach_at)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {!conv.is_ticket && (
            <button onClick={onConvertToTicket} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 transition-all">
              <Tag size={12} />Ticket
            </button>
          )}
          {conv.is_ticket && (
            <select value={ticketStatus} onChange={e => handleTicketStatusChange(e.target.value as Status)} className="text-xs text-slate-600 bg-white border border-amber-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400/30 cursor-pointer">
              {TICKET_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          )}
          <select value={conv.assigned_agent_id ?? ''} onChange={e => onAssign(e.target.value || null)} className="text-xs text-slate-600 bg-white border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 cursor-pointer">
            <option value="">Unassigned</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {!conv.is_ticket && nextStatus[conv.status] && (
            <button
              onClick={() => {
                const next = nextStatus[conv.status]!
                if (next === 'closed') { setCsatDialog(true) } else { onStatusChange(next) }
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-all"
            >{statusActionLabel[conv.status]}</button>
          )}
          {csatDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setCsatDialog(false)}>
              <div className="bg-white rounded-xl shadow-xl p-6 max-w-xs w-full mx-4" onClick={e => e.stopPropagation()}>
                <h3 className="text-sm font-semibold text-slate-900 mb-1">Close conversation</h3>
                <p className="text-xs text-slate-500 mb-5">Send a satisfaction survey to the visitor before closing?</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => { setCsatDialog(false); onStatusChange('closed', true) }}
                    className="flex-1 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors"
                  >Send Survey &amp; Close</button>
                  <button
                    onClick={() => { setCsatDialog(false); onStatusChange('closed', false) }}
                    className="flex-1 py-2 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                  >Just Close</button>
                </div>
                <button onClick={() => setCsatDialog(false)} className="mt-3 w-full text-xs text-slate-400 hover:text-slate-600 text-center">Cancel</button>
              </div>
            </div>
          )}
          <button onClick={handleExport} disabled={exporting} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-all">{exporting ? <RefreshCw size={12} className="animate-spin" /> : <FileDown size={12} />}PDF</button>
          <div ref={menuRef} className="relative">
            <button onClick={() => setMenuOpen(m => !m)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"><MoreHorizontal size={16} /></button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-30 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                {onPriorityChange && (
                  <>
                    <p className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Priority</p>
                    {(['low','normal','high','urgent'] as Priority[]).map(p => (
                      <button key={p} onClick={() => { onPriorityChange(p); setMenuOpen(false) }} className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2 capitalize ${conv.priority === p ? 'text-sky-600 font-semibold' : 'text-slate-700'}`}>
                        {p === 'urgent' ? '🔴' : p === 'high' ? '🟠' : p === 'normal' ? '🟡' : '⚪'} {p}{conv.priority === p && <Check size={11} className="ml-auto text-sky-500" />}
                      </button>
                    ))}
                    <div className="border-t border-slate-100 mt-1 pt-1" />
                  </>
                )}
                <p className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">CSAT Rating</p>
                <div className="px-3 pb-2 flex gap-1">
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => { handleCsatSet(n); setMenuOpen(false) }} className="p-0.5">
                      <Star size={16} className={n <= csatScore ? 'text-amber-400 fill-amber-400' : 'text-slate-200 fill-slate-200 hover:text-amber-300'} />
                    </button>
                  ))}
                </div>
                <div className="border-t border-slate-100 mt-1 pt-1" />
                <button onClick={() => { navigator.clipboard.writeText(conv.id); setMenuOpen(false) }} className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"><Copy size={11} />Copy ID</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && <div className={`mx-4 mt-3 p-3 rounded-lg text-xs flex items-center gap-2 ${toast.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>{toast.type === 'success' ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0" /> : <AlertTriangle size={14} className="text-red-500 shrink-0" />}<span>{toast.msg}</span></div>}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center"><MessageSquare size={32} className="text-slate-200 mb-2" /><p className="text-sm text-slate-400">No messages yet</p></div>
          ) : messages.map((m, i) => {
            const isLastAgent = (m.sender_type === 'agent' || m.sender_type === 'bot') && !m.is_internal_note &&
              messages.slice(i + 1).every(x => (x.sender_type !== 'agent' && x.sender_type !== 'bot') || x.is_internal_note)
            return <MessageBubble key={m.id} msg={m} visitorName={conv.visitor_name} onEdit={onEditMessage} onDelete={onDeleteMessage} isLastAgentMsg={isLastAgent} readAt={isLastAgent ? visitorReadAt : null} />
          })}
          <div ref={bottomRef} />
        </div>
        <VisitorInfoPanel conv={conv} currentPage={currentPage} />
      </div>

      {typingWho && (
        <div className="px-4 pb-1 flex items-center gap-1.5">
          <span className="flex gap-0.5 items-center">
            <span className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce [animation-delay:300ms]" />
          </span>
          <span className="text-xs text-slate-500 italic">{typingWho} is typing…</span>
        </div>
      )}
      <EmailComposeBox conv={conv} onSend={onSend} disabled={conv.status === 'closed'} />
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

// ─── Modal wrapper ────────────────────────────────────────────────────────────
function Modal({ onClose, children, wide }: { onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl ${wide ? 'w-full max-w-2xl' : 'w-full max-w-md'} p-6 max-h-[90vh] overflow-y-auto`}>{children}</div>
    </div>
  )
}

// ─── CopyButton ──────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  return <button onClick={handle} className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-400 hover:text-slate-200 transition-colors rounded">{copied ? <><Check size={10} className="text-emerald-400" /> Copied</> : <><Copy size={10} /> Copy</>}</button>
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
        <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Widget Color</label><div className="flex items-center gap-3"><input type="color" value={form.color} onChange={set('color')} className="w-10 h-9 rounded border border-slate-200 cursor-pointer" /><span className="text-xs text-slate-500">{form.color}</span></div></div>
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
    try { await api.deleteBrand(deleteBrand.id); setBrands(prev => prev.filter(b => b.id !== deleteBrand.id)); setDeleteBrand(null) }
    catch (err) { setDelError((err as Error).message) }
    finally { setDeleting(false) }
  }

  return (
    <>
      {showAdd && <AddBrandModal onClose={() => setShowAdd(false)} onCreated={handleBrandCreated} />}
      {editBrand && <EditBrandModal brand={editBrand} onClose={() => setEditBrand(null)} onSaved={handleBrandSaved} />}
      {deleteBrand && (
        <Modal onClose={() => setDeleteBrand(null)}>
          <div className="flex items-center justify-between mb-4"><h2 className="text-base font-semibold text-slate-900">Delete Brand</h2><button onClick={() => setDeleteBrand(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
          <p className="text-sm text-slate-600 mb-2">Are you sure you want to delete <strong>{deleteBrand.brand_name}</strong>? This will remove all associated conversations and data.</p>
          {delError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{delError}</div>}
          <div className="flex gap-2 mt-4">
            <button onClick={() => setDeleteBrand(null)} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={handleDelete} disabled={deleting} className="flex-1 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{deleting ? <><RefreshCw size={11} className="animate-spin" /> Deleting…</> : <><Trash2 size={11} /> Delete</>}</button>
          </div>
        </Modal>
      )}
      <div className="flex-1 overflow-auto p-6 bg-slate-50">
        <div className="max-w-3xl">
          <div className="flex items-center justify-between mb-6">
            <div><h2 className="text-base font-semibold text-slate-900">Brands</h2><p className="text-xs text-slate-500 mt-0.5">Manage your support brands and widget configurations</p></div>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-md hover:bg-sky-700 transition-colors"><Plus size={13} /> Add Brand</button>
          </div>
          {loading ? <div className="flex items-center justify-center py-16 gap-2 text-slate-400"><RefreshCw size={16} className="animate-spin" /> Loading…</div> : brands.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-slate-200"><Building2 size={32} className="mx-auto mb-3 text-slate-300" /><p className="text-sm text-slate-500">No brands yet</p><button onClick={() => setShowAdd(true)} className="mt-3 px-4 py-2 text-xs font-medium text-sky-600 border border-sky-200 rounded-lg hover:bg-sky-50">Create your first brand</button></div>
          ) : (
            <div className="space-y-3">
              {brands.map(brand => {
                const cfg = brand.widget_config_json ?? {}
                const widgetSrc = `${origin}/api/widget/widget.js`
                const snippet = `<script src="${widgetSrc}" data-brand-id="${brand.id}" defer></script>`
                return (
                  <div key={brand.id} className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ backgroundColor: cfg.color || '#0ea5e9' }}>{brand.brand_name[0]?.toUpperCase()}</div>
                        <div><p className="text-sm font-semibold text-slate-900">{brand.brand_name}</p>{cfg.website_url && <a href={cfg.website_url} target="_blank" rel="noreferrer" className="text-xs text-sky-600 hover:underline">{cfg.website_url}</a>}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setEditBrand(brand)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => setDeleteBrand(brand)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </div>
                    {cfg.support_email && <p className="text-xs text-slate-500 mb-3 flex items-center gap-1.5"><Mail size={11} /> {cfg.support_email}</p>}
                    <div className="bg-slate-900 rounded-lg p-3 flex items-start justify-between gap-2">
                      <code className="text-[10px] text-emerald-400 font-mono break-all leading-relaxed flex-1">{snippet}</code>
                      <CopyButton text={snippet} />
                    </div>
                    {brand.inbound_email_prefix && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <p className="text-[11px] font-medium text-slate-500 mb-1.5 flex items-center gap-1"><Mail size={11} /> Inbound email webhook</p>
                        <div className="bg-slate-900 rounded-lg p-3 flex items-start justify-between gap-2 mb-1.5">
                          <code className="text-[10px] text-sky-400 font-mono break-all leading-relaxed flex-1">{`POST ${origin}/api/webhooks/inbound-mail`}</code>
                          <CopyButton text={`${origin}/api/webhooks/inbound-mail`} />
                        </div>
                        <p className="text-[10px] text-slate-400 leading-relaxed">Point your email provider's inbound parse webhook (SendGrid, Mailgun, Postmark) to this URL. Emails with prefix <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600">{brand.inbound_email_prefix}</code> will open or thread conversations automatically.</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Billing Section ──────────────────────────────────────────────────────────
function BillingSection() {
  const api = useApi()
  const [submitting, setSub] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [form, setForm] = useState({ requested_plan: 'pro', company_size: '', notes: '' })
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setSub(true)
    try { await api.createUpgradeRequest(form.requested_plan, form.company_size, form.notes); setSubmitted(true) }
    catch (err) { setError((err as Error).message) }
    finally { setSub(false) }
  }

  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-2xl">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Billing & Plans</h2>
        <p className="text-xs text-slate-500 mb-6">Manage your subscription and usage</p>
        {submitted ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center"><CheckCircle2 size={28} className="text-emerald-500 mx-auto mb-3" /><p className="text-sm font-semibold text-emerald-800">Upgrade request submitted!</p><p className="text-xs text-emerald-600 mt-1">Our team will contact you within 24 hours.</p></div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Request Plan Upgrade</h3>
            {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Desired Plan</label>
                <select value={form.requested_plan} onChange={e => setForm(f => ({ ...f, requested_plan: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30">
                  <option value="pro">Pro — $49/mo</option><option value="business">Business — $149/mo</option><option value="enterprise">Enterprise — Custom</option>
                </select>
              </div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Company Size</label><input type="text" value={form.company_size} onChange={e => setForm(f => ({ ...f, company_size: e.target.value }))} placeholder="e.g. 50 employees" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Notes</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Any specific requirements…" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 resize-none" /></div>
              <button type="submit" disabled={submitting} className="px-4 py-2 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5">{submitting ? <><RefreshCw size={11} className="animate-spin" /> Submitting…</> : 'Submit Request'}</button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── CSAT Section ─────────────────────────────────────────────────────────────
function CsatSection({ brands }: { brands: Brand[] }) {
  const api = useApi()
  const [data, setData]           = useState<CsatAgent[]>([])
  const [loading, setLoading]     = useState(true)
  const [brandFilter, setBrand]   = useState('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [sortBy, setSortBy]       = useState<'avg_csat_score' | 'total_assigned' | 'closed_today' | 'participated_today' | 'avg_first_response_minutes'>('avg_csat_score')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (brandFilter) params.brand_id = brandFilter
      if (dateFrom)    params.date_from = dateFrom
      if (dateTo)      params.date_to   = dateTo
      const result = await api.getCsatReport(params)
      setData(result)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [brandFilter, dateFrom, dateTo]) // eslint-disable-line

  useEffect(() => { load() }, [load])

  const sorted = [...data].sort((a, b) => {
    const av = (a[sortBy] as number | null) ?? -1
    const bv = (b[sortBy] as number | null) ?? -1
    if (sortBy === 'avg_first_response_minutes') return av - bv
    return bv - av
  })

  const totals = data.reduce((acc, a) => ({
    total_assigned: acc.total_assigned + a.total_assigned,
    closed_count:   acc.closed_count + a.closed_count,
    rated_count:    acc.rated_count + a.rated_count,
    positive_ratings: acc.positive_ratings + a.positive_ratings,
    closed_today:   acc.closed_today + a.closed_today,
    participated_today: acc.participated_today + a.participated_today,
  }), { total_assigned: 0, closed_count: 0, rated_count: 0, positive_ratings: 0, closed_today: 0, participated_today: 0 })

  const overallCsat = data.length && data.some(a => a.avg_csat_score !== null)
    ? (data.reduce((s, a) => s + (a.avg_csat_score ?? 0) * a.rated_count, 0) / Math.max(1, totals.rated_count)).toFixed(2)
    : null

  const SortBtn = ({ field, label }: { field: typeof sortBy; label: string }) => (
    <button onClick={() => setSortBy(field)} className={`text-[11px] font-medium px-2 py-1 rounded transition-colors ${sortBy === field ? 'bg-sky-100 text-sky-700' : 'text-slate-500 hover:bg-slate-100'}`}>{label}</button>
  )

  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div><h2 className="text-base font-semibold text-slate-900 flex items-center gap-2"><BarChart2 size={16} className="text-sky-600" /> CSAT & Agent Performance</h2><p className="text-xs text-slate-500 mt-0.5">Customer satisfaction scores and productivity metrics per agent</p></div>
          <button onClick={load} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"><RefreshCw size={12} /> Refresh</button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <select value={brandFilter} onChange={e => setBrand(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500/30 min-w-[140px]">
            <option value="">All Brands</option>
            {brands.map(b => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500/30" placeholder="From" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500/30" placeholder="To" />
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Overall CSAT', value: overallCsat ? `${overallCsat}/5.0` : '—', icon: <Star size={16} className="text-amber-500" />, color: 'bg-amber-50 border-amber-200' },
            { label: 'Total Assigned', value: totals.total_assigned, icon: <MessageCircle size={16} className="text-sky-500" />, color: 'bg-sky-50 border-sky-200' },
            { label: 'Closed Today', value: totals.closed_today, icon: <CheckCircle2 size={16} className="text-emerald-500" />, color: 'bg-emerald-50 border-emerald-200' },
            { label: 'Positive Ratings', value: totals.rated_count ? `${Math.round(totals.positive_ratings / totals.rated_count * 100)}%` : '—', icon: <ThumbsUp size={16} className="text-indigo-500" />, color: 'bg-indigo-50 border-indigo-200' },
          ].map(card => (
            <div key={card.label} className={`bg-white border rounded-xl p-4 ${card.color}`}>
              <div className="flex items-center gap-2 mb-1">{card.icon}<span className="text-xs font-medium text-slate-600">{card.label}</span></div>
              <p className="text-2xl font-bold text-slate-900">{card.value}</p>
            </div>
          ))}
        </div>

        {/* Sort controls */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <span className="text-xs text-slate-400 mr-1">Sort by:</span>
          <SortBtn field="avg_csat_score" label="CSAT Score" />
          <SortBtn field="total_assigned" label="Assigned" />
          <SortBtn field="closed_today" label="Closed Today" />
          <SortBtn field="participated_today" label="Active Today" />
          <SortBtn field="avg_first_response_minutes" label="Response Time ↑" />
        </div>

        {/* Agent Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-slate-400"><RefreshCw size={16} className="animate-spin" /> Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200"><BarChart2 size={28} className="mx-auto mb-3 text-slate-300" /><p className="text-sm text-slate-400">No data yet</p></div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Agent', 'CSAT Score', 'Rating Distribution', 'Assigned', 'Closed', 'Closed Today', 'Active Today', 'Avg 1st Reply'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map((agent, i) => (
                    <tr key={agent.agent_id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {i < 3 && <Award size={13} className={i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-400' : 'text-amber-700'} />}
                          <div className="w-7 h-7 bg-sky-600 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">{agent.agent_name[0]?.toUpperCase()}</div>
                          <div>
                            <p className="text-xs font-semibold text-slate-800">{agent.agent_name}</p>
                            <p className="text-[10px] text-slate-400">{agent.agent_email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {agent.avg_csat_score !== null ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-slate-800">{agent.avg_csat_score}</span>
                            <StarRating score={Math.round(agent.avg_csat_score)} />
                            <span className="text-[10px] text-slate-400">({agent.rated_count})</span>
                          </div>
                        ) : <span className="text-xs text-slate-300">No ratings</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-0.5 items-center">
                          {[5,4,3,2,1].map(n => {
                            const count = agent[`${['five','four','three','two','one'][5-n]}_star` as keyof CsatAgent] as number
                            const pct = agent.rated_count ? Math.round(count / agent.rated_count * 100) : 0
                            return (
                              <div key={n} className="flex flex-col items-center gap-0.5" title={`${n}★: ${count}`}>
                                <div className="w-4 bg-slate-100 rounded-full overflow-hidden" style={{ height: 24 }}>
                                  <div className={`w-full rounded-full ${n >= 4 ? 'bg-emerald-400' : n === 3 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ height: `${pct}%`, marginTop: `${100-pct}%` }} />
                                </div>
                                <span className="text-[8px] text-slate-400">{n}★</span>
                              </div>
                            )
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3"><span className="text-xs font-semibold text-slate-700">{agent.total_assigned}</span></td>
                      <td className="px-4 py-3"><span className="text-xs text-slate-600">{agent.closed_count}</span></td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold ${agent.closed_today > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{agent.closed_today}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold ${agent.participated_today > 0 ? 'text-sky-600' : 'text-slate-400'}`}>{agent.participated_today}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-slate-600">
                          {agent.avg_first_response_minutes !== null ? `${agent.avg_first_response_minutes}m` : '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Settings Section ─────────────────────────────────────────────────────────
function SettingsSection() {
  const api = useApi()
  const { agent } = useAuth() as { agent: { name: string; email: string; role: string } | null }
  const [panel, setPanel] = useState<'profile' | 'workspace' | 'smtp' | 'ai_training' | 'webhook' | null>(null)
  const [articles, setArticles]       = useState<KnowledgeArticle[]>([])
  const [artLoading, setArtLoading]   = useState(false)
  const [artForm, setArtForm]         = useState({ title: '', content: '', tags: '' })
  const [artEditing, setArtEditing]   = useState<KnowledgeArticle | null>(null)
  const [artSaving, setArtSaving]     = useState(false)
  const [artMsg, setArtMsg]           = useState<{ ok: boolean; text: string } | null>(null)
  const [webhookUrl, setWebhookUrl]   = useState<string>('')

  const [profileForm, setProfile] = useState({ name: agent?.name ?? '', password: '', confirm: '' })
  const [profileSaving, setPS]    = useState(false)
  const [profileMsg, setPMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  const [wsForm, setWs] = useState({ company_name: '', default_timezone: 'UTC', ai_auto_reply_enabled: false, custom_domain: '', ai_feature_enabled: true, smtp_feature_enabled: true })
  const [wsSaving, setWS] = useState(false)
  const [wsMsg, setWsMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [smtpForm, setSmtp] = useState({ host: '', port: '587', user: '', pass: '', from_email: '', notification_email: '', enabled: false })
  const [smtpSaving, setSmtpSaving] = useState(false)
  const [smtpMsg, setSmtpMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [imapForm, setImap] = useState({ host: '', port: '993', user: '', pass: '', folder: 'INBOX', tls: true, enabled: false })
  const [imapSaving, setImapSaving] = useState(false)
  const [imapMsg, setImapMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    api.getWorkspaceSettings().then(s => {
      if (s.company_name !== undefined) setWs(f => ({ ...f, company_name: s.company_name ?? '' }))
      if (s.default_timezone)           setWs(f => ({ ...f, default_timezone: s.default_timezone ?? 'UTC' }))
      if (s.ai_auto_reply_enabled !== undefined) setWs(f => ({ ...f, ai_auto_reply_enabled: !!s.ai_auto_reply_enabled }))
      if (s.ai_feature_enabled   !== undefined) setWs(f => ({ ...f, ai_feature_enabled:   !!s.ai_feature_enabled }))
      if (s.smtp_feature_enabled !== undefined) setWs(f => ({ ...f, smtp_feature_enabled: !!s.smtp_feature_enabled }))
      if (s.custom_domain) setWs(f => ({ ...f, custom_domain: s.custom_domain ?? '' }))
      const sc = s.smtp_config_json
      if (sc) setSmtp(f => ({ ...f, host: String(sc.host ?? ''), port: String(sc.port ?? '587'), user: String(sc.user ?? ''), from_email: String(sc.from_email ?? ''), notification_email: String(sc.notification_email ?? ''), enabled: !!sc.enabled }))
      const ic = s.imap_config_json
      if (ic && Object.keys(ic).length) setImap(f => ({ ...f, host: String(ic.host ?? ''), port: String(ic.port ?? '993'), user: String(ic.user ?? ''), folder: String(ic.folder ?? 'INBOX'), tls: ic.tls !== false, enabled: !!ic.enabled }))
    }).catch(() => {})
  }, []) // eslint-disable-line

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault(); setPMsg(null)
    if (profileForm.password && profileForm.password !== profileForm.confirm) { setPMsg({ ok: false, text: 'Passwords do not match' }); return }
    setPS(true)
    try { await api.updateProfile(profileForm.name.trim() || undefined, profileForm.password || undefined); setPMsg({ ok: true, text: 'Profile updated! Re-login to see name changes.' }); setProfile(f => ({ ...f, password: '', confirm: '' })) }
    catch (err) { setPMsg({ ok: false, text: (err as Error).message }) }
    finally { setPS(false) }
  }

  const handleWsSave = async (e: React.FormEvent) => {
    e.preventDefault(); setWsMsg(null); setWS(true)
    try {
      await api.updateWorkspace({ company_name: wsForm.company_name || undefined, default_timezone: wsForm.default_timezone, ai_auto_reply_enabled: wsForm.ai_auto_reply_enabled, custom_domain: wsForm.custom_domain || undefined, ai_feature_enabled: wsForm.ai_feature_enabled, smtp_feature_enabled: wsForm.smtp_feature_enabled })
      setWsMsg({ ok: true, text: 'Workspace settings saved.' })
    }
    catch (err) { setWsMsg({ ok: false, text: (err as Error).message }) }
    finally { setWS(false) }
  }

  const handleSmtpSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSmtpMsg(null); setSmtpSaving(true)
    try {
      await api.updateWorkspace({ smtp_config_json: { host: smtpForm.host.trim(), port: parseInt(smtpForm.port, 10) || 587, user: smtpForm.user.trim(), pass: smtpForm.pass, from_email: smtpForm.from_email.trim(), notification_email: smtpForm.notification_email.trim() || undefined, enabled: smtpForm.enabled } })
      setSmtpMsg({ ok: true, text: 'SMTP configuration saved.' })
    }
    catch (err) { setSmtpMsg({ ok: false, text: (err as Error).message }) }
    finally { setSmtpSaving(false) }
  }

  const panels: { key: 'profile' | 'workspace' | 'smtp' | 'ai_training' | 'webhook'; label: string; desc: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { key: 'profile',     label: 'Profile',             desc: 'Update your name and password',                   icon: <User size={14} /> },
    { key: 'workspace',   label: 'Workspace Settings',  desc: 'Company name, timezone, AI auto-reply',           icon: <Building size={14} />, adminOnly: true },
    { key: 'smtp',        label: 'SMTP / Email Config', desc: 'Send ticket alerts via your own mail server',     icon: <Mail size={14} />, adminOnly: true },
    { key: 'ai_training', label: 'AI Training',         desc: 'Knowledge base articles for AI auto-reply',      icon: <Brain size={14} />, adminOnly: true },
    { key: 'webhook',     label: 'Inbound Email Webhook', desc: 'Receive inbound emails as conversations',       icon: <Webhook size={14} />, adminOnly: true },
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
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Custom Domain</label><input type="text" value={wsForm.custom_domain} onChange={e => setWs(f => ({ ...f, custom_domain: e.target.value }))} placeholder="support.acme.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Default Timezone</label>
                      <select value={wsForm.default_timezone} onChange={e => setWs(f => ({ ...f, default_timezone: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400">
                        {['UTC','America/New_York','America/Chicago','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Tokyo','Asia/Singapore','Asia/Dubai'].map(tz => <option key={tz}>{tz}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div><p className="text-xs font-medium text-slate-700">AI Auto-Reply</p><p className="text-[11px] text-slate-400">Automatically reply to new conversations with AI</p></div>
                      <button type="button" onClick={() => setWs(f => ({ ...f, ai_auto_reply_enabled: !f.ai_auto_reply_enabled }))} className={`${wsForm.ai_auto_reply_enabled ? 'text-sky-500' : 'text-slate-400'} transition-colors`}>{wsForm.ai_auto_reply_enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}</button>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div><p className="text-xs font-medium text-slate-700">AI Features</p><p className="text-[11px] text-slate-400">Enable AI capabilities for your workspace</p></div>
                      <button type="button" onClick={() => setWs(f => ({ ...f, ai_feature_enabled: !f.ai_feature_enabled }))} className={`${wsForm.ai_feature_enabled ? 'text-sky-500' : 'text-slate-400'} transition-colors`}>{wsForm.ai_feature_enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}</button>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div><p className="text-xs font-medium text-slate-700">SMTP / Email Alerts</p><p className="text-[11px] text-slate-400">Allow custom SMTP for status-change notifications</p></div>
                      <button type="button" onClick={() => setWs(f => ({ ...f, smtp_feature_enabled: !f.smtp_feature_enabled }))} className={`${wsForm.smtp_feature_enabled ? 'text-sky-500' : 'text-slate-400'} transition-colors`}>{wsForm.smtp_feature_enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}</button>
                    </div>
                    <button type="submit" disabled={wsSaving} className="px-4 py-2 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5">{wsSaving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : 'Save Settings'}</button>
                  </form>
                </div>
              )}

              {panel === 'smtp' && item.key === 'smtp' && (
                <div className="mt-2 p-5 bg-white border border-slate-200 rounded-xl">
                  <p className="text-xs text-slate-500 mb-4">Configure your outbound SMTP server for status-change alerts.</p>
                  {smtpMsg && <div className={`mb-3 p-2 rounded text-xs ${smtpMsg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>{smtpMsg.text}</div>}
                  <form onSubmit={handleSmtpSave} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="block text-xs font-medium text-slate-600 mb-1.5">SMTP Host</label><input type="text" value={smtpForm.host} onChange={e => setSmtp(f => ({ ...f, host: e.target.value }))} placeholder="smtp.sendgrid.net" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                      <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Port</label><input type="number" value={smtpForm.port} onChange={e => setSmtp(f => ({ ...f, port: e.target.value }))} placeholder="587" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                    </div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">SMTP Username</label><input type="text" value={smtpForm.user} onChange={e => setSmtp(f => ({ ...f, user: e.target.value }))} placeholder="apikey or your@email.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">SMTP Password / API Key</label><input type="password" value={smtpForm.pass} onChange={e => setSmtp(f => ({ ...f, pass: e.target.value }))} placeholder="••••••••••••" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">From Email</label><input type="email" value={smtpForm.from_email} onChange={e => setSmtp(f => ({ ...f, from_email: e.target.value }))} placeholder="support@acme.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Inbox Notification Email <span className="text-slate-400 font-normal">(alert address for new visitor messages)</span></label><input type="email" value={smtpForm.notification_email} onChange={e => setSmtp(f => ({ ...f, notification_email: e.target.value }))} placeholder="owner@acme.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all" /></div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div><p className="text-xs font-medium text-slate-700">Enable SMTP Alerts</p><p className="text-[11px] text-slate-400">Send email on ticket status changes and visitor messages</p></div>
                      <button type="button" onClick={() => setSmtp(f => ({ ...f, enabled: !f.enabled }))} className={`${smtpForm.enabled ? 'text-sky-500' : 'text-slate-400'} transition-colors`}>{smtpForm.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}</button>
                    </div>
                    <button type="submit" disabled={smtpSaving} className="px-4 py-2 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5">{smtpSaving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : 'Save SMTP Config'}</button>
                  </form>
                </div>
              )}

              {panel === 'ai_training' && item.key === 'ai_training' && (
                <AITrainingPanel
                  articles={articles} loading={artLoading} form={artForm} editing={artEditing} saving={artSaving} msg={artMsg}
                  onLoad={() => { setArtLoading(true); api.listKnowledge().then(a => { setArticles(a); setArtLoading(false) }).catch(() => setArtLoading(false)) }}
                  onFormChange={setArtForm}
                  onEdit={(a) => { setArtEditing(a); setArtForm({ title: a.title, content: a.content, tags: a.tags.join(', ') }) }}
                  onCancel={() => { setArtEditing(null); setArtForm({ title: '', content: '', tags: '' }) }}
                  onSave={async () => {
                    setArtSaving(true); setArtMsg(null)
                    const tags = artForm.tags.split(',').map(t => t.trim()).filter(Boolean)
                    try {
                      if (artEditing) {
                        const updated = await api.updateKnowledge(artEditing.id, { title: artForm.title, content: artForm.content, tags })
                        setArticles(prev => prev.map(a => a.id === artEditing.id ? updated : a))
                        setArtEditing(null)
                      } else {
                        const created = await api.createKnowledge({ title: artForm.title, content: artForm.content, tags })
                        setArticles(prev => [...prev, created])
                      }
                      setArtForm({ title: '', content: '', tags: '' })
                      setArtMsg({ ok: true, text: artEditing ? 'Article updated.' : 'Article created.' })
                    } catch (err) { setArtMsg({ ok: false, text: (err as Error).message }) }
                    finally { setArtSaving(false) }
                  }}
                  onDelete={async (id) => {
                    try { await api.deleteKnowledge(id); setArticles(prev => prev.filter(a => a.id !== id)) }
                    catch { /* ignore */ }
                  }}
                  onToggle={async (a) => {
                    try {
                      const updated = await api.updateKnowledge(a.id, { is_active: !a.is_active })
                      setArticles(prev => prev.map(x => x.id === a.id ? updated : x))
                    } catch { /* ignore */ }
                  }}
                />
              )}

              {panel === 'webhook' && item.key === 'webhook' && (
                <WebhookPanel webhookUrl={webhookUrl} onLoad={() => setWebhookUrl(window.location.origin.replace('5174','8080').replace('/dashboard','') + '/api/webhooks/email/inbound')} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AITrainingPanel({ articles, loading, form, editing, saving, msg, onLoad, onFormChange, onEdit, onCancel, onSave, onDelete, onToggle }: {
  articles: KnowledgeArticle[]; loading: boolean
  form: { title: string; content: string; tags: string }; editing: KnowledgeArticle | null
  saving: boolean; msg: { ok: boolean; text: string } | null
  onLoad: () => void; onFormChange: (f: { title: string; content: string; tags: string }) => void
  onEdit: (a: KnowledgeArticle) => void; onCancel: () => void; onSave: () => Promise<void>
  onDelete: (id: string) => Promise<void>; onToggle: (a: KnowledgeArticle) => Promise<void>
}) {
  useEffect(() => { onLoad() }, []) // eslint-disable-line
  return (
    <div className="mt-2 p-5 bg-white border border-slate-200 rounded-xl space-y-4">
      <div>
        <p className="text-xs font-semibold text-slate-700 mb-1">Knowledge Base Articles</p>
        <p className="text-[11px] text-slate-400">Articles used by the AI when auto-replying to visitor messages.</p>
      </div>
      {msg && <div className={`p-2 rounded text-xs ${msg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>{msg.text}</div>}
      <div className="space-y-2">
        <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Title *</label><input type="text" value={form.title} onChange={e => onFormChange({ ...form, title: e.target.value })} placeholder="How to reset your password" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
        <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Content *</label><textarea rows={4} value={form.content} onChange={e => onFormChange({ ...form, content: e.target.value })} placeholder="Write the article content here…" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 resize-none" /></div>
        <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Tags <span className="text-slate-400 font-normal">(comma-separated)</span></label><input type="text" value={form.tags} onChange={e => onFormChange({ ...form, tags: e.target.value })} placeholder="billing, password, account" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
        <div className="flex gap-2">
          {editing && <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>}
          <button type="button" disabled={saving || !form.title.trim() || !form.content.trim()} onClick={onSave} className="px-4 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5">{saving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : editing ? <><Pencil size={11} /> Update Article</> : <><Plus size={11} /> Add Article</>}</button>
        </div>
      </div>
      <div className="border-t border-slate-100 pt-3">
        {loading ? <div className="flex items-center gap-2 text-slate-400 text-xs py-4"><RefreshCw size={13} className="animate-spin" /> Loading articles…</div> : articles.length === 0 ? (
          <div className="text-center py-6"><BookOpen size={24} className="mx-auto text-slate-200 mb-2" /><p className="text-xs text-slate-400">No articles yet. Add your first one above.</p></div>
        ) : (
          <div className="space-y-2">
            {articles.map(a => (
              <div key={a.id} className="flex items-start justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-xs font-semibold text-slate-800 truncate">{a.title}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${a.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>{a.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-2">{a.content}</p>
                  {a.tags.length > 0 && <div className="flex gap-1 mt-1 flex-wrap">{a.tags.map(t => <span key={t} className="text-[10px] bg-sky-50 text-sky-600 px-1.5 py-0.5 rounded">{t}</span>)}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => onToggle(a)} className={`p-1.5 rounded transition-colors ${a.is_active ? 'text-sky-500 hover:bg-sky-50' : 'text-slate-400 hover:bg-slate-100'}`}>{a.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}</button>
                  <button onClick={() => onEdit(a)} className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors"><Pencil size={12} /></button>
                  <button onClick={() => onDelete(a.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function WebhookPanel({ webhookUrl, onLoad }: { webhookUrl: string; onLoad: () => void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => { onLoad() }, []) // eslint-disable-line
  const copy = () => { navigator.clipboard.writeText(webhookUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }) }
  return (
    <div className="mt-2 p-5 bg-white border border-slate-200 rounded-xl space-y-4">
      <div>
        <p className="text-xs font-semibold text-slate-700 mb-1">Inbound Email Webhook URL</p>
        <p className="text-[11px] text-slate-400">Configure your email provider (SendGrid, Resend, Postmark…) to forward inbound emails to this URL. Each email becomes a conversation in your inbox.</p>
      </div>
      <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
        <code className="flex-1 text-xs text-slate-700 break-all font-mono">{webhookUrl || 'Loading…'}</code>
        <button onClick={copy} className="shrink-0 p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors">{copied ? <Check size={14} className="text-emerald-500" /> : <Link2 size={14} />}</button>
      </div>
      <div className="p-3 bg-sky-50 border border-sky-100 rounded-lg">
        <p className="text-[11px] text-sky-700 font-medium mb-1">Setup instructions</p>
        <ol className="text-[11px] text-sky-600 space-y-1 list-decimal list-inside">
          <li>Copy the URL above</li>
          <li>In your email provider, enable Inbound Parse / Webhook and paste the URL</li>
          <li>Set the routing prefix for each brand in the brand settings</li>
          <li>Inbound emails are matched by prefix and create or thread conversations automatically</li>
        </ol>
      </div>
    </div>
  )
}

// ─── Team Section ─────────────────────────────────────────────────────────────
function TeamSection() {
  const api = useApi()
  const { agent: me } = useAuth() as { agent: { id: string } | null }
  const [agents, setAgents]         = useState<AgentRow[]>([])
  const [loading, setLoading]       = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'agent' })
  const [inviting, setInviting]     = useState(false)
  const [inviteErr, setInviteErr]   = useState<string | null>(null)
  const [removing, setRemoving]     = useState<string | null>(null)

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
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Role</label>
              <select value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400">
                <option value="agent">Agent</option><option value="admin">Admin</option>
              </select>
            </div>
            <p className="text-[11px] text-slate-400">Temporary password: <code className="bg-slate-100 px-1 rounded">Welcome1!</code></p>
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
          {loading ? <div className="flex items-center justify-center py-12 gap-2 text-slate-400 text-sm"><RefreshCw size={16} className="animate-spin" /> Loading…</div> : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {agents.length === 0 ? <div className="text-center py-12 text-slate-400"><Users size={28} className="mx-auto mb-2 text-slate-300" /><p className="text-sm">No agents yet</p></div> : agents.map((a, i) => (
                <div key={a.id} className={`flex items-center justify-between px-4 py-3 ${i < agents.length - 1 ? 'border-b border-slate-100' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-sky-600 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">{a.name[0]?.toUpperCase()}</div>
                    <div><p className="text-sm font-medium text-slate-800">{a.name} {a.id === me?.id && <span className="text-[10px] text-sky-600 font-semibold">(you)</span>}</p><p className="text-xs text-slate-400">{a.email}</p></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide ${a.role === 'admin' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>{a.role}</span>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${a.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{a.is_active ? 'Active' : 'Inactive'}</span>
                    {a.id !== me?.id && <button onClick={() => handleRemove(a.id)} disabled={removing === a.id} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-40">{removing === a.id ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}</button>}
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
  const [tenants, setTenants]         = useState<SANTenant[]>([])
  const [requests, setRequests]       = useState<UpgradeRequest[]>([])
  const [loading, setLoading]         = useState(true)
  const [tab, setTab]                 = useState<'tenants' | 'requests' | 'super_admins'>('tenants')
  const [actionTenant, setAction]     = useState<SANTenant | null>(null)
  const [purgeTarget, setPurge]       = useState<SANTenant | null>(null)
  const [purgeConfirm, setPConf]      = useState('')
  const [purging, setPurging]         = useState(false)
  const [purgeErr, setPurgeErr]       = useState<string | null>(null)
  const [billingTarget, setBilling]   = useState<SANTenant | null>(null)
  const [billingForm, setBForm]       = useState({ plan: 'free', subscription_status: 'active' })
  const [saving, setSaving]           = useState(false)
  const [limitsTarget, setLimits]     = useState<SANTenant | null>(null)
  const [limitsForm, setLimitsForm]   = useState({ max_brands_allowed: 3, max_agents_allowed: 10, ai_feature_enabled: true, smtp_feature_enabled: true, conversation_limit: 1000 })
  const [limitsSaving, setLSaving]    = useState(false)
  const [limitsErr, setLimitsErr]     = useState<string | null>(null)
  const [showCreate, setShowCreate]   = useState(false)
  const [createForm, setCreateForm]   = useState({ company_name: '', admin_name: '', admin_email: '', admin_password: '' })
  const [creating, setCreating]       = useState(false)
  const [createErr, setCreateErr]     = useState<string | null>(null)
  const [createResult, setCreateResult] = useState<{ tenant: SANTenant; agent: AgentRow; temp_password: string } | null>(null)

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
    e.preventDefault(); if (!billingTarget) return; setSaving(true)
    try { await api.patchTenantBilling(billingTarget.id, billingForm.plan, billingForm.subscription_status); setTenants(prev => prev.map(x => x.id === billingTarget.id ? { ...x, plan: billingForm.plan, subscription_status: billingForm.subscription_status } : x)); setBilling(null) }
    catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const handleLimitsSave = async (e: React.FormEvent) => {
    e.preventDefault(); if (!limitsTarget) return; setLimitsErr(null); setLSaving(true)
    try {
      await api.patchTenantLimits(limitsTarget.id, limitsForm)
      setTenants(prev => prev.map(x => x.id === limitsTarget.id ? { ...x, ...limitsForm } : x))
      setLimits(null)
    }
    catch (err) { setLimitsErr((err as Error).message) }
    finally { setLSaving(false) }
  }

  const handlePurge = async () => {
    if (!purgeTarget) return; setPurgeErr(null); setPurging(true)
    try { await api.purgeTenant(purgeTarget.id, purgeConfirm); setTenants(prev => prev.filter(x => x.id !== purgeTarget.id)); setPurge(null); setPConf('') }
    catch (e) { setPurgeErr((e as Error).message) }
    finally { setPurging(false) }
  }

  const statusColor = (s: string) => s === 'active' ? 'bg-emerald-50 text-emerald-700' : s === 'suspended' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault(); setCreateErr(null); setCreating(true)
    try {
      const result = await api.provisionTenant(
        createForm.company_name,
        createForm.admin_name,
        createForm.admin_email,
        createForm.admin_password || 'Welcome1!'
      )
      setCreateResult(result)
      setTenants(prev => [...prev, result.tenant])
      setCreateForm({ company_name: '', admin_name: '', admin_email: '', admin_password: '' })
    } catch (err) { setCreateErr((err as Error).message) }
    finally { setCreating(false) }
  }

  return (
    <>
      {/* Create Tenant Modal */}
      {showCreate && (
        <Modal onClose={() => { setShowCreate(false); setCreateErr(null); setCreateResult(null) }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-slate-900">Create New Tenant</h2>
            <button onClick={() => { setShowCreate(false); setCreateErr(null); setCreateResult(null) }} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>
          {createResult ? (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <p className="text-xs font-semibold text-emerald-700 mb-1">✅ Tenant created successfully!</p>
                <p className="text-xs text-emerald-600"><strong>{createResult.tenant.company_name}</strong> is ready.</p>
              </div>
              <div className="p-4 bg-sky-50 border border-sky-200 rounded-xl space-y-1.5">
                <p className="text-xs font-semibold text-sky-700 mb-2">Admin credentials</p>
                <p className="text-xs text-slate-700">Email: <code className="bg-white px-1 rounded">{createResult.agent.email}</code></p>
                <p className="text-xs text-slate-700">Temp password: <code className="bg-white px-1 rounded">{createResult.temp_password}</code></p>
                <p className="text-[11px] text-slate-400 mt-1">Share these securely — the admin should change the password on first login.</p>
              </div>
              <button onClick={() => { setShowCreate(false); setCreateResult(null) }} className="w-full py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg">Done</button>
            </div>
          ) : (
            <form onSubmit={handleCreateTenant} className="space-y-3">
              {createErr && <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{createErr}</div>}
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Company Name *</label><input required type="text" value={createForm.company_name} onChange={e => setCreateForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Acme Corp" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Admin Name *</label><input required type="text" value={createForm.admin_name} onChange={e => setCreateForm(f => ({ ...f, admin_name: e.target.value }))} placeholder="Jane Smith" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Admin Email *</label><input required type="email" value={createForm.admin_email} onChange={e => setCreateForm(f => ({ ...f, admin_email: e.target.value }))} placeholder="jane@acme.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Temporary Password <span className="text-slate-400 font-normal">(default: Welcome1!)</span></label><input type="password" value={createForm.admin_password} onChange={e => setCreateForm(f => ({ ...f, admin_password: e.target.value }))} placeholder="Welcome1!" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => { setShowCreate(false); setCreateErr(null) }} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={creating} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{creating ? <><RefreshCw size={11} className="animate-spin" /> Creating…</> : <><UserPlus size={11} /> Create Tenant</>}</button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {/* Limits Modal */}
      {limitsTarget && (
        <Modal onClose={() => setLimits(null)} wide>
          <div className="flex items-center justify-between mb-5"><h2 className="text-base font-semibold text-slate-900">Tenant Limits — {limitsTarget.company_name}</h2><button onClick={() => setLimits(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
          {limitsErr && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{limitsErr}</div>}
          <form onSubmit={handleLimitsSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Max Brands</label><input type="number" min={1} max={1000} value={limitsForm.max_brands_allowed} onChange={e => setLimitsForm(f => ({ ...f, max_brands_allowed: parseInt(e.target.value) }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Max Agents/Admins</label><input type="number" min={1} max={10000} value={limitsForm.max_agents_allowed} onChange={e => setLimitsForm(f => ({ ...f, max_agents_allowed: parseInt(e.target.value) }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Conversation Limit</label><input type="number" min={1} value={limitsForm.conversation_limit} onChange={e => setLimitsForm(f => ({ ...f, conversation_limit: parseInt(e.target.value) }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30" /></div>
            </div>
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Feature Access</p>
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div><p className="text-xs font-medium text-slate-700">AI Features</p><p className="text-[11px] text-slate-400">Allow tenant to use AI auto-reply</p></div>
                <button type="button" onClick={() => setLimitsForm(f => ({ ...f, ai_feature_enabled: !f.ai_feature_enabled }))} className={`${limitsForm.ai_feature_enabled ? 'text-sky-500' : 'text-slate-400'} transition-colors`}>{limitsForm.ai_feature_enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}</button>
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div><p className="text-xs font-medium text-slate-700">SMTP / Email</p><p className="text-[11px] text-slate-400">Allow tenant to configure custom SMTP</p></div>
                <button type="button" onClick={() => setLimitsForm(f => ({ ...f, smtp_feature_enabled: !f.smtp_feature_enabled }))} className={`${limitsForm.smtp_feature_enabled ? 'text-sky-500' : 'text-slate-400'} transition-colors`}>{limitsForm.smtp_feature_enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}</button>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setLimits(null)} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={limitsSaving} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{limitsSaving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : 'Save Limits'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Billing Modal */}
      {billingTarget && (
        <Modal onClose={() => setBilling(null)}>
          <div className="flex items-center justify-between mb-5"><h2 className="text-base font-semibold text-slate-900">Update Billing — {billingTarget.company_name}</h2><button onClick={() => setBilling(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
          <form onSubmit={handleBillingSave} className="space-y-3">
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Plan</label>
              <select value={billingForm.plan} onChange={e => setBForm(f => ({ ...f, plan: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30">
                {['free','pro','business','enterprise'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Subscription Status</label>
              <select value={billingForm.subscription_status} onChange={e => setBForm(f => ({ ...f, subscription_status: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30">
                {['trialing','active','past_due','cancelled','paused'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setBilling(null)} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{saving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Purge Modal */}
      {purgeTarget && (
        <Modal onClose={() => { setPurge(null); setPConf(''); setPurgeErr(null) }}>
          <div className="flex items-center justify-between mb-4"><h2 className="text-base font-semibold text-red-700">Delete Tenant</h2><button onClick={() => { setPurge(null); setPConf('') }} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4"><p className="text-xs text-red-700 font-medium">This will permanently delete <strong>{purgeTarget.company_name}</strong> and all associated data. This cannot be undone.</p></div>
          {purgeErr && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{purgeErr}</div>}
          <div className="mb-4"><label className="block text-xs font-medium text-slate-600 mb-1.5">Type <strong>{purgeTarget.company_name}</strong> to confirm</label><input type="text" value={purgeConfirm} onChange={e => setPConf(e.target.value)} placeholder={purgeTarget.company_name} className="w-full px-3 py-2 bg-slate-50 border border-red-300 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-400/30" /></div>
          <div className="flex gap-2">
            <button onClick={() => { setPurge(null); setPConf('') }} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={handlePurge} disabled={purgeConfirm !== purgeTarget.company_name || purging} className="flex-1 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-lg flex items-center justify-center gap-1.5">{purging ? <><RefreshCw size={11} className="animate-spin" /> Deleting…</> : <><Trash2 size={11} /> Delete Forever</>}</button>
          </div>
        </Modal>
      )}

      <div className="flex-1 overflow-auto p-6 bg-slate-50">
        <div className="max-w-5xl">
          <div className="flex items-center justify-between mb-6">
            <div><h2 className="text-base font-semibold text-slate-900 flex items-center gap-2"><Shield size={16} className="text-sky-600" /> Super Admin</h2><p className="text-xs text-slate-500 mt-0.5">Manage all tenants, plans, and platform features</p></div>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg transition-colors"><Plus size={13} /> New Tenant</button>
          </div>

          <div className="flex gap-2 mb-5">
            <button onClick={() => setTab('tenants')} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === 'tenants' ? 'bg-sky-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Tenants ({tenants.length})</button>
            <button onClick={() => setTab('requests')} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === 'requests' ? 'bg-sky-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Upgrade Requests ({requests.length})</button>
            <button onClick={() => setTab('super_admins')} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === 'super_admins' ? 'bg-sky-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Super Admins</button>
          </div>

          {loading ? <div className="flex items-center justify-center py-16 gap-2 text-slate-400"><RefreshCw size={16} className="animate-spin" /></div> : tab === 'tenants' ? (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {['Company', 'Plan', 'Status', 'Agents', 'Brands', 'AI', 'SMTP', 'Conversations', 'Created', 'Actions'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tenants.map(t => (
                      <tr key={t.id} className={`hover:bg-slate-50 ${t.account_status === 'suspended' ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3"><p className="text-xs font-semibold text-slate-800">{t.company_name}</p><p className="text-[10px] text-slate-400">{t.id.slice(0, 8)}</p></td>
                        <td className="px-4 py-3"><span className="text-xs font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded capitalize">{t.plan}</span></td>
                        <td className="px-4 py-3"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${statusColor(t.account_status)}`}>{t.account_status}</span></td>
                        <td className="px-4 py-3"><span className="text-xs text-slate-700">{t.agent_count} / {t.max_agents_allowed}</span></td>
                        <td className="px-4 py-3"><span className="text-xs text-slate-700">{t.max_brands_allowed}</span></td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${t.ai_feature_enabled ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-400'}`}>
                            {t.ai_feature_enabled ? 'ON' : 'OFF'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${t.smtp_feature_enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                            {t.smtp_feature_enabled ? 'ON' : 'OFF'}
                          </span>
                        </td>
                        <td className="px-4 py-3"><span className="text-xs text-slate-600">{t.conversation_limit.toLocaleString()}</span></td>
                        <td className="px-4 py-3"><span className="text-xs text-slate-500">{new Date(t.created_at).toLocaleDateString()}</span></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => { setLimits(t); setLimitsForm({ max_brands_allowed: t.max_brands_allowed, max_agents_allowed: t.max_agents_allowed, ai_feature_enabled: t.ai_feature_enabled, smtp_feature_enabled: t.smtp_feature_enabled, conversation_limit: t.conversation_limit }) }} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded text-[10px]" title="Limits & Features"><Settings size={12} /></button>
                            <button onClick={() => { setBilling(t); setBForm({ plan: t.plan, subscription_status: t.subscription_status }) }} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded" title="Billing"><CreditCard size={12} /></button>
                            <button onClick={() => toggleStatus(t)} className={`p-1.5 rounded transition-colors ${t.account_status === 'active' ? 'text-amber-400 hover:text-amber-600 hover:bg-amber-50' : 'text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50'}`} title={t.account_status === 'active' ? 'Suspend' : 'Activate'}>{t.account_status === 'active' ? <ToggleRight size={12} /> : <ToggleLeft size={12} />}</button>
                            <button onClick={() => { setPurge(t); setPConf(''); setPurgeErr(null) }} className="p-1.5 text-red-300 hover:text-red-500 hover:bg-red-50 rounded" title="Delete"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : tab === 'requests' ? (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {requests.length === 0 ? (
                <div className="text-center py-12 text-slate-400"><Bell size={24} className="mx-auto mb-2 text-slate-300" /><p className="text-sm">No upgrade requests</p></div>
              ) : requests.map((r, i) => (
                <div key={r.id} className={`p-4 ${i < requests.length - 1 ? 'border-b border-slate-100' : ''}`}>
                  <div className="flex items-start justify-between">
                    <div><p className="text-sm font-semibold text-slate-800">{r.company_name}</p><p className="text-xs text-slate-500">{r.agent_name} · {r.agent_email}</p></div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{r.status}</span>
                  </div>
                  <div className="mt-2 flex gap-4 text-xs text-slate-500">
                    <span>Plan: <strong className="text-slate-700">{r.requested_plan}</strong></span>
                    {r.company_size && <span>Size: <strong className="text-slate-700">{r.company_size}</strong></span>}
                    <span>{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  {r.notes && <p className="text-xs text-slate-400 mt-1.5 italic">{r.notes}</p>}
                </div>
              ))}
            </div>
          ) : (
            <SuperAdminsPanel api={api} />
          )}
        </div>
      </div>
    </>
  )
}

// ─── Super Admins Panel ────────────────────────────────────────────────────────
function SuperAdminsPanel({ api }: { api: ReturnType<typeof useApi> }) {
  const [data, setData]       = useState<{ primary: string | null; list: SuperAdminEntry[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail]     = useState('')
  const [adding, setAdding]   = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  useEffect(() => {
    api.listSuperAdmins().then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, []) // eslint-disable-line

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault(); if (!email.trim()) return; setErr(null); setAdding(true)
    try {
      const entry = await api.addSuperAdmin(email.trim())
      setData(prev => prev ? { ...prev, list: [...prev.list, entry] } : prev)
      setEmail('')
    } catch (ex) { setErr((ex as Error).message) }
    finally { setAdding(false) }
  }

  const handleRemove = async (id: string) => {
    try { await api.removeSuperAdmin(id); setData(prev => prev ? { ...prev, list: prev.list.filter(e => e.id !== id) } : prev) }
    catch { /* ignore */ }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div>
        <p className="text-sm font-semibold text-slate-800">Super Admin Access</p>
        <p className="text-xs text-slate-400 mt-0.5">Super admins can manage all tenants, billing, and platform settings. Changes take effect on next login.</p>
        {data?.primary && <p className="text-xs text-slate-500 mt-2">Primary super admin (env): <code className="bg-slate-100 px-1 rounded">{data.primary}</code></p>}
      </div>
      <form onSubmit={handleAdd} className="flex gap-2">
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="agent@example.com" required className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" />
        <button type="submit" disabled={adding} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-medium rounded-lg disabled:opacity-50 flex items-center gap-1">{adding ? <><RefreshCw size={11} className="animate-spin" /></> : <><UserPlus size={11} /> Add</>}</button>
      </form>
      {err && <p className="text-xs text-red-500">{err}</p>}
      {loading ? (
        <div className="flex items-center justify-center py-6 text-slate-400"><RefreshCw size={14} className="animate-spin mr-2" /> Loading…</div>
      ) : !data?.list.length ? (
        <div className="text-center py-6"><Shield size={22} className="mx-auto text-slate-200 mb-2" /><p className="text-xs text-slate-400">No additional super admins yet</p></div>
      ) : (
        <div className="divide-y divide-slate-100">
          {data.list.map(e => (
            <div key={e.id} className="flex items-center justify-between py-3">
              <div><p className="text-xs font-medium text-slate-800">{e.email}</p><p className="text-[11px] text-slate-400">Added {new Date(e.created_at).toLocaleDateString()} · by {e.added_by}</p></div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${e.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{e.is_active ? 'Active' : 'Inactive'}</span>
                <button onClick={() => handleRemove(e.id)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Toast Notification Stack ─────────────────────────────────────────────────
interface InboxToast { id: string; convId: string; visitorName: string; preview: string; createdAt: number }

function ToastStack({ toasts, onDismiss, onOpen }: { toasts: InboxToast[]; onDismiss: (id: string) => void; onOpen: (convId: string) => void }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 320 }}>
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto flex items-start gap-3 bg-slate-900 border border-slate-700 shadow-2xl rounded-xl px-4 py-3" style={{ animation: 'slideInRight 0.2s ease-out' }}>
          <div className="w-8 h-8 rounded-full bg-sky-600 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">{t.visitorName[0]?.toUpperCase()}</div>
          <div className="flex-1 min-w-0"><p className="text-xs font-semibold text-slate-100 truncate">{t.visitorName}</p><p className="text-xs text-slate-400 truncate mt-0.5">{t.preview}</p></div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => { onOpen(t.convId); onDismiss(t.id) }} className="text-[10px] font-semibold text-sky-400 hover:text-sky-300 transition-colors px-1.5 py-1 rounded">View</button>
            <button onClick={() => onDismiss(t.id)} className="text-slate-600 hover:text-slate-300 transition-colors p-1 rounded"><X size={11} /></button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Tickets Section ─────────────────────────────────────────────────────────
function TicketsSection({ tickets, activeId, agents, messages, visitorPages, typingInfo, onSelect, onSend, onStatusChange, onConvertToTicket, onAssign, onEditMessage, onDeleteMessage, onPriorityChange, socketConnected }: {
  tickets: Conversation[]; activeId: string | null; agents: AgentRow[]
  messages: Record<string, Message[]>; visitorPages: Record<string, string>
  typingInfo: Record<string, string>
  onSelect: (id: string) => void
  onSend: (body: string, isInternalNote?: boolean, attachments?: Attachment[]) => Promise<void>
  onStatusChange: (status: Status, triggerCsat?: boolean) => void
  onConvertToTicket: () => Promise<void>
  onAssign: (agentId: string | null) => Promise<void>
  onEditMessage?: (msgId: string, newBody: string) => Promise<void>
  onDeleteMessage?: (msgId: string) => Promise<void>
  onPriorityChange?: (priority: Priority) => Promise<void>
  socketConnected: boolean
}) {
  const [query, setQuery]         = useState('')
  const [statusFilter, setStatus] = useState<string>('all')
  const [agentFilter, setAgent]   = useState('')

  const TICKET_STATUS_OPTS = ['all', 'submitted', 'in_progress', 'waiting_on_customer', 'resolved', 'closed']

  const filtered = tickets
    .filter(t => statusFilter === 'all' || t.status === statusFilter)
    .filter(t => !agentFilter || t.assigned_agent_id === agentFilter)
    .filter(t => {
      if (!query) return true
      const q = query.toLowerCase()
      return t.visitor_name.toLowerCase().includes(q) || (t.subject ?? '').toLowerCase().includes(q) || (t.visitor_email ?? '').toLowerCase().includes(q)
    })
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  const activeTicket = filtered.find(t => t.id === activeId) ?? tickets.find(t => t.id === activeId)

  return (
    <>
      <div className="flex flex-col w-80 border-r border-slate-200 bg-white shrink-0">
        <div className="px-4 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Tag size={14} className="text-amber-600" />Tickets</h2>
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{filtered.length}</span>
          </div>
          <div className="relative mb-2">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search tickets…" value={query} onChange={e => setQuery(e.target.value)} className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" />
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none mb-2">
            {TICKET_STATUS_OPTS.map(s => (
              <button key={s} onClick={() => setStatus(s)} className={`shrink-0 px-2 py-1 text-[10px] font-medium rounded-md transition-colors whitespace-nowrap ${statusFilter === s ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {s === 'all' ? 'All' : s === 'in_progress' ? 'In Progress' : s === 'waiting_on_customer' ? 'Waiting' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <select value={agentFilter} onChange={e => setAgent(e.target.value)} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400">
            <option value="">All Agents</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8"><Tag size={28} className="text-slate-300 mb-2" /><p className="text-sm text-slate-400">No tickets</p><p className="text-xs text-slate-300 mt-1">Use "Ticket" button in any conversation</p></div>
          ) : filtered.map(t => <ConversationRow key={t.id} conv={t} isActive={t.id === activeId} onClick={() => onSelect(t.id)} />)}
        </div>
      </div>
      {activeTicket ? (
        <ChatPanel conv={activeTicket} messages={messages[activeId!] ?? []} onSend={onSend} onStatusChange={onStatusChange} onConvertToTicket={onConvertToTicket} onAssign={onAssign} onEditMessage={onEditMessage} onDeleteMessage={onDeleteMessage} onPriorityChange={onPriorityChange} agents={agents} currentPage={visitorPages[activeId ?? ''] ?? null} socketConnected={socketConnected} typingWho={typingInfo[activeId ?? ''] ?? null} visitorOnline={false} visitorReadAt={null} />
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

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ active, onNavigate, unread, unassigned, recentActivity, onSelectConv, agent, onLogout }: {
  active: Section; onNavigate: (s: Section) => void; unread: number; unassigned: number
  recentActivity: Conversation[]; onSelectConv: (id: string) => void
  agent: { name: string; email: string; role: string; isSuperAdmin?: boolean } | null
  onLogout: () => Promise<void>
}) {
  const [bellOpen, setBellOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)
  const totalNotifs = unread + unassigned

  useEffect(() => {
    if (!bellOpen) return
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [bellOpen])

  const items: { key: Section; icon: React.ReactNode; label: string; adminOnly?: boolean; superAdminOnly?: boolean }[] = [
    { key: 'conversations', icon: <MessageSquare size={16} />, label: 'Inbox' },
    { key: 'tickets',       icon: <Tag size={16} />,           label: 'Tickets' },
    { key: 'csat',          icon: <BarChart2 size={16} />,     label: 'CSAT', adminOnly: true },
    { key: 'brands',        icon: <Building2 size={16} />,     label: 'Brands', adminOnly: true },
    { key: 'team',          icon: <Users size={16} />,         label: 'Team', adminOnly: true },
    { key: 'billing',       icon: <CreditCard size={16} />,    label: 'Billing' },
    { key: 'settings',      icon: <Settings size={16} />,      label: 'Settings' },
    { key: 'superadmin',    icon: <Shield size={16} />,        label: 'Super Admin', superAdminOnly: true },
  ]

  const visible = items.filter(i => {
    if (i.superAdminOnly) return agent?.isSuperAdmin
    if (i.adminOnly) return agent?.role === 'admin' || agent?.isSuperAdmin
    return true
  })

  return (
    <div className="flex flex-col w-52 h-full bg-slate-900 text-white shrink-0">
      <div className="flex items-center gap-2 px-4 py-5 border-b border-slate-800">
        <OmniLogo size="sm" />
        <div className="min-w-0 flex-1"><p className="text-sm font-bold tracking-wide leading-none">OmniCore</p><p className="text-[10px] text-slate-500 mt-0.5">Atelier</p></div>
        <div className="relative shrink-0" ref={bellRef}>
          <button
            onClick={() => setBellOpen(o => !o)}
            className={`relative p-1.5 rounded-lg transition-colors ${bellOpen ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-white hover:bg-slate-800'}`}
            title="Notifications"
          >
            <Bell size={15} />
            {totalNotifs > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none px-0.5 animate-pulse">
                {totalNotifs > 99 ? '99+' : totalNotifs}
              </span>
            )}
          </button>
          {bellOpen && (
            <div className="absolute left-0 top-full mt-1 w-72 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
              <div className="px-3 py-2.5 border-b border-slate-700 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">Notifications</span>
                <button onClick={() => setBellOpen(false)} className="text-slate-500 hover:text-slate-300 transition-colors"><X size={12} /></button>
              </div>
              <div className="flex gap-2 px-3 py-2 border-b border-slate-700/50">
                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${unread > 0 ? 'bg-red-500/20 text-red-400' : 'bg-slate-700 text-slate-500'}`}>
                  <MessageSquare size={9} /> {unread} unread
                </span>
                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${unassigned > 0 ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-slate-500'}`}>
                  <UserPlus size={9} /> {unassigned} unassigned
                </span>
              </div>
              <div className="max-h-60 overflow-y-auto">
                {recentActivity.length === 0 ? (
                  <div className="px-3 py-5 text-center">
                    <CheckCircle2 size={18} className="mx-auto mb-1.5 text-emerald-500/60" />
                    <p className="text-xs text-slate-500">All caught up!</p>
                  </div>
                ) : (
                  recentActivity.map(conv => (
                    <button key={conv.id} onClick={() => { onSelectConv(conv.id); setBellOpen(false) }}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-700/50 transition-colors border-b border-slate-700/30 last:border-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-xs font-medium text-slate-200 truncate">{conv.visitor_name}</span>
                        <div className="flex gap-1 shrink-0">
                          {(conv.unread ?? 0) > 0 && (
                            <span className="bg-red-500 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none">{conv.unread}</span>
                          )}
                          {!conv.assigned_agent_id && conv.status !== 'closed' && (
                            <span className="bg-amber-500/80 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none">OPEN</span>
                          )}
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400 truncate">{conv.subject || '(No subject)'}</p>
                    </button>
                  ))
                )}
              </div>
              <div className="px-3 py-2 border-t border-slate-700">
                <button onClick={() => { onNavigate('conversations'); setBellOpen(false) }} className="text-[10px] text-sky-400 hover:text-sky-300 transition-colors">View all in inbox →</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {visible.map(item => (
          <button key={item.key} onClick={() => onNavigate(item.key)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${active === item.key ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
            {item.icon}
            <span>{item.label}</span>
            {item.key === 'conversations' && unread > 0 && <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{unread}</span>}
            {item.key === 'conversations' && unassigned > 0 && unread === 0 && (
              <span className="ml-auto bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{unassigned}</span>
            )}
            {item.key === 'conversations' && unread > 0 && unassigned > 0 && (
              <span className="bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{unassigned}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="px-2 py-3 border-t border-slate-800">
        <div className="px-3 py-2 mb-1">
          <p className="text-xs font-medium text-slate-300 truncate">{agent?.name}</p>
          <p className="text-[10px] text-slate-500 truncate">{agent?.email}</p>
          <span className={`mt-0.5 inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase ${agent?.isSuperAdmin ? 'bg-sky-900 text-sky-300' : agent?.role === 'admin' ? 'bg-sky-900/50 text-sky-400' : 'bg-slate-800 text-slate-500'}`}>{agent?.isSuperAdmin ? 'Super Admin' : agent?.role}</span>
        </div>
        <button onClick={onLogout} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"><LogOut size={14} /> Sign out</button>
      </div>
    </div>
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
  const [brands, setBrands]       = useState<Brand[]>([])
  const [visitorPages, setVisitorPages]   = useState<Record<string, string>>({})
  const [typingInfo, setTypingInfo]       = useState<Record<string, string>>({})
  const [visitorOnline, setVisitorOnline] = useState<Record<string, boolean>>({})
  const [visitorReadAt, setVisitorReadAt] = useState<Record<string, string>>({})
  const socketRef                 = useRef<Socket | null>(null)
  const activeIdRef               = useRef<string | null>(null)
  const typingTimers              = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  useEffect(() => {
    if (agent?.isSuperAdmin) setSection('superadmin')
  }, [agent?.isSuperAdmin]) // eslint-disable-line

  useEffect(() => {
    api.listAgents().then(setAgents).catch(() => {})
    api.listBrands().then(setBrands).catch(() => {})
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
    socket.on('connect', () => {
      setSocketOk(true)
      // Re-join the active conversation room after every (re)connect so
      // server:new_message keeps arriving even after a network blip.
      if (activeIdRef.current) socket.emit('join:conversation', { conversationId: activeIdRef.current })
    })
    socket.on('disconnect',    () => setSocketOk(false))
    socket.on('connect_error', () => setSocketOk(false))
    socket.on('conversation:created', (conv: Conversation) => {
      setConvs(prev => { if (prev.some(c => c.id === conv.id)) return prev; return [{ ...conv, unread: 0 }, ...prev] })
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
      if (msg.sender_type !== 'agent' && msg.sender_type !== 'system') {
        setConvs(prev => {
          const conv = prev.find(c => c.id === msg.conversation_id)
          if (!conv || activeIdRef.current === msg.conversation_id) return prev
          const toastId = `${msg.id}-toast`
          const toast: InboxToast = { id: toastId, convId: msg.conversation_id, visitorName: conv.visitor_name, preview: msg.message_body.slice(0, 80), createdAt: Date.now() }
          setToasts(t => [...t.slice(-4), toast])
          setTimeout(() => setToasts(t => t.filter(x => x.id !== toastId)), 6000)
          return prev
        })
      }
    })
    socket.on('visitor:page_change', ({ conversationId, url }: { conversationId: string; url: string }) => {
      setVisitorPages(prev => ({ ...prev, [conversationId]: url }))
    })
    const clearTyping = (conversationId: string) => {
      clearTimeout(typingTimers.current[conversationId])
      setTypingInfo(prev => { const n = { ...prev }; delete n[conversationId]; return n })
    }
    const setTyping = (conversationId: string, name: string) => {
      setTypingInfo(prev => ({ ...prev, [conversationId]: name }))
      clearTimeout(typingTimers.current[conversationId])
      typingTimers.current[conversationId] = setTimeout(() => clearTyping(conversationId), 5000)
    }
    socket.on('visitor:is_typing',    ({ conversationId, displayName }: { conversationId: string; displayName: string }) => setTyping(conversationId, displayName || 'Visitor'))
    socket.on('visitor:typing_stopped', ({ conversationId }: { conversationId: string }) => clearTyping(conversationId))
    socket.on('agent:is_typing',      ({ conversationId, displayName }: { conversationId: string; displayName: string }) => setTyping(conversationId, displayName || 'Agent'))
    socket.on('agent:typing_stopped', ({ conversationId }: { conversationId: string }) => clearTyping(conversationId))
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
    socket.on('conversation:assigned', ({ conversationId, agentId, agentName }: { conversationId: string; agentId: string | null; agentName: string | null }) => {
      setConvs(prev => prev.map(c => c.id === conversationId ? { ...c, agent_name: agentName, assigned_agent_id: agentId } : c))
    })
    // Tenant-level visitor message broadcast — keeps inbox live for ALL agents
    // regardless of which conversation they're currently viewing.
    socket.on('conversation:visitor_message', ({ conversationId, message: msg }: { conversationId: string; message: Message }) => {
      if (msg.is_internal_note) return
      playChime()
      // Dedup-safe fallback: add to message pane in case server:new_message was
      // missed (e.g. agent wasn't yet in the conv room when the message arrived).
      setMessages(prev => {
        const existing = prev[conversationId] ?? []
        if (existing.some(m => m.id === msg.id)) return prev
        return { ...prev, [conversationId]: [...existing, msg] }
      })
      // Update the conversation's position + unread badge in the sidebar
      setConvs(prev => prev.map(c => {
        if (c.id !== conversationId) return c
        const isActive = activeIdRef.current === c.id
        return { ...c, updated_at: msg.created_at, unread: isActive ? (c.unread ?? 0) : (c.unread ?? 0) + 1 }
      }))
      // Show toast for agents not currently viewing this conversation
      if (activeIdRef.current !== conversationId) {
        setConvs(prev => {
          const conv = prev.find(c => c.id === conversationId)
          if (!conv) return prev
          const toastId = `${msg.id}-vm-toast`
          const toast: InboxToast = { id: toastId, convId: conversationId, visitorName: conv.visitor_name, preview: (msg.message_body || '').slice(0, 80), createdAt: Date.now() }
          setToasts(t => [...t.slice(-4), toast])
          setTimeout(() => setToasts(t => t.filter(x => x.id !== toastId)), 6000)
          if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification(`New message from ${conv.visitor_name}`, { body: (msg.message_body || '').slice(0, 80), icon: '/favicon.ico' })
          }
          return prev
        })
      }
    })
    socket.on('visitor:online',  ({ conversationId }: { conversationId: string }) => {
      setVisitorOnline(prev => ({ ...prev, [conversationId]: true }))
    })
    socket.on('visitor:offline', ({ conversationId }: { conversationId: string }) => {
      setVisitorOnline(prev => ({ ...prev, [conversationId]: false }))
    })
    socket.on('visitor:read_receipt', ({ conversationId, readAt }: { conversationId: string; readAt: string }) => {
      setVisitorReadAt(prev => ({ ...prev, [conversationId]: readAt }))
    })
    return () => { socket.disconnect(); socketRef.current = null }
  }, [accessToken])

  useEffect(() => {
    if (activeId && socketRef.current?.connected) socketRef.current.emit('join:conversation', { conversationId: activeId })
  }, [activeId])

  useEffect(() => {
    if (!activeId || messages[activeId] !== undefined) return
    api.getMessages(activeId)
      .then(msgs => setMessages(prev => ({ ...prev, [activeId]: msgs })))
      .catch(() => setMessages(prev => ({ ...prev, [activeId]: [] })))
    setConvs(prev => prev.map(c => c.id === activeId ? { ...c, unread: 0 } : c))
  }, [activeId]) // eslint-disable-line

  // Polling safety net: every 8 s re-fetch messages for the open conversation.
  // Catches any message that slipped through during a socket room race or blip.
  useEffect(() => {
    if (!activeId) return
    const interval = setInterval(async () => {
      try {
        const msgs = await api.getMessages(activeId)
        setMessages(prev => {
          const existing = prev[activeId] ?? []
          // Only update if the server has more messages than local state
          if (msgs.length <= existing.length) return prev
          return { ...prev, [activeId]: msgs }
        })
      } catch { /* non-fatal */ }
    }, 8_000)
    return () => clearInterval(interval)
  }, [activeId]) // eslint-disable-line

  const handleSelectConversation = useCallback((id: string) => {
    setActiveId(id); setSection('conversations')
    setConvs(prev => prev.map(c => c.id === id ? { ...c, unread: 0 } : c))
  }, [])

  const handleSelectTicket = useCallback((id: string) => {
    setActiveId(id)
    setConvs(prev => prev.map(c => c.id === id ? { ...c, unread: 0 } : c))
  }, [])

  const handleSend = useCallback(async (body: string, isInternalNote = false, attachments: Attachment[] = []) => {
    if (!activeId) return
    const msg = await api.sendMessage(activeId, body, isInternalNote, attachments)
    setMessages(prev => {
      const existing = prev[activeId] ?? []
      if (existing.some(m => m.id === msg.id)) return prev
      return { ...prev, [activeId]: [...existing, msg] }
    })
    setConvs(prev => prev.map(c => c.id === activeId ? { ...c, updated_at: msg.created_at } : c))
  }, [activeId]) // eslint-disable-line

  const handleStatusChange = useCallback(async (status: Status, triggerCsat?: boolean) => {
    if (!activeId) return
    const patch: Record<string, unknown> = { status }
    if (triggerCsat !== undefined) patch.trigger_csat = triggerCsat
    await api.patchConversation(activeId, patch)
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
    setConvs(prev => prev.map(c => c.id === activeId ? { ...c, agent_name: agentName, assigned_agent_id: agentId } : c))
  }, [activeId, agents]) // eslint-disable-line

  const handleEditMessage = useCallback(async (msgId: string, newBody: string) => {
    if (!activeId) return
    await api.editMessage(activeId, msgId, newBody)
    setMessages(prev => ({ ...prev, [activeId]: (prev[activeId] ?? []).map(m => m.id === msgId ? { ...m, message_body: newBody } : m) }))
  }, [activeId]) // eslint-disable-line

  const handleDeleteMessage = useCallback(async (msgId: string) => {
    if (!activeId) return
    await api.deleteMessage(activeId, msgId)
    setMessages(prev => ({ ...prev, [activeId]: (prev[activeId] ?? []).filter(m => m.id !== msgId) }))
  }, [activeId]) // eslint-disable-line

  const handlePriorityChange = useCallback(async (priority: Priority) => {
    if (!activeId) return
    await api.patchConversation(activeId, { priority })
    setConvs(prev => prev.map(c => c.id === activeId ? { ...c, priority } : c))
  }, [activeId]) // eslint-disable-line

  const totalUnread   = convs.reduce((n, c) => n + (c.unread ?? 0), 0)
  const totalUnassigned = convs.filter(c => !c.assigned_agent_id && c.status !== 'closed' && !c.is_ticket).length
  const recentActivity  = convs
    .filter(c => !c.is_ticket && ((c.unread ?? 0) > 0 || (!c.assigned_agent_id && c.status !== 'closed')))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 8)
  const activeConv  = convs.find(c => c.id === activeId)
  const dismissToast = useCallback((id: string) => setToasts(t => t.filter(x => x.id !== id)), [])
  const openToastConv = useCallback((convId: string) => { handleSelectConversation(convId); setSection('conversations') }, [handleSelectConversation])

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <ToastStack toasts={toasts} onDismiss={dismissToast} onOpen={openToastConv} />
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebar(false)} />
          <div className="absolute left-0 top-0 bottom-0 z-50"><Sidebar active={section} onNavigate={s => { setSection(s); setSidebar(false) }} unread={totalUnread} unassigned={totalUnassigned} recentActivity={recentActivity} onSelectConv={id => { handleSelectConversation(id); setSidebar(false) }} agent={agent} onLogout={logout} /></div>
        </div>
      )}
      <div className="hidden lg:flex"><Sidebar active={section} onNavigate={setSection} unread={totalUnread} unassigned={totalUnassigned} recentActivity={recentActivity} onSelectConv={handleSelectConversation} agent={agent} onLogout={logout} /></div>

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
                <ConversationsList convs={convs} activeId={activeId} onSelect={handleSelectConversation} brands={brands} agents={agents} />
                {activeConv ? <ChatPanel conv={activeConv} messages={messages[activeId!] ?? []} onSend={handleSend} onStatusChange={handleStatusChange} onConvertToTicket={handleConvertToTicket} onAssign={handleAssign} onEditMessage={handleEditMessage} onDeleteMessage={handleDeleteMessage} onPriorityChange={handlePriorityChange} agents={agents} currentPage={visitorPages[activeId ?? ''] ?? null} socketConnected={socketOk} typingWho={typingInfo[activeId ?? ''] ?? null} visitorOnline={visitorOnline[activeId ?? ''] ?? false} visitorReadAt={visitorReadAt[activeId ?? ''] ?? null} /> : <EmptyChat />}
              </>
            )
          )}
          {section === 'tickets' && (
            <TicketsSection tickets={convs.filter(c => c.is_ticket)} activeId={activeId} agents={agents} messages={messages} visitorPages={visitorPages} typingInfo={typingInfo} onSelect={handleSelectTicket} onSend={handleSend} onStatusChange={handleStatusChange} onConvertToTicket={handleConvertToTicket} onAssign={handleAssign} onEditMessage={handleEditMessage} onDeleteMessage={handleDeleteMessage} onPriorityChange={handlePriorityChange} socketConnected={socketOk} />
          )}
          {section === 'csat'      && <CsatSection brands={brands} />}
          {section === 'brands'    && <BrandsSection />}
          {section === 'billing'   && <BillingSection />}
          {section === 'settings'  && <SettingsSection />}
          {section === 'team'      && <TeamSection />}
          {section === 'superadmin' && <SuperAdminSection />}
        </div>
      </div>
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { isAuthenticated, isLoading } = useAuth() as { isAuthenticated: boolean; isLoading: boolean }
  const [view, setView]     = useState<AuthView>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('reset_token') ? 'reset' : 'login'
  })
  const [successMsg, setSuccess] = useState<string | undefined>()
  const [resetToken, setResetToken] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('reset_token') ?? ''
  })

  const goSignup = () => { setSuccess(undefined); setView('signup') }
  const goLogin  = (msg?: string) => { setSuccess(msg); setView('login'); history.replaceState({}, '', window.location.pathname) }
  const goForgot = () => { setSuccess(undefined); setView('forgot') }

  if (isLoading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-9 h-9 bg-sky-500 rounded-xl flex items-center justify-center animate-pulse"><Sparkles size={18} className="text-white" /></div>
        <p className="text-slate-500 text-xs">Loading…</p>
      </div>
    </div>
  )

  if (isAuthenticated) return <Dashboard />

  if (view === 'signup') return <SignupPage onGoLogin={goLogin} />
  if (view === 'forgot') return <ForgotPasswordPage onGoLogin={goLogin} />
  if (view === 'reset')  return <ResetPasswordPage token={resetToken} onGoLogin={goLogin} />
  return <LoginPage onGoSignup={goSignup} onGoForgot={goForgot} successMsg={successMsg} />
}
