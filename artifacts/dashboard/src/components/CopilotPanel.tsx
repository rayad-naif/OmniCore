import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Send, Sparkles, Trash2, X } from 'lucide-react';
import type { AuthFetch } from '../sections/AuditLogSection';
import { useBranding } from '../lib/branding';

interface Pending {
  id: string;
  name: string;
  summary: string;
}
interface Line {
  role: 'user' | 'assistant' | 'system';
  text: string;
  pending?: Pending[];
}
interface Reply {
  session_id: string;
  reply: string;
  pending: Pending[];
  actions: { type: string; section: string }[];
  executed?: { summary: string; ok: boolean; error?: unknown }[];
}

const STARTERS = [
  'How do I install the chat widget on my website?',
  'Show me open tickets with high priority',
  'Summarise the latest conversation',
  'Create a saved reply for refund requests',
  'Connect Slack notifications',
];

const SESSION_KEY = 'omni_copilot_session';

/** Renders **bold** and line breaks without injecting HTML. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <p key={i} className={line.trim() ? '' : 'h-2'}>
          {line
            .split(/(\*\*[^*]+\*\*)/g)
            .map((part, j) =>
              part.startsWith('**') && part.endsWith('**') ? (
                <strong key={j}>{part.slice(2, -2)}</strong>
              ) : (
                <span key={j}>{part}</span>
              ),
            )}
        </p>
      ))}
    </>
  );
}

export function CopilotPanel({
  authFetch,
  section,
  onOpenSection,
}: {
  authFetch: AuthFetch;
  section: string;
  onOpenSection: (section: string) => void;
}) {
  const brand = useBranding();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  });
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || enabled !== null) return;
    authFetch('/api/copilot/status')
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => setEnabled(Boolean(d.enabled)))
      .catch(() => setEnabled(false));
  }, [open, enabled, authFetch]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines, busy]);

  function remember(id: string | null) {
    setSessionId(id);
    try {
      if (id) sessionStorage.setItem(SESSION_KEY, id);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* private mode */
    }
  }

  function handle(d: Reply) {
    remember(d.session_id);
    const extra: Line[] = (d.executed || []).map((x) => ({
      role: 'system',
      text: `${x.ok ? '✓' : '✗'} ${x.summary}${x.ok ? '' : ` — ${String(x.error)}`}`,
    }));
    setLines((l) => [
      ...l,
      ...extra,
      ...(d.reply || d.pending.length
        ? [{ role: 'assistant' as const, text: d.reply, pending: d.pending }]
        : []),
    ]);
    for (const a of d.actions || [])
      if (a.type === 'open_section') onOpenSection(a.section);
  }

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput('');
    setLines((l) => [...l, { role: 'user', text: msg }]);
    setBusy(true);
    try {
      const r = await authFetch('/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, message: msg, section }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 409 && sessionId) remember(null);
        setLines((l) => [
          ...l,
          {
            role: 'system',
            text: (d as { error?: string }).error || `Error ${r.status}`,
          },
        ]);
      } else handle(d as Reply);
    } finally {
      setBusy(false);
    }
  }

  async function decide(approve: boolean) {
    if (!sessionId) return;
    setBusy(true);
    setLines((l) =>
      l.map((x) => (x.pending?.length ? { ...x, pending: [] } : x)),
    );
    try {
      const r = await authFetch(`/api/copilot/sessions/${sessionId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ approve, section }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok)
        setLines((l) => [
          ...l,
          {
            role: 'system',
            text: (d as { error?: string }).error || `Error ${r.status}`,
          },
        ]);
      else handle(d as Reply);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (sessionId)
      await authFetch(`/api/copilot/sessions/${sessionId}`, {
        method: 'DELETE',
      }).catch(() => {});
    remember(null);
    setLines([]);
  }

  const waiting = lines.some((l) => l.pending?.length);

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 h-12 pl-4 pr-5 rounded-full bg-sky-600 text-white shadow-lg hover:bg-sky-700 flex items-center gap-2 text-sm font-medium"
          aria-label="Open AI assistant"
        >
          <Sparkles size={16} /> Ask AI
        </button>
      )}
      {open && (
        <div
          className="fixed bottom-6 right-6 z-50 w-[min(420px,calc(100vw-2rem))] h-[min(620px,calc(100vh-3rem))] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          role="dialog"
          aria-label={`${brand.appName} assistant`}
        >
          <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles size={15} className="text-sky-400" /> {brand.appName}{' '}
              Assistant
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => void reset()}
                className="p-1.5 rounded hover:bg-slate-800"
                title="New conversation"
                aria-label="New conversation"
              >
                <Trash2 size={14} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded hover:bg-slate-800"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm bg-slate-50">
            {enabled === false && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                The assistant is not configured on this platform yet.
              </p>
            )}
            {lines.length === 0 && enabled !== false && (
              <div className="space-y-2">
                <p className="text-slate-600">
                  Hi! I can explain any part of {brand.appName} and do things
                  for you, like finding conversations, replying, creating saved
                  replies or connecting integrations. I always ask before
                  changing anything.
                </p>
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="block w-full text-left text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white hover:border-sky-300 text-slate-700"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {lines.map((l, i) => (
              <div
                key={i}
                className={l.role === 'user' ? 'flex justify-end' : ''}
              >
                {l.role === 'system' ? (
                  <p className="text-[11px] text-slate-500 italic">{l.text}</p>
                ) : (
                  <div
                    className={`max-w-[90%] rounded-2xl px-3 py-2 leading-relaxed ${l.role === 'user' ? 'bg-sky-600 text-white' : 'bg-white border border-slate-200 text-slate-800'}`}
                  >
                    {l.text && <Rich text={l.text} />}
                    {l.pending && l.pending.length > 0 && (
                      <div className="mt-2 border-t border-slate-100 pt-2 space-y-2">
                        <p className="text-[11px] font-semibold text-slate-500">
                          Approve{' '}
                          {l.pending.length > 1
                            ? 'these actions'
                            : 'this action'}
                          ?
                        </p>
                        {l.pending.map((p) => (
                          <p
                            key={p.id}
                            className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-900"
                          >
                            {p.summary}
                          </p>
                        ))}
                        <div className="flex gap-2">
                          <button
                            onClick={() => void decide(true)}
                            className="h-7 px-3 rounded-lg bg-emerald-600 text-white text-xs inline-flex items-center gap-1"
                          >
                            <Check size={12} /> Approve
                          </button>
                          <button
                            onClick={() => void decide(false)}
                            className="h-7 px-3 rounded-lg border border-slate-200 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Thinking…
              </p>
            )}
            <div ref={endRef} />
          </div>
          <form
            className="p-3 border-t border-slate-200 flex gap-2 bg-white"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                waiting
                  ? 'Approve or cancel above first'
                  : 'Ask anything or tell me what to do…'
              }
              disabled={busy || waiting || enabled === false}
              className="flex-1 h-9 px-3 text-sm border border-slate-200 rounded-lg"
              aria-label="Message the assistant"
            />
            <button
              className="h-9 w-9 rounded-lg bg-sky-600 text-white flex items-center justify-center disabled:opacity-50"
              disabled={busy || waiting || !input.trim()}
              aria-label="Send"
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
