import type { Message } from './dashboardTypes';

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const MIN = 60_000,
    HR = 3_600_000;
  if (diff < MIN) return 'just now';
  if (diff < HR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / HR)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function slaColor(breachAt?: string | null, now = Date.now()): string {
  if (!breachAt) return '';
  const diff = new Date(breachAt).getTime() - now;
  if (diff < 0) return 'text-red-500';
  if (diff < 3_600_000) return 'text-amber-500';
  return 'text-slate-400';
}

export function safeHref(raw: string): string | null {
  try {
    const { protocol } = new URL(raw);
    return protocol === 'http:' || protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

export type MsgGroup =
  | { type: 'single'; msg: Message; idx: number }
  | { type: 'journey'; msgs: Message[] };

export function buildMessageGroups(messages: Message[]): MsgGroup[] {
  const groups: MsgGroup[] = [];
  let i = 0;
  while (i < messages.length) {
    const message = messages[i];
    if (
      message.sender_type === 'system' &&
      message.message_body.startsWith('Visited:')
    ) {
      const group: Message[] = [message];
      let j = i + 1;
      while (
        j < messages.length &&
        messages[j].sender_type === 'system' &&
        messages[j].message_body.startsWith('Visited:')
      ) {
        group.push(messages[j]);
        j++;
      }
      groups.push(
        group.length >= 2
          ? { type: 'journey', msgs: group }
          : { type: 'single', msg: message, idx: i },
      );
      i = j;
    } else {
      groups.push({ type: 'single', msg: message, idx: i });
      i++;
    }
  }
  return groups;
}

export function fmtMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
    minimumFractionDigits: 0,
  }).format(amount / 100);
}

export const FEATURE_META: { key: string; label: string; desc: string }[] = [
  { key: 'inbox', label: 'Inbox', desc: 'Conversations & live chat' },
  { key: 'contacts', label: 'Contacts', desc: 'Visitor / contact directory' },
  {
    key: 'knowledge_base',
    label: 'Knowledge Base',
    desc: 'KB articles & AI training',
  },
  { key: 'brands', label: 'Brands', desc: 'Brand & widget configuration' },
  { key: 'analytics', label: 'Analytics', desc: 'CSAT & reporting' },
  { key: 'billing', label: 'Billing', desc: 'Plans & subscription' },
  { key: 'team', label: 'Team', desc: 'Agent management' },
  { key: 'settings', label: 'Settings', desc: 'Workspace settings & SMTP' },
];
export const PERMISSION_LEVELS = ['none', 'read', 'edit'] as const;

export function defaultPermsForRole(role: string): Record<string, string> {
  if (role === 'admin')
    return Object.fromEntries(FEATURE_META.map((f) => [f.key, 'edit']));
  if (role === 'supervisor')
    return {
      inbox: 'edit',
      contacts: 'edit',
      knowledge_base: 'edit',
      brands: 'read',
      analytics: 'read',
      billing: 'read',
      team: 'read',
      settings: 'read',
    };
  return {
    inbox: 'edit',
    contacts: 'read',
    knowledge_base: 'read',
    brands: 'none',
    analytics: 'none',
    billing: 'none',
    team: 'none',
    settings: 'none',
  };
}

export function extractEmailDomain(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  return at !== -1 ? trimmed.slice(at + 1).toLowerCase() : '';
}
