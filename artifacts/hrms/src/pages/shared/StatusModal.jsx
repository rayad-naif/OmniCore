import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, AlertCircle, CheckCircle2, X, Loader2 } from 'lucide-react';

// Configuration presets for consistent UX branding matching your system
const MODAL_PRESETS = {
  delete: {
    icon: Trash2,
    iconContainerClass: 'bg-red-500/10 text-red-400 border border-red-500/20',
    confirmBtnClass: 'bg-red-500 hover:bg-red-600 focus:ring-red-500/50',
    confirmLabel: 'Delete',
  },
  confirm: {
    icon: AlertCircle,
    iconContainerClass: 'bg-primary-500/10 text-primary-400 border border-primary-500/20',
    confirmBtnClass: 'bg-primary-500 hover:bg-primary-600 focus:ring-primary-500/50',
    confirmLabel: 'Confirm',
  },
  success: {
    icon: CheckCircle2,
    iconContainerClass: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    confirmBtnClass: 'bg-emerald-500 hover:bg-emerald-600 focus:ring-emerald-500/50',
    confirmLabel: 'Done',
  }
};

export default function StatusModal({
  isOpen,
  type = 'confirm', // 'delete' | 'confirm' | 'success'
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
  isLoading = false,
  children // This lets you inject custom item data dynamically
}) {
  if (!isOpen) return null;

  const config = MODAL_PRESETS[type] || MODAL_PRESETS.confirm;
  const Icon = config.icon;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        {/* Backdrop glassmorphism effect */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={!isLoading ? onClose : undefined}
          className="absolute inset-0 bg-black/70 backdrop-blur-md"
        />

        {/* Modal body container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-surface-900 p-6 shadow-2xl text-center z-10"
        >
          {/* Top corner close x button */}
          {type === 'success' && (
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 p-1 rounded-xl text-slate-400 hover:bg-white/5 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {/* Dynamic Top Floating Graphic Header Badge */}
          <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl mb-4 ${config.iconContainerClass}`}>
            <Icon className="h-6 w-6" />
          </div>

          {/* Heading context titles */}
          <h3 className="text-base font-semibold text-white mb-1.5">{title}</h3>
          
          {message && (
            <p className="text-xs text-slate-400 mb-5 max-w-sm mx-auto leading-relaxed">
              {message}
            </p>
          )}

          {/* Children Slot: This injects contextual summary cards inside the modal */}
          {children && (
            <div className="mb-6 text-left rounded-2xl bg-white/5 border border-white/5 p-4 text-xs space-y-2">
              {children}
            </div>
          )}

          {/* Interactive footer action panel links */}
          <div className="flex gap-3">
            {type !== 'success' && (
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="flex-1 py-2.5 rounded-xl border border-white/10 bg-transparent font-medium text-slate-300 text-xs hover:bg-white/5 transition disabled:opacity-50"
              >
                {cancelLabel}
              </button>
            )}
            <button
              type="button"
              onClick={onConfirm || onClose}
              disabled={isLoading}
              className={`flex-1 py-2.5 rounded-xl font-medium text-white text-xs transition disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-lg ${config.confirmBtnClass}`}
            >
              {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {confirmLabel || config.confirmLabel}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}