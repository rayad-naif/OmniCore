export type Status =
  | 'open'
  | 'closed'
  | 'pending'
  | 'ai_handling'
  | 'submitted'
  | 'in_progress'
  | 'waiting_on_customer'
  | 'resolved';
export type TicketStatus =
  | 'submitted'
  | 'in_progress'
  | 'waiting_on_customer'
  | 'resolved'
  | 'closed';
export type Channel = 'email' | 'widget' | 'api' | 'whatsapp';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type Sender = 'agent' | 'visitor' | 'bot' | 'system';
export type Section =
  | 'conversations'
  | 'tickets'
  | 'brands'
  | 'billing'
  | 'settings'
  | 'team'
  | 'superadmin'
  | 'csat'
  | 'ai_training'
  | 'smtp'
  | 'contacts'
  | 'canned_responses';
export type StatusFilter = 'all' | Status;
export type AuthView = 'login' | 'signup' | 'forgot' | 'reset';

export interface Conversation {
  id: string;
  subject: string | null;
  status: Status;
  channel: Channel;
  priority: Priority;
  visitor_name: string;
  visitor_email: string | null;
  agent_name?: string | null;
  brand_name: string;
  updated_at: string;
  sla_breach_at?: string | null;
  unread?: number;
  is_ticket?: boolean;
  assigned_agent_id?: string | null;
  ticket_number?: number | null;
  visitor_id?: string;
  visitor_timezone?: string | null;
  csat_score?: number | null;
  brand_id?: string;
  referrer_url?: string | null;
  current_url?: string | null;
}

export interface Attachment {
  url: string;
  name: string;
  type?: string;
}
export interface Message {
  id: string;
  conversation_id: string;
  sender_type: Sender;
  sender_name: string;
  message_body: string;
  is_internal_note: boolean;
  created_at: string;
  attachments_json?: string | Attachment[] | null;
}
export interface Brand {
  id: string;
  brand_name: string;
  widget_config_json?: {
    website_url?: string;
    support_email?: string;
    color?: string;
  } | null;
  allowed_domains_array?: string[];
  inbound_email_prefix?: string | null;
  created_at?: string;
}
export interface AgentRow {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
  permissions?: Record<string, string>;
}
export interface SuperAdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
  tenant_id: string | null;
  company_name: string | null;
  is_super_admin: boolean;
}
export interface SANTenant {
  id: string;
  company_name: string;
  account_status: string;
  subscription_status: string;
  plan: string;
  created_at: string;
  agent_count: number;
  max_brands_allowed: number;
  max_agents_allowed: number;
  ai_feature_enabled: boolean;
  smtp_feature_enabled: boolean;
  conversation_limit: number;
  trial_ends_at: string | null;
  grace_period_ends_at: string | null;
  lock_notified_at: string | null;
  paddle_customer_id: string | null;
  paddle_subscription_id: string | null;
}
export interface UpgradeRequest {
  id: string;
  tenant_id: string;
  company_name: string;
  agent_name: string;
  agent_email: string;
  requested_plan: string;
  company_size: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}
export interface KnowledgeArticle {
  id: string;
  title: string;
  content: string;
  tags: string[];
  brand_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export interface SuperAdminEntry {
  id: string;
  email: string;
  added_by: string;
  is_active: boolean;
  created_at: string;
}
export interface PlanFeatures {
  ai_feature_enabled: boolean;
  smtp_feature_enabled: boolean;
}
export interface PlanLimits {
  max_brands_allowed: number | null;
  max_agents_allowed: number | null;
  conversation_limit: number | null;
}
export interface BillingPlan {
  plan: string;
  name: string;
  description: string | null;
  priceId: string;
  amount: number;
  currency: string;
  interval: string;
  features?: PlanFeatures;
  limits?: PlanLimits;
}
export interface BillingAdminPlan {
  id: string;
  slug: string;
  plan: string;
  name: string;
  description: string;
  amount: number;
  currency: string;
  interval: string;
  is_free: boolean;
  self_serve: boolean;
  active: boolean;
  sort_order: number;
  trial_days: number;
  paddle_product_id: string | null;
  paddle_price_id: string | null;
  paddle_synced: boolean;
  features: PlanFeatures;
  limits: PlanLimits;
}
export interface SubscriptionInfo {
  customerId: string | null;
  subscriptionId: string | null;
  plan: string;
  status: string;
  gracePeriodEndsAt: string | null;
  currentPeriodEnd: string | null;
}
export interface BillingStatus {
  provider: string;
  connected: boolean;
  environment: string;
  error: string | null;
  subscriptions: number;
  planCount: number;
}
export interface PlatformSmtpInput {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from_email: string;
  enabled: boolean;
  pass: string;
}
export interface PlatformSmtpConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  from_email?: string;
  enabled?: boolean;
  pass_set?: boolean;
}
export interface AIBrandSetting {
  id: string;
  brand_name: string;
  ai_system_prompt: string | null;
  bot_max_messages: string | number;
  auto_assign_strategy: string;
  auto_close_enabled: boolean;
  auto_close_idle_minutes: string | number;
}
export interface CsatAgent {
  agent_id: string;
  agent_name: string;
  agent_email: string;
  total_assigned: number;
  closed_count: number;
  avg_csat_score: number | null;
  positive_ratings: number;
  five_star: number;
  four_star: number;
  three_star: number;
  two_star: number;
  one_star: number;
  rated_count: number;
  avg_first_response_minutes: number | null;
  closed_today: number;
  participated_today: number;
}
export interface Contact {
  id: string;
  display_name: string;
  email: string | null;
  brand_name: string;
  brand_id: string;
  location_city: string | null;
  last_seen_at: string;
  created_at: string;
  conversation_count: number;
}
export interface ContactConversation {
  id: string;
  status: string;
  channel: string;
  subject: string | null;
  priority: string;
  created_at: string;
  updated_at: string;
  csat_score: number | null;
  brand_name: string;
  agent_name: string | null;
  referrer_url?: string | null;
}
export interface CannedResponse {
  id: string;
  name: string;
  body: string;
  shortcut: string | null;
  created_at: string;
}
