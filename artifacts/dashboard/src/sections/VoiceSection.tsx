import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  Ear,
  Headphones,
  MessageSquareText,
  Mic,
  Phone,
  PhoneCall,
  PhoneOff,
  Play,
  RefreshCw,
  Rocket,
  Save,
  Settings2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { AuthFetch } from './AuditLogSection';

// ── Types (mirror /api/voice responses) ─────────────────────────────────────
interface Line {
  role: 'caller' | 'agent' | 'system' | string;
  text: string;
  agent?: string;
  at?: string;
}
interface CallSummary {
  id: string;
  status: string;
  direction: string;
  customer?: { number?: string; name?: string };
  agent?: string;
  createdAt: string;
  durationSec?: number;
  lastLine: Line | null;
  takeover: { state: string; by: string } | null;
  muted: boolean;
  grade: { score: number; sentiment: string; outcome: string } | null;
  alerts: { type: string; text?: string; keyword?: string }[];
}
interface CallDetail extends CallSummary {
  lines: Line[];
  total: number;
  partial: Line | null;
  whispers: { text: string; by?: string; at?: string }[];
  summary: string;
  recordingUrl: string;
  endedReason: string;
  canListen: boolean;
  sync: { state?: string; error?: string } | null;
}
interface Step {
  key: string;
  label: string;
  status: string;
  error?: string;
}
interface Deployment {
  locationId: string;
  name: string;
  status: string;
  lastError: string;
  phoneNumber: string;
  agent: Record<string, unknown>;
  options: { country: string; areaCode: string; useSubaccount: boolean };
  pipeline: { pipelineId: string; stages: Record<string, string> };
  outbound: {
    enabled: boolean;
    consent: boolean;
    maxAttempts: number;
    retryMinutes: number;
    dailyCap: number;
    start: string;
    end: string;
    webhookUrl: string;
  } | null;
  followUp: { enabled: boolean } | null;
  alerts: { enabled: boolean; keywords: string[]; minScore: number } | null;
  steps: Step[];
}
interface Overview {
  account: { id: string; name: string; isAgency: boolean };
  planAllowsVoice: boolean;
  canManageKeys: boolean;
  keys: Record<string, { set: boolean; hint: string }> & {
    status: Record<string, { ok: boolean; detail: string }>;
  };
  setup: { takeoverNumber: string; browserCalling: boolean };
  ghl: { locationId: string; name: string } | null;
  deployment: Deployment | null;
  voices: string[];
  outcomes: string[];
  languages: { id: string; label: string }[];
  defaults: { agent: Record<string, unknown> };
  pollMs: number;
}

const btn =
  'h-8 px-3 text-xs rounded-lg font-medium inline-flex items-center gap-1.5 disabled:opacity-50';
const primary = `${btn} bg-sky-600 text-white hover:bg-sky-700`;
const ghost = `${btn} border border-slate-200 bg-white text-slate-600 hover:bg-slate-50`;
const danger = `${btn} border border-red-200 bg-white text-red-600 hover:bg-red-50`;
const field =
  'w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white';
const area = 'w-full p-2 text-sm border border-slate-200 rounded-lg bg-white';
const card = 'bg-white border border-slate-200 rounded-xl p-5';
type Msg = { ok: boolean; text: string } | null;

async function call<T>(
  authFetch: AuthFetch,
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const r = await authFetch(`/api/voice${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(
      new Error((d as { error?: string }).error || `HTTP ${r.status}`),
      { data: d },
    );
  return d as T;
}

const fmtDur = (s?: number) =>
  s
    ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
    : '—';
const nice = (s: string) => s.replace(/_/g, ' ');

// ── Live listen (raw 16-bit PCM over the voice service's WebSocket) ─────────
function createListener(url: string, onClose: () => void) {
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  let next = 0;
  let rate = 16000;
  let channels = 1;
  let closed = false;
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') {
      try {
        const m = JSON.parse(e.data);
        if (Number(m.sampleRate || m.sample_rate))
          rate = Number(m.sampleRate || m.sample_rate);
        if (Number(m.channels)) channels = Number(m.channels);
      } catch {
        /* not JSON */
      }
      return;
    }
    const pcm = new Int16Array(e.data, 0, Math.floor(e.data.byteLength / 2));
    const frames = Math.floor(pcm.length / channels);
    if (!frames) return;
    const buf = ctx.createBuffer(channels, frames, rate);
    for (let c = 0; c < channels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < frames; i++) ch[i] = pcm[i * channels + c] / 32768;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    const now = ctx.currentTime;
    if (next < now + 0.05 || next > now + 1) next = now + 0.15;
    src.start(next);
    next += buf.duration;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    void ctx.close().catch(() => {});
  };
  ws.onclose = () => {
    if (!closed) onClose();
    close();
  };
  if (ctx.state === 'suspended') void ctx.resume();
  return { close };
}

// ── Command Deck ────────────────────────────────────────────────────────────
function Deck({
  authFetch,
  canManage,
  pollMs,
}: {
  authFetch: AuthFetch;
  canManage: boolean;
  pollMs: number;
}) {
  const [calls, setCalls] = useState<CallSummary[]>([]);
  const [stats, setStats] = useState<{
    calls7d: number;
    minutes7d: number;
    avgScore: number | null;
    booked7d: number;
    cost7d: number;
  } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [whisper, setWhisper] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState<{
    ready: boolean;
    onCall: boolean;
    reason?: string;
  }>({ ready: false, onCall: false });
  const listener = useRef<{ close: () => void } | null>(null);
  const device = useRef<{ destroy: () => void } | null>(null);
  const expecting = useRef(0);
  const total = useRef(0);

  // Live grid
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const d = await call<{ calls: CallSummary[] }>(
          authFetch,
          'GET',
          '/live/calls',
        );
        if (!stop) setCalls(d.calls);
      } catch {
        /* keep last */
      }
    };
    void tick();
    call<typeof stats>(authFetch, 'GET', '/live/stats')
      .then(setStats)
      .catch(() => {});
    const t = setInterval(tick, Math.max(pollMs, 1000));
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [authFetch, pollMs]);

  // Selected call: incremental transcript polling
  useEffect(() => {
    if (!sel) return;
    let stop = false;
    total.current = 0;
    setLines([]);
    setDetail(null);
    const tick = async () => {
      try {
        const d = await call<CallDetail>(
          authFetch,
          'GET',
          `/live/calls/${encodeURIComponent(sel)}?after=${total.current}`,
        );
        if (stop) return;
        if (d.lines.length) setLines((l) => [...l, ...d.lines]);
        total.current = d.total;
        setDetail(d);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const t = setInterval(tick, Math.max(pollMs, 1000));
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [sel, authFetch, pollMs]);

  // Browser takeover device (managers only, lazily loaded)
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    (async () => {
      try {
        const t = await call<{
          enabled: boolean;
          token?: string;
          reason?: string;
        }>(authFetch, 'GET', '/live/voice-token');
        if (!t.enabled || !t.token)
          return setVoice({ ready: false, onCall: false, reason: t.reason });
        const { Device } = await import('@twilio/voice-sdk');
        if (cancelled) return;
        const dev = new Device(t.token, { closeProtection: true });
        dev.on('error', (err: { message?: string }) => {
          setVoice({
            ready: false,
            onCall: false,
            reason: `Browser calling unavailable: ${err?.message || 'connection error'}`,
          });
        });
        dev.on(
          'incoming',
          (c: {
            accept: () => void;
            reject: () => void;
            on: (e: string, f: () => void) => void;
          }) => {
            if (!expecting.current || Date.now() - expecting.current > 120e3)
              return c.reject();
            expecting.current = 0;
            c.accept();
            setVoice({ ready: true, onCall: true });
            c.on('disconnect', () => setVoice({ ready: true, onCall: false }));
          },
        );
        dev.on('tokenWillExpire', async () => {
          const n = await call<{ token?: string }>(
            authFetch,
            'GET',
            '/live/voice-token',
          ).catch(() => null);
          if (n?.token) dev.updateToken(n.token);
        });
        dev.on('registered', () => setVoice({ ready: true, onCall: false }));
        device.current = dev;
        await dev.register();
      } catch (e) {
        setVoice({ ready: false, onCall: false, reason: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
      device.current?.destroy();
      listener.current?.close();
    };
  }, [authFetch, canManage]);

  async function act(action: string, body: Record<string, unknown> = {}) {
    if (!sel) return;
    setMsg(null);
    try {
      await call(
        authFetch,
        'POST',
        `/live/calls/${encodeURIComponent(sel)}/${action}`,
        body,
      );
      setMsg({
        ok: true,
        text: action === 'whisper' ? 'Whispered to the AI.' : `Done: ${action}`,
      });
      if (action === 'whisper' || action === 'say') setWhisper('');
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function toggleListen() {
    if (listening) {
      listener.current?.close();
      listener.current = null;
      setListening(false);
      return;
    }
    try {
      const { url } = await call<{ url: string }>(
        authFetch,
        'POST',
        `/live/calls/${encodeURIComponent(sel!)}/listen`,
        {},
      );
      listener.current = createListener(url, () => setListening(false));
      setListening(true);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function takeover() {
    if (!voice.ready)
      return setMsg({
        ok: false,
        text: voice.reason || 'Browser calling is not ready yet.',
      });
    try {
      await navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((s) => s.getTracks().forEach((t) => t.stop()));
      expecting.current = Date.now();
      listener.current?.close();
      setListening(false);
      await call(
        authFetch,
        'POST',
        `/live/calls/${encodeURIComponent(sel!)}/takeover`,
        {},
      );
      setMsg({ ok: true, text: 'Connecting the caller to you…' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  const live =
    detail && ['queued', 'ringing', 'in-progress'].includes(detail.status);
  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            ['Calls (7 days)', stats.calls7d],
            ['Minutes', stats.minutes7d],
            ['Booked', stats.booked7d],
            ['Avg QA score', stats.avgScore ?? '—'],
            ['Cost', `$${stats.cost7d}`],
          ].map(([k, v]) => (
            <div
              key={String(k)}
              className="bg-white border border-slate-200 rounded-xl p-3"
            >
              <p className="text-[10px] uppercase tracking-wide text-slate-400">
                {k}
              </p>
              <p className="text-lg font-semibold text-slate-900">{v}</p>
            </div>
          ))}
        </div>
      )}
      <div className="grid lg:grid-cols-[320px_1fr] gap-4 min-h-[480px]">
        <div className={`${card} p-0 overflow-hidden`}>
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">
              Live calls ({calls.length})
            </p>
            {canManage && (
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full ${voice.onCall ? 'bg-red-50 text-red-600' : voice.ready ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
              >
                {voice.onCall
                  ? 'On call'
                  : voice.ready
                    ? 'Takeover ready'
                    : 'Takeover off'}
              </span>
            )}
          </div>
          {calls.length === 0 && (
            <p className="p-6 text-xs text-slate-400 text-center">
              No live calls right now. They appear here the moment the AI
              answers.
            </p>
          )}
          {calls.map((c) => (
            <button
              key={c.id}
              onClick={() => setSel(c.id)}
              className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 ${sel === c.id ? 'bg-sky-50' : ''}`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-800">
                  {c.customer?.name || c.customer?.number || 'Caller'}
                </span>
                <span className="text-slate-400">
                  {c.direction === 'outbound' ? 'Outbound' : 'Inbound'} ·{' '}
                  {c.agent || 'AI'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate mt-0.5">
                {c.lastLine
                  ? `${c.lastLine.role === 'caller' ? 'Caller' : 'AI'}: ${c.lastLine.text}`
                  : 'Connecting…'}
              </p>
              {c.alerts.length > 0 && (
                <p className="text-[10px] text-red-600 mt-0.5">
                  ⚠ {c.alerts.map((a) => a.keyword || a.type).join(', ')}
                </p>
              )}
            </button>
          ))}
        </div>
        <div className={`${card} flex flex-col`}>
          {!detail ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400 text-sm">
              <Headphones size={28} className="mb-2" /> Select a call to watch
              the transcript, listen in, whisper to the AI or take over.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {detail.customer?.name ||
                      detail.customer?.number ||
                      'Caller'}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {nice(detail.status)} · {detail.agent || 'AI'} ·{' '}
                    {fmtDur(detail.durationSec)}
                    {detail.takeover
                      ? ` · takeover ${detail.takeover.state} by ${detail.takeover.by}`
                      : ''}
                  </p>
                </div>
                {detail.grade && (
                  <span className="text-xs px-2 py-1 rounded-lg bg-slate-100">
                    QA {detail.grade.score}/100 · {nice(detail.grade.outcome)} ·{' '}
                    {detail.grade.sentiment}
                  </span>
                )}
              </div>
              {msg && (
                <div
                  className={`p-2 rounded-lg text-xs mb-2 ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
                >
                  {msg.text}
                </div>
              )}
              <div
                className="flex-1 overflow-y-auto space-y-2 bg-slate-50 rounded-lg p-3 max-h-[420px]"
                aria-live="polite"
              >
                {lines.map((l, i) => (
                  <div
                    key={i}
                    className={l.role === 'caller' ? 'flex justify-end' : ''}
                  >
                    <div
                      className={`max-w-[80%] rounded-xl px-3 py-1.5 text-xs ${l.role === 'caller' ? 'bg-sky-600 text-white' : l.role === 'system' ? 'bg-amber-50 text-amber-800' : 'bg-white border border-slate-200 text-slate-800'}`}
                    >
                      {l.role !== 'caller' && (
                        <span className="block text-[10px] text-slate-400">
                          {l.agent || (l.role === 'system' ? 'System' : 'AI')}
                        </span>
                      )}
                      {l.text}
                    </div>
                  </div>
                ))}
                {detail.partial && (
                  <p className="text-[11px] text-slate-400 italic">
                    {detail.partial.text}…
                  </p>
                )}
                {!live && detail.summary && (
                  <p className="text-xs bg-white border border-slate-200 rounded-lg p-2">
                    <strong>Summary:</strong> {detail.summary}
                  </p>
                )}
                {!live && detail.recordingUrl && (
                  <audio
                    controls
                    src={detail.recordingUrl}
                    className="w-full mt-2"
                  />
                )}
              </div>
              {live && canManage && (
                <div className="mt-3 space-y-2">
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (whisper.trim())
                        void act('whisper', { text: whisper });
                    }}
                  >
                    <input
                      className={field}
                      value={whisper}
                      onChange={(e) => setWhisper(e.target.value)}
                      placeholder="Whisper an instruction to the AI (caller won't hear it)"
                      aria-label="Whisper"
                    />
                    <button className={primary}>
                      <MessageSquareText size={12} /> Whisper
                    </button>
                    <button
                      type="button"
                      className={ghost}
                      onClick={() =>
                        whisper.trim() && void act('say', { text: whisper })
                      }
                      title="The AI says this exactly"
                    >
                      <Volume2 size={12} /> Say
                    </button>
                  </form>
                  <div className="flex flex-wrap gap-2">
                    {detail.canListen && (
                      <button
                        className={listening ? primary : ghost}
                        onClick={() => void toggleListen()}
                      >
                        <Ear size={12} />{' '}
                        {listening ? 'Stop listening' : 'Listen'}
                      </button>
                    )}
                    <button
                      className={ghost}
                      onClick={() => void act(detail.muted ? 'unmute' : 'mute')}
                    >
                      {detail.muted ? (
                        <Volume2 size={12} />
                      ) : (
                        <VolumeX size={12} />
                      )}{' '}
                      {detail.muted ? 'Unmute AI' : 'Mute AI'}
                    </button>
                    <button className={primary} onClick={() => void takeover()}>
                      <Mic size={12} /> Take over
                    </button>
                    <button
                      className={ghost}
                      onClick={() => {
                        const n = prompt(
                          'Transfer to which number? (+15551234567)',
                        );
                        if (n) void act('transfer', { number: n });
                      }}
                    >
                      <Phone size={12} /> Transfer
                    </button>
                    <button
                      className={danger}
                      onClick={() =>
                        confirm('End this call?') && void act('end')
                      }
                    >
                      <PhoneOff size={12} /> End
                    </button>
                  </div>
                </div>
              )}
              {live && !canManage && (
                <p className="mt-3 text-[11px] text-slate-500">
                  View only. Admins and supervisors can listen, whisper and take
                  over.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── History & leads ─────────────────────────────────────────────────────────
function History({ authFetch }: { authFetch: AuthFetch }) {
  const [rows, setRows] = useState<CallSummary[]>([]);
  useEffect(() => {
    call<{ calls: CallSummary[] }>(authFetch, 'GET', '/live/history?limit=100')
      .then((d) => setRows(d.calls))
      .catch(() => {});
  }, [authFetch]);
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-xs">
        <thead className="text-slate-400 text-left">
          <tr>
            <th className="py-1">When</th>
            <th>Caller</th>
            <th>Direction</th>
            <th>Duration</th>
            <th>Outcome</th>
            <th>QA</th>
            <th>Sentiment</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-slate-400">
                No calls yet.
              </td>
            </tr>
          )}
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-slate-100">
              <td className="py-2 pr-2 whitespace-nowrap">
                {new Date(c.createdAt).toLocaleString()}
              </td>
              <td className="pr-2">
                {c.customer?.name || c.customer?.number || '—'}
              </td>
              <td className="pr-2">{c.direction}</td>
              <td className="pr-2">{fmtDur(c.durationSec)}</td>
              <td className="pr-2">
                {c.grade ? nice(c.grade.outcome) : nice(c.status)}
              </td>
              <td className="pr-2">{c.grade?.score ?? '—'}</td>
              <td>{c.grade?.sentiment ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Leads({ authFetch }: { authFetch: AuthFetch }) {
  const [rows, setRows] = useState<
    {
      id: string;
      name: string;
      phone: string;
      interest: string;
      status: string;
      attempts: number;
      reason: string;
      createdAt: string;
      nextAt: string;
    }[]
  >([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    call<{ leads: typeof rows }>(authFetch, 'GET', '/leads')
      .then((d) => setRows(d.leads))
      .catch((e) => setErr((e as Error).message));
  }, [authFetch]);
  return (
    <div className={`${card} overflow-x-auto`}>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      <table className="w-full text-xs">
        <thead className="text-slate-400 text-left">
          <tr>
            <th className="py-1">Received</th>
            <th>Lead</th>
            <th>Phone</th>
            <th>Interest</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Next call</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-slate-400">
                No speed-to-lead calls yet. Turn it on under Setup and add the
                webhook to a HighLevel workflow.
              </td>
            </tr>
          )}
          {rows.map((l) => (
            <tr key={l.id} className="border-t border-slate-100">
              <td className="py-2 pr-2 whitespace-nowrap">
                {new Date(l.createdAt).toLocaleString()}
              </td>
              <td className="pr-2">{l.name || '—'}</td>
              <td className="pr-2 font-mono">{l.phone}</td>
              <td className="pr-2">{l.interest || '—'}</td>
              <td className="pr-2">
                {nice(l.status)}
                {l.reason ? ` (${l.reason})` : ''}
              </td>
              <td className="pr-2">{l.attempts}</td>
              <td>
                {l.nextAt && l.status === 'queued'
                  ? new Date(l.nextAt).toLocaleString()
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Reports ─────────────────────────────────────────────────────────────────
interface Summary {
  days: number;
  totals: Record<string, number | null>;
  daily: { date: string; calls: number; booked: number; missed: number }[];
  outcomes: Record<string, number>;
  leads: {
    received: number;
    connected: number;
    unreached: number;
    avgSpeedSec: number | null;
  };
}
function Reports({ authFetch }: { authFetch: AuthFetch }) {
  const [days, setDays] = useState(30);
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    call<Summary>(authFetch, 'GET', `/reports/summary?days=${days}`)
      .then(setS)
      .catch(() => setS(null));
  }, [authFetch, days]);
  async function csv() {
    const r = await authFetch(`/api/voice/reports/calls.csv?days=${days}`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = `calls-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  const max = Math.max(1, ...(s?.daily || []).map((d) => d.calls));
  const t = s?.totals || {};
  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <select
          className="h-8 px-2 text-xs border border-slate-200 rounded-lg"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="Period"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <button className={ghost} onClick={() => void csv()}>
          <Download size={12} /> Export CSV
        </button>
      </div>
      {s && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['Calls', t.calls],
              ['Answered', t.answered],
              ['Booked', t.booked],
              ['Booking rate', `${t.bookingRate ?? 0}%`],
              ['Est. revenue', `$${t.estRevenue ?? 0}`],
              ['AI cost', `$${t.cost ?? 0}`],
              ['Return on AI cost', t.roi ? `${t.roi}×` : '—'],
              ['Staff hours saved', t.staffHoursSaved],
              ['After-hours calls', t.afterHours],
              ['Avg QA score', t.avgScore ?? '—'],
              ['Leads called', s.leads.connected],
              [
                'Avg speed-to-lead',
                s.leads.avgSpeedSec !== null ? `${s.leads.avgSpeedSec}s` : '—',
              ],
            ].map(([k, v]) => (
              <div
                key={String(k)}
                className="bg-white border border-slate-200 rounded-xl p-3"
              >
                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                  {k}
                </p>
                <p className="text-lg font-semibold text-slate-900">
                  {v as string}
                </p>
              </div>
            ))}
          </div>
          <div className={card}>
            <p className="text-xs font-semibold text-slate-700 mb-3">
              Calls per day (booked in colour)
            </p>
            <div
              className="flex gap-[2px] h-32 border-b border-slate-200"
              role="img"
              aria-label="Calls per day"
            >
              {s.daily.map((d) => (
                <div
                  key={d.date}
                  className="flex-1 h-full flex flex-col justify-end"
                  title={`${d.date}: ${d.calls} calls, ${d.booked} booked`}
                >
                  <div
                    className="bg-slate-300 rounded-t flex flex-col justify-end overflow-hidden"
                    style={{ height: `${(d.calls / max) * 100}%` }}
                  >
                    <div
                      className="bg-sky-600 w-full"
                      style={{
                        height: d.calls ? `${(d.booked / d.calls) * 100}%` : 0,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>{s.daily[0]?.date}</span>
              <span>{s.daily[s.daily.length - 1]?.date}</span>
            </div>
          </div>
          <div className={card}>
            <p className="text-xs font-semibold text-slate-700 mb-2">
              Outcomes
            </p>
            {Object.keys(s.outcomes).length === 0 && (
              <p className="text-xs text-slate-400">No graded calls yet.</p>
            )}
            {Object.entries(s.outcomes).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-xs mb-1">
                <span className="w-40 text-slate-600">{nice(k)}</span>
                <div className="flex-1 bg-slate-100 rounded h-2">
                  <div
                    className="bg-sky-600 h-2 rounded"
                    style={{
                      width: `${(v / Math.max(1, Number(t.calls))) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-8 text-right">{v}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Setup ───────────────────────────────────────────────────────────────────
function Setup({
  authFetch,
  ov,
  reload,
}: {
  authFetch: AuthFetch;
  ov: Overview;
  reload: () => void;
}) {
  const dep = ov.deployment;
  const [agent, setAgent] = useState<Record<string, unknown>>({
    ...ov.defaults.agent,
    ...(dep?.agent || {}),
    businessName: (dep?.agent?.businessName as string) || ov.ghl?.name || '',
  });
  const [options, setOptions] = useState(
    dep?.options || { country: 'US', areaCode: '', useSubaccount: true },
  );
  const [outbound, setOutbound] = useState(
    dep?.outbound || {
      enabled: false,
      consent: false,
      maxAttempts: 2,
      retryMinutes: 30,
      dailyCap: 200,
      start: '08:00',
      end: '20:00',
      webhookUrl: '',
    },
  );
  const [followUp, setFollowUp] = useState(dep?.followUp?.enabled || false);
  const [alerts, setAlerts] = useState(
    (dep?.alerts?.keywords || []).join(', '),
  );
  const [keys, setKeys] = useState({
    twilioSid: '',
    twilioToken: '',
    vapiKey: '',
    openaiKey: '',
  });
  const [crm, setCrm] = useState<{
    pipelines: {
      id: string;
      name: string;
      stages: { id: string; name: string }[];
    }[];
    calendars: { id: string; name: string }[];
  } | null>(null);
  const [pipeline, setPipeline] = useState(
    dep?.pipeline || { pipelineId: '', stages: {} },
  );
  const [templates, setTemplates] = useState<
    { id: string; label: string; agent: Record<string, unknown> }[]
  >([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testNumber, setTestNumber] = useState('');

  useEffect(() => {
    call<{ templates: typeof templates }>(authFetch, 'GET', '/templates')
      .then((d) => setTemplates(d.templates))
      .catch(() => {});
    if (ov.ghl)
      call<typeof crm>(authFetch, 'GET', '/crm')
        .then(setCrm)
        .catch(() => {});
  }, [authFetch, ov.ghl]);

  const run = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      reload();
    } finally {
      setBusy(null);
    }
  };
  const payload = () => ({
    agent,
    options,
    pipeline,
    outbound: { ...outbound, webhookUrl: undefined },
    followUp: { enabled: followUp },
    alerts: { keywords: alerts },
  });
  const a = (k: string) => (agent[k] as string) ?? '';
  const text = (k: string, label: string, rows = 0) => (
    <label className="block text-xs text-slate-600">
      {label}
      {rows ? (
        <textarea
          className={`${area} mt-1`}
          rows={rows}
          value={a(k)}
          onChange={(e) => setAgent({ ...agent, [k]: e.target.value })}
        />
      ) : (
        <input
          className={`${field} mt-1`}
          value={a(k)}
          onChange={(e) => setAgent({ ...agent, [k]: e.target.value })}
        />
      )}
    </label>
  );

  return (
    <div className="space-y-4">
      {msg && (
        <div
          className={`p-3 rounded-lg text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
        >
          {msg.text}
        </div>
      )}
      {!ov.planAllowsVoice && (
        <div className="p-3 rounded-lg text-xs bg-amber-50 text-amber-800 border border-amber-200">
          Your plan does not include AI features. You can prepare the call
          center, but deploying needs an upgrade (Billing).
        </div>
      )}

      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-900 mb-1">
          1. Provider keys{' '}
          {ov.account.isAgency && (
            <span className="text-[11px] font-normal text-slate-500">
              (managed by your agency)
            </span>
          )}
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          Calls run on your own Twilio, Vapi and OpenAI accounts, so you pay
          them directly. Keys are checked live and stored encrypted.
        </p>
        <div className="grid sm:grid-cols-2 gap-2 text-xs mb-3">
          {(['twilio', 'vapi', 'openai'] as const).map((p) => {
            const st = ov.keys.status?.[p];
            return (
              <p key={p}>
                <strong className="capitalize">{p}:</strong>{' '}
                {st ? (
                  <span className={st.ok ? 'text-emerald-600' : 'text-red-600'}>
                    {st.detail}
                  </span>
                ) : (
                  <span className="text-slate-400">not set</span>
                )}
              </p>
            );
          })}
        </div>
        {ov.canManageKeys && (
          <form
            className="grid sm:grid-cols-2 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                'keys',
                () => call(authFetch, 'PUT', '/keys', keys),
                'Keys checked. Working keys were saved.',
              );
            }}
          >
            <input
              className={field}
              placeholder={`Twilio Account SID ${ov.keys.twilioSid?.hint || ''}`}
              value={keys.twilioSid}
              onChange={(e) => setKeys({ ...keys, twilioSid: e.target.value })}
              autoComplete="off"
            />
            <input
              className={field}
              type="password"
              placeholder={`Twilio Auth Token ${ov.keys.twilioToken?.hint || ''}`}
              value={keys.twilioToken}
              onChange={(e) =>
                setKeys({ ...keys, twilioToken: e.target.value })
              }
              autoComplete="off"
            />
            <input
              className={field}
              type="password"
              placeholder={`Vapi private key ${ov.keys.vapiKey?.hint || ''}`}
              value={keys.vapiKey}
              onChange={(e) => setKeys({ ...keys, vapiKey: e.target.value })}
              autoComplete="off"
            />
            <input
              className={field}
              type="password"
              placeholder={`OpenAI key ${ov.keys.openaiKey?.hint || ''}`}
              value={keys.openaiKey}
              onChange={(e) => setKeys({ ...keys, openaiKey: e.target.value })}
              autoComplete="off"
            />
            <div>
              <button className={primary} disabled={busy === 'keys'}>
                <Save size={12} />{' '}
                {busy === 'keys' ? 'Checking…' : 'Check and save keys'}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-900 mb-1">
          2. Business and AI agents
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          A receptionist answers and hands off to Sales (quotes, booking) or
          Support (existing customers). Start from a template, then adjust.
        </p>
        {templates.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                className={ghost}
                onClick={() => setAgent({ ...agent, ...t.agent })}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          {text('businessName', 'Business name')}
          {text('industry', 'Industry')}
          {text('hours', 'Opening hours')}
          {text('timezone', 'Time zone (e.g. America/Chicago)')}
          {text('serviceArea', 'Service area')}
          {text('greeting', 'Greeting (optional)')}
          {text('transferNumber', 'Human transfer number (+1…)')}
          <label className="block text-xs text-slate-600">
            Booking calendar
            <select
              className={`${field} mt-1`}
              value={a('calendarId')}
              onChange={(e) =>
                setAgent({ ...agent, calendarId: e.target.value })
              }
            >
              <option value="">No booking</option>
              {(crm?.calendars || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-600">
            Voice
            <select
              className={`${field} mt-1`}
              value={a('voiceId')}
              onChange={(e) => setAgent({ ...agent, voiceId: e.target.value })}
            >
              {ov.voices.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-600">
            Language
            <select
              className={`${field} mt-1`}
              value={a('language')}
              onChange={(e) => setAgent({ ...agent, language: e.target.value })}
            >
              {ov.languages.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-600">
            Average job value ($, for ROI)
            <input
              type="number"
              min={0}
              className={`${field} mt-1`}
              value={Number(agent.avgJobValue) || 0}
              onChange={(e) =>
                setAgent({ ...agent, avgJobValue: Number(e.target.value) })
              }
            />
          </label>
          <label className="block text-xs text-slate-600">
            Phone number area code
            <input
              className={`${field} mt-1`}
              value={options.areaCode}
              onChange={(e) =>
                setOptions({ ...options, areaCode: e.target.value })
              }
              placeholder="e.g. 512"
            />
          </label>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 mt-3">
          {text('services', 'Services (one per line)', 5)}
          {text('faq', 'FAQ the AI may answer', 5)}
          {text('pricing', 'Pricing the AI may share', 5)}
        </div>
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-900 mb-1">
          3. CRM pipeline
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          After every call the AI grades it and updates the HighLevel contact.
          Pick which stage each outcome moves the opportunity to.
        </p>
        {!crm ? (
          <p className="text-xs text-slate-400">Loading HighLevel pipelines…</p>
        ) : (
          <>
            <select
              className={`${field} mb-3 max-w-sm`}
              value={pipeline.pipelineId}
              onChange={(e) =>
                setPipeline({ pipelineId: e.target.value, stages: {} })
              }
              aria-label="Pipeline"
            >
              <option value="">Don't move opportunities</option>
              {crm.pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {pipeline.pipelineId && (
              <div className="grid sm:grid-cols-2 gap-2">
                {ov.outcomes.map((o) => (
                  <label
                    key={o}
                    className="text-xs text-slate-600 flex items-center gap-2"
                  >
                    <span className="w-36">{nice(o)}</span>
                    <select
                      className="h-8 flex-1 px-2 border border-slate-200 rounded-lg"
                      value={pipeline.stages[o] || ''}
                      onChange={(e) =>
                        setPipeline({
                          ...pipeline,
                          stages: { ...pipeline.stages, [o]: e.target.value },
                        })
                      }
                    >
                      <option value="">—</option>
                      {(
                        crm.pipelines.find((p) => p.id === pipeline.pipelineId)
                          ?.stages || []
                      ).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-900 mb-3">
          4. Automations
        </h3>
        <label className="flex items-start gap-2 text-xs text-slate-700 mb-2">
          <input
            type="checkbox"
            checked={outbound.consent}
            onChange={(e) =>
              setOutbound({
                ...outbound,
                consent: e.target.checked,
                enabled: e.target.checked && outbound.enabled,
              })
            }
          />{' '}
          Leads I send have agreed to be called (required for speed-to-lead)
        </label>
        <label className="flex items-start gap-2 text-xs text-slate-700 mb-2">
          <input
            type="checkbox"
            disabled={!outbound.consent}
            checked={outbound.enabled}
            onChange={(e) =>
              setOutbound({ ...outbound, enabled: e.target.checked })
            }
          />{' '}
          Speed-to-lead: call new leads back within seconds
        </label>
        {outbound.enabled && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3 text-xs">
            <label>
              From
              <input
                className={field}
                value={outbound.start}
                onChange={(e) =>
                  setOutbound({ ...outbound, start: e.target.value })
                }
              />
            </label>
            <label>
              Until
              <input
                className={field}
                value={outbound.end}
                onChange={(e) =>
                  setOutbound({ ...outbound, end: e.target.value })
                }
              />
            </label>
            <label>
              Attempts
              <input
                type="number"
                min={1}
                max={3}
                className={field}
                value={outbound.maxAttempts}
                onChange={(e) =>
                  setOutbound({
                    ...outbound,
                    maxAttempts: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Retry after (min)
              <input
                type="number"
                min={10}
                className={field}
                value={outbound.retryMinutes}
                onChange={(e) =>
                  setOutbound({
                    ...outbound,
                    retryMinutes: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Daily cap
              <input
                type="number"
                min={1}
                className={field}
                value={outbound.dailyCap}
                onChange={(e) =>
                  setOutbound({ ...outbound, dailyCap: Number(e.target.value) })
                }
              />
            </label>
          </div>
        )}
        {dep?.outbound?.webhookUrl && outbound.enabled && (
          <p className="text-[11px] text-slate-500 mb-3 break-all">
            HighLevel workflow → Custom Webhook (POST):{' '}
            <code>{dep.outbound.webhookUrl}</code>
          </p>
        )}
        <label className="flex items-start gap-2 text-xs text-slate-700 mb-2">
          <input
            type="checkbox"
            checked={followUp}
            onChange={(e) => setFollowUp(e.target.checked)}
          />{' '}
          Text a follow-up after each call (booking confirmation, missed call,
          lead nurture) through the HighLevel number
        </label>
        <label className="block text-xs text-slate-600">
          Alert keywords (comma-separated)
          <input
            className={`${field} mt-1`}
            value={alerts}
            onChange={(e) => setAlerts(e.target.value)}
            placeholder="refund, lawyer, cancel"
          />
        </label>
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-900 mb-3">5. Deploy</h3>
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            className={ghost}
            disabled={!!busy}
            onClick={() =>
              void run(
                'save',
                () => call(authFetch, 'PUT', '/deployment', payload()),
                'Saved.',
              )
            }
          >
            <Save size={12} /> Save
          </button>
          {dep?.status === 'live' ? (
            <button
              className={primary}
              disabled={!!busy}
              onClick={() =>
                void run(
                  'update',
                  async () => {
                    await call(authFetch, 'PUT', '/deployment', payload());
                    await call(
                      authFetch,
                      'POST',
                      '/deployment/agents',
                      payload(),
                    );
                  },
                  'Live agents updated.',
                )
              }
            >
              <RefreshCw size={12} /> Save and update live agents
            </button>
          ) : (
            <button
              className={primary}
              disabled={!!busy}
              onClick={() =>
                void run(
                  'deploy',
                  async () => {
                    await call(authFetch, 'PUT', '/deployment', payload());
                    await call(authFetch, 'POST', '/deployment/deploy', {});
                  },
                  'Your AI call center is live!',
                )
              }
            >
              <Rocket size={12} />{' '}
              {busy === 'deploy'
                ? 'Deploying… (up to a minute)'
                : dep?.status === 'failed'
                  ? 'Resume deployment'
                  : 'Deploy call center'}
            </button>
          )}
          {dep && dep.status !== 'draft' && (
            <button
              className={danger}
              disabled={!!busy}
              onClick={() =>
                confirm('Remove the AI agents and release the phone number?') &&
                void run(
                  'teardown',
                  () =>
                    call(authFetch, 'POST', '/deployment/teardown', {
                      releaseNumber: true,
                    }),
                  'Removed.',
                )
              }
            >
              Remove
            </button>
          )}
        </div>
        {dep && (
          <ol className="space-y-1 text-xs mb-4">
            {dep.steps.map((s) => (
              <li key={s.key} className="flex gap-2">
                <span
                  className={
                    s.status === 'done'
                      ? 'text-emerald-600'
                      : s.status === 'error'
                        ? 'text-red-600'
                        : s.status === 'skipped'
                          ? 'text-slate-400'
                          : 'text-slate-500'
                  }
                >
                  {s.status === 'done' ? '✓' : s.status === 'error' ? '✗' : '•'}
                </span>
                <span className="text-slate-700">{s.label}</span>
                {s.error && <span className="text-red-600">{s.error}</span>}
              </li>
            ))}
          </ol>
        )}
        {dep?.status === 'live' && (
          <div className="flex flex-wrap gap-2 items-center p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs">
            <PhoneCall size={14} className="text-emerald-700" />{' '}
            <span className="text-emerald-800">
              Live on <strong>{dep.phoneNumber}</strong>. Forward your business
              line to it, or test it:
            </span>
            <input
              className="h-8 px-2 border border-slate-200 rounded-lg"
              placeholder="+15551234567"
              value={testNumber}
              onChange={(e) => setTestNumber(e.target.value)}
              aria-label="Test number"
            />
            <button
              className={ghost}
              disabled={!!busy}
              onClick={() =>
                void run(
                  'test',
                  () =>
                    call(authFetch, 'POST', '/deployment/test-call', {
                      number: testNumber,
                    }),
                  'Calling you now…',
                )
              }
            >
              <Play size={12} /> Test call
            </button>
            {outbound.enabled && (
              <button
                className={ghost}
                disabled={!!busy}
                onClick={() =>
                  void run(
                    'lead',
                    () =>
                      call(authFetch, 'POST', '/deployment/test-lead', {
                        phone: testNumber,
                        name: 'Test',
                      }),
                    'Test lead queued.',
                  )
                }
              >
                Test speed-to-lead
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────
const TABS = [
  ['deck', 'Command Deck'],
  ['history', 'Call history'],
  ['leads', 'Leads'],
  ['reports', 'Reports'],
  ['setup', 'Setup'],
] as const;

export function VoiceSection({
  authFetch,
  role,
}: {
  authFetch: AuthFetch;
  role: string;
}) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('deck');
  const load = useCallback(() => {
    call<Overview>(authFetch, 'GET', '')
      .then((d) => {
        setOv(d);
        if (!d.deployment || d.deployment.status === 'draft')
          setTab((t) => (t === 'deck' && role === 'admin' ? 'setup' : t));
      })
      .catch((e) => setErr((e as Error).message));
  }, [authFetch, role]);
  useEffect(() => {
    load();
  }, [load]);
  const canManage =
    role === 'admin' || role === 'supervisor' || Boolean(ov?.canManageKeys);
  const visible = TABS.filter(([k]) =>
    k === 'setup'
      ? role === 'admin' || ov?.canManageKeys
      : k === 'leads'
        ? canManage
        : true,
  );

  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-6xl mx-auto">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Phone size={16} className="text-sky-600" /> AI Call Center
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              AI receptionist, sales and support agents on your own phone
              number, with live supervision, QA grading and HighLevel sync.
              {ov?.deployment?.status === 'live' && (
                <>
                  {' '}
                  · Live on <strong>{ov.deployment.phoneNumber}</strong>
                </>
              )}
            </p>
          </div>
          <button className={ghost} onClick={load}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        {err && (
          <div className="p-3 rounded-lg text-xs mb-4 bg-red-50 text-red-600">
            {err}
          </div>
        )}
        {ov && !ov.ghl && (
          <div className="p-4 rounded-xl mb-4 bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2">
            <Settings2 size={14} /> Connect this workspace to GoHighLevel first
            (Integrations → GoHighLevel). The call center books appointments and
            updates contacts there.
          </div>
        )}
        {ov && (
          <>
            <div className="flex flex-wrap gap-2 mb-5">
              {visible.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg ${tab === k ? 'bg-sky-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === 'deck' && (
              <Deck
                authFetch={authFetch}
                canManage={canManage}
                pollMs={ov.pollMs}
              />
            )}
            {tab === 'history' && <History authFetch={authFetch} />}
            {tab === 'leads' && <Leads authFetch={authFetch} />}
            {tab === 'reports' && <Reports authFetch={authFetch} />}
            {tab === 'setup' && ov.ghl && (
              <Setup authFetch={authFetch} ov={ov} reload={load} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
