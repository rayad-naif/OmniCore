import { motion } from 'framer-motion';
import { Building2, Clock, Mail, Bot, Palette, ExternalLink } from 'lucide-react';
import { getWorkspace } from '@/services/workspace';
import { productName } from '@/services/brand';

// In OmniCore the HR module shares the workspace's settings, so the original
// standalone settings form (company, SMTP, Gemini key) is replaced by pointers
// to where each setting lives.
const ITEMS = [
  { icon: Building2, title: 'Company name', where: 'OmniCore → Settings → Workspace', key: 'name' },
  { icon: Clock, title: 'Time zone (attendance, shifts, late marks)', where: 'OmniCore → Settings → Workspace → Default time zone', key: 'timezone' },
  { icon: Mail, title: 'Email sending', where: 'OmniCore → Settings → Email / SMTP (falls back to the platform mail server)' },
  { icon: Bot, title: 'AI features (resume screening, assistant)', where: 'Included with plans that have AI; no API key needed here', key: 'aiEnabled' },
  { icon: Palette, title: 'Logo, colours and domain', where: 'Agency branding / custom domain in OmniCore' },
];

export default function SystemSettings() {
  const ws = getWorkspace() || {};
  const value = (key) => {
    if (!key) return null;
    if (key === 'aiEnabled') return ws.aiEnabled ? 'On' : 'Off';
    return ws[key] || '—';
  };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Settings</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          {productName()} uses your workspace settings. Change them in the main dashboard.
        </p>
      </div>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card divide-y divide-white/5">
        {ITEMS.map(({ icon: Icon, title, where, key }) => (
          <div key={title} className="flex items-start gap-4 p-5">
            <div className="w-9 h-9 rounded-lg bg-primary-600/15 flex-center flex-shrink-0">
              <Icon className="w-4 h-4 text-primary-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">{title}</p>
              <p className="text-xs text-slate-400 mt-0.5">{where}</p>
            </div>
            {key && <span className="text-sm text-slate-200">{value(key)}</span>}
          </div>
        ))}
      </motion.div>
      <a href="/dashboard/" className="btn-primary inline-flex items-center gap-2">
        <ExternalLink className="w-4 h-4" /> Open the main dashboard
      </a>
    </div>
  );
}
