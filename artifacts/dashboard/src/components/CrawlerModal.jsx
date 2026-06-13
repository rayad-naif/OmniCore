import { useState, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * CrawlerModal.jsx
 * Atelier OmniCore — Web crawler trigger modal
 *
 * States:
 *  idle      → URL input + config sliders
 *  crawling  → animated progress bar + live stats feed
 *  done      → summary (pages crawled, vectorised, errors)
 *  error     → error message + retry
 *
 * Calls POST /api/crawler/start  →  streams SSE progress
 * or polls GET /api/crawler/job/:jobId if SSE is not available
 */

const API_URL = import.meta.env.VITE_API_URL || '/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isValidUrl(str) {
  try { const u = new URL(str); return u.protocol === 'https:' || u.protocol === 'http:'; }
  catch { return false; }
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner({ size = 'md' }) {
  const sz = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <svg className={`animate-spin ${sz} text-violet-600`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
function ProgressBar({ value, max, color = 'violet' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const colors = { violet: 'bg-violet-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-400' };
  return (
    <div className="w-full">
      <div className="flex justify-between text-[11px] text-slate-500 mb-1.5">
        <span>{value} / {max}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${colors[color]}`}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Stat chip ────────────────────────────────────────────────────────────────
function StatChip({ icon, label, value, color = 'slate' }) {
  const colors = {
    slate:   'bg-slate-100 text-slate-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    red:     'bg-red-100 text-red-700',
    violet:  'bg-violet-100 text-violet-700',
  };
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${colors[color]}`}>
      <span className="text-base">{icon}</span>
      <div>
        <p className="text-[10px] font-medium opacity-70 leading-none">{label}</p>
        <p className="text-sm font-bold leading-tight">{value}</p>
      </div>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────
export default function CrawlerModal({ onClose, onComplete }) {
  const { authFetch } = useAuth();

  const [phase, setPhase]         = useState('idle');      // 'idle' | 'crawling' | 'done' | 'error'
  const [url, setUrl]             = useState('');
  const [urlError, setUrlError]   = useState('');
  const [maxDepth, setMaxDepth]   = useState(2);
  const [maxPages, setMaxPages]   = useState(30);

  // Progress state
  const [stats, setStats]         = useState({ crawled: 0, vectorised: 0, errors: 0 });
  const [currentUrl, setCurrentUrl] = useState('');
  const [log, setLog]             = useState([]);          // [ { type, text, ts } ]
  const [finalStats, setFinalStats] = useState(null);
  const [errorMsg, setErrorMsg]   = useState('');

  const abortRef  = useRef(null);
  const logEndRef = useRef(null);

  // Auto-scroll log
  const appendLog = useCallback((type, text) => {
    setLog(prev => [...prev.slice(-99), { type, text, ts: new Date().toLocaleTimeString() }]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  // ── Start crawl ─────────────────────────────────────────────────────────────
  const startCrawl = async () => {
    if (!isValidUrl(url)) { setUrlError('Enter a valid https:// URL'); return; }
    setUrlError('');
    setPhase('crawling');
    setStats({ crawled: 0, vectorised: 0, errors: 0 });
    setLog([]);
    setCurrentUrl(url);
    appendLog('info', `Starting crawl of ${url}`);

    try {
      // Attempt SSE streaming first
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const res = await authFetch(`${API_URL}/crawler/start`, {
        method: 'POST',
        body:   JSON.stringify({ url, maxDepth, maxPages }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        // ── SSE streaming ────────────────────────────────────────────────────
        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const block of lines) {
            const dataLine = block.split('\n').find(l => l.startsWith('data:'));
            if (!dataLine) continue;
            try {
              const ev = JSON.parse(dataLine.slice(5));
              handleProgressEvent(ev);
            } catch { /* skip malformed */ }
          }
        }
      } else {
        // ── JSON response (non-streaming fallback) ───────────────────────────
        const data = await res.json();
        if (data.jobId) {
          // Poll for job completion
          await pollJobProgress(data.jobId, ctrl.signal);
        } else if (data.stats) {
          setFinalStats(data.stats);
          setPhase('done');
          appendLog('success', `Crawl complete: ${data.stats.crawled} pages, ${data.stats.vectorised} indexed`);
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        appendLog('warn', 'Crawl cancelled by user');
        setPhase('idle');
        return;
      }
      setErrorMsg(err.message || 'Crawl failed');
      setPhase('error');
      appendLog('error', `Error: ${err.message}`);
    }
  };

  // ── Handle SSE progress event ───────────────────────────────────────────────
  const handleProgressEvent = useCallback((ev) => {
    if (ev.type === 'progress' || ev.crawled !== undefined) {
      setStats({ crawled: ev.crawled || 0, vectorised: ev.vectorised || 0, errors: ev.errors || 0 });
      if (ev.currentUrl) { setCurrentUrl(ev.currentUrl); appendLog('info', `Crawled: ${ev.currentUrl}`); }
    } else if (ev.type === 'complete' || ev.done) {
      const s = ev.stats || ev;
      setFinalStats({ crawled: s.crawled || 0, vectorised: s.vectorised || 0, errors: s.errors || 0 });
      setPhase('done');
      appendLog('success', `Finished: ${s.crawled} pages crawled, ${s.vectorised} vectorised`);
    } else if (ev.type === 'error') {
      setErrorMsg(ev.message || 'Crawl error');
      setPhase('error');
      appendLog('error', ev.message || 'Crawl error');
    } else if (ev.type === 'log') {
      appendLog('info', ev.message);
    }
  }, [appendLog]);

  // ── Poll BullMQ job ─────────────────────────────────────────────────────────
  const pollJobProgress = async (jobId, signal) => {
    const POLL_MS = 1500;
    let done = false;
    while (!done) {
      await new Promise(r => setTimeout(r, POLL_MS));
      if (signal.aborted) break;
      try {
        const res  = await authFetch(`${API_URL}/crawler/job/${jobId}`);
        const data = await res.json();
        if (data.progress) {
          setStats({
            crawled:    data.progress.crawled    || 0,
            vectorised: data.progress.vectorised || 0,
            errors:     data.progress.errors     || 0,
          });
          if (data.progress.currentUrl) setCurrentUrl(data.progress.currentUrl);
        }
        if (data.status === 'completed') {
          setFinalStats(data.result || data.progress || {});
          setPhase('done');
          appendLog('success', 'Job completed');
          done = true;
        } else if (data.status === 'failed') {
          throw new Error(data.error || 'Job failed');
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          setErrorMsg(err.message);
          setPhase('error');
          appendLog('error', err.message);
        }
        done = true;
      }
    }
  };

  const cancelCrawl = () => {
    abortRef.current?.abort();
  };

  const reset = () => {
    setPhase('idle');
    setStats({ crawled: 0, vectorised: 0, errors: 0 });
    setLog([]);
    setFinalStats(null);
    setErrorMsg('');
    setCurrentUrl('');
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-violet-600">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Crawl Website</h2>
              <p className="text-xs text-slate-500">Extract and index content from any URL</p>
            </div>
          </div>
          <button onClick={phase === 'crawling' ? cancelCrawl : onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── IDLE: config form ─────────────────────────────────────────── */}
          {phase === 'idle' && (
            <div className="space-y-5">
              {/* URL input */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Starting URL
                </label>
                <input
                  type="url" value={url} onChange={e => { setUrl(e.target.value); setUrlError(''); }}
                  placeholder="https://example.com"
                  className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition
                    focus:ring-2 focus:ring-violet-400 focus:border-violet-400
                    ${urlError ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white'}`}
                  onKeyDown={e => e.key === 'Enter' && startCrawl()}
                />
                {urlError && <p className="mt-1.5 text-xs text-red-600">⚠ {urlError}</p>}
                <p className="mt-1.5 text-xs text-slate-400">
                  The crawler will follow internal links starting from this page.
                </p>
              </div>

              {/* Depth slider */}
              <div>
                <div className="flex justify-between mb-1.5">
                  <label className="text-sm font-medium text-slate-700">Crawl depth</label>
                  <span className="text-sm font-semibold text-violet-600">{maxDepth}</span>
                </div>
                <input type="range" min={1} max={4} value={maxDepth}
                  onChange={e => setMaxDepth(Number(e.target.value))}
                  className="w-full accent-violet-600 cursor-pointer" />
                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                  <span>1 (shallow)</span><span>4 (deep)</span>
                </div>
              </div>

              {/* Max pages slider */}
              <div>
                <div className="flex justify-between mb-1.5">
                  <label className="text-sm font-medium text-slate-700">Max pages</label>
                  <span className="text-sm font-semibold text-violet-600">{maxPages}</span>
                </div>
                <input type="range" min={5} max={100} step={5} value={maxPages}
                  onChange={e => setMaxPages(Number(e.target.value))}
                  className="w-full accent-violet-600 cursor-pointer" />
                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                  <span>5</span><span>100</span>
                </div>
              </div>

              {/* Info banner */}
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0 mt-0.5 text-blue-500">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                </svg>
                <p>Pages are chunked into ~500-word segments and embedded into your brand's vector index. Only same-origin URLs are followed. Respects <code className="font-mono bg-blue-100 px-1 rounded">X-Robots-Tag: noindex</code>.</p>
              </div>
            </div>
          )}

          {/* ── CRAWLING: live progress ───────────────────────────────────── */}
          {phase === 'crawling' && (
            <div className="space-y-5">
              {/* Animated status */}
              <div className="flex items-center gap-3">
                <Spinner />
                <div>
                  <p className="text-sm font-semibold text-slate-800">Crawling in progress…</p>
                  <p className="text-xs text-slate-400">Scanning pages and building vector embeddings</p>
                </div>
              </div>

              {/* Stats chips */}
              <div className="grid grid-cols-3 gap-2">
                <StatChip icon="🔍" label="Crawled"    value={stats.crawled}    color="violet"  />
                <StatChip icon="✅" label="Indexed"    value={stats.vectorised} color="emerald" />
                <StatChip icon="⚠️" label="Errors"    value={stats.errors}     color={stats.errors > 0 ? 'red' : 'slate'} />
              </div>

              {/* Progress bar */}
              <ProgressBar value={stats.crawled} max={maxPages} color="violet" />

              {/* Current URL */}
              {currentUrl && (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse shrink-0" />
                  <p className="text-[11px] text-slate-500 truncate font-mono">{currentUrl}</p>
                </div>
              )}

              {/* Live log */}
              <div className="bg-slate-900 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <span className="text-[10px] text-slate-400 ml-2 font-mono">crawler.log</span>
                </div>
                <div className="h-40 overflow-y-auto px-4 py-3 font-mono text-[11px] space-y-1">
                  {log.map((entry, i) => (
                    <div key={i} className={`flex gap-2 ${
                      entry.type === 'error'   ? 'text-red-400'    :
                      entry.type === 'success' ? 'text-emerald-400':
                      entry.type === 'warn'    ? 'text-amber-400'  : 'text-slate-300'
                    }`}>
                      <span className="text-slate-600 shrink-0">{entry.ts}</span>
                      <span className="break-all">{entry.text}</span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </div>
            </div>
          )}

          {/* ── DONE: summary ─────────────────────────────────────────────── */}
          {phase === 'done' && finalStats && (
            <div className="space-y-5">
              <div className="flex flex-col items-center gap-2 py-4">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-emerald-600">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                  </svg>
                </div>
                <p className="text-sm font-bold text-slate-900">Crawl complete!</p>
                <p className="text-xs text-slate-500">Your knowledge base has been updated.</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <StatChip icon="📄" label="Pages crawled" value={finalStats.crawled    ?? 0} color="violet"  />
                <StatChip icon="🧠" label="Indexed"        value={finalStats.vectorised ?? 0} color="emerald" />
                <StatChip icon="⚠️" label="Errors"         value={finalStats.errors     ?? 0} color={finalStats.errors > 0 ? 'red' : 'slate'} />
              </div>

              {finalStats.errors > 0 && (
                <div className="px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                  <p className="font-medium mb-0.5">Some pages were skipped</p>
                  <p>This is normal — pages may have been blocked by robots.txt, returned non-HTML content, or timed out.</p>
                </div>
              )}

              {/* Show tail of log */}
              {log.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 select-none">
                    View crawler log ({log.length} entries)
                  </summary>
                  <div className="mt-2 bg-slate-900 rounded-xl h-32 overflow-y-auto px-4 py-3 font-mono text-[11px] space-y-1">
                    {log.map((e, i) => (
                      <div key={i} className={`${e.type === 'error' ? 'text-red-400' : e.type === 'success' ? 'text-emerald-400' : 'text-slate-300'}`}>
                        <span className="text-slate-600">{e.ts} </span>{e.text}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* ── ERROR ─────────────────────────────────────────────────────── */}
          {phase === 'error' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-2 py-4">
                <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-red-500">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                  </svg>
                </div>
                <p className="text-sm font-bold text-slate-900">Crawl failed</p>
                <p className="text-xs text-red-600 text-center">{errorMsg}</p>
              </div>

              {log.length > 0 && (
                <div className="bg-slate-900 rounded-xl h-32 overflow-y-auto px-4 py-3 font-mono text-[11px] space-y-1">
                  {log.slice(-20).map((e, i) => (
                    <div key={i} className={e.type === 'error' ? 'text-red-400' : 'text-slate-300'}>
                      {e.ts} {e.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="shrink-0 flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50">
          {phase === 'idle' && (
            <>
              <button onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors">
                Cancel
              </button>
              <button onClick={startCrawl} disabled={!url.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold
                           hover:bg-violet-700 disabled:bg-slate-300 disabled:text-slate-500 transition-colors shadow-sm">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                Start Crawl
              </button>
            </>
          )}

          {phase === 'crawling' && (
            <button onClick={cancelCrawl}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 bg-white
                         text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M6 6h12v12H6z"/>
              </svg>
              Cancel Crawl
            </button>
          )}

          {phase === 'done' && (
            <>
              <button onClick={reset}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors">
                Crawl Another
              </button>
              <button onClick={onComplete}
                className="px-5 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold
                           hover:bg-violet-700 transition-colors shadow-sm">
                View Articles
              </button>
            </>
          )}

          {phase === 'error' && (
            <>
              <button onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-200">
                Close
              </button>
              <button onClick={reset}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold
                           hover:bg-violet-700 transition-colors">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                </svg>
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
