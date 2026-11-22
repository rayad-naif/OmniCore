import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { ArrowRight, Bell } from 'lucide-react';
import clsx from 'clsx';

const TYPE_META = {
  leave:      { label: 'Leave',      variant: 'success' },
  late:       { label: 'Late',       variant: 'danger'  },
  shift_swap: { label: 'Shift Swap', variant: 'warning' },
  payroll:    { label: 'Payroll',    variant: 'accent'  },
  employee:   { label: 'Employee',   variant: 'primary' },
  calendar_event: { label: 'Event', variant: 'accent' },
  default:    { label: 'Update',     variant: 'slate'   },
};

const BADGE_STYLES = {
  primary: 'text-primary-500 bg-primary-500/10',
  accent:  'text-accent-500 bg-accent-500/10',
  success: 'text-accent-400 bg-accent-400/10',
  warning: 'text-warning-400 bg-warning-400/10',
  danger:  'text-danger-400 bg-danger-400/10',
  slate:   'text-slate-500 bg-slate-200/70 dark:text-slate-300 dark:bg-slate-700/50',
};

const formatRelativeTime = (createdAt) => {
  if (!createdAt) return 'Just now';
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
};

export default function RecentActivity() {
  const notifications = useSelector((state) => state.notifications.list || []);

  const recentNotifications = useMemo(() => {
    return [...notifications]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 8);
  }, [notifications]);

  return (
    <div className="flex h-[270px] flex-col overflow-hidden">    
        <div className="flex-between mb-4 gap-3">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white text-sm">Recent Activity</h3>
            <p className="text-xs text-slate-500 mt-1">Live admin notifications from your bell feed.</p>
          </div>
          {/* <button className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-colors">
            View all
            <ArrowRight className="w-3.5 h-3.5" />
          </button> */}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
          {recentNotifications.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-200/80 bg-slate-50 dark:bg-slate-950/50 text-slate-500 dark:text-slate-400">
              <Bell className="w-6 h-6 opacity-40" />
              <p className="text-sm">No recent notifications yet.</p>
              <p className="text-xs text-slate-400">Notifications will appear here once new requests arrive.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {recentNotifications.map((item) => {
                const meta = TYPE_META[item.type] || TYPE_META.default;

                return (
                  <li
                    key={item._id || item.id}
                    className={clsx(
                      'rounded-3xl border px-4 transition-colors',
                      item.read
                        ? 'border-slate-200/70 bg-white/90 dark:border-white/10 dark:bg-slate-950/80'
                        : 'border-primary-200 bg-primary-50/80 dark:border-primary-500/20 dark:bg-primary-500/10'
                    )}
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">{item.title || meta.label}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{item.message || item.text || 'No description available.'}</p>
                        </div>
                        <span className={clsx('rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em]', BADGE_STYLES[meta.variant])}>
                          {meta.label}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>{formatRelativeTime(item.createdAt)}</span>
                        <span className="inline-flex items-center gap-1 text-primary-500 font-medium">
                          Details
                          <ArrowRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      
  </div>  
  );
}
