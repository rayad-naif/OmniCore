import { useState, useEffect, useRef, useCallback } from 'react'
import { ensurePaddle } from './lib/paddle'
import { checkoutMode } from './lib/checkout'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import omnicoreLogo from './assets/omnicore-logo.png'
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
  Brain, BookOpen, Link2, Webhook, Upload, FileText,
  KeyRound,
} from 'lucide-react'
// @ts-ignore
import { useAuth } from './context/AuthContext'
import TrialGateway from './components/TrialGateway'
import { io, type Socket } from 'socket.io-client'

// ─── Types ────────────────────────────────────────────────────────────────────
type Status      = 'open' | 'closed' | 'pending' | 'ai_handling' | 'submitted' | 'in_progress' | 'waiting_on_customer' | 'resolved'
type TicketStatus = 'submitted' | 'in_progress' | 'waiting_on_customer' | 'resolved' | 'closed'
type Channel     = 'email' | 'widget' | 'api' | 'whatsapp'
type Priority    = 'low' | 'normal' | 'high' | 'urgent'
type Sender      = 'agent' | 'visitor' | 'bot' | 'system'
type Section     = 'conversations' | 'tickets' | 'brands' | 'billing' | 'settings' | 'team' | 'superadmin' | 'csat' | 'ai_training' | 'smtp' | 'contacts' | 'canned_responses'
type StatusFilter = 'all' | Status
type AuthView    = 'login' | 'signup' | 'forgot' | 'reset'

interface Conversation {
  id: string; subject: string | null; status: Status; channel: Channel
  priority: Priority; visitor_name: string; visitor_email: string | null
  agent_name?: string | null; brand_name: string; updated_at: string
  sla_breach_at?: string | null; unread?: number
  is_ticket?: boolean; assigned_agent_id?: string | null
  ticket_number?: number | null
  visitor_id?: string; visitor_timezone?: string | null
  csat_score?: number | null; brand_id?: string
  referrer_url?: string | null
  current_url?: string | null
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
  permissions?: Record<string, string>
}

interface SuperAdminUser {
  id: string; name: string; email: string; role: string
  is_active: boolean; created_at: string
  tenant_id: string | null; company_name: string | null
  is_super_admin: boolean
}

interface SANTenant {
  id: string; company_name: string; account_status: string
  subscription_status: string; plan: string; created_at: string
  agent_count: number; max_brands_allowed: number
  max_agents_allowed: number; ai_feature_enabled: boolean
  smtp_feature_enabled: boolean; conversation_limit: number
  trial_ends_at: string | null; grace_period_ends_at: string | null
  lock_notified_at: string | null
  paddle_customer_id: string | null; paddle_subscription_id: string | null
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
interface PlanFeatures { ai_feature_enabled: boolean; smtp_feature_enabled: boolean }
interface PlanLimits { max_brands_allowed: number | null; max_agents_allowed: number | null; conversation_limit: number | null }
interface BillingPlan {
  plan: string; name: string; description: string | null
  priceId: string; amount: number; currency: string; interval: string
  features?: PlanFeatures; limits?: PlanLimits
}
interface BillingAdminPlan {
  id: string; slug: string; plan: string; name: string; description: string
  amount: number; currency: string; interval: string
  is_free: boolean; self_serve: boolean; active: boolean
  sort_order: number; trial_days: number
  paddle_product_id: string | null; paddle_price_id: string | null; paddle_synced: boolean
  features: PlanFeatures; limits: PlanLimits
}
interface SubscriptionInfo {
  customerId: string | null; subscriptionId: string | null
  plan: string; status: string
  gracePeriodEndsAt: string | null; currentPeriodEnd: string | null
}
interface BillingStatus {
  provider: string
  connected: boolean
  environment: string
  error: string | null
  subscriptions: number
  planCount: number
}
interface PlatformSmtpInput {
  host: string; port: number; secure: boolean; user: string
  from_email: string; enabled: boolean; pass: string
}
interface PlatformSmtpConfig {
  host?: string; port?: number; secure?: boolean; user?: string
  from_email?: string; enabled?: boolean; pass_set?: boolean
}
interface AIBrandSetting {
  id: string
  brand_name: string
  ai_system_prompt: string | null
  bot_max_messages: string | number
  auto_assign_strategy: string
  auto_close_enabled: boolean
  auto_close_idle_minutes: string | number
}

interface CsatAgent {
  agent_id: string; agent_name: string; agent_email: string
  total_assigned: number; closed_count: number
  avg_csat_score: number | null; positive_ratings: number
  five_star: number; four_star: number; three_star: number; two_star: number; one_star: number
  rated_count: number; avg_first_response_minutes: number | null
  closed_today: number; participated_today: number
}

interface Contact {
  id: string; display_name: string; email: string | null
  brand_name: string; brand_id: string; location_city: string | null
  last_seen_at: string; created_at: string; conversation_count: number
}

interface ContactConversation {
  id: string; status: string; channel: string; subject: string | null
  priority: string; created_at: string; updated_at: string
  csat_score: number | null; brand_name: string; agent_name: string | null
  referrer_url?: string | null
}

interface CannedResponse {
  id: string; name: string; body: string; shortcut: string | null; created_at: string
}

// ─── API Layer ────────────────────────────────────────────────────────────────
const API = '/api'

function useApi() {
  const { authFetch, agent, workspaceOverride } = useAuth() as {
    authFetch: (url: string, opts?: RequestInit) => Promise<Response>
    agent: { id: string; name: string; email: string; tenantId: string; role: string; isSuperAdmin?: boolean } | null
    workspaceOverride: { tenantId: string; name: string } | null
  }
  // When a super-admin is viewing a workspace, use that workspace's tenant id
  // for routes that embed the tenant id in the URL path.
  const effectiveTenantId = workspaceOverride?.tenantId ?? agent?.tenantId ?? ''
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
    getConversation: async (id: string): Promise<Conversation> => {
      const r = await authFetch(`${API}/conversations/${id}`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<Conversation>
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
    deleteConversation: async (id: string): Promise<void> => {
      const r = await authFetch(`${API}/conversations/${id}`, { method: 'DELETE' })
      if (!r.ok) { const err = await r.json().catch(() => ({})) as { error?: string }; throw new Error(err.error ?? 'Failed to delete conversation') }
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
      if (!effectiveTenantId) return []
      const r = await authFetch(`${API}/tenants/${effectiveTenantId}/brands`)
      if (!r.ok) return []
      const d = await r.json() as Brand[] | { brands: Brand[] }
      return Array.isArray(d) ? d : (d.brands ?? [])
    },
    createBrand: async (name: string, websiteUrl: string, supportEmail: string): Promise<Brand> => {
      if (!effectiveTenantId) throw new Error('Not authenticated')
      const r = await authFetch(`${API}/tenants/${effectiveTenantId}/brands`, {
        method: 'POST',
        body: JSON.stringify({ brand_name: name, widget_config_json: { website_url: websiteUrl || undefined, support_email: supportEmail || undefined } }),
      })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to create brand') }
      return r.json() as Promise<Brand>
    },
    editBrand: async (brandId: string, patch: { brand_name?: string; website_url?: string; support_email?: string; color?: string }): Promise<Brand> => {
      if (!effectiveTenantId) throw new Error('Not authenticated')
      const widget_config_json: Record<string, string> = {}
      if (patch.website_url !== undefined) widget_config_json.website_url = patch.website_url
      if (patch.support_email !== undefined) widget_config_json.support_email = patch.support_email
      if (patch.color !== undefined) widget_config_json.color = patch.color
      const body: Record<string, unknown> = {}
      if (patch.brand_name) body.brand_name = patch.brand_name
      if (Object.keys(widget_config_json).length) body.widget_config_json = widget_config_json
      const r = await authFetch(`${API}/tenants/${effectiveTenantId}/brands/${brandId}`, { method: 'PATCH', body: JSON.stringify(body) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to update brand') }
      return r.json() as Promise<Brand>
    },
    deleteBrand: async (brandId: string): Promise<void> => {
      if (!effectiveTenantId) throw new Error('Not authenticated')
      const r = await authFetch(`${API}/tenants/${effectiveTenantId}/brands/${brandId}`, { method: 'DELETE' })
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
    inviteAgent: async (name: string, email: string, role: string, permissions?: Record<string, string>): Promise<AgentRow & { invite_link?: string; email_sent?: boolean }> => {
      const r = await authFetch(`${API}/agents`, { method: 'POST', body: JSON.stringify({ name, email, role, permissions }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to invite agent') }
      return r.json() as Promise<AgentRow & { invite_link?: string; email_sent?: boolean }>
    },
    updateAgent: async (id: string, body: { role?: string; permissions?: Record<string, string> }): Promise<AgentRow> => {
      const r = await authFetch(`${API}/agents/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to update agent') }
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
    setAgentPassword: async (id: string, password: string): Promise<void> => {
      const r = await authFetch(`${API}/agents/${id}/password`, { method: 'PATCH', body: JSON.stringify({ password }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to set password') }
    },
    createUpgradeRequest: async (requested_plan: string, company_size: string, notes: string): Promise<void> => {
      const r = await authFetch(`${API}/billing/upgrade-request`, { method: 'POST', body: JSON.stringify({ requested_plan, company_size, notes }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to submit request') }
    },
    listBillingPlans: async (): Promise<BillingPlan[]> => {
      const r = await authFetch(`${API}/billing/plans`)
      if (!r.ok) throw new Error(`${r.status}`)
      const d = await r.json() as { plans: BillingPlan[] }
      return d.plans
    },
    getSubscription: async (): Promise<SubscriptionInfo> => {
      const r = await authFetch(`${API}/billing/subscription`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<SubscriptionInfo>
    },
    createCheckout: async (plan: string): Promise<{ url: string; transactionId?: string; provider?: string }> => {
      const r = await authFetch(`${API}/checkout`, { method: 'POST', body: JSON.stringify({ plan }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to start checkout') }
      return r.json() as Promise<{ url: string; transactionId?: string; provider?: string }>
    },
    getBillingPortal: async (): Promise<string> => {
      const r = await authFetch(`${API}/billing/portal`, { method: 'POST' })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to open billing portal') }
      const d = await r.json() as { url: string }
      return d.url
    },
    getBillingStatus: async (): Promise<BillingStatus> => {
      const r = await authFetch(`${API}/super-admin/billing/status`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<BillingStatus>
    },
    listAdminPlans: async (): Promise<BillingAdminPlan[]> => {
      const r = await authFetch(`${API}/super-admin/billing/plans`)
      if (!r.ok) { const err = await r.json().catch(() => ({})) as { error?: string }; throw new Error(err.error ?? 'Failed to load plans') }
      const d = await r.json() as { plans: BillingAdminPlan[] }
      return d.plans
    },
    createAdminPlan: async (body: Record<string, unknown>): Promise<{ plan: BillingAdminPlan; warning: string | null }> => {
      const r = await authFetch(`${API}/super-admin/billing/plans`, { method: 'POST', body: JSON.stringify(body) })
      if (!r.ok) { const err = await r.json().catch(() => ({})) as { error?: string }; throw new Error(err.error ?? 'Failed to create plan') }
      return r.json() as Promise<{ plan: BillingAdminPlan; warning: string | null }>
    },
    updateAdminPlan: async (id: string, body: Record<string, unknown>): Promise<{ plan: BillingAdminPlan; warning: string | null }> => {
      const r = await authFetch(`${API}/super-admin/billing/plans/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      if (!r.ok) { const err = await r.json().catch(() => ({})) as { error?: string }; throw new Error(err.error ?? 'Failed to update plan') }
      return r.json() as Promise<{ plan: BillingAdminPlan; warning: string | null }>
    },
    deleteAdminPlan: async (id: string): Promise<void> => {
      const r = await authFetch(`${API}/super-admin/billing/plans/${id}`, { method: 'DELETE' })
      if (!r.ok) { const err = await r.json().catch(() => ({})) as { error?: string }; throw new Error(err.error ?? 'Failed to delete plan') }
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
    patchTenantBilling: async (id: string, body: Record<string, unknown>): Promise<void> => {
      const r = await authFetch(`${API}/super-admin/tenants/${id}/billing`, { method: 'PATCH', body: JSON.stringify(body) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to update billing') }
    },
    adminTenantCheckout: async (tenantId: string, agentEmail: string, plan: string): Promise<{ url: string; provider: string }> => {
      const r = await authFetch(`${API}/super-admin/tenants/${tenantId}/checkout`, { method: 'POST', body: JSON.stringify({ agentEmail, plan }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to generate checkout') }
      return r.json() as Promise<{ url: string; provider: string }>
    },
    purgeTenant: async (id: string, confirm_name: string): Promise<void> => {
      const r = await authFetch(`${API}/super-admin/tenants/${id}/purge`, { method: 'DELETE', body: JSON.stringify({ confirm_name }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Purge failed') }
    },
    patchTenantLimits: async (id: string, limits: Partial<{ max_brands_allowed: number; max_agents_allowed: number; ai_feature_enabled: boolean; smtp_feature_enabled: boolean; conversation_limit: number }>): Promise<void> => {
      const r = await authFetch(`${API}/super-admin/tenants/${id}/limits`, { method: 'PATCH', body: JSON.stringify(limits) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to update limits') }
    },
    provisionTenant: async (company_name: string, admin_name: string, admin_email: string, admin_password: string): Promise<{ tenant: SANTenant; agent: AgentRow }> => {
      const r = await authFetch(`${API}/tenants/provision`, { method: 'POST', body: JSON.stringify({ company_name, admin_name, admin_email, admin_password }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to provision tenant') }
      return r.json() as Promise<{ tenant: SANTenant; agent: AgentRow }>
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
    listSuperAdminUsers: async (): Promise<SuperAdminUser[]> => {
      const r = await authFetch(`${API}/super-admin/users`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<SuperAdminUser[]>
    },
    setUserPassword: async (id: string, password: string): Promise<void> => {
      const r = await authFetch(`${API}/super-admin/users/${id}/password`, { method: 'PATCH', body: JSON.stringify({ password }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to set password') }
    },
    sendUserReset: async (id: string, variant?: 'invite' | 'workspace'): Promise<{ ok: boolean; sent: boolean; message: string }> => {
      const r = await authFetch(`${API}/super-admin/users/${id}/send-reset`, { method: 'POST', body: JSON.stringify({ variant: variant ?? 'workspace' }) })
      const data = await r.json() as { ok?: boolean; sent?: boolean; message?: string; error?: string }
      if (!r.ok) throw new Error(data.error ?? 'Failed to send email')
      return { ok: Boolean(data.ok), sent: Boolean(data.sent), message: data.message ?? '' }
    },
    getPlatformSmtp: async (): Promise<PlatformSmtpConfig> => {
      const r = await authFetch(`${API}/super-admin/platform-smtp`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<PlatformSmtpConfig>
    },
    updatePlatformSmtp: async (cfg: Partial<PlatformSmtpInput>): Promise<PlatformSmtpConfig> => {
      const r = await authFetch(`${API}/super-admin/platform-smtp`, { method: 'PUT', body: JSON.stringify(cfg) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Failed to save platform SMTP') }
      return r.json() as Promise<PlatformSmtpConfig>
    },
    testPlatformSmtp: async (to?: string): Promise<{ ok: boolean; message: string; to?: string }> => {
      const r = await authFetch(`${API}/super-admin/platform-smtp/test`, { method: 'POST', body: JSON.stringify({ to }) })
      return r.json() as Promise<{ ok: boolean; message: string; to?: string }>
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
    startSiteCrawl: async (url: string, brandId?: string, maxPages = 100, maxDepth = 5): Promise<{ jobId: string; maxPages: number; maxDepth: number; startUrl: string }> => {
      const r = await authFetch(`${API}/ai/knowledge-base/crawl`, { method: 'POST', body: JSON.stringify({ url, brand_id: brandId, max_pages: maxPages, max_depth: maxDepth }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Crawl failed') }
      return r.json()
    },
    getCrawlStatus: async (jobId: string): Promise<{ status: string; crawled: number; saved: number; errors: number; maxPages: number; currentUrl?: string; errorMessage?: string }> => {
      const r = await authFetch(`${API}/ai/knowledge-base/crawl/status/${jobId}`)
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Status check failed') }
      return r.json()
    },
    uploadPdfKnowledge: async (data: string, filename: string, brandId?: string): Promise<KnowledgeArticle> => {
      const r = await authFetch(`${API}/ai/knowledge-base/upload-pdf`, { method: 'POST', body: JSON.stringify({ data, filename, brand_id: brandId }) })
      if (!r.ok) { const err = await r.json() as { error?: string }; throw new Error(err.error ?? 'Upload failed') }
      return r.json() as Promise<KnowledgeArticle>
    },
    bulkExport: async (ids: string[]): Promise<void> => {
      const r = await authFetch(`${API}/conversations/bulk-export`, { method: 'POST', body: JSON.stringify({ ids }) })
      if (!r.ok) throw new Error('Export failed')
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `omnicore-export-${Date.now()}.zip`; document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 2000)
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
    updateBotSettings: async (brandId: string, settings: { ai_system_prompt?: string | null; bot_max_messages?: number; auto_assign_strategy?: string; auto_close_enabled?: boolean; auto_close_idle_minutes?: number }): Promise<AIBrandSetting> => {
      const r = await authFetch(`${API}/ai/settings/${brandId}`, { method: 'PATCH', body: JSON.stringify(settings) })
      if (!r.ok) throw new Error('Failed to update bot settings')
      return r.json() as Promise<AIBrandSetting>
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
    testSmtp: async (): Promise<{ ok: boolean; message: string }> => {
      const r = await authFetch(`${API}/tenants/smtp/test`, { method: 'POST' })
      return r.json() as Promise<{ ok: boolean; message: string }>
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
    listContacts: async (params?: Record<string, string>): Promise<{ contacts: Contact[]; pagination: { page: number; limit: number; total: number; pages: number } }> => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      const r = await authFetch(`${API}/contacts${qs}`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<{ contacts: Contact[]; pagination: { page: number; limit: number; total: number; pages: number } }>
    },
    getContactConversations: async (visitorId: string): Promise<ContactConversation[]> => {
      const r = await authFetch(`${API}/contacts/${visitorId}/conversations`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<ContactConversation[]>
    },
    deleteContact: async (visitorId: string): Promise<void> => {
      const r = await authFetch(`${API}/contacts/${visitorId}`, { method: 'DELETE' })
      if (!r.ok) { const err = await r.json().catch(() => ({})) as { error?: string }; throw new Error(err.error ?? 'Failed to delete contact') }
    },
    exportContactsCsv: async (params?: Record<string, string>): Promise<void> => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      const r = await authFetch(`${API}/contacts/export${qs}`)
      if (!r.ok) throw new Error(`Export failed (${r.status})`)
      const blob = await r.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const cd   = r.headers.get('content-disposition') ?? ''
      const match = cd.match(/filename="?([^";\r\n]+)"?/)
      a.href     = url
      a.download = match?.[1] ?? `contacts-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    },
    listCannedResponses: async (): Promise<CannedResponse[]> => {
      const r = await authFetch(`${API}/canned-responses`)
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<CannedResponse[]>
    },
    createCannedResponse: async (name: string, body: string, shortcut?: string): Promise<CannedResponse> => {
      const r = await authFetch(`${API}/canned-responses`, {
        method: 'POST', body: JSON.stringify({ name, body, shortcut }),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<CannedResponse>
    },
    deleteCannedResponse: async (id: string): Promise<void> => {
      const r = await authFetch(`${API}/canned-responses/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`${r.status}`)
    },
  }), [authFetch, effectiveTenantId])()
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
  return (
    <div className={`${s} bg-slate-900 rounded-xl flex items-center justify-center shadow-lg shadow-amber-900/20 ring-1 ring-amber-400/20 overflow-hidden`}>
      <img src={omnicoreLogo} alt="OmniCore" className="w-[78%] h-[78%] object-contain" />
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

function WhatsAppIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.978-1.398A9.948 9.948 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2Z" fill="#25D366"/>
      <path d="M17.04 14.72c-.28-.14-1.65-.81-1.9-.9-.26-.1-.44-.14-.63.14-.18.28-.72.9-.88 1.09-.16.18-.33.2-.61.07-.28-.14-1.19-.44-2.27-1.4-.84-.75-1.41-1.67-1.57-1.95-.17-.28-.02-.43.12-.57.13-.13.28-.33.42-.5.14-.17.18-.28.28-.47.1-.18.05-.35-.02-.49-.07-.14-.63-1.51-.86-2.07-.23-.54-.46-.47-.63-.48h-.54c-.18 0-.49.07-.75.35-.26.28-1 .98-1 2.39 0 1.41 1.02 2.77 1.16 2.96.14.2 2 3.05 4.85 4.28.68.29 1.21.47 1.62.6.68.22 1.3.19 1.79.11.55-.08 1.65-.67 1.88-1.33.23-.65.23-1.21.16-1.33-.07-.12-.26-.19-.54-.33Z" fill="white"/>
    </svg>
  )
}

function ChannelIcon({ channel }: { channel: Channel }) {
  if (channel === 'email')     return <Mail size={11} className="text-slate-400" />
  if (channel === 'api')       return <Hash size={11} className="text-slate-400" />
  if (channel === 'whatsapp')  return <WhatsAppIcon size={11} />
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
          {conv.ticket_number && <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">#{conv.ticket_number}</span>}
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
  const api = useApi()
  const [query, setQuery]       = useState('')
  const [filter, setFilter]     = useState<StatusFilter>('all')
  const [brandFilter, setBrand] = useState('')
  const [agentFilter, setAgent] = useState('')
  const [ratingFilter, setRating] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)

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

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const toggleAll = () => setSelectedIds(selectedIds.size === filtered.length ? new Set() : new Set(filtered.map(c => c.id)))
  const handleBulkExport = async () => {
    if (!selectedIds.size) return
    setExporting(true)
    try { await api.bulkExport([...selectedIds]); setSelectedIds(new Set()) }
    catch (err) { alert((err as Error).message) }
    finally { setExporting(false) }
  }

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
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400" />
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400" />
            </div>
            {hasFilters && <button onClick={() => { setBrand(''); setAgent(''); setRating(''); setDateFrom(''); setDateTo('') }} className="text-xs text-red-500 hover:text-red-600">Clear filters</button>}
          </div>
        )}
        <div className="flex gap-1 mt-2 overflow-x-auto pb-1 scrollbar-none">
          {CONV_FILTERS.map(f => (
            <button key={f.value} onClick={() => setFilter(f.value)} className={`shrink-0 px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${filter === f.value ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{f.label}</button>
          ))}
        </div>
        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={selectedIds.size === filtered.length} onChange={toggleAll} className="w-3 h-3 rounded accent-sky-600 cursor-pointer" />
              <span className="text-[11px] text-slate-500">{selectedIds.size} selected</span>
            </div>
            <button onClick={handleBulkExport} disabled={exporting} className="flex items-center gap-1 text-[11px] font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded-md px-2 py-1 hover:bg-sky-100 disabled:opacity-50">
              {exporting ? <RefreshCw size={10} className="animate-spin" /> : <FileDown size={10} />} Export ZIP
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8"><Inbox size={28} className="text-slate-200 mb-2" /><p className="text-xs text-slate-400">No conversations match</p></div>
        ) : filtered.map(c => (
          <div key={c.id} className="relative group/row">
            <div
              className={`absolute left-1.5 top-1/2 -translate-y-1/2 z-10 transition-opacity ${selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'}`}
              onClick={e => toggleSelect(c.id, e)}
            >
              <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => {}} className="w-3.5 h-3.5 rounded accent-sky-600 cursor-pointer" />
            </div>
            <ConversationRow conv={c} isActive={c.id === activeId} onClick={() => onSelect(c.id)} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── URL allow-list sanitizer ─────────────────────────────────────────────────
// Only allow http: and https: URLs. Any other scheme (javascript:, data:, etc.)
// returns null so the caller can fall back to plain text.
function safeHref(raw: string): string | null {
  try {
    const { protocol } = new URL(raw)
    return protocol === 'http:' || protocol === 'https:' ? raw : null
  } catch {
    return null
  }
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

  if (isSystem) {
    const isPageView = msg.message_body.startsWith('Visited:')
    const rawUrl = isPageView ? msg.message_body.replace(/^Visited:\s*/, '').trim() : null
    const pageUrl = rawUrl ? safeHref(rawUrl) : null
    if (isPageView) {
      let displayPath = rawUrl ?? ''
      try { displayPath = new URL(rawUrl!).pathname || '/' } catch { /* keep raw */ }
      const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      return (
        <div className="flex justify-center my-2 px-4">
          <div className="flex items-center gap-0 w-full max-w-[88%] rounded-lg overflow-hidden border border-sky-100 bg-sky-50 shadow-sm">
            <div className="flex items-center justify-center w-7 h-7 bg-sky-100 shrink-0">
              <Globe size={11} className="text-sky-500" />
            </div>
            <div className="flex items-center justify-between flex-1 px-2.5 py-1.5 min-w-0">
              {pageUrl ? (
                <a href={pageUrl} target="_blank" rel="noopener noreferrer"
                  title={rawUrl!}
                  className="text-[10px] font-mono text-sky-700 hover:text-sky-900 hover:underline truncate leading-snug"
                >{displayPath}</a>
              ) : (
                <span className="text-[10px] font-mono text-slate-500 truncate leading-snug" title={rawUrl ?? undefined}>{displayPath}</span>
              )}
              <span className="text-[9px] text-slate-400 shrink-0 ml-2 tabular-nums">{timeStr}</span>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="flex justify-center my-1">
        <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-400 bg-slate-100 px-3 py-1 rounded-full italic">
          {msg.message_body}
        </span>
      </div>
    )
  }

  const handleSave = async () => {
    if (!editDraft.trim() || !onEdit) return
    setSaving(true)
    try { await onEdit(msg.id, editDraft.trim()); setEditing(false) }
    catch { /* ignore */ }
    finally { setSaving(false) }
  }

  // Parse attachments — handle both JSON string (REST) and already-parsed array (socket).
  // Filter out threading-metadata entries ({email_message_id}) that have no renderable URL.
  let attachments: Attachment[] = []
  try {
    if (msg.attachments_json) {
      const raw = typeof msg.attachments_json === 'string' ? JSON.parse(msg.attachments_json) : msg.attachments_json
      if (Array.isArray(raw)) attachments = (raw as Attachment[]).filter((a) => a && a.url)
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

// ─── Page Journey Group ────────────────────────────────────────────────────────
function PageJourneyGroup({ msgs }: { msgs: Message[] }) {
  const [expanded, setExpanded] = useState(false)

  const entries = msgs.map(m => {
    const raw = m.message_body.replace(/^Visited:\s*/, '').trim()
    let path = raw
    try { path = new URL(raw).pathname || '/' } catch { /* keep raw */ }
    return { url: raw, path, ts: m.created_at }
  })

  return (
    <div className="flex justify-center my-2 px-4">
      <div className="w-full max-w-[88%] rounded-lg overflow-hidden border border-sky-100 shadow-sm">
        <button
          onClick={() => setExpanded(x => !x)}
          className="w-full flex items-center justify-between bg-sky-50 hover:bg-sky-100 transition-colors px-2.5 py-1.5"
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <div className="flex items-center justify-center w-5 h-5 bg-sky-100 rounded shrink-0">
              <Globe size={10} className="text-sky-500" />
            </div>
            <span className="text-[10px] font-medium text-sky-700 truncate">
              Browsed {entries.length} pages
            </span>
            <span className="text-[9px] text-sky-400 font-mono truncate hidden sm:inline">
              {entries[0].path} → {entries[entries.length - 1].path}
            </span>
          </span>
          <ChevronDown size={10} className={`shrink-0 text-sky-400 transition-transform ml-2 ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {expanded && (
          <div className="bg-white border-t border-sky-100 divide-y divide-slate-100">
            {entries.map((e, i) => {
              const href = safeHref(e.url)
              const timeStr = new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              return (
                <div key={i} className="flex items-center gap-2 px-2.5 py-1.5">
                  <span className="w-4 text-[9px] text-slate-400 tabular-nums shrink-0 text-right">{i + 1}</span>
                  <Globe size={9} className="text-sky-300 shrink-0" />
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer"
                      title={e.url}
                      className="flex-1 text-[10px] font-mono text-sky-700 hover:text-sky-900 hover:underline truncate"
                    >{e.path}</a>
                  ) : (
                    <span className="flex-1 text-[10px] font-mono text-slate-600 truncate" title={e.url}>{e.path}</span>
                  )}
                  <span className="text-[9px] text-slate-400 tabular-nums shrink-0">{timeStr}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── buildMessageGroups ────────────────────────────────────────────────────────
type MsgGroup =
  | { type: 'single'; msg: Message; idx: number }
  | { type: 'journey'; msgs: Message[] }

function buildMessageGroups(messages: Message[]): MsgGroup[] {
  const groups: MsgGroup[] = []
  let i = 0
  while (i < messages.length) {
    const m = messages[i]
    if (m.sender_type === 'system' && m.message_body.startsWith('Visited:')) {
      const group: Message[] = [m]
      let j = i + 1
      while (
        j < messages.length &&
        messages[j].sender_type === 'system' &&
        messages[j].message_body.startsWith('Visited:')
      ) {
        group.push(messages[j])
        j++
      }
      if (group.length >= 2) {
        groups.push({ type: 'journey', msgs: group })
      } else {
        groups.push({ type: 'single', msg: m, idx: i })
      }
      i = j
    } else {
      groups.push({ type: 'single', msg: m, idx: i })
      i++
    }
  }
  return groups
}

// ─── Visitor Info Panel ────────────────────────────────────────────────────────
function VisitorInfoPanel({ conv, currentPage, pageHistory, onSelectConversation }: { conv: Conversation; currentPage: string | null; pageHistory: Array<{ url: string; ts: string }>; onSelectConversation?: (id: string) => void }) {
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
        {pageHistory.length > 0 && (
          <div>
            <p className="text-[10px] text-slate-400 font-medium uppercase mb-1.5 flex items-center gap-1"><Globe size={9} />Page Journey ({pageHistory.length})</p>
            <div className="space-y-1">
              {pageHistory.map((entry, i) => {
                let label: string
                try { label = new URL(entry.url).pathname || '/' } catch { label = entry.url }
                const time = new Date(entry.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: tz ?? undefined })
                return (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-slate-700 break-all leading-snug truncate" title={entry.url}>{label}</p>
                      <p className="text-[9px] text-slate-400">{time}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Channel</p><p className="text-xs text-slate-700 capitalize">{conv.channel}</p></div>
        <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">Brand</p><p className="text-xs text-slate-700">{conv.brand_name}</p></div>
        {conv.csat_score && <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">CSAT</p><StarRating score={conv.csat_score} /></div>}
        {conv.sla_breach_at && <div><p className="text-[10px] text-slate-400 font-medium uppercase mb-0.5">SLA</p><p className={`text-xs ${slaColor(conv.sla_breach_at)}`}>{new Date(conv.sla_breach_at).getTime() < Date.now() ? 'Breached' : `Due ${timeAgo(conv.sla_breach_at)}`}</p></div>}
        {history.length > 0 && (
          <div>
            <p className="text-[10px] text-slate-400 font-medium uppercase mb-1.5">Past Conversations ({history.length})</p>
            <div className="space-y-1.5">
              {history.slice(0, 5).map(h => (
                <button
                  key={h.id}
                  onClick={() => onSelectConversation?.(h.id)}
                  disabled={!onSelectConversation || h.id === conv.id}
                  className={`w-full text-left text-[10px] p-1.5 rounded border transition-colors ${h.id === conv.id ? 'bg-sky-50 border-sky-200 cursor-default' : onSelectConversation ? 'bg-slate-50 border-slate-100 hover:bg-sky-50 hover:border-sky-200 cursor-pointer' : 'bg-slate-50 border-slate-100'}`}
                >
                  <span className={`inline-block px-1 py-0.5 rounded text-[9px] font-semibold mr-1 ${h.status === 'open' ? 'bg-emerald-100 text-emerald-700' : h.status === 'closed' ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700'}`}>{h.status}</span>
                  <span className="text-slate-600">{h.subject || '(No subject)'}</span>
                  {h.id !== conv.id && onSelectConversation && (
                    <span className="float-right text-sky-400 text-[9px] mt-0.5">Open →</span>
                  )}
                </button>
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
  const [pendingFiles, setPendingFiles] = useState<{ name: string; type: string; dataUrl: string }[]>([])
  const [editorHasContent, setEditorHasContent] = useState(false)
  const fileInputRef                = useRef<HTMLInputElement>(null)
  const api = useApi()

  const isClosed = conv.status === 'closed' || disabled

  // ── Canned responses ("/" slash command) ──────────────────────────────────
  const [canned, setCanned]         = useState<CannedResponse[]>([])
  const [slash, setSlash]           = useState<{ open: boolean; query: string; start: number; index: number }>({ open: false, query: '', start: 0, index: 0 })
  const slashRef                    = useRef(slash)
  slashRef.current = slash
  const editorRef                   = useRef<ReturnType<typeof useEditor>>(null)
  const slashKeyRef                 = useRef<(e: KeyboardEvent) => boolean>(() => false)

  useEffect(() => {
    api.listCannedResponses().then(r => setCanned(r)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filterCanned = (q: string) => {
    const query = q.toLowerCase()
    return canned.filter(c =>
      !query || (c.shortcut || '').toLowerCase().includes(query) || c.name.toLowerCase().includes(query)
    )
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: isClosed
          ? 'Conversation closed — reopen to reply'
          : isNote
          ? 'Write an internal note (not visible to visitor)… (type / for canned responses)'
          : 'Write your reply… (Ctrl+Enter to send · type / for canned responses)',
      }),
    ],
    editable: !isClosed,
    editorProps: {
      handleKeyDown: (_view, event) => slashKeyRef.current(event),
    },
    onCreate: ({ editor }) => {
      setEditorHasContent(!editor.isEmpty)
    },
    onUpdate: ({ editor }) => {
      // Track emptiness in React state so canSend is always current on re-render
      setEditorHasContent(!editor.isEmpty)
      const { from } = editor.state.selection
      const textBefore = editor.state.doc.textBetween(Math.max(0, from - 40), from, '\n', '\n')
      const m = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/.exec(textBefore)
      if (m) {
        const start = from - m[1].length - 1
        setSlash({ open: true, query: m[1], start, index: 0 })
      } else {
        setSlash(s => (s.open ? { ...s, open: false } : s))
      }
    },
  })
  editorRef.current = editor

  const applyCanned = (resp: CannedResponse) => {
    const ed = editorRef.current
    if (!ed) return
    const from = ed.state.selection.from
    const start = slashRef.current.start
    const html = resp.body
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
    ed.chain().focus().deleteRange({ from: start, to: from }).insertContent(html).run()
    setSlash({ open: false, query: '', start: 0, index: 0 })
  }

  const slashItems = slash.open ? filterCanned(slash.query) : []

  // Keyboard navigation inside the slash menu (intercepted before ProseMirror).
  slashKeyRef.current = (event: KeyboardEvent) => {
    const st = slashRef.current
    if (!st.open) return false
    const items = filterCanned(st.query)
    if (!items.length) return false
    if (event.key === 'ArrowDown') { setSlash(s => ({ ...s, index: (s.index + 1) % items.length })); return true }
    if (event.key === 'ArrowUp')   { setSlash(s => ({ ...s, index: (s.index - 1 + items.length) % items.length })); return true }
    if ((event.key === 'Enter' && !event.ctrlKey && !event.metaKey) || event.key === 'Tab') {
      applyCanned(items[Math.min(st.index, items.length - 1)]); return true
    }
    if (event.key === 'Escape') { setSlash(s => ({ ...s, open: false })); return true }
    return false
  }

  const canSend = !isClosed && !sending && (pendingFiles.length > 0 || editorHasContent)

  const handleSend = async () => {
    if (isClosed || sending || (pendingFiles.length === 0 && (!editor || editor.isEmpty))) return
    const body = editor ? editor.getHTML() : ''
    const captured = pendingFiles
    setSending(true)
    try {
      const attachments: Attachment[] = []
      for (const f of captured) {
        const comma = f.dataUrl.indexOf(',')
        const b64   = comma >= 0 ? f.dataUrl.slice(comma + 1) : f.dataUrl
        try {
          const att = await api.uploadFile(f.name, f.type, b64)
          attachments.push(att)
        } catch {
          alert(`Failed to upload "${f.name}" — message not sent. Remove it or try again.`)
          setSending(false)
          return
        }
      }
      await onSend(body, isNote, attachments)
      // Clear the draft only after everything succeeded so a failed
      // upload/send doesn't lose the agent's message.
      editor?.commands.clearContent(true)
      setPendingFiles([])
    } catch { /* keep draft so the agent can retry */ } finally { setSending(false) }
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

  const addPendingFile = (file: File, name?: string) => {
    if (file.size > 10 * 1024 * 1024) { alert(`${name || file.name}: file too large — max 10 MB`); return }
    const reader = new FileReader()
    reader.onload = ev => setPendingFiles(prev => [...prev, { name: name || file.name, type: file.type, dataUrl: ev.target!.result as string }])
    reader.readAsDataURL(file)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    files.forEach(f => addPendingFile(f))
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
        addPendingFile(file, `paste-${Date.now()}.png`)
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
      <div className="relative">
        {slash.open && slashItems.length > 0 && (
          <div className="absolute bottom-full left-3 mb-2 w-80 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-40 py-1">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1 border-b border-slate-100">
              <Zap size={10} className="text-amber-500" />Canned Responses
            </div>
            {slashItems.map((c, i) => (
              <button
                key={c.id}
                onMouseDown={e => { e.preventDefault(); applyCanned(c) }}
                onMouseEnter={() => setSlash(s => ({ ...s, index: i }))}
                className={`w-full text-left px-3 py-2 transition-colors ${i === Math.min(slash.index, slashItems.length - 1) ? 'bg-sky-50' : 'hover:bg-slate-50'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">{c.name}</span>
                  {c.shortcut && <span className="text-[10px] font-mono text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{c.shortcut}</span>}
                </div>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">{c.body}</p>
              </button>
            ))}
          </div>
        )}
        <div
          className={`tiptap-compose ${isNote ? 'bg-amber-50/20' : ''}`}
          onClick={() => editor?.commands.focus()}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSend() } }}
          onPaste={handlePaste}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
      {/* Pending files preview */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-sky-50 border-t border-sky-100">
          {pendingFiles.map((f, idx) => (
            <div key={idx} className="flex items-center gap-1.5 bg-white border border-sky-200 rounded-lg pl-1.5 pr-2 py-1 max-w-[200px]">
              {f.type.startsWith('image/') ? (
                <img src={f.dataUrl} alt="preview" className="w-7 h-7 rounded object-cover shrink-0 border border-sky-100" />
              ) : (
                <Paperclip size={13} className="text-sky-500 shrink-0" />
              )}
              <span className="text-xs text-sky-700 truncate font-medium">{f.name}</span>
              <button onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))} className="text-sky-400 hover:text-sky-600 font-bold text-sm leading-none shrink-0">×</button>
            </div>
          ))}
        </div>
      )}
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" className="hidden" multiple
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
            className={`p-1.5 rounded-lg transition-colors ${pendingFiles.length > 0 ? 'text-sky-600 bg-sky-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'} disabled:opacity-30 disabled:cursor-not-allowed`}>
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
function ChatPanel({ conv, messages, onSend, onStatusChange, onConvertToTicket, onAssign, onEditMessage, onDeleteMessage, onPriorityChange, onDelete, agents, currentPage, socketConnected, typingWho, visitorOnline, visitorReadAt, onSelectConversation }: {
  conv: Conversation; messages: Message[]
  onSend: (body: string, isInternalNote?: boolean, attachments?: Attachment[]) => Promise<void>
  onStatusChange: (status: Status, triggerCsat?: boolean) => void
  onConvertToTicket: (triggerCsat: boolean) => Promise<void>
  onAssign: (agentId: string | null) => Promise<void>
  onEditMessage?: (msgId: string, newBody: string) => Promise<void>
  onDeleteMessage?: (msgId: string) => Promise<void>
  onPriorityChange?: (priority: Priority) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  agents: AgentRow[]
  currentPage: string | null
  socketConnected: boolean
  typingWho?: string | null
  visitorOnline?: boolean
  visitorReadAt?: string | null
  onSelectConversation?: (id: string) => void
}) {
  const [exporting, setExporting] = useState(false)
  const [toast, setToast]         = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [menuOpen, setMenuOpen]   = useState(false)
  const [ticketStatus, setTicketStatus] = useState<Status>(conv.status)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const menuRef     = useRef<HTMLDivElement>(null)
  const api = useApi()

  const pageHistory = messages
    .filter(m => m.sender_type === 'system' && m.message_body.startsWith('Visited:'))
    .map(m => ({ url: m.message_body.replace(/^Visited:\s*/, '').trim(), ts: m.created_at }))

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
  const [ticketDialog, setTicketDialog] = useState(false)

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-slate-900 truncate">{conv.subject || '(No subject)'}</h3>
            {conv.ticket_number && <span className="text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full shrink-0">#{conv.ticket_number}</span>}
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
            {conv.referrer_url && (<><span>·</span><a href={conv.referrer_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-sky-600 hover:underline max-w-[220px] truncate" title={conv.referrer_url}><Link2 size={9} className="shrink-0" />{conv.referrer_url}</a></>)}
            {conv.sla_breach_at && <span className={`flex items-center gap-0.5 ${slaColor(conv.sla_breach_at)}`}><Clock size={10} /> SLA {new Date(conv.sla_breach_at).getTime() < Date.now() ? 'breached' : timeAgo(conv.sla_breach_at)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {!conv.is_ticket && (
            <button onClick={() => setTicketDialog(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 transition-all">
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
          {ticketDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setTicketDialog(false)}>
              <div className="bg-white rounded-xl shadow-xl p-6 max-w-xs w-full mx-4" onClick={e => e.stopPropagation()}>
                <h3 className="text-sm font-semibold text-slate-900 mb-1">Convert to ticket</h3>
                <p className="text-xs text-slate-500 mb-5">This closes the live chat and moves the conversation to email. Send a satisfaction survey to the visitor first?</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => { setTicketDialog(false); onConvertToTicket(true) }}
                    className="flex-1 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors"
                  >Send Survey &amp; Convert</button>
                  <button
                    onClick={() => { setTicketDialog(false); onConvertToTicket(false) }}
                    className="flex-1 py-2 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                  >Just Convert</button>
                </div>
                <button onClick={() => setTicketDialog(false)} className="mt-3 w-full text-xs text-slate-400 hover:text-slate-600 text-center">Cancel</button>
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
                <button onClick={() => { navigator.clipboard.writeText(conv.id); setMenuOpen(false) }} className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"><Copy size={11} />Copy ID</button>
                {onDelete && (
                  <>
                    <div className="border-t border-slate-100 mt-1 pt-1" />
                    <button
                      onClick={async () => {
                        setMenuOpen(false)
                        if (!window.confirm(`Delete this ${conv.is_ticket ? 'ticket' : 'conversation'} and all its messages? This cannot be undone.`)) return
                        try { await onDelete(conv.id) }
                        catch (e) { showToast('error', (e as Error).message || 'Failed to delete') }
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2"
                    ><Trash2 size={11} />Delete {conv.is_ticket ? 'ticket' : 'conversation'}</button>
                  </>
                )}
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
          ) : buildMessageGroups(messages).map((group) => {
            if (group.type === 'journey') {
              return <PageJourneyGroup key={group.msgs[0].id} msgs={group.msgs} />
            }
            const { msg: m, idx: i } = group
            const isLastAgent = (m.sender_type === 'agent' || m.sender_type === 'bot') && !m.is_internal_note &&
              messages.slice(i + 1).every(x => (x.sender_type !== 'agent' && x.sender_type !== 'bot') || x.is_internal_note)
            return <MessageBubble key={m.id} msg={m} visitorName={conv.visitor_name} onEdit={onEditMessage} onDelete={onDeleteMessage} isLastAgentMsg={isLastAgent} readAt={isLastAgent ? visitorReadAt : null} />
          })}
          <div ref={bottomRef} />
        </div>
        <VisitorInfoPanel conv={conv} currentPage={currentPage} pageHistory={pageHistory} onSelectConversation={onSelectConversation} />
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
function fmtMoney(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase(), minimumFractionDigits: 0 }).format(amount / 100)
}

function BillingSection() {
  const api = useApi()
  const [plans, setPlans]       = useState<BillingPlan[]>([])
  const [sub, setSubInfo]       = useState<SubscriptionInfo | null>(null)
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [notice, setNotice]     = useState<string | null>(null)

  // Enterprise "request upgrade" flow.
  const [reqOpen, setReqOpen]   = useState(false)
  const [submitting, setSub]    = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [form, setForm]         = useState({ company_size: '', notes: '' })

  useEffect(() => {
    // Surface the post-checkout redirect result, then clean the URL.
    const params = new URLSearchParams(window.location.search)
    const co = params.get('checkout')
    if (co === 'success') setNotice('Payment successful — your subscription is being activated.')
    else if (co === 'cancelled') setNotice('Checkout cancelled. No changes were made.')
    if (co) { params.delete('checkout'); const q = params.toString(); window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : '')) }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, s] = await Promise.all([api.listBillingPlans(), api.getSubscription()])
      setPlans(p); setSubInfo(s)
    } catch (err) { setError((err as Error).message) }
    finally { setLoading(false) }
  }, []) // eslint-disable-line
  useEffect(() => { load() }, [load])

  const checkout = async (plan: string) => {
    setError(null); setBusy(plan)
    try {
      const result = await api.createCheckout(plan)
      const paddle = result.transactionId && result.provider === 'paddle'
        ? await ensurePaddle(sub?.customerId ?? null)
        : undefined
      const mode = checkoutMode(result, Boolean(paddle))
      if (mode === 'paddle') {
        if (!paddle || !result.transactionId) {
          throw new Error('Paddle checkout could not be initialized.')
        }
        paddle.Checkout.open({
          transactionId: result.transactionId,
          settings: {
            successUrl: `${window.location.origin}/dashboard/`,
            displayMode: 'overlay',
            theme: 'light',
          },
        })
        setBusy(null)
      } else {
        if (!result.url) throw new Error('Checkout provider did not return a hosted checkout URL.')
        window.location.href = result.url
      }
    }
    catch (err) { setError((err as Error).message); setBusy(null) }
  }

  const openPortal = async () => {
    setError(null); setBusy('portal')
    try { const url = await api.getBillingPortal(); window.location.href = url }
    catch (err) { setError((err as Error).message); setBusy(null) }
  }

  const submitEnterprise = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setSub(true)
    try { await api.createUpgradeRequest('enterprise', form.company_size, form.notes); setSubmitted(true) }
    catch (err) { setError((err as Error).message) }
    finally { setSub(false) }
  }

  const currentPlan = (sub?.plan || 'free').toLowerCase()

  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-4xl">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Billing & Plans</h2>
        <p className="text-xs text-slate-500 mb-6">Choose a plan or manage your subscription</p>

        {notice && <div className="mb-4 p-3 bg-sky-50 border border-sky-200 rounded-lg text-xs text-sky-700">{notice}</div>}
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{error}</div>}

        {/* Current subscription summary */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Current Plan</p>
            <p className="text-lg font-semibold text-slate-900 capitalize">{currentPlan}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Status: <span className="capitalize">{sub?.status ?? '—'}</span>
              {sub?.currentPeriodEnd && <> · Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}</>}
            </p>
          </div>
          {sub?.customerId && (
            <button onClick={openPortal} disabled={busy === 'portal'} className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5">
              {busy === 'portal' ? <><RefreshCw size={11} className="animate-spin" /> Opening…</> : 'Manage Billing'}
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-slate-400 py-8"><RefreshCw size={12} className="animate-spin" /> Loading plans…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map(p => {
              const isCurrent = currentPlan === p.plan
              return (
                <div key={p.plan} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
                  <h3 className="text-sm font-semibold text-slate-900">{p.name}</h3>
                  <p className="mt-2"><span className="text-2xl font-bold text-slate-900">{fmtMoney(p.amount, p.currency)}</span><span className="text-xs text-slate-400">/{p.interval}</span></p>
                  {p.description && <p className="text-xs text-slate-500 mt-2 leading-relaxed">{p.description}</p>}
                  {(p.features || p.limits) && (
                    <ul className="mt-3 space-y-1.5">
                      {p.features?.ai_feature_enabled && <li className="flex items-center gap-1.5 text-xs text-slate-600"><CheckCircle2 size={12} className="text-emerald-500 shrink-0" /> AI auto-replies</li>}
                      {p.features?.smtp_feature_enabled && <li className="flex items-center gap-1.5 text-xs text-slate-600"><CheckCircle2 size={12} className="text-emerald-500 shrink-0" /> Custom SMTP / email</li>}
                      {p.limits?.max_brands_allowed != null && <li className="flex items-center gap-1.5 text-xs text-slate-600"><CheckCircle2 size={12} className="text-emerald-500 shrink-0" /> {p.limits.max_brands_allowed} brands</li>}
                      {p.limits?.max_agents_allowed != null && <li className="flex items-center gap-1.5 text-xs text-slate-600"><CheckCircle2 size={12} className="text-emerald-500 shrink-0" /> {p.limits.max_agents_allowed} agents</li>}
                      {p.limits?.conversation_limit != null && <li className="flex items-center gap-1.5 text-xs text-slate-600"><CheckCircle2 size={12} className="text-emerald-500 shrink-0" /> {p.limits.conversation_limit} conversations/mo</li>}
                    </ul>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() => checkout(p.plan)}
                    disabled={isCurrent || busy === p.plan}
                    className="mt-4 px-4 py-2 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                  >
                    {isCurrent ? 'Current Plan' : busy === p.plan ? <><RefreshCw size={11} className="animate-spin" /> Redirecting…</> : `Upgrade to ${p.name}`}
                  </button>
                </div>
              )
            })}

            {/* Enterprise — manual request only */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
              <h3 className="text-sm font-semibold text-slate-900">Enterprise</h3>
              <p className="mt-2"><span className="text-2xl font-bold text-slate-900">Custom</span></p>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">Dedicated support, custom limits, SSO and SLA. Talk to our team.</p>
              <div className="flex-1" />
              <button onClick={() => { setReqOpen(true); setSubmitted(false) }} disabled={currentPlan === 'enterprise'} className="mt-4 px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50">
                {currentPlan === 'enterprise' ? 'Current Plan' : 'Request Upgrade'}
              </button>
            </div>
          </div>
        )}

        {/* Enterprise request modal */}
        {reqOpen && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setReqOpen(false)}>
            <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
              {submitted ? (
                <div className="text-center py-4">
                  <CheckCircle2 size={28} className="text-emerald-500 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-emerald-800">Request submitted!</p>
                  <p className="text-xs text-emerald-600 mt-1">Our team will contact you within 24 hours.</p>
                  <button onClick={() => setReqOpen(false)} className="mt-4 px-4 py-2 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-200">Close</button>
                </div>
              ) : (
                <>
                  <h3 className="text-sm font-semibold text-slate-900 mb-4">Request Enterprise Plan</h3>
                  <form onSubmit={submitEnterprise} className="space-y-4">
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Company Size</label><input type="text" value={form.company_size} onChange={e => setForm(f => ({ ...f, company_size: e.target.value }))} placeholder="e.g. 50 employees" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30" /></div>
                    <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Notes</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Any specific requirements…" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 resize-none" /></div>
                    <div className="flex gap-2">
                      <button type="submit" disabled={submitting} className="px-4 py-2 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5">{submitting ? <><RefreshCw size={11} className="animate-spin" /> Submitting…</> : 'Submit Request'}</button>
                      <button type="button" onClick={() => setReqOpen(false)} className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50">Cancel</button>
                    </div>
                  </form>
                </>
              )}
            </div>
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
  const [panel, setPanel] = useState<'profile' | 'workspace' | 'webhook' | null>(null)
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

  const panels: { key: 'profile' | 'workspace' | 'webhook'; label: string; desc: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { key: 'profile',     label: 'Profile',             desc: 'Update your name and password',                   icon: <User size={14} /> },
    { key: 'workspace',   label: 'Workspace Settings',  desc: 'Company name, timezone, AI auto-reply',           icon: <Building size={14} />, adminOnly: true },
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
// ─── RBAC: feature catalogue + permission matrix editor ───────────────────────
const FEATURE_META: { key: string; label: string; desc: string }[] = [
  { key: 'inbox',          label: 'Inbox',          desc: 'Conversations & live chat' },
  { key: 'contacts',       label: 'Contacts',       desc: 'Visitor / contact directory' },
  { key: 'knowledge_base', label: 'Knowledge Base', desc: 'KB articles & AI training' },
  { key: 'brands',         label: 'Brands',         desc: 'Brand & widget configuration' },
  { key: 'analytics',      label: 'Analytics',      desc: 'CSAT & reporting' },
  { key: 'billing',        label: 'Billing',        desc: 'Plans & subscription' },
  { key: 'team',           label: 'Team',           desc: 'Agent management' },
  { key: 'settings',       label: 'Settings',       desc: 'Workspace settings & SMTP' },
]
const PERMISSION_LEVELS = ['none', 'read', 'edit'] as const

// Sensible per-role defaults, mirrored from the server's permissions lib.
function defaultPermsForRole(role: string): Record<string, string> {
  if (role === 'admin') return Object.fromEntries(FEATURE_META.map(f => [f.key, 'edit']))
  if (role === 'supervisor') return { inbox: 'edit', contacts: 'edit', knowledge_base: 'edit', brands: 'read', analytics: 'read', billing: 'read', team: 'read', settings: 'read' }
  return { inbox: 'edit', contacts: 'read', knowledge_base: 'read', brands: 'none', analytics: 'none', billing: 'none', team: 'none', settings: 'none' }
}

function PermissionMatrix({ value, onChange, disabled }: {
  value: Record<string, string>; onChange: (next: Record<string, string>) => void; disabled?: boolean
}) {
  return (
    <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
      {FEATURE_META.map(f => (
        <div key={f.key} className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-700">{f.label}</p>
            <p className="text-[10px] text-slate-400 truncate">{f.desc}</p>
          </div>
          <div className="flex gap-1 shrink-0">
            {PERMISSION_LEVELS.map(lvl => {
              const sel = (value[f.key] ?? 'none') === lvl
              const tone = lvl === 'edit' ? 'sky' : lvl === 'read' ? 'emerald' : 'slate'
              return (
                <button key={lvl} type="button" disabled={disabled}
                  onClick={() => onChange({ ...value, [f.key]: lvl })}
                  className={`px-2 py-1 text-[10px] font-semibold rounded uppercase tracking-wide transition-colors disabled:opacity-50 ${
                    sel
                      ? tone === 'sky' ? 'bg-sky-600 text-white' : tone === 'emerald' ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-slate-700'
                      : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
                  }`}>
                  {lvl}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function TeamSection() {
  const api = useApi()
  const { agent: me } = useAuth() as { agent: { id: string } | null }
  const [agents, setAgents]         = useState<AgentRow[]>([])
  const [loading, setLoading]       = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'agent' })
  const [invitePerms, setInvitePerms] = useState<Record<string, string>>(() => defaultPermsForRole('agent'))
  const [inviting, setInviting]     = useState(false)
  const [inviteErr, setInviteErr]   = useState<string | null>(null)
  const [inviteResult, setInviteResult] = useState<{ email: string; invite_link?: string; email_sent?: boolean } | null>(null)
  const [removing, setRemoving]     = useState<string | null>(null)
  // Edit-agent (role + permissions) modal.
  const [editTarget, setEditTarget] = useState<AgentRow | null>(null)
  const [editRole, setEditRole]     = useState('agent')
  const [editPerms, setEditPerms]   = useState<Record<string, string>>({})
  const [editSaving, setEditSaving] = useState(false)
  const [editErr, setEditErr]       = useState<string | null>(null)
  const [pwdTarget, setPwdTarget]   = useState<AgentRow | null>(null)
  const [pwdForm, setPwdForm]       = useState({ password: '', confirm: '' })
  const [pwdSaving, setPwdSaving]   = useState(false)
  const [pwdMsg, setPwdMsg]         = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    api.listAgents().then(list => { setAgents(list); setLoading(false) }).catch(() => setLoading(false))
  }, []) // eslint-disable-line

  const openPwd = (a: AgentRow) => { setPwdTarget(a); setPwdForm({ password: '', confirm: '' }); setPwdMsg(null) }
  const closePwd = () => { setPwdTarget(null); setPwdForm({ password: '', confirm: '' }); setPwdMsg(null) }
  const handleSetPwd = async (e: React.FormEvent) => {
    e.preventDefault(); if (!pwdTarget) return; setPwdMsg(null)
    if (pwdForm.password.length < 8) { setPwdMsg({ ok: false, text: 'Password must be at least 8 characters' }); return }
    if (pwdForm.password !== pwdForm.confirm) { setPwdMsg({ ok: false, text: 'Passwords do not match' }); return }
    setPwdSaving(true)
    try { await api.setAgentPassword(pwdTarget.id, pwdForm.password); setPwdMsg({ ok: true, text: `Password updated for ${pwdTarget.name}.` }); setPwdForm({ password: '', confirm: '' }) }
    catch (err) { setPwdMsg({ ok: false, text: (err as Error).message }) }
    finally { setPwdSaving(false) }
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault(); setInviteErr(null); setInviting(true)
    try {
      const perms = inviteForm.role === 'admin' ? undefined : invitePerms
      const a = await api.inviteAgent(inviteForm.name, inviteForm.email, inviteForm.role, perms)
      const { invite_link, email_sent, ...row } = a
      setAgents(prev => [...prev, row as AgentRow])
      setInviteResult({ email: row.email, invite_link, email_sent })
      setInviteForm({ name: '', email: '', role: 'agent' })
      setInvitePerms(defaultPermsForRole('agent'))
    } catch (err) { setInviteErr((err as Error).message) }
    finally { setInviting(false) }
  }

  const setInviteRole = (role: string) => {
    setInviteForm(f => ({ ...f, role }))
    setInvitePerms(defaultPermsForRole(role))
  }

  const closeInvite = () => { setShowInvite(false); setInviteErr(null); setInviteResult(null); setInviteForm({ name: '', email: '', role: 'agent' }); setInvitePerms(defaultPermsForRole('agent')) }

  const openEdit = (a: AgentRow) => {
    setEditTarget(a); setEditErr(null)
    setEditRole(a.role)
    setEditPerms(a.permissions && Object.keys(a.permissions).length ? { ...a.permissions } : defaultPermsForRole(a.role))
  }
  const closeEdit = () => { setEditTarget(null); setEditErr(null) }
  const setEditRoleAndPerms = (role: string) => { setEditRole(role); setEditPerms(defaultPermsForRole(role)) }
  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editTarget) return; setEditErr(null); setEditSaving(true)
    try {
      const updated = await api.updateAgent(editTarget.id, { role: editRole, permissions: editRole === 'admin' ? undefined : editPerms })
      setAgents(prev => prev.map(a => a.id === updated.id ? updated : a))
      setEditTarget(null)
    } catch (err) { setEditErr((err as Error).message) }
    finally { setEditSaving(false) }
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
        <Modal onClose={closeInvite}>
          <div className="flex items-center justify-between mb-5"><h2 className="text-base font-semibold text-slate-900">Invite Agent</h2><button onClick={closeInvite} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
          {inviteResult ? (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <p className="text-xs font-semibold text-emerald-700 mb-1">Agent invited</p>
                <p className="text-xs text-emerald-600">{inviteResult.email_sent
                  ? <>An invite email with a set-password link was sent to <code className="bg-white px-1 rounded">{inviteResult.email}</code>.</>
                  : <>Platform email isn't configured, so no email was sent. Share the link below so they can set their password.</>}</p>
              </div>
              {inviteResult.invite_link && (
                <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl space-y-2">
                  <p className="text-[11px] font-semibold text-sky-700">Set-password link (valid 7 days)</p>
                  <div className="flex gap-2">
                    <input readOnly value={inviteResult.invite_link} className="flex-1 px-2 py-1.5 bg-white border border-sky-200 rounded text-[11px] text-slate-700 font-mono" onFocus={e => e.target.select()} />
                    <button type="button" onClick={() => navigator.clipboard?.writeText(inviteResult.invite_link!)} className="px-2.5 py-1.5 bg-sky-600 text-white text-[11px] font-medium rounded hover:bg-sky-700">Copy</button>
                  </div>
                </div>
              )}
              <button onClick={closeInvite} className="w-full py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg">Done</button>
            </div>
          ) : (<>
          {inviteErr && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{inviteErr}</div>}
          <form onSubmit={handleInvite} className="space-y-3">
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Name *</label><input type="text" value={inviteForm.name} onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} required className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Email *</label><input type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} required className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Role</label>
              <select value={inviteForm.role} onChange={e => setInviteRole(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400">
                <option value="agent">Agent</option><option value="supervisor">Supervisor</option><option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Feature Permissions</label>
              {inviteForm.role === 'admin'
                ? <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg text-[11px] text-sky-700">Admins always have full access to every feature.</div>
                : <PermissionMatrix value={invitePerms} onChange={setInvitePerms} disabled={inviting} />}
            </div>
            <p className="text-[11px] text-slate-400">The agent will be emailed a secure link to set their own password (valid 7 days). If platform email isn't configured, the invite link is shown after creating.</p>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={closeInvite} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={inviting} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{inviting ? <><RefreshCw size={11} className="animate-spin" /> Inviting…</> : <><UserPlus size={11} /> Invite</>}</button>
            </div>
          </form>
          </>)}
        </Modal>
      )}
      {editTarget && (
        <Modal onClose={closeEdit}>
          <div className="flex items-center justify-between mb-5"><h2 className="text-base font-semibold text-slate-900">Edit Access</h2><button onClick={closeEdit} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg mb-4"><p className="text-xs text-slate-600">Editing role & permissions for <strong>{editTarget.name}</strong> (<code className="bg-white px-1 rounded">{editTarget.email}</code>).</p></div>
          {editErr && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{editErr}</div>}
          <form onSubmit={handleEdit} className="space-y-3">
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Role</label>
              <select value={editRole} onChange={e => setEditRoleAndPerms(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400">
                <option value="agent">Agent</option><option value="supervisor">Supervisor</option><option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Feature Permissions</label>
              {editRole === 'admin'
                ? <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg text-[11px] text-sky-700">Admins always have full access to every feature.</div>
                : <PermissionMatrix value={editPerms} onChange={setEditPerms} disabled={editSaving} />}
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={closeEdit} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={editSaving} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{editSaving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : <><Shield size={11} /> Save Access</>}</button>
            </div>
          </form>
        </Modal>
      )}
      {pwdTarget && (
        <Modal onClose={closePwd}>
          <div className="flex items-center justify-between mb-5"><h2 className="text-base font-semibold text-slate-900">Set Password</h2><button onClick={closePwd} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
          <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg mb-4"><p className="text-xs text-sky-700">Setting a new password for <strong>{pwdTarget.name}</strong> (<code className="bg-white px-1 rounded">{pwdTarget.email}</code>). Share it with them securely.</p></div>
          {pwdMsg && <div className={`mb-3 p-2 rounded text-xs ${pwdMsg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>{pwdMsg.text}</div>}
          <form onSubmit={handleSetPwd} className="space-y-3">
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">New Password</label><input type="text" value={pwdForm.password} onChange={e => setPwdForm(f => ({ ...f, password: e.target.value }))} placeholder="At least 8 characters" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Confirm Password</label><input type="text" value={pwdForm.confirm} onChange={e => setPwdForm(f => ({ ...f, confirm: e.target.value }))} placeholder="Re-enter password" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={closePwd} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Close</button>
              <button type="submit" disabled={pwdSaving} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{pwdSaving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : <><KeyRound size={11} /> Set Password</>}</button>
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
                    {a.id !== me?.id && <button onClick={() => openEdit(a)} className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors" title="Edit access"><Shield size={12} /></button>}
                    {a.id !== me?.id && <button onClick={() => openPwd(a)} className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors" title="Set password"><KeyRound size={12} /></button>}
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
  const [tab, setTab]                 = useState<'tenants' | 'requests' | 'super_admins' | 'platform_smtp' | 'user_accounts' | 'billing'>('tenants')
  const [actionTenant, setAction]     = useState<SANTenant | null>(null)
  const [purgeTarget, setPurge]       = useState<SANTenant | null>(null)
  const [purgeConfirm, setPConf]      = useState('')
  const [purging, setPurging]         = useState(false)
  const [purgeErr, setPurgeErr]       = useState<string | null>(null)
  const [billingTarget, setBilling]   = useState<SANTenant | null>(null)
  const [billingForm, setBForm]       = useState({ plan: 'free', subscription_status: 'active', trial_ends_at: '', reset_lock: false })
  const [billingErr, setBillingErr]   = useState<string | null>(null)
  const [checkoutEmail, setCheckoutEmail] = useState('')
  const [checkoutPlan, setCheckoutPlan]   = useState('starter')
  const [checkoutUrl, setCheckoutUrl]     = useState<string | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null)
  const [saving, setSaving]           = useState(false)
  const [limitsTarget, setLimits]     = useState<SANTenant | null>(null)
  const [limitsForm, setLimitsForm]   = useState({ max_brands_allowed: 3, max_agents_allowed: 10, ai_feature_enabled: true, smtp_feature_enabled: true, conversation_limit: 1000 })
  const [limitsSaving, setLSaving]    = useState(false)
  const [limitsErr, setLimitsErr]     = useState<string | null>(null)
  const [showCreate, setShowCreate]   = useState(false)
  const [createForm, setCreateForm]   = useState({ company_name: '', admin_name: '', admin_email: '', admin_password: '' })
  const [creating, setCreating]       = useState(false)
  const [createErr, setCreateErr]     = useState<string | null>(null)
  const [createResult, setCreateResult] = useState<{ tenant: SANTenant; agent: AgentRow } | null>(null)

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
    e.preventDefault(); if (!billingTarget) return; setBillingErr(null); setSaving(true)
    try {
      const body: Record<string, unknown> = {
        plan: billingForm.plan,
        subscription_status: billingForm.subscription_status,
      }
      if (billingForm.trial_ends_at) body.trial_ends_at = billingForm.trial_ends_at
      if (billingForm.reset_lock) body.lock_notified_at = null
      await api.patchTenantBilling(billingTarget.id, body)
      setTenants(prev => prev.map(x => x.id === billingTarget.id ? {
        ...x, plan: billingForm.plan, subscription_status: billingForm.subscription_status,
        trial_ends_at: (billingForm.trial_ends_at || x.trial_ends_at) as string | null,
        lock_notified_at: billingForm.reset_lock ? null : x.lock_notified_at,
      } : x))
      setBilling(null)
    }
    catch (err) { setBillingErr((err as Error).message) }
    finally { setSaving(false) }
  }

  const handleAdminCheckout = async () => {
    if (!billingTarget || !checkoutEmail) return
    setCheckoutLoading(true); setCheckoutErr(null); setCheckoutUrl(null)
    try {
      const result = await api.adminTenantCheckout(billingTarget.id, checkoutEmail, checkoutPlan)
      setCheckoutUrl(result.url)
    }
    catch (err) { setCheckoutErr((err as Error).message) }
    finally { setCheckoutLoading(false) }
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
        createForm.admin_password
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
                <p className="text-[11px] text-slate-500 mt-1">The password was accepted securely and is not displayed here. Share it with the admin using your approved secure channel.</p>
              </div>
              <button onClick={() => { setShowCreate(false); setCreateResult(null) }} className="w-full py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg">Done</button>
            </div>
          ) : (
            <form onSubmit={handleCreateTenant} className="space-y-3">
              {createErr && <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{createErr}</div>}
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Company Name *</label><input required type="text" value={createForm.company_name} onChange={e => setCreateForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Acme Corp" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Admin Name *</label><input required type="text" value={createForm.admin_name} onChange={e => setCreateForm(f => ({ ...f, admin_name: e.target.value }))} placeholder="Jane Smith" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Admin Email *</label><input required type="email" value={createForm.admin_email} onChange={e => setCreateForm(f => ({ ...f, admin_email: e.target.value }))} placeholder="jane@acme.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Admin Password * <span className="text-slate-400 font-normal">(minimum 12 characters)</span></label><input required minLength={12} type="password" value={createForm.admin_password} onChange={e => setCreateForm(f => ({ ...f, admin_password: e.target.value }))} placeholder="Choose a unique password" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
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
        <Modal onClose={() => { setBilling(null); setCheckoutUrl(null); setCheckoutErr(null) }} wide>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-slate-900">Billing Controls — {billingTarget.company_name}</h2>
            <button onClick={() => { setBilling(null); setCheckoutUrl(null); setCheckoutErr(null) }} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>

          {/* Current billing info */}
          <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 space-y-1">
            <p><span className="font-medium text-slate-700">Status:</span> {billingTarget.subscription_status} · <span className="font-medium text-slate-700">Plan:</span> {billingTarget.plan}</p>
            {billingTarget.trial_ends_at && <p><span className="font-medium text-slate-700">Trial ends:</span> {new Date(billingTarget.trial_ends_at).toLocaleString()}</p>}
            {billingTarget.grace_period_ends_at && <p><span className="font-medium text-slate-700">Grace ends:</span> {new Date(billingTarget.grace_period_ends_at).toLocaleString()}</p>}
            {billingTarget.lock_notified_at && <p className="text-amber-600"><span className="font-medium">Lock email sent:</span> {new Date(billingTarget.lock_notified_at).toLocaleString()}</p>}
            {billingTarget.paddle_customer_id && <p><span className="font-medium">Paddle customer:</span> <code className="bg-white px-1 rounded">{billingTarget.paddle_customer_id}</code></p>}
          </div>

          {/* Plan / status form */}
          {billingErr && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{billingErr}</div>}
          <form onSubmit={handleBillingSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Plan</label>
                <select value={billingForm.plan} onChange={e => setBForm(f => ({ ...f, plan: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30">
                  {['free','starter','growth','pro','business','enterprise'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Subscription Status</label>
                <select value={billingForm.subscription_status} onChange={e => setBForm(f => ({ ...f, subscription_status: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30">
                  {['trialing','active','past_due','cancelled','paused'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Trial End Date <span className="text-slate-400 font-normal">(leave blank to keep existing)</span></label>
              <input type="datetime-local" value={billingForm.trial_ends_at} onChange={e => setBForm(f => ({ ...f, trial_ends_at: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30" />
            </div>
            {billingTarget.lock_notified_at && (
              <label className="flex items-center gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer">
                <input type="checkbox" checked={billingForm.reset_lock} onChange={e => setBForm(f => ({ ...f, reset_lock: e.target.checked }))} className="rounded" />
                <span className="text-xs font-medium text-amber-800">Reset lock notification (allows admin email to fire again when locked)</span>
              </label>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { setBilling(null); setCheckoutUrl(null) }} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{saving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : 'Save Billing'}</button>
            </div>
          </form>

          {/* Admin checkout generator */}
          <div className="mt-5 pt-4 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-700 mb-3">Generate Checkout Link for Tenant</p>
            <p className="text-[11px] text-slate-400 mb-3">Creates a Paddle-hosted checkout. Copy the URL and share it with the tenant's admin, or open it directly to start their trial + subscription.</p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input type="email" placeholder="Admin email" value={checkoutEmail} onChange={e => setCheckoutEmail(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
              <select value={checkoutPlan} onChange={e => setCheckoutPlan(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/30">
                {['starter','growth'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {checkoutErr && <p className="text-xs text-red-600 mb-2">{checkoutErr}</p>}
            {checkoutUrl ? (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
                <p className="text-[11px] font-semibold text-emerald-700">✅ Checkout URL ready</p>
                <code className="block text-[10px] text-slate-600 break-all">{checkoutUrl}</code>
                <div className="flex gap-2">
                  <button onClick={() => { navigator.clipboard.writeText(checkoutUrl); }} className="flex-1 py-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded-lg transition-colors">Copy URL</button>
                  <button onClick={() => window.open(checkoutUrl, '_blank')} className="flex-1 py-1.5 text-[11px] font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors">Open Checkout</button>
                </div>
              </div>
            ) : (
              <button onClick={handleAdminCheckout} disabled={checkoutLoading || !checkoutEmail} className="w-full py-2 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-lg flex items-center justify-center gap-1.5 transition-colors">
                {checkoutLoading ? <><RefreshCw size={11} className="animate-spin" /> Generating…</> : 'Generate Checkout Link'}
              </button>
            )}
          </div>
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
            <button onClick={() => setTab('user_accounts')} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === 'user_accounts' ? 'bg-sky-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>User Accounts</button>
            <button onClick={() => setTab('platform_smtp')} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === 'platform_smtp' ? 'bg-sky-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Platform Email</button>
            <button onClick={() => setTab('billing')} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === 'billing' ? 'bg-sky-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Billing</button>
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
                            <button onClick={() => { setBilling(t); setBForm({ plan: t.plan, subscription_status: t.subscription_status, trial_ends_at: t.trial_ends_at ? new Date(t.trial_ends_at).toISOString().slice(0,16) : '', reset_lock: false }); setCheckoutUrl(null); setCheckoutErr(null); setCheckoutEmail('') }} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded" title="Billing"><CreditCard size={12} /></button>
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
          ) : tab === 'super_admins' ? (
            <SuperAdminsPanel api={api} />
          ) : tab === 'user_accounts' ? (
            <UserAccountsPanel api={api} />
          ) : tab === 'billing' ? (
            <BillingPanel api={api} />
          ) : (
            <PlatformSmtpPanel api={api} />
          )}
        </div>
      </div>
    </>
  )
}

// ─── Billing Panel (super-admin: Paddle connection + plan management) ─────────
type PlanFormState = {
  name: string; description: string; plan: string; amount: string
  is_free: boolean; self_serve: boolean
  ai_feature_enabled: boolean; smtp_feature_enabled: boolean
  trial_days: string
  max_brands_allowed: string; max_agents_allowed: string; conversation_limit: string
}

const emptyPlanForm: PlanFormState = {
  name: '', description: '', plan: '', amount: '',
  is_free: false, self_serve: true,
  ai_feature_enabled: false, smtp_feature_enabled: false,
  trial_days: '14',
  max_brands_allowed: '', max_agents_allowed: '', conversation_limit: '',
}

function BillingPanel({ api }: { api: ReturnType<typeof useApi> }) {
  const [status, setStatus]   = useState<BillingStatus | null>(null)
  const [plans, setPlans]     = useState<BillingAdminPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [notice, setNotice]   = useState<string | null>(null)

  // Plan builder modal.
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)   // plan id when editing
  const [editIsFree, setEditIsFree] = useState(false)
  const [form, setForm]         = useState<PlanFormState>(emptyPlanForm)
  const [saving, setSaving]     = useState(false)
  const [formErr, setFormErr]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [st, pl] = await Promise.all([
        api.getBillingStatus(),
        api.listAdminPlans().catch(() => [] as BillingAdminPlan[]),
      ])
      setStatus(st); setPlans(pl)
    }
    catch (err) { setError((err as Error).message) }
    finally { setLoading(false) }
  }, []) // eslint-disable-line
  useEffect(() => { load() }, [load])

  const openCreate = () => { setEditId(null); setEditIsFree(false); setForm(emptyPlanForm); setFormErr(null); setShowForm(true) }
  const openEdit = (p: BillingAdminPlan) => {
    setEditId(p.id)
    setEditIsFree(p.is_free)
    setForm({
      name: p.name, description: p.description ?? '', plan: p.plan ?? '',
      amount: p.is_free ? '0' : (p.amount / 100).toString(),
      is_free: p.is_free, self_serve: p.self_serve,
      ai_feature_enabled: p.features.ai_feature_enabled,
      smtp_feature_enabled: p.features.smtp_feature_enabled,
      trial_days: p.trial_days?.toString() ?? '0',
      max_brands_allowed: p.limits.max_brands_allowed?.toString() ?? '',
      max_agents_allowed: p.limits.max_agents_allowed?.toString() ?? '',
      conversation_limit: p.limits.conversation_limit?.toString() ?? '',
    })
    setFormErr(null); setShowForm(true)
  }
  const closeForm = () => { setShowForm(false); setEditId(null); setFormErr(null) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormErr(null)
    if (!form.name.trim()) { setFormErr('Plan name is required'); return }
    const isFree = editId ? editIsFree : form.is_free
    let dollars = 0
    if (!isFree) {
      dollars = parseFloat(form.amount)
      if (Number.isNaN(dollars) || dollars < 0) { setFormErr('Enter a valid monthly price'); return }
    }
    setSaving(true)
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description.trim(),
      ai_feature_enabled: form.ai_feature_enabled,
      smtp_feature_enabled: form.smtp_feature_enabled,
    }
    if (!editId) {
      body.is_free = form.is_free
      body.plan = form.plan.trim() || form.name.trim().toLowerCase().replace(/\s+/g, '_')
    }
    if (!isFree) {
      body.amount = Math.round(dollars * 100)
      body.self_serve = form.self_serve
      const trial = parseInt(form.trial_days, 10)
      if (Number.isFinite(trial) && trial >= 0) body.trial_days = trial
    }
    body.max_brands_allowed = form.max_brands_allowed ? parseInt(form.max_brands_allowed, 10) : null
    body.max_agents_allowed = form.max_agents_allowed ? parseInt(form.max_agents_allowed, 10) : null
    body.conversation_limit = form.conversation_limit ? parseInt(form.conversation_limit, 10) : null
    try {
      const res = editId ? await api.updateAdminPlan(editId, body) : await api.createAdminPlan(body)
      setNotice(res.warning ? `Saved — ${res.warning}` : null)
      closeForm(); await load()
    } catch (err) { setFormErr((err as Error).message) }
    finally { setSaving(false) }
  }

  const archive = async (p: BillingAdminPlan) => {
    if (!window.confirm(`Archive "${p.name}"? It will no longer be purchasable.`)) return
    try { await api.updateAdminPlan(p.id, { active: false }); await load() }
    catch (err) { setError((err as Error).message) }
  }
  const reactivate = async (p: BillingAdminPlan) => {
    try { await api.updateAdminPlan(p.id, { active: true }); await load() }
    catch (err) { setError((err as Error).message) }
  }
  const remove = async (p: BillingAdminPlan) => {
    if (!window.confirm(`Permanently delete "${p.name}"? This cannot be undone.`)) return
    try { await api.deleteAdminPlan(p.id); await load() }
    catch (err) { setError((err as Error).message) }
  }

  if (loading) return <div className="flex items-center gap-2 text-xs text-slate-400 py-8"><RefreshCw size={12} className="animate-spin" /> Loading billing status…</div>
  if (error) return <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{error} <button onClick={load} className="underline ml-1">Retry</button></div>
  if (!status) return null

  const providerLabel = status.provider.charAt(0).toUpperCase() + status.provider.slice(1)

  return (
    <div className="space-y-4">
      {notice && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 flex items-center justify-between"><span>{notice}</span><button onClick={() => setNotice(null)} className="text-amber-500 hover:text-amber-700"><X size={13} /></button></div>}

      {/* Connection state */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><CreditCard size={15} className="text-sky-600" /> {providerLabel} Connection</h3>
          <button onClick={load} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded" title="Refresh"><RefreshCw size={12} /></button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${status.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>{status.connected ? 'Connected' : 'Not connected'}</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">{status.environment || 'unknown'}</span>
          <span className="text-xs text-slate-500">Provider: <strong className="text-slate-700">{providerLabel}</strong></span>
        </div>
        {status.error && <p className="mt-2 text-xs text-red-600">{status.error}</p>}
        <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
          <span>Plans: <strong className="text-slate-700">{status.planCount}</strong></span>
          <span>Active subscriptions: <strong className="text-slate-700">{status.subscriptions}</strong></span>
        </div>
      </div>

      {/* Plan builder */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div><h3 className="text-sm font-semibold text-slate-900">Plans</h3><p className="text-[11px] text-slate-400 mt-0.5">Create plans with the features they unlock. Paid plans sync to {providerLabel}. Activating a plan grants those features to the tenant.</p></div>
          <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-md hover:bg-sky-700"><Plus size={13} /> New Plan</button>
        </div>
        {plans.length === 0 ? (
          <div className="text-center py-10 text-slate-400"><CreditCard size={24} className="mx-auto mb-2 text-slate-300" /><p className="text-sm">No plans yet. Click “New Plan” to create one.</p></div>
        ) : (
          <div className="divide-y divide-slate-100">
            {plans.map(p => (
              <div key={p.id} className="px-5 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-800">{p.name}</span>
                    <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded capitalize">{p.plan}</span>
                    {p.is_free && <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">Free</span>}
                    {p.self_serve && !p.is_free && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">Self-serve</span>}
                    {!p.is_free && (p.paddle_synced ? <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">Paddle synced</span> : <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Not synced</span>)}
                    {!p.active && <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Archived</span>}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{p.is_free ? 'Free' : `${fmtMoney(p.amount, p.currency)}/${p.interval}`}{!p.is_free && p.trial_days > 0 ? ` · ${p.trial_days}-day trial` : ''}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {p.features.ai_feature_enabled && <span className="text-[10px] text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">AI replies</span>}
                    {p.features.smtp_feature_enabled && <span className="text-[10px] text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">Custom SMTP</span>}
                    {p.limits.max_brands_allowed != null && <span className="text-[10px] text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded">{p.limits.max_brands_allowed} brands</span>}
                    {p.limits.max_agents_allowed != null && <span className="text-[10px] text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded">{p.limits.max_agents_allowed} agents</span>}
                    {p.limits.conversation_limit != null && <span className="text-[10px] text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded">{p.limits.conversation_limit} convos</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(p)} className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded" title="Edit plan"><Pencil size={13} /></button>
                  {!p.is_free && p.active && <button onClick={() => archive(p)} className="p-1.5 text-amber-400 hover:text-amber-600 hover:bg-amber-50 rounded" title="Archive plan"><Trash2 size={13} /></button>}
                  {!p.is_free && !p.active && <button onClick={() => reactivate(p)} className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded" title="Reactivate plan"><RefreshCw size={13} /></button>}
                  {!p.is_free && !p.active && <button onClick={() => remove(p)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete plan"><X size={13} /></button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Plan builder modal */}
      {showForm && (
        <Modal onClose={closeForm}>
          <div className="flex items-center justify-between mb-5"><h2 className="text-base font-semibold text-slate-900">{editId ? `Edit Plan${editIsFree ? ' (Free)' : ''}` : 'New Plan'}</h2><button onClick={closeForm} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
          {formErr && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{formErr}</div>}
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Plan name *</label><input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Growth" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Plan key</label><input type="text" value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))} disabled={!!editId} placeholder="auto from name" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-60" /></div>
            </div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Description</label><input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30" /></div>

            {!editId && (
              <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={form.is_free} onChange={e => setForm(f => ({ ...f, is_free: e.target.checked }))} className="rounded" /> This is the free plan (no price, not synced to {providerLabel})</label>
            )}

            {!(editId ? editIsFree : form.is_free) && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Monthly price (USD) *</label><input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="49.00" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30" />{editId && <p className="text-[10px] text-slate-400 mt-1">Changing the price creates a new {providerLabel} price.</p>}</div>
                  <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Trial days</label><input type="number" min="0" value={form.trial_days} onChange={e => setForm(f => ({ ...f, trial_days: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30" /></div>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={form.self_serve} onChange={e => setForm(f => ({ ...f, self_serve: e.target.checked }))} className="rounded" /> Available for self-serve checkout</label>
              </>
            )}

            <div className="pt-1">
              <p className="text-xs font-medium text-slate-600 mb-1.5">Features unlocked</p>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={form.ai_feature_enabled} onChange={e => setForm(f => ({ ...f, ai_feature_enabled: e.target.checked }))} className="rounded" /> AI auto-replies</label>
                <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={form.smtp_feature_enabled} onChange={e => setForm(f => ({ ...f, smtp_feature_enabled: e.target.checked }))} className="rounded" /> Custom SMTP / email</label>
              </div>
            </div>

            <div className="pt-1">
              <p className="text-xs font-medium text-slate-600 mb-1.5">Limits granted (blank = unlimited)</p>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="block text-[10px] text-slate-400 mb-1">Brands</label><input type="number" min="1" value={form.max_brands_allowed} onChange={e => setForm(f => ({ ...f, max_brands_allowed: e.target.value }))} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30" /></div>
                <div><label className="block text-[10px] text-slate-400 mb-1">Agents</label><input type="number" min="1" value={form.max_agents_allowed} onChange={e => setForm(f => ({ ...f, max_agents_allowed: e.target.value }))} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30" /></div>
                <div><label className="block text-[10px] text-slate-400 mb-1">Convos</label><input type="number" min="1" value={form.conversation_limit} onChange={e => setForm(f => ({ ...f, conversation_limit: e.target.value }))} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30" /></div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={closeForm} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{saving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : editId ? 'Save Plan' : 'Create Plan'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ─── User Accounts Panel (super-admin: set any account's password) ────────────
function UserAccountsPanel({ api }: { api: ReturnType<typeof useApi> }) {
  const [users, setUsers]     = useState<SuperAdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [target, setTarget]   = useState<SuperAdminUser | null>(null)
  const [form, setForm]       = useState({ password: '', confirm: '' })
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState<{ ok: boolean; text: string } | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [banner, setBanner]   = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    api.listSuperAdminUsers().then(setUsers).catch(() => {}).finally(() => setLoading(false))
  }, []) // eslint-disable-line

  const open  = (u: SuperAdminUser) => { setTarget(u); setForm({ password: '', confirm: '' }); setMsg(null) }
  const close = () => { setTarget(null); setForm({ password: '', confirm: '' }); setMsg(null) }

  const sendReset = async (u: SuperAdminUser, inModal = false, variant: 'invite' | 'workspace' = 'workspace') => {
    setSendingId(u.id)
    if (inModal) setMsg(null); else setBanner(null)
    try {
      const res = await api.sendUserReset(u.id, variant)
      const m = { ok: res.sent, text: res.message }
      if (inModal) setMsg(m); else setBanner(m)
    } catch (err) {
      const m = { ok: false, text: (err as Error).message }
      if (inModal) setMsg(m); else setBanner(m)
    } finally { setSendingId(null) }
  }
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!target) return; setMsg(null)
    if (form.password.length < 8) { setMsg({ ok: false, text: 'Password must be at least 8 characters' }); return }
    if (form.password !== form.confirm) { setMsg({ ok: false, text: 'Passwords do not match' }); return }
    setSaving(true)
    try { await api.setUserPassword(target.id, form.password); setMsg({ ok: true, text: `Password updated for ${target.name}.` }); setForm({ password: '', confirm: '' }) }
    catch (err) { setMsg({ ok: false, text: (err as Error).message }) }
    finally { setSaving(false) }
  }

  const q = search.trim().toLowerCase()
  const filtered = q ? users.filter(u =>
    u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.company_name ?? '').toLowerCase().includes(q)
  ) : users

  if (loading) return <div className="flex items-center justify-center py-16 gap-2 text-slate-400"><RefreshCw size={16} className="animate-spin" /></div>

  return (
    <>
      {target && (
        <Modal onClose={close}>
          <div className="flex items-center justify-between mb-5"><h2 className="text-base font-semibold text-slate-900">Set Password</h2><button onClick={close} className="text-slate-400 hover:text-slate-600"><X size={18} /></button></div>
          <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg mb-4"><p className="text-xs text-sky-700">Setting a new password for <strong>{target.name}</strong> (<code className="bg-white px-1 rounded">{target.email}</code>){target.company_name ? <> at <strong>{target.company_name}</strong></> : null}. Share it securely.</p></div>
          {msg && <div className={`mb-3 p-2 rounded text-xs ${msg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>{msg.text}</div>}
          <form onSubmit={save} className="space-y-3">
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">New Password</label><input type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="At least 8 characters" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Confirm Password</label><input type="text" value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} placeholder="Re-enter password" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={close} className="flex-1 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Close</button>
              <button type="submit" disabled={saving} className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{saving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : <><KeyRound size={11} /> Set Password</>}</button>
            </div>
          </form>
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
            <p className="text-[11px] text-slate-500">Or let the user choose their own password — email them a secure link (valid 7 days).</p>
            <button type="button" onClick={() => sendReset(target, true)} disabled={sendingId === target.id} className="w-full py-2 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{sendingId === target.id ? <><RefreshCw size={11} className="animate-spin" /> Sending…</> : <><Mail size={11} /> Email setup link</>}</button>
            <button type="button" onClick={() => sendReset(target, true, 'invite')} disabled={sendingId === target.id} className="w-full py-2 text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5">{sendingId === target.id ? <><RefreshCw size={11} className="animate-spin" /> Sending…</> : <><Send size={11} /> Resend invite email</>}</button>
          </div>
        </Modal>
      )}
      {banner && <div className={`mb-4 p-3 rounded-lg text-xs ${banner.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>{banner.text}</div>}
      <div className="mb-4">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, email, or company…" className="w-full max-w-sm px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" />
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>{['User', 'Company', 'Role', 'Status', 'Action'].map(h => <th key={h} className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-slate-400 text-sm"><Users size={24} className="mx-auto mb-2 text-slate-300" />No users found</td></tr>
              ) : filtered.map(u => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><p className="text-xs font-semibold text-slate-800">{u.name}</p><p className="text-[10px] text-slate-400">{u.email}</p></td>
                  <td className="px-4 py-3"><span className="text-xs text-slate-600">{u.company_name ?? '—'}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide ${u.role === 'admin' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>{u.role}</span>
                      {u.is_super_admin && <span className="text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide bg-violet-100 text-violet-700">Super</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-medium px-2 py-0.5 rounded ${u.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => sendReset(u)} disabled={sendingId === u.id} className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-sky-600 hover:text-sky-700 hover:bg-sky-50 rounded transition-colors disabled:opacity-50">{sendingId === u.id ? <RefreshCw size={12} className="animate-spin" /> : <Mail size={12} />} Email link</button>
                      <button onClick={() => sendReset(u, false, 'invite')} disabled={sendingId === u.id} className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-violet-600 hover:text-violet-700 hover:bg-violet-50 rounded transition-colors disabled:opacity-50">{sendingId === u.id ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />} Resend invite</button>
                      <button onClick={() => open(u)} className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"><KeyRound size={12} /> Set Password</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ─── Platform SMTP Panel (super-admin owned, powers system emails) ────────────
function PlatformSmtpPanel({ api }: { api: ReturnType<typeof useApi> }) {
  const [form, setForm] = useState({ host: '', port: '587', user: '', pass: '', from_email: '', secure: false, enabled: false })
  const [passSet, setPassSet] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [testing, setTesting] = useState(false)
  const [testTo, setTestTo]   = useState('')
  const [msg, setMsg]         = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    api.getPlatformSmtp().then(c => {
      setForm({
        host: c.host ?? '', port: String(c.port ?? 587), user: c.user ?? '',
        pass: '', from_email: c.from_email ?? '',
        secure: Boolean(c.secure), enabled: Boolean(c.enabled),
      })
      setPassSet(Boolean(c.pass_set))
    }).catch(() => {}).finally(() => setLoading(false))
  }, []) // eslint-disable-line

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null); setSaving(true)
    try {
      const saved = await api.updatePlatformSmtp({
        host: form.host.trim(), port: parseInt(form.port, 10) || 587,
        user: form.user.trim(), from_email: form.from_email.trim(),
        secure: form.secure, enabled: form.enabled,
        ...(form.pass ? { pass: form.pass } : {}),
      })
      setPassSet(Boolean(saved.pass_set))
      setForm(f => ({ ...f, pass: '' }))
      setMsg({ ok: true, text: 'Platform SMTP configuration saved.' })
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }) }
    finally { setSaving(false) }
  }

  const handleTest = async () => {
    setTesting(true); setMsg(null)
    try {
      const result = await api.testPlatformSmtp(testTo.trim() || undefined)
      setMsg({ ok: result.ok, text: result.message })
    } catch {
      setMsg({ ok: false, text: 'Request failed — make sure platform SMTP is saved and enabled first.' })
    } finally { setTesting(false) }
  }

  if (loading) return <div className="flex items-center justify-center py-16 gap-2 text-slate-400"><RefreshCw size={16} className="animate-spin" /></div>

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center"><Mail size={20} className="text-sky-600" /></div>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Platform Email (System SMTP)</h2>
          <p className="text-xs text-slate-500">Powers password resets, agent invites, and account/plan notifications across all tenants. Independent of per-tenant SMTP.</p>
        </div>
      </div>

      {msg && <div className={`mb-5 p-3 rounded-lg text-xs ${msg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>{msg.text}</div>}

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">SMTP Host</label><input type="text" value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="smtp.sendgrid.net" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Port</label><input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: e.target.value }))} placeholder="587" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
          </div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1.5">SMTP Username</label><input type="text" value={form.user} onChange={e => setForm(f => ({ ...f, user: e.target.value }))} placeholder="apikey or your@email.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1.5">SMTP Password / API Key</label><input type="password" value={form.pass} onChange={e => setForm(f => ({ ...f, pass: e.target.value }))} placeholder={passSet ? 'Leave blank to keep existing' : 'Enter password or API key'} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" />{passSet && <p className="mt-1 text-[11px] text-emerald-600">A password is currently stored. Leave blank to keep it.</p>}</div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1.5">From Email</label><input type="email" value={form.from_email} onChange={e => setForm(f => ({ ...f, from_email: e.target.value }))} placeholder="noreply@yourplatform.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div><p className="text-xs font-medium text-slate-700">Use TLS/SSL (secure)</p><p className="text-[11px] text-slate-400">Enable for port 465. Leave off for STARTTLS on 587.</p></div>
            <button type="button" onClick={() => setForm(f => ({ ...f, secure: !f.secure }))} className={`transition-colors ${form.secure ? 'text-sky-500' : 'text-slate-400'}`}>{form.secure ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}</button>
          </div>
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div><p className="text-xs font-medium text-slate-700">Enable Platform Emails</p><p className="text-[11px] text-slate-400">When off, system emails fall back to dev mode (reset links returned in-app)</p></div>
            <button type="button" onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))} className={`transition-colors ${form.enabled ? 'text-sky-500' : 'text-slate-400'}`}>{form.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}</button>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-end pt-1">
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Send test email to <span className="text-slate-400 font-normal">(optional — defaults to From Email)</span></label><input type="email" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="you@example.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
            <button type="button" disabled={testing || !form.host.trim()} onClick={handleTest} className="px-4 py-2 text-sky-700 bg-sky-50 border border-sky-200 text-xs font-medium rounded-lg hover:bg-sky-100 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap">{testing ? <><RefreshCw size={11} className="animate-spin" /> Sending…</> : 'Send Test'}</button>
          </div>
          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5">{saving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : 'Save Configuration'}</button>
          </div>
        </form>
      </div>

      <div className="mt-4 p-4 bg-sky-50 border border-sky-100 rounded-xl">
        <p className="text-[11px] text-sky-700 font-medium mb-2">Common SMTP providers</p>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-sky-600">
          <div><strong>SendGrid:</strong> smtp.sendgrid.net : 587</div>
          <div><strong>Resend:</strong> smtp.resend.com : 465</div>
          <div><strong>Postmark:</strong> smtp.postmarkapp.com : 587</div>
          <div><strong>Mailgun:</strong> smtp.mailgun.org : 465</div>
        </div>
      </div>
    </div>
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
interface InboxToast { id: string; convId: string; visitorName: string; preview: string; createdAt: number; kind?: 'pending' | 'ticket' }

function ToastStack({ toasts, onDismiss, onOpen }: { toasts: InboxToast[]; onDismiss: (id: string) => void; onOpen: (convId: string) => void }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 340 }}>
      {toasts.map(t => t.kind === 'ticket' ? (
        <div key={t.id} className="pointer-events-auto flex items-start gap-3 bg-violet-950 border border-violet-700 shadow-2xl rounded-xl px-4 py-3" style={{ animation: 'slideInRight 0.25s ease-out' }}>
          <div className="w-8 h-8 rounded-full bg-violet-500 flex items-center justify-center text-white text-sm font-bold shrink-0 mt-0.5">🎫</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-violet-100 truncate">{t.visitorName}</p>
            <p className="text-xs text-violet-300 truncate mt-0.5">{t.preview}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => { onOpen(t.convId); onDismiss(t.id) }} className="text-[10px] font-semibold text-violet-300 hover:text-violet-100 transition-colors px-1.5 py-1 rounded">View</button>
            <button onClick={() => onDismiss(t.id)} className="text-violet-700 hover:text-violet-300 transition-colors p-1 rounded"><X size={11} /></button>
          </div>
        </div>
      ) : t.kind === 'pending' ? (
        <div key={t.id} className="pointer-events-auto flex items-start gap-3 bg-amber-950 border border-amber-700 shadow-2xl rounded-xl px-4 py-3" style={{ animation: 'slideInRight 0.25s ease-out' }}>
          <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-white text-sm font-bold shrink-0 mt-0.5">⏳</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-amber-100 truncate">{t.visitorName}</p>
            <p className="text-xs text-amber-300 truncate mt-0.5">{t.preview}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => { onOpen(t.convId); onDismiss(t.id) }} className="text-[10px] font-semibold text-amber-300 hover:text-amber-100 transition-colors px-1.5 py-1 rounded">View</button>
            <button onClick={() => onDismiss(t.id)} className="text-amber-700 hover:text-amber-300 transition-colors p-1 rounded"><X size={11} /></button>
          </div>
        </div>
      ) : (
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

// ─── AI Training Section ──────────────────────────────────────────────────────
type AITab = 'articles' | 'crawl' | 'pdf' | 'text' | 'faq' | 'bot-settings'

function AITrainingSection() {
  const api = useApi()
  const [tab, setTab] = useState<AITab>('articles')
  const [articles, setArticles] = useState<KnowledgeArticle[]>([])
  const [artLoading, setArtLoading] = useState(false)
  const [artForm, setArtForm] = useState({ title: '', content: '', tags: '' })
  const [artEditing, setArtEditing] = useState<KnowledgeArticle | null>(null)
  const [artSaving, setArtSaving] = useState(false)
  const [artMsg, setArtMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [crawlUrl, setCrawlUrl] = useState('')
  const [crawlMaxPages, setCrawlMaxPages] = useState(100)
  const [crawlMaxDepth, setCrawlMaxDepth] = useState(5)
  const [crawling, setCrawling] = useState(false)
  const [crawlMsg, setCrawlMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [crawlProgress, setCrawlProgress] = useState<{ crawled: number; saved: number; errors: number; maxPages: number; currentUrl?: string } | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [pdfMsg, setPdfMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const pdfRef = useRef<HTMLInputElement>(null)
  const [textForm, setTextForm] = useState({ title: '', content: '', tags: '' })
  const [textSaving, setTextSaving] = useState(false)
  const [textMsg, setTextMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [faqPairs, setFaqPairs] = useState([{ q: '', a: '' }])
  const [faqSaving, setFaqSaving] = useState(false)
  const [faqMsg, setFaqMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // ── Bot Settings state ───────────────────────────────────────────────────────
  const [brands, setBrands] = useState<AIBrandSetting[]>([])
  const [brandsLoading, setBrandsLoading] = useState(false)
  type BotForm = { ai_system_prompt: string; bot_max_messages: string; auto_assign_strategy: string; auto_close_enabled: boolean; auto_close_idle_minutes: string }
  const [botForms, setBotForms] = useState<Record<string, BotForm>>({})
  const [botSaving, setBotSaving] = useState<Record<string, boolean>>({})
  const [botMsg, setBotMsg] = useState<Record<string, { ok: boolean; text: string }>>({})

  const loadBrands = useCallback(() => {
    setBrandsLoading(true)
    api.listAISettings().then(b => {
      setBrands(b)
      const forms: Record<string, BotForm> = {}
      b.forEach(br => {
        forms[br.id] = {
          ai_system_prompt:       br.ai_system_prompt || '',
          bot_max_messages:       String(br.bot_max_messages ?? 10),
          auto_assign_strategy:   br.auto_assign_strategy || 'round_robin',
          auto_close_enabled:     Boolean(br.auto_close_enabled),
          auto_close_idle_minutes: String(br.auto_close_idle_minutes ?? 60),
        }
      })
      setBotForms(forms)
      setBrandsLoading(false)
    }).catch(() => setBrandsLoading(false))
  }, []) // eslint-disable-line

  const handleBotSave = async (brandId: string) => {
    const form = botForms[brandId]
    if (!form) return
    setBotSaving(s => ({ ...s, [brandId]: true }))
    setBotMsg(m => ({ ...m, [brandId]: { ok: true, text: '' } }))
    try {
      const updated = await api.updateBotSettings(brandId, {
        ai_system_prompt:       form.ai_system_prompt || null,
        bot_max_messages:       parseInt(form.bot_max_messages, 10) || 10,
        auto_assign_strategy:   form.auto_assign_strategy,
        auto_close_enabled:     form.auto_close_enabled,
        auto_close_idle_minutes: parseInt(form.auto_close_idle_minutes, 10) || 60,
      })
      setBrands(prev => prev.map(b => b.id === brandId ? updated : b))
      setBotMsg(m => ({ ...m, [brandId]: { ok: true, text: 'Settings saved.' } }))
    } catch (err) {
      setBotMsg(m => ({ ...m, [brandId]: { ok: false, text: (err as Error).message } }))
    } finally {
      setBotSaving(s => ({ ...s, [brandId]: false }))
    }
  }

  const loadArticles = useCallback(() => {
    setArtLoading(true)
    api.listKnowledge().then(a => { setArticles(a); setArtLoading(false) }).catch(() => setArtLoading(false))
  }, []) // eslint-disable-line

  useEffect(() => { loadArticles() }, []) // eslint-disable-line
  useEffect(() => { if (tab === 'bot-settings' && !brands.length) loadBrands() }, [tab]) // eslint-disable-line

  const handleArtSave = async () => {
    setArtSaving(true); setArtMsg(null)
    const tags = artForm.tags.split(',').map(t => t.trim()).filter(Boolean)
    try {
      if (artEditing) {
        const updated = await api.updateKnowledge(artEditing.id, { title: artForm.title, content: artForm.content, tags })
        setArticles(prev => prev.map(a => a.id === artEditing.id ? updated : a))
        setArtEditing(null)
      } else {
        const created = await api.createKnowledge({ title: artForm.title, content: artForm.content, tags })
        setArticles(prev => [created, ...prev])
      }
      setArtForm({ title: '', content: '', tags: '' })
      setArtMsg({ ok: true, text: artEditing ? 'Article updated.' : 'Article created.' })
    } catch (err) { setArtMsg({ ok: false, text: (err as Error).message }) }
    finally { setArtSaving(false) }
  }

  const handleCrawl = async () => {
    if (!crawlUrl.trim()) return
    setCrawling(true); setCrawlMsg(null); setCrawlProgress(null)
    try {
      const { jobId, maxPages } = await api.startSiteCrawl(crawlUrl.trim(), undefined, crawlMaxPages, crawlMaxDepth)

      // Poll for progress every 2 seconds
      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(async () => {
          try {
            const job = await api.getCrawlStatus(jobId)
            setCrawlProgress({ crawled: job.crawled, saved: job.saved, errors: job.errors, maxPages: job.maxPages, currentUrl: job.currentUrl })
            if (job.status === 'done' || job.status === 'error') {
              clearInterval(interval)
              if (job.status === 'error') reject(new Error(job.errorMessage ?? 'Crawl failed'))
              else resolve()
            }
          } catch (err) { clearInterval(interval); reject(err) }
        }, 2000)
      })

      // Reload articles list so crawled pages appear
      const data = await api.listKnowledge()
      setArticles(data)

      const prog = await api.getCrawlStatus(jobId).catch(() => null)
      const saved = prog?.saved ?? 0
      const errors = prog?.errors ?? 0
      setCrawlMsg({ ok: true, text: `Done! Crawled ${maxPages <= crawlMaxPages ? prog?.crawled ?? 0 : crawlMaxPages} pages — ${saved} article${saved !== 1 ? 's' : ''} saved${errors > 0 ? `, ${errors} page${errors !== 1 ? 's' : ''} skipped` : ''}.` })
      setCrawlUrl('')
    } catch (err) { setCrawlMsg({ ok: false, text: (err as Error).message }) }
    finally { setCrawling(false) }
  }

  const handlePdfUpload = async () => {
    if (!pdfFile) return
    setUploading(true); setPdfMsg(null)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = e => {
          const result = (e.target?.result as string)
          resolve(result.includes(',') ? result.split(',')[1] : result)
        }
        reader.onerror = reject
        reader.readAsDataURL(pdfFile)
      })
      const article = await api.uploadPdfKnowledge(base64, pdfFile.name)
      setArticles(prev => [article, ...prev])
      setPdfMsg({ ok: true, text: `Extracted and saved as article: "${article.title}"` })
      setPdfFile(null)
      if (pdfRef.current) pdfRef.current.value = ''
    } catch (err) { setPdfMsg({ ok: false, text: (err as Error).message }) }
    finally { setUploading(false) }
  }

  const handleTextSave = async () => {
    if (!textForm.title.trim() || !textForm.content.trim()) return
    setTextSaving(true); setTextMsg(null)
    try {
      const tags = textForm.tags.split(',').map(t => t.trim()).filter(Boolean)
      const article = await api.createKnowledge({ title: textForm.title, content: textForm.content, tags })
      setArticles(prev => [article, ...prev])
      setTextMsg({ ok: true, text: 'Saved as knowledge article.' })
      setTextForm({ title: '', content: '', tags: '' })
    } catch (err) { setTextMsg({ ok: false, text: (err as Error).message }) }
    finally { setTextSaving(false) }
  }

  const handleFaqSave = async () => {
    const valid = faqPairs.filter(p => p.q.trim() && p.a.trim())
    if (!valid.length) return
    setFaqSaving(true); setFaqMsg(null)
    try {
      const created: KnowledgeArticle[] = []
      for (const pair of valid) {
        const article = await api.createKnowledge({ title: pair.q.trim(), content: `Q: ${pair.q.trim()}\n\nA: ${pair.a.trim()}`, tags: ['faq'] })
        created.push(article)
      }
      setArticles(prev => [...created, ...prev])
      setFaqMsg({ ok: true, text: `${created.length} FAQ item${created.length !== 1 ? 's' : ''} saved.` })
      setFaqPairs([{ q: '', a: '' }])
    } catch (err) { setFaqMsg({ ok: false, text: (err as Error).message }) }
    finally { setFaqSaving(false) }
  }

  const TABS: { key: AITab; label: string; icon: React.ReactNode }[] = [
    { key: 'articles',     label: 'Articles',     icon: <BookOpen size={14} /> },
    { key: 'crawl',        label: 'Web Crawl',    icon: <Globe size={14} /> },
    { key: 'pdf',          label: 'PDF Upload',   icon: <Paperclip size={14} /> },
    { key: 'text',         label: 'Text Content', icon: <FileText size={14} /> },
    { key: 'faq',          label: 'FAQ',          icon: <MessageCircle size={14} /> },
    { key: 'bot-settings', label: 'Bot Settings', icon: <Settings size={14} /> },
  ]

  const StatusBanner = ({ msg }: { msg: { ok: boolean; text: string } | null }) => !msg ? null : (
    <div className={`p-3 rounded-lg text-xs mb-4 ${msg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>{msg.text}</div>
  )

  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center"><Brain size={20} className="text-purple-600" /></div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">AI Training</h2>
            <p className="text-xs text-slate-500">Build the knowledge base your AI uses when responding to customers.</p>
          </div>
        </div>

        <div className="flex gap-1 mb-6 border-b border-slate-200 overflow-x-auto pb-0">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap -mb-px ${tab === t.key ? 'border-purple-600 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {tab === 'articles' && (
          <div className="space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-semibold text-slate-700 mb-3">{artEditing ? 'Edit Article' : 'Add Article'}</p>
              <StatusBanner msg={artMsg} />
              <div className="space-y-3">
                <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Title *</label><input type="text" value={artForm.title} onChange={e => setArtForm(f => ({ ...f, title: e.target.value }))} placeholder="How to reset your password" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400" /></div>
                <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Content *</label><textarea rows={4} value={artForm.content} onChange={e => setArtForm(f => ({ ...f, content: e.target.value }))} placeholder="Write article content…" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400 resize-none" /></div>
                <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Tags <span className="text-slate-400 font-normal">(comma-separated)</span></label><input type="text" value={artForm.tags} onChange={e => setArtForm(f => ({ ...f, tags: e.target.value }))} placeholder="billing, password, account" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400" /></div>
                <div className="flex gap-2">
                  {artEditing && <button onClick={() => { setArtEditing(null); setArtForm({ title: '', content: '', tags: '' }) }} className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>}
                  <button disabled={artSaving || !artForm.title.trim() || !artForm.content.trim()} onClick={handleArtSave} className="px-4 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5">
                    {artSaving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : artEditing ? <><Pencil size={11} /> Update</> : <><Plus size={11} /> Add Article</>}
                  </button>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-semibold text-slate-700 mb-3">All Articles ({articles.length})</p>
              {artLoading ? <div className="flex items-center gap-2 text-slate-400 text-xs py-4"><RefreshCw size={12} className="animate-spin" /> Loading…</div>
                : articles.length === 0 ? <div className="text-center py-8"><BookOpen size={24} className="mx-auto text-slate-200 mb-2" /><p className="text-xs text-slate-400">No articles yet. Add one above.</p></div>
                : <div className="space-y-2">{articles.map(a => (
                  <div key={a.id} className="flex items-start justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-xs font-semibold text-slate-800 truncate">{a.title}</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${a.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>{a.is_active ? 'Active' : 'Inactive'}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-2">{a.content}</p>
                      {a.tags.length > 0 && <div className="flex gap-1 mt-1 flex-wrap">{a.tags.map(t => <span key={t} className="text-[10px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">{t}</span>)}</div>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={async () => { try { const u = await api.updateKnowledge(a.id, { is_active: !a.is_active }); setArticles(prev => prev.map(x => x.id === a.id ? u : x)) } catch { /* */ } }} className={`p-1.5 rounded transition-colors ${a.is_active ? 'text-purple-500 hover:bg-purple-50' : 'text-slate-400 hover:bg-slate-100'}`}>{a.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}</button>
                      <button onClick={() => { setArtEditing(a); setArtForm({ title: a.title, content: a.content, tags: a.tags.join(', ') }); setTab('articles') }} className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors"><Pencil size={12} /></button>
                      <button onClick={async () => { try { await api.deleteKnowledge(a.id); setArticles(prev => prev.filter(x => x.id !== a.id)) } catch { /* */ } }} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={12} /></button>
                    </div>
                  </div>
                ))}</div>}
            </div>
          </div>
        )}

        {tab === 'crawl' && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-1">Crawl a Website</p>
              <p className="text-[11px] text-slate-400">Enter a starting URL and we'll crawl the whole site — following internal links up to your chosen depth and page limit.</p>
            </div>
            <StatusBanner msg={crawlMsg} />

            {/* URL input row */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Globe size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="url" value={crawlUrl} onChange={e => setCrawlUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && !crawling && handleCrawl()} placeholder="https://docs.yoursite.com" disabled={crawling} className="w-full pl-8 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400 disabled:opacity-50" />
              </div>
              <button onClick={handleCrawl} disabled={crawling || !crawlUrl.trim()} className="px-4 py-2.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5 shrink-0">
                {crawling ? <><RefreshCw size={11} className="animate-spin" /> Crawling…</> : <><Globe size={11} /> Start Crawl</>}
              </button>
            </div>

            {/* Crawl settings */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Max pages <span className="text-slate-400 font-normal">(1–5000)</span></label>
                <input type="number" min={1} max={5000} value={crawlMaxPages} onChange={e => setCrawlMaxPages(Math.min(5000, Math.max(1, parseInt(e.target.value) || 1)))} disabled={crawling} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400 disabled:opacity-50" />
                <p className="text-[10px] text-slate-400 mt-0.5">~{Math.round(crawlMaxPages * 0.6 / 60)} min at 600 ms/page</p>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Link depth <span className="text-slate-400 font-normal">(1–20)</span></label>
                <input type="number" min={1} max={20} value={crawlMaxDepth} onChange={e => setCrawlMaxDepth(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))} disabled={crawling} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400 disabled:opacity-50" />
                <p className="text-[10px] text-slate-400 mt-0.5">Hops from the starting URL</p>
              </div>
            </div>

            {/* Live progress */}
            {crawling && crawlProgress && (
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-purple-700">Crawling in progress…</span>
                  <span className="text-[11px] text-purple-600">{crawlProgress.crawled} / {crawlProgress.maxPages} pages</span>
                </div>
                <div className="w-full bg-purple-100 rounded-full h-1.5">
                  <div className="bg-purple-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (crawlProgress.crawled / crawlProgress.maxPages) * 100)}%` }} />
                </div>
                <div className="flex gap-3 text-[10px] text-purple-600">
                  <span>✓ {crawlProgress.saved} saved</span>
                  {crawlProgress.errors > 0 && <span className="text-amber-600">⚠ {crawlProgress.errors} skipped</span>}
                </div>
                {crawlProgress.currentUrl && (
                  <p className="text-[10px] text-purple-400 truncate" title={crawlProgress.currentUrl}>↳ {crawlProgress.currentUrl}</p>
                )}
              </div>
            )}
            {crawling && !crawlProgress && (
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg flex items-center gap-2">
                <RefreshCw size={11} className="animate-spin text-purple-500 shrink-0" />
                <span className="text-[11px] text-purple-600">Starting crawl…</span>
              </div>
            )}

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <p className="text-[11px] text-slate-500 font-medium mb-1">Tips</p>
              <ul className="text-[11px] text-slate-400 space-y-0.5 list-disc list-inside">
                <li>Crawl runs in the background — you can navigate away</li>
                <li>Only follows links on the same domain as the starting URL</li>
                <li>JavaScript-heavy SPAs may not render all content</li>
                <li>Pages with <code className="bg-slate-100 px-0.5 rounded text-[10px]">noindex</code> headers are skipped automatically</li>
                <li>Crawled articles appear in the Articles tab</li>
              </ul>
            </div>
          </div>
        )}

        {tab === 'pdf' && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-1">Upload a PDF</p>
              <p className="text-[11px] text-slate-400">Extract text from a PDF file and save it as a knowledge article.</p>
            </div>
            <StatusBanner msg={pdfMsg} />
            <div
              className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-purple-300 hover:bg-purple-50/30 transition-colors"
              onClick={() => pdfRef.current?.click()}
              onDragOver={e => { e.preventDefault() }}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type === 'application/pdf') setPdfFile(f) }}
            >
              <Upload size={24} className="mx-auto text-slate-300 mb-2" />
              <p className="text-xs font-medium text-slate-600">{pdfFile ? pdfFile.name : 'Drop a PDF here or click to browse'}</p>
              <p className="text-[11px] text-slate-400 mt-1">{pdfFile ? `${(pdfFile.size / 1024).toFixed(0)} KB` : 'PDF files only, max 20 MB'}</p>
              <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setPdfFile(f) }} />
            </div>
            {pdfFile && (
              <button onClick={handlePdfUpload} disabled={uploading} className="w-full py-2.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                {uploading ? <><RefreshCw size={11} className="animate-spin" /> Extracting text…</> : <><Upload size={11} /> Extract & Save</>}
              </button>
            )}
          </div>
        )}

        {tab === 'text' && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-1">Add Text Content</p>
              <p className="text-[11px] text-slate-400">Paste or type any text content you want the AI to learn from.</p>
            </div>
            <StatusBanner msg={textMsg} />
            <div className="space-y-3">
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Title *</label><input type="text" value={textForm.title} onChange={e => setTextForm(f => ({ ...f, title: e.target.value }))} placeholder="Return Policy Overview" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Content *</label><textarea rows={8} value={textForm.content} onChange={e => setTextForm(f => ({ ...f, content: e.target.value }))} placeholder="Paste your content here — policies, procedures, product descriptions, etc." className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400 resize-none" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Tags <span className="text-slate-400 font-normal">(comma-separated)</span></label><input type="text" value={textForm.tags} onChange={e => setTextForm(f => ({ ...f, tags: e.target.value }))} placeholder="policy, returns, shipping" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400" /></div>
              <button disabled={textSaving || !textForm.title.trim() || !textForm.content.trim()} onClick={handleTextSave} className="px-4 py-2 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5">
                {textSaving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : <><Plus size={11} /> Save as Article</>}
              </button>
            </div>
          </div>
        )}

        {tab === 'faq' && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-1">FAQ Builder</p>
              <p className="text-[11px] text-slate-400">Add question and answer pairs — each becomes a separate knowledge article tagged "faq".</p>
            </div>
            <StatusBanner msg={faqMsg} />
            <div className="space-y-3">
              {faqPairs.map((pair, i) => (
                <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-500">Item {i + 1}</span>
                    {faqPairs.length > 1 && <button onClick={() => setFaqPairs(prev => prev.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-red-500 rounded transition-colors"><Trash2 size={11} /></button>}
                  </div>
                  <input type="text" value={pair.q} onChange={e => setFaqPairs(prev => prev.map((p, j) => j === i ? { ...p, q: e.target.value } : p))} placeholder="Question" className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400" />
                  <textarea rows={2} value={pair.a} onChange={e => setFaqPairs(prev => prev.map((p, j) => j === i ? { ...p, a: e.target.value } : p))} placeholder="Answer" className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400 resize-none" />
                </div>
              ))}
              <button onClick={() => setFaqPairs(prev => [...prev, { q: '', a: '' }])} className="w-full py-2 border-2 border-dashed border-slate-200 rounded-lg text-xs text-slate-500 hover:border-purple-300 hover:text-purple-600 hover:bg-purple-50/30 transition-colors flex items-center justify-center gap-1.5">
                <Plus size={12} /> Add Another
              </button>
              <button disabled={faqSaving || !faqPairs.some(p => p.q.trim() && p.a.trim())} onClick={handleFaqSave} className="px-4 py-2 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5">
                {faqSaving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : <><Plus size={11} /> Save FAQ Items</>}
              </button>
            </div>
          </div>
        )}

        {tab === 'bot-settings' && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-blue-800 mb-1">Bot Behaviour per Brand</p>
              <p className="text-[11px] text-blue-600">Configure how the AI bot responds, hands over to agents, and auto-closes idle conversations. Settings are saved per brand.</p>
            </div>
            {brandsLoading && <div className="flex items-center gap-2 text-slate-400 text-xs py-4"><RefreshCw size={12} className="animate-spin" /> Loading brands…</div>}
            {!brandsLoading && brands.length === 0 && <div className="text-center py-8 text-xs text-slate-400">No brands found. Create a brand first.</div>}
            {brands.map(brand => {
              const form = botForms[brand.id]
              if (!form) return null
              const saving = botSaving[brand.id] ?? false
              const msg = botMsg[brand.id]
              return (
                <div key={brand.id} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">{brand.brand_name}</p>
                    {msg && <span className={`text-[11px] font-medium ${msg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{msg.text}</span>}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">AI System Prompt</label>
                    <textarea rows={3} value={form.ai_system_prompt} onChange={e => setBotForms(f => ({ ...f, [brand.id]: { ...f[brand.id], ai_system_prompt: e.target.value } }))} placeholder="You are a helpful support assistant for this brand…" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400 resize-none" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">Max Bot Messages <span className="text-slate-400 font-normal">(before handover)</span></label>
                      <input type="number" min={1} max={50} value={form.bot_max_messages} onChange={e => setBotForms(f => ({ ...f, [brand.id]: { ...f[brand.id], bot_max_messages: e.target.value } }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">Auto-assign Strategy</label>
                      <select value={form.auto_assign_strategy} onChange={e => setBotForms(f => ({ ...f, [brand.id]: { ...f[brand.id], auto_assign_strategy: e.target.value } }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400">
                        <option value="round_robin">Round Robin</option>
                        <option value="least_load">Least Load</option>
                        <option value="manual">Manual (no auto-assign)</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.auto_close_enabled} onChange={e => setBotForms(f => ({ ...f, [brand.id]: { ...f[brand.id], auto_close_enabled: e.target.checked } }))} className="rounded" />
                      <span className="text-xs text-slate-700 font-medium">Auto-close idle conversations</span>
                    </label>
                    {form.auto_close_enabled && (
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-600">after</label>
                        <input type="number" min={5} max={10080} value={form.auto_close_idle_minutes} onChange={e => setBotForms(f => ({ ...f, [brand.id]: { ...f[brand.id], auto_close_idle_minutes: e.target.value } }))} className="w-20 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-purple-400" />
                        <label className="text-xs text-slate-600">minutes idle</label>
                      </div>
                    )}
                  </div>

                  <button disabled={saving} onClick={() => handleBotSave(brand.id)} className="px-4 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5">
                    {saving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : <><Check size={11} /> Save Settings</>}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── SMTP Section ─────────────────────────────────────────────────────────────
/** Extract the domain part from an email address, e.g. "support@omni.irofficial.com" → "omni.irofficial.com" */
function extractEmailDomain(email: string): string {
  const at = email.trim().lastIndexOf('@')
  return at !== -1 ? email.trim().slice(at + 1).toLowerCase() : ''
}

function SMTPSection() {
  const api = useApi()
  const [form, setForm] = useState({
    host: '', port: '587', user: '', pass: '',
    from_email: '', notification_email: '',
    inbound_email_domain: '', enabled: false,
  })
  const [domainAutoFilled, setDomainAutoFilled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    api.getWorkspaceSettings().then(s => {
      const sc = s.smtp_config_json as Record<string, unknown> | null | undefined
      if (sc) {
        const savedDomain = String(sc.inbound_email_domain ?? '')
        setForm(f => ({
          ...f,
          host: String(sc.host ?? ''),
          port: String(sc.port ?? '587'),
          user: String(sc.user ?? ''),
          from_email: String(sc.from_email ?? ''),
          notification_email: String(sc.notification_email ?? ''),
          inbound_email_domain: savedDomain,
          enabled: Boolean(sc.enabled),
        }))
        // Mark as auto-filled only if no explicit domain was saved
        if (!savedDomain && sc.from_email) setDomainAutoFilled(true)
      }
    }).catch(() => {})
  }, []) // eslint-disable-line

  // When from_email changes, auto-populate the domain field if the user
  // hasn't manually touched it
  const handleFromEmailChange = (val: string) => {
    setForm(f => {
      const nextDomain = (!f.inbound_email_domain || domainAutoFilled)
        ? extractEmailDomain(val)
        : f.inbound_email_domain
      return { ...f, from_email: val, inbound_email_domain: nextDomain }
    })
    setDomainAutoFilled(true)
  }

  const handleDomainChange = (val: string) => {
    setDomainAutoFilled(false) // user took manual control
    setForm(f => ({ ...f, inbound_email_domain: val }))
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null); setSaving(true)
    try {
      await api.updateWorkspace({
        smtp_config_json: {
          host: form.host.trim(), port: parseInt(form.port, 10) || 587,
          user: form.user.trim(), pass: form.pass || undefined,
          from_email: form.from_email.trim(),
          notification_email: form.notification_email.trim() || undefined,
          inbound_email_domain: form.inbound_email_domain.trim() || undefined,
          enabled: form.enabled,
        }
      })
      setMsg({ ok: true, text: 'SMTP configuration saved.' })
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }) }
    finally { setSaving(false) }
  }

  const handleTest = async () => {
    setTesting(true); setMsg(null)
    try {
      const result = await api.testSmtp()
      setMsg({ ok: result.ok, text: result.message })
    } catch {
      setMsg({ ok: false, text: 'Request failed — make sure SMTP is saved and enabled first.' })
    } finally {
      setTesting(false)
    }
  }

  const derivedDomain = extractEmailDomain(form.from_email)

  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center"><Mail size={20} className="text-sky-600" /></div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Email / SMTP</h2>
            <p className="text-xs text-slate-500">Configure your outbound mail server for ticket alerts and status notifications.</p>
          </div>
        </div>

        {msg && <div className={`mb-5 p-3 rounded-lg text-xs ${msg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>{msg.text}</div>}

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">SMTP Host</label><input type="text" value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="smtp.sendgrid.net" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
              <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Port</label><input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: e.target.value }))} placeholder="587" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
            </div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">SMTP Username</label><input type="text" value={form.user} onChange={e => setForm(f => ({ ...f, user: e.target.value }))} placeholder="apikey or your@email.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">SMTP Password / API Key</label><input type="password" value={form.pass} onChange={e => setForm(f => ({ ...f, pass: e.target.value }))} placeholder="Leave blank to keep existing" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">From Email</label><input type="email" value={form.from_email} onChange={e => handleFromEmailChange(e.target.value)} placeholder="support@yourcompany.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>

            {/* Inbound Email Domain */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Inbound Email Domain
                <span className="ml-1.5 text-slate-400 font-normal">(for reply threading)</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={form.inbound_email_domain}
                  onChange={e => handleDomainChange(e.target.value)}
                  placeholder={derivedDomain || 'inbound.yourcompany.com'}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 pr-20"
                />
                {domainAutoFilled && form.inbound_email_domain && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-sky-500 font-medium bg-sky-50 px-1.5 py-0.5 rounded">auto</span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                {domainAutoFilled
                  ? `Auto-extracted from your From Email. Replies to tickets will use reply+conv_…@${form.inbound_email_domain}.`
                  : 'The domain your inbound mail provider receives on. Leave blank to use the same domain as your From Email.'}
              </p>
            </div>

            <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Notification Email <span className="text-slate-400 font-normal">(receives alerts for new visitor messages)</span></label><input type="email" value={form.notification_email} onChange={e => setForm(f => ({ ...f, notification_email: e.target.value }))} placeholder="owner@yourcompany.com" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400" /></div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div><p className="text-xs font-medium text-slate-700">Enable SMTP Alerts</p><p className="text-[11px] text-slate-400">Send email notifications on ticket status changes and new messages</p></div>
              <button type="button" onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))} className={`transition-colors ${form.enabled ? 'text-sky-500' : 'text-slate-400'}`}>{form.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}</button>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={saving} className="px-4 py-2 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5">
                {saving ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : 'Save Configuration'}
              </button>
              <button type="button" disabled={testing || !form.host.trim()} onClick={handleTest} className="px-4 py-2 text-sky-700 bg-sky-50 border border-sky-200 text-xs font-medium rounded-lg hover:bg-sky-100 disabled:opacity-50 flex items-center gap-1.5">
                {testing ? <><RefreshCw size={11} className="animate-spin" /> Sending…</> : 'Send Test Email'}
              </button>
            </div>
          </form>
        </div>

        <div className="mt-4 p-4 bg-sky-50 border border-sky-100 rounded-xl">
          <p className="text-[11px] text-sky-700 font-medium mb-2">Common SMTP providers</p>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-sky-600">
            <div><strong>SendGrid:</strong> smtp.sendgrid.net : 587</div>
            <div><strong>Resend:</strong> smtp.resend.com : 465</div>
            <div><strong>Postmark:</strong> smtp.postmarkapp.com : 587</div>
            <div><strong>Mailgun:</strong> smtp.mailgun.org : 465</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Tickets Section ─────────────────────────────────────────────────────────
function TicketsSection({ tickets, activeId, agents, brands, messages, visitorPages, typingInfo, onSelect, onSend, onStatusChange, onConvertToTicket, onAssign, onEditMessage, onDeleteMessage, onPriorityChange, onDelete, socketConnected }: {
  tickets: Conversation[]; activeId: string | null; agents: AgentRow[]; brands: Brand[]
  messages: Record<string, Message[]>; visitorPages: Record<string, string>
  typingInfo: Record<string, string>
  onSelect: (id: string) => void
  onSend: (body: string, isInternalNote?: boolean, attachments?: Attachment[]) => Promise<void>
  onStatusChange: (status: Status, triggerCsat?: boolean) => void
  onConvertToTicket: (triggerCsat: boolean) => Promise<void>
  onAssign: (agentId: string | null) => Promise<void>
  onEditMessage?: (msgId: string, newBody: string) => Promise<void>
  onDeleteMessage?: (msgId: string) => Promise<void>
  onPriorityChange?: (priority: Priority) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  socketConnected: boolean
}) {
  const api = useApi()
  const [query, setQuery]             = useState('')
  const [statusFilter, setStatus]     = useState<string>('all')
  const [agentFilter, setAgent]       = useState('')
  const [brandFilter, setBrand]       = useState('')
  const [priorityFilter, setPriority] = useState<string>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [exporting, setExporting]     = useState(false)

  const TICKET_STATUS_OPTS = ['all', 'submitted', 'in_progress', 'waiting_on_customer', 'resolved', 'closed']
  const PRIORITY_OPTS: { label: string; value: string }[] = [
    { label: 'All Priorities', value: 'all' },
    { label: 'Urgent', value: 'urgent' }, { label: 'High', value: 'high' },
    { label: 'Normal', value: 'normal' }, { label: 'Low', value: 'low' },
  ]

  const filtered = tickets
    .filter(t => statusFilter === 'all' || t.status === statusFilter)
    .filter(t => priorityFilter === 'all' || t.priority === priorityFilter)
    .filter(t => !agentFilter || t.assigned_agent_id === agentFilter)
    .filter(t => !brandFilter || t.brand_id === brandFilter)
    .filter(t => {
      if (!query) return true
      const q = query.toLowerCase()
      return t.visitor_name.toLowerCase().includes(q) || (t.subject ?? '').toLowerCase().includes(q) || (t.visitor_email ?? '').toLowerCase().includes(q)
    })
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  const activeTicket = filtered.find(t => t.id === activeId) ?? tickets.find(t => t.id === activeId)
  const hasExtraFilters = agentFilter || brandFilter || priorityFilter !== 'all'

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const toggleAll = () => setSelectedIds(selectedIds.size === filtered.length ? new Set() : new Set(filtered.map(t => t.id)))
  const handleBulkExport = async () => {
    if (!selectedIds.size) return
    setExporting(true)
    try { await api.bulkExport([...selectedIds]); setSelectedIds(new Set()) }
    catch (err) { alert((err as Error).message) }
    finally { setExporting(false) }
  }

  return (
    <>
      <div className="flex flex-col w-80 border-r border-slate-200 bg-white shrink-0">
        <div className="px-4 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Tag size={14} className="text-amber-600" />Tickets</h2>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{filtered.length}</span>
              <button onClick={() => setShowFilters(f => !f)} className={`p-1 rounded-md transition-colors ${hasExtraFilters ? 'text-amber-600 bg-amber-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`} title="Filters"><Filter size={13} /></button>
            </div>
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
          {showFilters && (
            <div className="space-y-2 pt-2 border-t border-slate-100 mt-1">
              <select value={priorityFilter} onChange={e => setPriority(e.target.value)} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400">
                {PRIORITY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select value={agentFilter} onChange={e => setAgent(e.target.value)} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400">
                <option value="">All Agents</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {brands.length > 0 && (
                <select value={brandFilter} onChange={e => setBrand(e.target.value)} className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400">
                  <option value="">All Brands</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
                </select>
              )}
              {hasExtraFilters && <button onClick={() => { setAgent(''); setBrand(''); setPriority('all') }} className="text-xs text-red-500 hover:text-red-600">Clear filters</button>}
            </div>
          )}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={selectedIds.size === filtered.length} onChange={toggleAll} className="w-3 h-3 rounded accent-amber-500 cursor-pointer" />
                <span className="text-[11px] text-slate-500">{selectedIds.size} selected</span>
              </div>
              <button onClick={handleBulkExport} disabled={exporting} className="flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 hover:bg-amber-100 disabled:opacity-50">
                {exporting ? <RefreshCw size={10} className="animate-spin" /> : <FileDown size={10} />} Export ZIP
              </button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8"><Tag size={28} className="text-slate-300 mb-2" /><p className="text-sm text-slate-400">No tickets</p><p className="text-xs text-slate-300 mt-1">Use "Ticket" button in any conversation</p></div>
          ) : filtered.map(t => (
            <div key={t.id} className="relative group/row">
              <div
                className={`absolute left-1.5 top-1/2 -translate-y-1/2 z-10 transition-opacity ${selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'}`}
                onClick={e => toggleSelect(t.id, e)}
              >
                <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => {}} className="w-3.5 h-3.5 rounded accent-amber-500 cursor-pointer" />
              </div>
              <ConversationRow conv={t} isActive={t.id === activeId} onClick={() => onSelect(t.id)} />
            </div>
          ))}
        </div>
      </div>
      {activeTicket ? (
        <ChatPanel conv={activeTicket} messages={messages[activeId!] ?? []} onSend={onSend} onStatusChange={onStatusChange} onConvertToTicket={onConvertToTicket} onAssign={onAssign} onEditMessage={onEditMessage} onDeleteMessage={onDeleteMessage} onPriorityChange={onPriorityChange} onDelete={onDelete} agents={agents} currentPage={visitorPages[activeId ?? ''] ?? null} socketConnected={socketConnected} typingWho={typingInfo[activeId ?? ''] ?? null} visitorOnline={false} visitorReadAt={null} />
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

// ─── Contacts Section ─────────────────────────────────────────────────────────
function ContactsSection({ brands, socketRef }: { brands: Brand[]; socketRef: React.MutableRefObject<Socket | null> }) {
  const api = useApi()
  const { isAdmin } = useAuth() as { isAdmin: boolean }
  const [contacts, setContacts]         = useState<Contact[]>([])
  const [total, setTotal]               = useState(0)
  const [pages, setPages]               = useState(1)
  const [page, setPage]                 = useState(1)
  const [search, setSearch]             = useState('')
  const [brandFilter, setBrandFilter]   = useState('')
  const [loading, setLoading]           = useState(true)
  const [selected, setSelected]         = useState<Contact | null>(null)
  const [convHistory, setConvHistory]   = useState<ContactConversation[]>([])
  const [panelLoading, setPanelLoading] = useState(false)
  const [exporting, setExporting]       = useState(false)
  const LIMIT = 25

  const load = useCallback(async (p = 1) => {
    setLoading(true)
    try {
      const params: Record<string, string> = { page: String(p), limit: String(LIMIT) }
      if (search) params.search = search
      if (brandFilter) params.brand_id = brandFilter
      const data = await api.listContacts(params)
      setContacts(data.contacts)
      setTotal(data.pagination.total)
      setPages(data.pagination.pages)
      setPage(p)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [api, search, brandFilter]) // eslint-disable-line

  useEffect(() => { load(1) }, [search, brandFilter]) // eslint-disable-line

  useEffect(() => {
    const socket = socketRef.current
    if (!socket) return
    const handler = () => load(page)
    socket.on('conversation:created', handler)
    return () => { socket.off('conversation:created', handler) }
  }, [socketRef, page, load])

  const handleExportCsv = async () => {
    setExporting(true)
    try {
      const params: Record<string, string> = {}
      if (search) params.search = search
      if (brandFilter) params.brand_id = brandFilter
      await api.exportContactsCsv(Object.keys(params).length ? params : undefined)
    } catch (err) { alert((err as Error).message) }
    finally { setExporting(false) }
  }

  const openPanel = async (c: Contact) => {
    setSelected(c)
    setConvHistory([])
    setPanelLoading(true)
    try {
      const rows = await api.getContactConversations(c.id)
      setConvHistory(rows)
    } catch { /* ignore */ }
    finally { setPanelLoading(false) }
  }

  const statusColor: Record<string, string> = {
    open: 'bg-sky-100 text-sky-700', closed: 'bg-slate-100 text-slate-500',
    pending: 'bg-amber-50 text-amber-700', ai_handling: 'bg-violet-100 text-violet-700',
    resolved: 'bg-emerald-50 text-emerald-700', in_progress: 'bg-indigo-50 text-indigo-700',
    waiting_on_customer: 'bg-orange-50 text-orange-700', submitted: 'bg-blue-50 text-blue-700',
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-white shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Contacts</h1>
              <p className="text-xs text-slate-500 mt-0.5">{total} visitor{total !== 1 ? 's' : ''} across all brands</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportCsv}
                disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                title={search || brandFilter ? 'Export filtered contacts as CSV' : 'Export all contacts as CSV'}
              >
                {exporting ? <RefreshCw size={12} className="animate-spin" /> : <FileDown size={12} />}
                Export CSV
              </button>
              <button onClick={() => load(page)} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-medium transition-colors">
                <RefreshCw size={12} /> Refresh
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text" placeholder="Search by name or email…"
                value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400"
              />
            </div>
            <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}
              className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400">
              <option value="">All Brands</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              <RefreshCw size={14} className="animate-spin mr-2" /> Loading contacts…
            </div>
          ) : contacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-400">
              <Users size={28} className="mb-2 opacity-40" />
              <p className="text-sm">{search || brandFilter ? 'No contacts match your filters.' : 'No contacts yet.'}</p>
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-slate-50 z-10">
                <tr className="border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Email</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Brand</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Location</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Last Seen</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Conversations</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map(c => (
                  <tr key={c.id}
                    onClick={() => openPanel(c)}
                    className={`border-b border-slate-100 cursor-pointer transition-colors hover:bg-sky-50/60 ${selected?.id === c.id ? 'bg-sky-50 border-l-2 border-l-sky-500' : ''}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-[11px] font-bold shrink-0">
                          {c.display_name[0]?.toUpperCase() || '?'}
                        </div>
                        <span className="text-slate-800 font-medium text-xs truncate max-w-[140px]">{c.display_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 truncate max-w-[160px]">{c.email || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{c.brand_name}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{c.location_city || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">{timeAgo(c.last_seen_at)}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-[11px] font-medium">
                        <MessageCircle size={10} /> {c.conversation_count}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {pages > 1 && (
          <div className="px-6 py-3 border-t border-slate-200 bg-white flex items-center justify-between shrink-0">
            <span className="text-xs text-slate-500">Page {page} of {pages} ({total} total)</span>
            <div className="flex gap-1.5">
              <button disabled={page <= 1} onClick={() => load(page - 1)}
                className="px-3 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                ← Prev
              </button>
              <button disabled={page >= pages} onClick={() => load(page + 1)}
                className="px-3 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div className="w-80 border-l border-slate-200 bg-white flex flex-col shrink-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-[12px] font-bold shrink-0">
                  {selected.display_name[0]?.toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{selected.display_name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{selected.email || 'No email'}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                  <Building size={9} /> {selected.brand_name}
                </span>
                {selected.location_city && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                    <Globe size={9} /> {selected.location_city}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                  <Clock size={9} /> {timeAgo(selected.last_seen_at)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 mt-0.5">
              {isAdmin && (
                <button
                  onClick={async () => {
                    if (!selected) return
                    if (!window.confirm(`Delete ${selected.display_name} and all their conversations? This cannot be undone.`)) return
                    try {
                      await api.deleteContact(selected.id)
                      setSelected(null)
                      setConvHistory([])
                      load(page)
                    } catch { /* ignore */ }
                  }}
                  className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                  title="Delete contact"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Conversation History</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {panelLoading ? (
              <div className="flex items-center justify-center h-20 text-slate-400 text-xs">
                <RefreshCw size={12} className="animate-spin mr-1.5" /> Loading…
              </div>
            ) : convHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 text-slate-400">
                <MessageSquare size={20} className="mb-1.5 opacity-40" />
                <p className="text-xs">No conversations yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {convHistory.map(conv => (
                  <div key={conv.id} className="px-4 py-3 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusColor[conv.status] ?? 'bg-slate-100 text-slate-500'}`}>
                        {conv.status.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[10px] text-slate-400">{timeAgo(conv.created_at)}</span>
                    </div>
                    <p className="text-xs text-slate-700 truncate mb-0.5">{conv.subject || '(No subject)'}</p>
                    <div className="flex items-center gap-2">
                      {conv.agent_name && <span className="text-[10px] text-slate-400 truncate">{conv.agent_name}</span>}
                      {conv.csat_score && <StarRating score={conv.csat_score} />}
                    </div>
                    {conv.referrer_url && (
                      <a href={conv.referrer_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[10px] text-sky-500 hover:underline truncate mt-0.5" title={conv.referrer_url}>
                        <Link2 size={8} className="shrink-0" />{conv.referrer_url}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Canned Responses Settings ────────────────────────────────────────────────
function CannedResponsesSection() {
  const api = useApi()
  const [responses, setResponses] = useState<CannedResponse[]>([])
  const [loading, setLoading]     = useState(true)
  const [form, setForm]           = useState({ name: '', body: '', shortcut: '' })
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    api.listCannedResponses()
      .then(setResponses)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null)
    if (!form.name.trim() || !form.body.trim()) { setMsg({ ok: false, text: 'Name and body are required.' }); return }
    setSaving(true)
    try {
      const created = await api.createCannedResponse(form.name, form.body, form.shortcut || undefined)
      setResponses(r => [...r, created].sort((a, b) => a.name.localeCompare(b.name)))
      setForm({ name: '', body: '', shortcut: '' })
      setMsg({ ok: true, text: 'Canned response saved.' })
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }) }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this canned response?')) return
    try { await api.deleteCannedResponse(id); setResponses(r => r.filter(x => x.id !== id)) }
    catch { /* non-fatal */ }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto w-full overflow-y-auto h-full">
      <h2 className="text-xl font-bold text-slate-900 mb-1 flex items-center gap-2">
        <Zap size={20} className="text-amber-500" /> Canned Responses
      </h2>
      <p className="text-sm text-slate-500 mb-6">
        Reusable reply templates for common questions. Agents pick them from the ⚡ button in the inbox.
      </p>

      <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2"><Plus size={14} /> New Canned Response</h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Name / Title *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Greeting" required
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Shortcut <span className="text-slate-400 font-normal">(optional)</span></label>
            <input value={form.shortcut} onChange={e => setForm(f => ({ ...f, shortcut: e.target.value }))}
              placeholder="e.g. /greet"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
        </div>
        <div className="mb-4">
          <label className="text-xs font-medium text-slate-600 mb-1 block">Reply Body *</label>
          <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
            rows={4} required placeholder="Type the reply template here…"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" />
        </div>
        {msg && <p className={`text-xs mb-3 ${msg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{msg.text}</p>}
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-sky-600 text-white text-sm font-semibold rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors">
          {saving ? 'Saving…' : 'Save Response'}
        </button>
      </form>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <RefreshCw size={18} className="animate-spin mr-2" /> Loading…
        </div>
      ) : responses.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Zap size={32} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">No canned responses yet. Create one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {responses.map(r => (
            <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-4 flex gap-4 items-start">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-slate-800">{r.name}</span>
                  {r.shortcut && (
                    <span className="text-[10px] font-mono bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded">{r.shortcut}</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 whitespace-pre-wrap line-clamp-3">{r.body}</p>
              </div>
              <button onClick={() => handleDelete(r.id)} title="Delete"
                className="shrink-0 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ active, onNavigate, unread, unassigned, ticketUnread, ticketOpen, recentActivity, onSelectConv, agent, onLogout, can }: {
  active: Section; onNavigate: (s: Section) => void; unread: number; unassigned: number
  ticketUnread: number; ticketOpen: number
  recentActivity: Conversation[]; onSelectConv: (id: string) => void
  agent: { name: string; email: string; role: string; isSuperAdmin?: boolean } | null
  onLogout: () => Promise<void>
  can: (feature: string, level?: string) => boolean
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

  const items: { key: Section; icon: React.ReactNode; label: string; feature?: string; superAdminOnly?: boolean }[] = [
    { key: 'conversations', icon: <MessageSquare size={16} />, label: 'Inbox', feature: 'inbox' },
    { key: 'tickets',       icon: <Tag size={16} />,           label: 'Tickets', feature: 'inbox' },
    { key: 'contacts',        icon: <Users size={16} />,         label: 'Contacts', feature: 'contacts' },
    { key: 'canned_responses', icon: <Zap size={16} />,        label: 'Canned Responses', feature: 'inbox' },
    { key: 'csat',            icon: <BarChart2 size={16} />,   label: 'CSAT', feature: 'analytics' },
    { key: 'ai_training',   icon: <Brain size={16} />,         label: 'AI Training', feature: 'knowledge_base' },
    { key: 'smtp',          icon: <Mail size={16} />,          label: 'Email / SMTP', feature: 'settings' },
    { key: 'brands',        icon: <Building2 size={16} />,     label: 'Brands', feature: 'brands' },
    { key: 'team',          icon: <Users size={16} />,         label: 'Team', feature: 'team' },
    { key: 'billing',       icon: <CreditCard size={16} />,    label: 'Billing', feature: 'billing' },
    { key: 'settings',      icon: <Settings size={16} />,      label: 'Settings', feature: 'settings' },
    { key: 'superadmin',    icon: <Shield size={16} />,        label: 'Super Admin', superAdminOnly: true },
  ]

  const visible = items.filter(i => {
    if (i.superAdminOnly) return agent?.isSuperAdmin
    if (i.feature) return can(i.feature, 'read')
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
            {item.key === 'tickets' && ticketUnread > 0 && (
              <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{ticketUnread}</span>
            )}
            {item.key === 'tickets' && ticketOpen > 0 && ticketUnread === 0 && (
              <span className="ml-auto bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{ticketOpen}</span>
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
  const { accessToken, authFetch, agent, logout, can, isAdmin, workspaceOverride, setWorkspaceOverride } = useAuth() as {
    accessToken: string | null
    authFetch: (url: string, opts?: RequestInit) => Promise<Response>
    agent: { id: string; name: string; email: string; tenantId: string; role: string; isSuperAdmin?: boolean } | null
    logout: () => Promise<void>
    can: (feature: string, level?: string) => boolean
    isAdmin: boolean
    workspaceOverride: { tenantId: string; name: string } | null
    setWorkspaceOverride: (w: { tenantId: string; name: string } | null) => void
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

  const [tenantList, setTenantList] = useState<SANTenant[]>([])

  useEffect(() => {
    // Super admins land on the Super Admin console by default, but when they
    // "view as" a workspace we keep them on the data sections instead.
    if (agent?.isSuperAdmin && !workspaceOverride) setSection('superadmin')
  }, [agent?.isSuperAdmin, workspaceOverride]) // eslint-disable-line

  useEffect(() => {
    if (agent?.isSuperAdmin) api.listSANTenants().then(setTenantList).catch(() => {})
  }, [agent?.isSuperAdmin]) // eslint-disable-line

  const enterWorkspace = useCallback((t: SANTenant) => {
    setWorkspaceOverride({ tenantId: t.id, name: t.company_name })
    setSection('conversations')
  }, [setWorkspaceOverride])

  const exitWorkspace = useCallback(() => {
    setWorkspaceOverride(null)
    setSection('superadmin')
  }, [setWorkspaceOverride])

  useEffect(() => {
    api.listAgents().then(setAgents).catch(() => {})
    api.listBrands().then(setBrands).catch(() => {})
  }, []) // eslint-disable-line

  useEffect(() => {
    api.listConversations()
      .then(list => { setConvs(list); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, []) // eslint-disable-line

  // Refresh + merge the conversation list — used by the 30 s auto-refresh and
  // by the socket reconnect handler to catch anything missed while offline.
  const refreshConvs = useCallback(async () => {
    try {
      const list = await api.listConversations()
      setConvs(prev => {
        const prevMap = new Map(prev.map(c => [c.id, c]))
        const merged = list.map((c: Conversation) => {
          const existing = prevMap.get(c.id)
          if (existing) return { ...c, unread: existing.unread ?? 0 }
          return { ...c, unread: 0 }
        })
        const freshIds = new Set(list.map((c: Conversation) => c.id))
        const local    = prev.filter(c => !freshIds.has(c.id))
        return [...merged, ...local].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      })
    } catch { /* non-fatal */ }
  }, []) // eslint-disable-line
  const refreshConvsRef = useRef(refreshConvs)
  refreshConvsRef.current = refreshConvs

  // Auto-refresh conversation list every 30 s — catches new tickets/conversations
  // that arrived while the agent was idle or had a socket blip.
  useEffect(() => {
    const interval = setInterval(() => { void refreshConvsRef.current() }, 30_000)
    return () => clearInterval(interval)
  }, [])

  const accessTokenRef = useRef(accessToken)
  accessTokenRef.current = accessToken

  useEffect(() => {
    if (!accessToken) return
    // Retry forever (default) — a capped attempt count made the socket give up
    // permanently when the API server restarted, silently killing all real-time
    // updates (toasts, live messages) until the next token refresh remount.
    const socket: Socket = io({ path: '/api/socket.io', auth: { agentToken: accessToken }, transports: ['websocket', 'polling'] })
    socketRef.current = socket
    // Keep auth fresh on every reconnect attempt so a retry that happens after
    // a token refresh doesn't fail with AUTH_FAILED on the stale token.
    socket.io.on('reconnect_attempt', () => {
      (socket.auth as { agentToken?: string | null }).agentToken = accessTokenRef.current
    })
    socket.on('connect', () => {
      setSocketOk(true)
      // Re-join the active conversation room after every (re)connect so
      // server:new_message keeps arriving even after a network blip.
      if (activeIdRef.current) socket.emit('join:conversation', { conversationId: activeIdRef.current })
      // Catch up on anything that arrived while the socket was down.
      void refreshConvsRef.current()
    })
    socket.on('disconnect',    () => setSocketOk(false))
    // A middleware rejection (e.g. AUTH_FAILED on an expired token) stops
    // socket.io's automatic retries (socket.active === false). Manually retry
    // with the freshest token so real-time updates always come back.
    let disposed = false
    let authRetryTimer: ReturnType<typeof setTimeout> | undefined
    socket.on('connect_error', () => {
      setSocketOk(false)
      if (!socket.active && !disposed) {
        clearTimeout(authRetryTimer)
        authRetryTimer = setTimeout(() => {
          if (disposed) return
          ;(socket.auth as { agentToken?: string | null }).agentToken = accessTokenRef.current
          socket.connect()
        }, 3000)
      }
    })
    socket.on('conversation:created', (conv: Conversation) => {
      setConvs(prev => { if (prev.some(c => c.id === conv.id)) return prev; return [{ ...conv, unread: 0, ticket_number: conv.ticket_number ?? null }, ...prev] })
      if (conv.is_ticket) {
        const toastId = `new-ticket-${conv.id}`
        const t: InboxToast = { id: toastId, convId: conv.id, visitorName: conv.visitor_name, preview: `New ticket — ${conv.subject || '(no subject)'}`, createdAt: Date.now(), kind: 'ticket' }
        setToasts(prev => [...prev.slice(-4), t])
        setTimeout(() => setToasts(prev => prev.filter(x => x.id !== toastId)), 6000)
      } else if (conv.status === 'pending') {
        const toastId = `new-pending-${conv.id}`
        const t: InboxToast = { id: toastId, convId: conv.id, visitorName: conv.visitor_name, preview: 'New conversation — awaiting agent', createdAt: Date.now(), kind: 'pending' }
        setToasts(prev => [...prev.slice(-4), t])
        setTimeout(() => setToasts(prev => prev.filter(x => x.id !== toastId)), 3000)
      }
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

      const fireToast = (convName: string, convId: string) => {
        if (activeIdRef.current === convId) return
        const toastId = `${msg.id}-vm-toast`
        const toast: InboxToast = { id: toastId, convId, visitorName: convName, preview: (msg.message_body || '').slice(0, 80), createdAt: Date.now() }
        setToasts(t => { if (t.some(x => x.id === toastId)) return t; return [...t.slice(-4), toast] })
        setTimeout(() => setToasts(t => t.filter(x => x.id !== toastId)), 6000)
        if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(`New message from ${convName}`, { body: (msg.message_body || '').slice(0, 80), icon: '/favicon.ico' })
        }
      }

      // Update the conversation's position + unread badge in the sidebar.
      // If the conversation isn't loaded yet (e.g. new inbound ticket email),
      // fetch it and surface it immediately so the Tickets tab badge updates.
      setConvs(prev => {
        const existing = prev.find(c => c.id === conversationId)
        if (!existing) {
          // Fetch and inject — runs async outside the updater to avoid side-effect issues
          api.getConversation(conversationId)
            .then((fetched: Conversation) => {
              setConvs(ps => {
                if (ps.some(c => c.id === conversationId)) return ps
                return [{ ...fetched, unread: 1 }, ...ps]
              })
              fireToast(fetched.visitor_name, conversationId)
            })
            .catch(() => {})
          return prev
        }
        return prev.map(c => {
          if (c.id !== conversationId) return c
          const isActive = activeIdRef.current === c.id
          return { ...c, updated_at: msg.created_at, unread: isActive ? (c.unread ?? 0) : (c.unread ?? 0) + 1 }
        })
      })
      // Toast for known conversations — called directly, not from inside an updater
      setConvs(prev => {
        const conv = prev.find(c => c.id === conversationId)
        if (conv) fireToast(conv.visitor_name, conversationId)
        return prev
      })
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
    return () => { disposed = true; clearTimeout(authRetryTimer); socket.disconnect(); socketRef.current = null }
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

  // On open, fetch the freshest current_url so "Current Page" is accurate even if
  // the visitor navigated while no agent was in the conversation room.
  useEffect(() => {
    if (!activeId) return
    api.getConversation(activeId)
      .then(c => {
        if (c.current_url) setVisitorPages(prev => (prev[activeId] ? prev : { ...prev, [activeId]: c.current_url! }))
        setConvs(prev => prev.map(x => x.id === activeId ? { ...x, current_url: c.current_url ?? x.current_url } : x))
      })
      .catch(() => { /* non-fatal */ })
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
    setConvs(prev => {
      if (status === 'pending') {
        const conv = prev.find(c => c.id === activeId)
        if (conv) {
          const toastId = `pending-${activeId}-${Date.now()}`
          const t: InboxToast = { id: toastId, convId: activeId, visitorName: conv.visitor_name, preview: 'Chat transferred — awaiting agent pickup', createdAt: Date.now(), kind: 'pending' }
          setToasts(ts => [...ts.slice(-4), t])
          setTimeout(() => setToasts(ts => ts.filter(x => x.id !== toastId)), 3000)
        }
      }
      return prev.map(c => c.id === activeId ? { ...c, status } : c)
    })
  }, [activeId]) // eslint-disable-line

  const handleConvertToTicket = useCallback(async (triggerCsat = false) => {
    if (!activeId) return
    const updated = await api.patchConversation(activeId, { is_ticket: true, trigger_csat: triggerCsat })
    setConvs(prev => prev.map(c => c.id === activeId ? { ...c, is_ticket: true, ticket_number: updated.ticket_number } : c))
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

  const handleDeleteConversation = useCallback(async (id: string) => {
    await api.deleteConversation(id)
    setConvs(prev => prev.filter(c => c.id !== id))
    setActiveId(prev => (prev === id ? null : prev))
  }, [api]) // eslint-disable-line

  const totalUnread     = convs.reduce((n, c) => n + (c.unread ?? 0), 0)
  const totalUnassigned = convs.filter(c => !c.assigned_agent_id && c.status !== 'closed' && !c.is_ticket).length
  const ticketUnread    = convs.filter(c => c.is_ticket).reduce((n, c) => n + (c.unread ?? 0), 0)
  const ticketOpen      = convs.filter(c => c.is_ticket && c.status !== 'closed' && c.status !== 'resolved').length
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
          <div className="absolute left-0 top-0 bottom-0 z-50"><Sidebar active={section} onNavigate={s => { setSection(s); setSidebar(false) }} unread={totalUnread} unassigned={totalUnassigned} ticketUnread={ticketUnread} ticketOpen={ticketOpen} recentActivity={recentActivity} onSelectConv={id => { handleSelectConversation(id); setSidebar(false) }} agent={agent} onLogout={logout} can={can} /></div>
        </div>
      )}
      <div className="hidden lg:flex"><Sidebar active={section} onNavigate={setSection} unread={totalUnread} unassigned={totalUnassigned} ticketUnread={ticketUnread} ticketOpen={ticketOpen} recentActivity={recentActivity} onSelectConv={handleSelectConversation} agent={agent} onLogout={logout} can={can} /></div>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 lg:hidden">
          <button onClick={() => setSidebar(true)} className="text-slate-500 hover:text-slate-800"><Menu size={20} /></button>
          <span className="text-sm font-semibold text-slate-800 capitalize">{section}</span>
          {totalUnread > 0 && <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{totalUnread}</span>}
        </div>

        {agent?.isSuperAdmin && (
          workspaceOverride ? (
            <div className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200">
              <span className="flex items-center gap-2 text-xs font-medium text-amber-800 min-w-0">
                <Eye size={13} className="shrink-0" />
                <span className="truncate">Viewing workspace: <span className="font-semibold">{workspaceOverride.name}</span></span>
              </span>
              <button onClick={exitWorkspace} className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md transition-colors shrink-0">
                <X size={12} /> Exit workspace
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 border-b border-slate-200">
              <Eye size={13} className="text-slate-500 shrink-0" />
              <span className="text-xs font-medium text-slate-600 shrink-0">View as workspace:</span>
              <select
                value=""
                onChange={e => { const t = tenantList.find(x => x.id === e.target.value); if (t) enterWorkspace(t) }}
                className="text-xs text-slate-700 bg-white border border-slate-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-sky-500/30 cursor-pointer max-w-[280px]"
              >
                <option value="">Select a workspace…</option>
                {tenantList.map(t => <option key={t.id} value={t.id}>{t.company_name}</option>)}
              </select>
            </div>
          )
        )}

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {section === 'conversations' && (
            loading ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3"><RefreshCw size={20} className="animate-spin text-slate-300" /><span className="text-xs text-slate-400">Loading conversations…</span></div>
            ) : error ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8"><AlertTriangle size={28} className="text-amber-400" /><p className="text-sm font-medium text-slate-700">Could not load conversations</p><p className="text-xs text-slate-400">{error}</p><button onClick={() => window.location.reload()} className="text-xs text-sky-600 underline">Retry</button></div>
            ) : (
              <>
                <ConversationsList convs={convs} activeId={activeId} onSelect={handleSelectConversation} brands={brands} agents={agents} />
                {activeConv ? <ChatPanel conv={activeConv} messages={messages[activeId!] ?? []} onSend={handleSend} onStatusChange={handleStatusChange} onConvertToTicket={handleConvertToTicket} onAssign={handleAssign} onEditMessage={handleEditMessage} onDeleteMessage={handleDeleteMessage} onPriorityChange={handlePriorityChange} onDelete={isAdmin ? handleDeleteConversation : undefined} agents={agents} currentPage={visitorPages[activeId ?? ''] ?? activeConv.current_url ?? null} socketConnected={socketOk} typingWho={typingInfo[activeId ?? ''] ?? null} visitorOnline={visitorOnline[activeId ?? ''] ?? false} visitorReadAt={visitorReadAt[activeId ?? ''] ?? null} onSelectConversation={handleSelectConversation} /> : <EmptyChat />}
              </>
            )
          )}
          {section === 'tickets' && (
            <TicketsSection tickets={convs.filter(c => c.is_ticket)} activeId={activeId} agents={agents} brands={brands} messages={messages} visitorPages={visitorPages} typingInfo={typingInfo} onSelect={handleSelectTicket} onSend={handleSend} onStatusChange={handleStatusChange} onConvertToTicket={handleConvertToTicket} onAssign={handleAssign} onEditMessage={handleEditMessage} onDeleteMessage={handleDeleteMessage} onPriorityChange={handlePriorityChange} onDelete={isAdmin ? handleDeleteConversation : undefined} socketConnected={socketOk} />
          )}
          {section === 'contacts'         && <ContactsSection brands={brands} socketRef={socketRef} />}
          {section === 'canned_responses' && <CannedResponsesSection />}
          {section === 'csat'             && <CsatSection brands={brands} />}
          {section === 'ai_training' && <AITrainingSection />}
          {section === 'smtp'        && <SMTPSection />}
          {section === 'brands'      && <BrandsSection />}
          {section === 'billing'     && <BillingSection />}
          {section === 'settings'    && <SettingsSection />}
          {section === 'team'        && <TeamSection />}
          {section === 'superadmin'  && <SuperAdminSection />}
        </div>
      </div>

      {/* Trial / lock gateway overlay — renders above everything else */}
      <TrialGateway
        authFetch={authFetch}
        agent={agent}
        onNavigate={setSection}
        onCheckout={async (plan: string) => {
          try {
            const r = await authFetch(`${API}/billing/checkout`, {
              method: 'POST',
              body: JSON.stringify({ plan }),
            })
            if (!r.ok) { setSection('billing'); return }
            const result = await r.json() as { url?: string; transactionId?: string; provider?: string }
            const paddle = await ensurePaddle(null)
            if (result.transactionId && paddle && result.provider === 'paddle') {
              paddle.Checkout.open({
                transactionId: result.transactionId,
                settings: {
                  successUrl: `${window.location.origin}/dashboard/`,
                  displayMode: 'overlay',
                  theme: 'light',
                },
              })
            } else if (result.url) {
              window.location.href = result.url
            } else {
              setSection('billing')
            }
          } catch {
            setSection('billing')
          }
        }}
      />

      {/* Floating WhatsApp button */}
      <a
        href="https://wa.me/923294816780"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with us on WhatsApp"
        className="fixed bottom-6 left-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-110"
        style={{ backgroundColor: '#25D366', boxShadow: '0 4px 20px rgba(37,211,102,0.4)' }}
      >
        <svg viewBox="0 0 24 24" width="28" height="28" fill="#fff" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
        </svg>
      </a>
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { isAuthenticated, isLoading, workspaceOverride } = useAuth() as { isAuthenticated: boolean; isLoading: boolean; workspaceOverride: { tenantId: string } | null }
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

  if (isAuthenticated) return <Dashboard key={workspaceOverride?.tenantId ?? 'self'} />

  if (view === 'signup') return <SignupPage onGoLogin={goLogin} />
  if (view === 'forgot') return <ForgotPasswordPage onGoLogin={goLogin} />
  if (view === 'reset')  return <ResetPasswordPage token={resetToken} onGoLogin={goLogin} />
  return <LoginPage onGoSignup={goSignup} onGoForgot={goForgot} successMsg={successMsg} />
}
