import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import clsx from 'clsx';

export default function StatCard({ label, value, change, up, badge, icon: Icon, color, bg, loading }) {
  if (loading) {
    return (
      <div className="stat-card">
        <div className="skeleton h-8 w-8 rounded-xl" />
        <div className="space-y-2">
          <div className="skeleton h-3 w-24 rounded" />
          <div className="skeleton h-6 w-16 rounded" />
          <div className="skeleton h-3 w-12 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="stat-card group hover:border-white/10 transition-all duration-300">
      <div className="flex-between">
        <div className={clsx('w-9 h-9 rounded-xl flex-center flex-shrink-0', bg)}>
          <Icon className={clsx('w-4.5 h-4.5', color)} size={18} />
        </div>

        {/* Priority: badge (Coming Soon) → change pill → nothing */}
        {badge ? (
          <span className="text-[10px] font-medium text-warning-400 bg-warning-500/10 border border-warning-500/20 px-2 py-1 rounded-full">
            {badge}
          </span>
        ) : change ? (
          <span className={clsx(
            'flex items-center gap-0.5 text-xs font-medium px-2 py-1 rounded-full',
            up ? 'text-accent-400 bg-accent-500/10' : 'text-danger-400 bg-danger-500/10'
          )}>
            {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {change}
          </span>
        ) : null}

      </div>
      <div>
        <p className="text-2xl font-display font-bold text-white">{value}</p>
        <p className="text-xs text-slate-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}