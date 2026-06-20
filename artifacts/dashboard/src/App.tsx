import { useState, useEffect, useRef, useCallback } from 'react'
import {
  MessageSquare, Building2, CreditCard, Settings,
  Search, Send, FileDown, Menu, X, Bot, User,
  Inbox, Sparkles, LogOut, Bell, RefreshCw,
  AlertTriangle, CheckCircle2, Clock, Circle,
  ChevronRight, Hash, Mail, Globe, Zap, MoreHorizontal,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
type Status = 'open' | 'closed' | 'pending' | 'ai_handling'
type Channel = 'email' | 'widget' | 'api'
type Priority = 'low' | 'medium' | 'high'
type Sender = 'agent' | 'visitor' | 'bot'
type Section = 'conversations' | 'brands' | 'billing' | 'settings'
type StatusFilter = 'all' | Status

interface Conversation {
  id: string
  subject: string
  status: Status
  channel: Channel
  priority: Priority
  visitor_name: string
  visitor_email: string
  agent_name?: string
  brand_name: string
  updated_at: string
  sla_breach_at?: string
  unread?: number
  last_snippet?: string
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

// ─── Mock Data ────────────────────────────────────────────────────────────────
const T = Date.now()
const ago = (ms: number) => new Date(T - ms).toISOString()
const fwd = (ms: number) => new Date(T + ms).toISOString()
const MIN = 60_000
const HR = 3_600_000

const MOCK_CONVS: Conversation[] = [
  { id: 'c1', subject: 'Payment declined — card type Visa 4242', status: 'open', channel: 'widget', priority: 'high', visitor_name: 'Alice Chen', visitor_email: 'alice@acme.com', agent_name: 'You', brand_name: 'Acme Help Center', updated_at: ago(4 * MIN), sla_breach_at: fwd(45 * MIN), unread: 2, last_snippet: 'The popup closed before I could enter the code.' },
  { id: 'c2', subject: 'Refund request — order #8821', status: 'pending', channel: 'email', priority: 'medium', visitor_name: 'Bob Martinez', visitor_email: 'bob@example.com', brand_name: 'Acme Help Center', updated_at: ago(32 * MIN), sla_breach_at: fwd(3 * HR), last_snippet: 'Could you send a photo of the item received?' },
  { id: 'c3', subject: 'Onboarding walkthrough request', status: 'ai_handling', channel: 'widget', priority: 'low', visitor_name: 'Priya Sharma', visitor_email: 'priya@startup.io', brand_name: 'Acme Help Center', updated_at: ago(8 * MIN), last_snippet: 'Of course! To install the widget, navigate to…' },
  { id: 'c4', subject: 'API rate limit exceeded on free plan', status: 'open', channel: 'api', priority: 'high', visitor_name: 'Derek Osei', visitor_email: 'derek@devco.com', agent_name: 'Sara K.', brand_name: 'DevCo Support', updated_at: ago(2 * HR), sla_breach_at: ago(10 * MIN), unread: 1, last_snippet: 'Error 429 on every request since 14:00 UTC.' },
  { id: 'c5', subject: 'Feature request: bulk conversation export', status: 'closed', channel: 'email', priority: 'low', visitor_name: 'Emma Johansson', visitor_email: 'emma@bigco.eu', agent_name: 'You', brand_name: 'DevCo Support', updated_at: ago(2 * 86_400_000), last_snippet: 'Perfect, thank you!' },
  { id: 'c6', subject: 'SSO login broken post-update (200 users affected)', status: 'open', channel: 'widget', priority: 'high', visitor_name: 'Wei Zhang', visitor_email: 'wei@enterprise.com', brand_name: 'Acme Help Center', updated_at: ago(18 * MIN), sla_breach_at: fwd(90 * MIN), unread: 3, last_snippet: 'SAML assertion signature mismatch. Please escalate.' },
]

const MOCK_MSGS: Record<string, Message[]> = {
  c1: [
    { id: 'm1', conversation_id: 'c1', sender_type: 'visitor', sender_name: 'Alice Chen', message_body: "Hi, I've been trying to process a payment for the past 30 minutes but keep getting a \"card declined\" error. My bank says the card is fine.", is_internal_note: false, created_at: ago(25 * MIN) },
    { id: 'm2', conversation_id: 'c1', sender_type: 'bot', sender_name: 'OmniCore AI', message_body: "I'm sorry to hear that. Let me connect you with a support agent who can investigate right away.", is_internal_note: false, created_at: ago(24 * MIN) },
    { id: 'm3', conversation_id: 'c1', sender_type: 'agent', sender_name: 'You', message_body: "Hello Alice! Looking into this now. Which card type are you using — Visa, Mastercard, or Amex?", is_internal_note: false, created_at: ago(20 * MIN) },
    { id: 'm4', conversation_id: 'c1', sender_type: 'visitor', sender_name: 'Alice Chen', message_body: "It's a Visa credit card ending in 4242. I've tried three times already.", is_internal_note: false, created_at: ago(18 * MIN) },
    { id: 'm5', conversation_id: 'c1', sender_type: 'agent', sender_name: 'You', message_body: "Thanks. Our payment logs show a 3D Secure step that may be timing out. Did your bank send you an OTP or push notification?", is_internal_note: false, created_at: ago(15 * MIN) },
    { id: 'm6', conversation_id: 'c1', sender_type: 'visitor', sender_name: 'Alice Chen', message_body: "Oh! I did get a text — but the popup closed before I could enter it.", is_internal_note: false, created_at: ago(4 * MIN) },
  ],
  c2: [
    { id: 'm1', conversation_id: 'c2', sender_type: 'visitor', sender_name: 'Bob Martinez', message_body: "I placed order #8821 on Tuesday but received the wrong item. I'd like a full refund.", is_internal_note: false, created_at: ago(2 * HR) },
    { id: 'm2', conversation_id: 'c2', sender_type: 'agent', sender_name: 'Sara K.', message_body: "Hi Bob, I'm sorry about the mix-up. I've found order #8821. Could you send a photo of the item you received?", is_internal_note: false, created_at: ago(1.5 * HR) },
    { id: 'm3', conversation_id: 'c2', sender_type: 'agent', sender_name: 'Sara K.', message_body: "⚠ Internal: This order shipped from warehouse B, which had a labelling issue last week. Likely related.", is_internal_note: true, created_at: ago(1.4 * HR) },
  ],
  c3: [
    { id: 'm1', conversation_id: 'c3', sender_type: 'visitor', sender_name: 'Priya Sharma', message_body: "Hey! I just signed up and not sure where to start. Can someone walk me through the setup?", is_internal_note: false, created_at: ago(20 * MIN) },
    { id: 'm2', conversation_id: 'c3', sender_type: 'bot', sender_name: 'OmniCore AI', message_body: "Welcome Priya! Here's a quick start guide:\n\n1. Connect your channels (email, widget, API)\n2. Invite your team under Settings → Team\n3. Upload knowledge base articles so I can auto-answer FAQs\n\nWhich would you like help with first?", is_internal_note: false, created_at: ago(19 * MIN) },
    { id: 'm3', conversation_id: 'c3', sender_type: 'visitor', sender_name: 'Priya Sharma', message_body: "Great! Can you help me set up the chat widget?", is_internal_note: false, created_at: ago(9 * MIN) },
    { id: 'm4', conversation_id: 'c3', sender_type: 'bot', sender_name: 'OmniCore AI', message_body: "Of course! Go to Brand Settings → Widget, copy the script tag, and paste it before `</body>` on your site. It'll appear within 30 seconds!", is_internal_note: false, created_at: ago(8 * MIN) },
  ],
  c4: [
    { id: 'm1', conversation_id: 'c4', sender_type: 'visitor', sender_name: 'Derek Osei', message_body: "Getting 429 errors on every API call since 14:00 UTC. We're on the free plan — did the rate limits change?", is_internal_note: false, created_at: ago(2 * HR) },
  ],
  c5: [
    { id: 'm1', conversation_id: 'c5', sender_type: 'visitor', sender_name: 'Emma Johansson', message_body: "Would love a bulk export feature — currently we export reports one by one.", is_internal_note: false, created_at: ago(3 * 86_400_000) },
    { id: 'm2', conversation_id: 'c5', sender_type: 'agent', sender_name: 'You', message_body: "Thanks Emma! I've logged this as a feature request. We'll notify you once it's on the roadmap.", is_internal_note: false, created_at: ago(2 * 86_400_000) },
    { id: 'm3', conversation_id: 'c5', sender_type: 'visitor', sender_name: 'Emma Johansson', message_body: "Perfect, thank you!", is_internal_note: false, created_at: ago(2 * 86_400_000 - 10 * MIN) },
  ],
  c6: [
    { id: 'm1', conversation_id: 'c6', sender_type: 'visitor', sender_name: 'Wei Zhang', message_body: "After yesterday's update, SSO login is completely broken. All 200 users in our org are affected.", is_internal_note: false, created_at: ago(45 * MIN) },
    { id: 'm2', conversation_id: 'c6', sender_type: 'visitor', sender_name: 'Wei Zhang', message_body: "Error: \"SAML assertion signature mismatch\". We haven't touched our IdP config.", is_internal_note: false, created_at: ago(44 * MIN) },
    { id: 'm3', conversation_id: 'c6', sender_type: 'visitor', sender_name: 'Wei Zhang', message_body: "This is P0 — 200 users locked out. Please escalate immediately.", is_internal_note: false, created_at: ago(18 * MIN) },
  ],
}

// ─── Mock API ─────────────────────────────────────────────────────────────────
const mockApi = {
  listConversations: async (): Promise<Conversation[]> => {
    await new Promise(r => setTimeout(r, 280))
    return [...MOCK_CONVS]
  },
  getMessages: async (id: string): Promise<Message[]> => {
    await new Promise(r => setTimeout(r, 180))
    return [...(MOCK_MSGS[id] ?? [])]
  },
  sendMessage: async (id: string, body: string): Promise<Message> => {
    await new Promise(r => setTimeout(r, 140))
    const msg: Message = { id: `m${Date.now()}`, conversation_id: id, sender_type: 'agent', sender_name: 'You', message_body: body, is_internal_note: false, created_at: new Date().toISOString() }
    MOCK_MSGS[id] = [...(MOCK_MSGS[id] ?? []), msg]
    return msg
  },
  exportPdf: async (id: string): Promise<string> => {
    await new Promise(r => setTimeout(r, 900))
    return `https://r2.atelieromnicore.com/exports/${id}-${Date.now()}.pdf`
  },
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < MIN) return 'just now'
  if (diff < HR) return `${Math.floor(diff / MIN)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / HR)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function slaColor(breachAt?: string): string {
  if (!breachAt) return ''
  const diff = new Date(breachAt).getTime() - Date.now()
  if (diff < 0) return 'text-red-500'
  if (diff < HR) return 'text-amber-500'
  return 'text-slate-400'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string; icon: React.ReactNode }> = {
    open:        { label: 'Open',       cls: 'bg-sky-100 text-sky-700 border border-sky-200',          icon: <Circle size={6} className="fill-sky-500 text-sky-500" /> },
    pending:     { label: 'Pending',    cls: 'bg-amber-50 text-amber-700 border border-amber-200',     icon: <Clock size={10} /> },
    ai_handling: { label: 'AI',         cls: 'bg-violet-100 text-violet-700 border border-violet-200', icon: <Sparkles size={10} /> },
    closed:      { label: 'Closed',     cls: 'bg-slate-100 text-slate-500 border border-slate-200',    icon: <CheckCircle2 size={10} /> },
  }
  const { label, cls, icon } = map[status]
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${cls}`}>
      {icon}{label}
    </span>
  )
}

function PriorityDot({ priority }: { priority: Priority }) {
  const colors: Record<Priority, string> = { high: 'bg-red-400', medium: 'bg-amber-400', low: 'bg-slate-300' }
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${colors[priority]}`} />
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
      className={`w-full text-left px-4 py-3 border-b border-slate-100 transition-colors group ${isActive ? 'bg-slate-50 border-l-2 border-l-sky-500' : 'hover:bg-slate-50/70 border-l-2 border-l-transparent'}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <PriorityDot priority={conv.priority} />
          <span className={`text-sm font-medium truncate ${isActive ? 'text-slate-900' : 'text-slate-700'}`}>
            {conv.visitor_name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {conv.unread ? (
            <span className="bg-sky-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
              {conv.unread}
            </span>
          ) : null}
          <span className="text-[11px] text-slate-400">{timeAgo(conv.updated_at)}</span>
        </div>
      </div>

      <p className={`text-xs mb-1.5 truncate ${isActive ? 'text-slate-700 font-medium' : 'text-slate-600'}`}>
        {conv.subject}
      </p>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusBadge status={conv.status} />
          <ChannelIcon channel={conv.channel} />
          {conv.sla_breach_at && (
            <span className={`text-[10px] flex items-center gap-0.5 ${slaColor(conv.sla_breach_at)}`}>
              {breached && <AlertTriangle size={9} />}
              {breached ? 'SLA breached' : `SLA ${timeAgo(conv.sla_breach_at).replace(' ago', '')}`}
            </span>
          )}
        </div>
        {conv.agent_name && (
          <span className="text-[10px] text-slate-400 truncate shrink-0">{conv.agent_name}</span>
        )}
      </div>
    </button>
  )
}

// ─── Conversations List ───────────────────────────────────────────────────────
const FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'Pending', value: 'pending' },
  { label: 'AI', value: 'ai_handling' },
  { label: 'Closed', value: 'closed' },
]

function ConversationsList({ convs, activeId, onSelect }: { convs: Conversation[]; activeId: string | null; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')

  const filtered = convs.filter(c => {
    const matchStatus = filter === 'all' || c.status === filter
    const q = query.toLowerCase()
    const matchQuery = !q || c.visitor_name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q) || c.visitor_email.toLowerCase().includes(q)
    return matchStatus && matchQuery
  })

  const counts: Record<StatusFilter, number> = {
    all: convs.length,
    open: convs.filter(c => c.status === 'open').length,
    pending: convs.filter(c => c.status === 'pending').length,
    ai_handling: convs.filter(c => c.status === 'ai_handling').length,
    closed: convs.filter(c => c.status === 'closed').length,
  }

  return (
    <div className="flex flex-col h-full w-80 border-r border-slate-200 bg-white shrink-0">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-800">Conversations</h2>
          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{convs.length}</span>
        </div>
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search conversations…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 transition-all"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-0.5 px-3 py-2 bg-slate-50/80 border-b border-slate-100 overflow-x-auto">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${filter === f.value ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {f.label}
            <span className={`text-[10px] ${filter === f.value ? 'text-sky-600' : 'text-slate-400'}`}>
              {counts[f.value]}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <Inbox size={28} className="text-slate-300 mb-2" />
            <p className="text-sm text-slate-400">No conversations match</p>
          </div>
        ) : (
          filtered.map(c => (
            <ConversationRow key={c.id} conv={c} isActive={c.id === activeId} onClick={() => onSelect(c.id)} />
          ))
        )}
      </div>
    </div>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
  const isAgent   = msg.sender_type === 'agent'
  const isBot     = msg.sender_type === 'bot'
  const isVisitor = msg.sender_type === 'visitor'
  const isNote    = msg.is_internal_note

  if (isNote) {
    return (
      <div className="flex justify-center my-1">
        <div className="max-w-lg bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold mr-1">🔒 Internal note · {msg.sender_name}</span>
          <span>{msg.message_body}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex items-end gap-2 ${isAgent ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isAgent ? 'bg-sky-600 text-white' : isBot ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
        {isAgent ? <User size={13} /> : isBot ? <Bot size={13} /> : <span className="text-xs font-semibold">{msg.sender_name[0]}</span>}
      </div>

      {/* Bubble */}
      <div className={`group max-w-sm lg:max-w-md xl:max-w-lg`}>
        <div className={`text-[10px] mb-1 text-slate-400 ${isAgent ? 'text-right' : 'text-left'}`}>
          {msg.sender_name} · {timeAgo(msg.created_at)}
        </div>
        <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
          isAgent
            ? 'bg-sky-600 text-white rounded-br-sm'
            : isBot
            ? 'bg-violet-100 text-violet-900 border border-violet-200 rounded-bl-sm'
            : 'bg-white text-slate-800 border border-slate-200 shadow-sm rounded-bl-sm'
        }`}>
          {msg.message_body}
        </div>
      </div>
    </div>
  )
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────
function ChatPanel({ conv, messages, onSend }: { conv: Conversation; messages: Message[]; onSend: (body: string) => Promise<void> }) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportToast, setExportToast] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const body = draft.trim()
    if (!body || sending) return
    setDraft('')
    setSending(true)
    try { await onSend(body) } finally { setSending(false) }
    textareaRef.current?.focus()
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const url = await mockApi.exportPdf(conv.id)
      setExportToast(url)
      setTimeout(() => setExportToast(null), 4000)
    } finally { setExporting(false) }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full bg-slate-50">
      {/* Chat header */}
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-slate-900 truncate">{conv.subject}</h3>
            <StatusBadge status={conv.status} />
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span>{conv.visitor_name}</span>
            <span>·</span>
            <span>{conv.visitor_email}</span>
            <span>·</span>
            <span className="capitalize">{conv.channel}</span>
            {conv.sla_breach_at && (
              <>
                <span>·</span>
                <span className={`flex items-center gap-0.5 ${slaColor(conv.sla_breach_at)}`}>
                  <Clock size={10} />
                  SLA {new Date(conv.sla_breach_at).getTime() < Date.now() ? 'breached' : timeAgo(conv.sla_breach_at)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 transition-all"
          >
            {exporting ? <RefreshCw size={12} className="animate-spin" /> : <FileDown size={12} />}
            Export PDF
          </button>
          <button className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors">
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* Export toast */}
      {exportToast && (
        <div className="mx-4 mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
          <span>PDF exported. <a href={exportToast} target="_blank" rel="noopener noreferrer" className="underline font-medium">Download</a></span>
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
        ) : (
          messages.map(m => <MessageBubble key={m.id} msg={m} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Compose */}
      <div className="px-4 py-3 bg-white border-t border-slate-200 shrink-0">
        <div className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-500/20 transition-all">
          <textarea
            ref={textareaRef}
            rows={2}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Reply to customer… (Enter to send, Shift+Enter for newline)"
            className="flex-1 bg-transparent text-sm text-slate-700 placeholder-slate-400 resize-none focus:outline-none leading-relaxed"
          />
          <div className="flex items-center gap-1.5 shrink-0 pb-0.5">
            <button
              className="p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
              title="AI Rephrase"
            >
              <Sparkles size={14} />
            </button>
            <button
              onClick={handleSend}
              disabled={!draft.trim() || sending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-lg hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {sending ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
              Send
            </button>
          </div>
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5 px-1">
          Agent: You · {conv.brand_name}
        </p>
      </div>
    </div>
  )
}

// ─── Empty chat state ─────────────────────────────────────────────────────────
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
            <p className="text-xs text-slate-500 mt-0.5">Manage your branded help centers and widget configurations</p>
          </div>
          <button className="px-3 py-1.5 bg-sky-600 text-white text-xs font-medium rounded-md hover:bg-sky-700 transition-colors">
            + Add Brand
          </button>
        </div>
        <div className="space-y-3">
          {brands.map(b => (
            <div key={b.name} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 bg-gradient-to-br from-sky-400 to-sky-600 rounded-lg flex items-center justify-center text-white text-xs font-bold">
                      {b.name[0]}
                    </div>
                    <span className="text-sm font-semibold text-slate-800">{b.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 ml-10">
                    <span className="flex items-center gap-1"><Globe size={10} /> {b.domain}</span>
                    <span className="flex items-center gap-1"><Mail size={10} /> {b.email}</span>
                    <span className="flex items-center gap-1"><MessageSquare size={10} /> {b.convs} conversations</span>
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
        <p className="text-xs text-slate-500 mb-6">Manage your subscription and usage</p>

        {/* Current plan */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-slate-900">Growth Plan</span>
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold px-2 py-0.5 rounded">Active</span>
              </div>
              <p className="text-xs text-slate-500">Billed monthly · Next invoice Jun 1, 2026</p>
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

        {/* Recent invoices */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-xs font-semibold text-slate-700 mb-3">Recent Invoices</h3>
          <div className="space-y-2">
            {[{ date: 'May 1, 2026', amount: '$99.00', status: 'Paid' }, { date: 'Apr 1, 2026', amount: '$99.00', status: 'Paid' }, { date: 'Mar 1, 2026', amount: '$79.00', status: 'Paid' }].map(inv => (
              <div key={inv.date} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <div>
                  <span className="text-xs text-slate-700 font-medium">{inv.date}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">{inv.amount}</span>
                  <span className="bg-emerald-50 text-emerald-700 text-[10px] font-semibold px-2 py-0.5 rounded">{inv.status}</span>
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
        <div className="space-y-4">
          {[
            { label: 'Team Members', desc: '4 active agents', icon: <User size={14} /> },
            { label: 'Notifications', desc: 'Email + in-app alerts enabled', icon: <Bell size={14} /> },
            { label: 'API & Webhooks', desc: '2 webhooks configured', icon: <Zap size={14} /> },
            { label: 'Security & SSO', desc: 'Password auth · 2FA off', icon: <Settings size={14} /> },
          ].map(item => (
            <button key={item.label} className="w-full flex items-center justify-between bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors text-left">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-600">
                  {item.icon}
                </div>
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

function Sidebar({ active, onNavigate, unread }: { active: Section; onNavigate: (s: Section) => void; unread: number }) {
  return (
    <nav className="flex flex-col w-56 bg-slate-900 h-full shrink-0">
      {/* Logo */}
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

      {/* Nav */}
      <div className="flex-1 px-2 py-3 space-y-0.5">
        {NAV.map(n => {
          const isActive = n.section === active
          return (
            <button
              key={n.section}
              onClick={() => onNavigate(n.section)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive ? 'bg-sky-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'}`}
            >
              {n.icon}
              <span>{n.label}</span>
              {n.section === 'conversations' && unread > 0 && (
                <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                  {unread}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-slate-800">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors group">
          <div className="w-7 h-7 bg-sky-600 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">
            A
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-200 truncate">Admin Agent</p>
            <p className="text-[10px] text-slate-500 truncate">admin@tenant.com</p>
          </div>
          <LogOut size={13} className="text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
        </div>
      </div>
    </nav>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [section, setSection]       = useState<Section>('conversations')
  const [convs, setConvs]           = useState<Conversation[]>([])
  const [activeId, setActiveId]     = useState<string | null>(null)
  const [messages, setMessages]     = useState<Record<string, Message[]>>({})
  const [loading, setLoading]       = useState(true)
  const [sidebarOpen, setSidebar]   = useState(false)

  // Load conversations
  useEffect(() => {
    mockApi.listConversations().then(c => {
      setConvs(c)
      setLoading(false)
    })
  }, [])

  // Load messages when conversation changes
  useEffect(() => {
    if (!activeId) return
    if (messages[activeId]) return   // already loaded
    mockApi.getMessages(activeId).then(msgs => {
      setMessages(prev => ({ ...prev, [activeId]: msgs }))
      // Clear unread
      setConvs(prev => prev.map(c => c.id === activeId ? { ...c, unread: 0 } : c))
    })
  }, [activeId])

  const handleSend = useCallback(async (body: string) => {
    if (!activeId) return
    const msg = await mockApi.sendMessage(activeId, body)
    setMessages(prev => ({ ...prev, [activeId]: [...(prev[activeId] ?? []), msg] }))
  }, [activeId])

  const totalUnread = convs.reduce((n, c) => n + (c.unread ?? 0), 0)
  const activeConv  = convs.find(c => c.id === activeId)

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebar(false)} />
          <div className="absolute left-0 top-0 bottom-0 z-50">
            <Sidebar active={section} onNavigate={s => { setSection(s); setSidebar(false) }} unread={totalUnread} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="hidden lg:flex">
        <Sidebar active={section} onNavigate={setSection} unread={totalUnread} />
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 lg:hidden">
          <button onClick={() => setSidebar(true)} className="text-slate-500 hover:text-slate-800">
            <Menu size={20} />
          </button>
          <span className="text-sm font-semibold text-slate-800 capitalize">{section}</span>
          {totalUnread > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{totalUnread}</span>
          )}
        </div>

        {/* Section content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {section === 'conversations' && (
            loading ? (
              <div className="flex-1 flex items-center justify-center">
                <RefreshCw size={20} className="animate-spin text-slate-300" />
              </div>
            ) : (
              <>
                <ConversationsList convs={convs} activeId={activeId} onSelect={setActiveId} />
                {activeConv
                  ? <ChatPanel conv={activeConv} messages={messages[activeId!] ?? []} onSend={handleSend} />
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
