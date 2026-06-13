import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import ArticleEditor from '../components/ArticleEditor';
import CrawlerModal from '../components/CrawlerModal';

/**
 * KnowledgeBase.jsx
 * Atelier OmniCore — Knowledge Base page
 *
 * Layout:
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  Toolbar: search · filter · [Crawl URL] · [New Article] │
 *  ├──────────────┬──────────────────────────────────────────┤
 *  │ Article list │ ArticleEditor (inline panel)             │
 *  └──────────────┴──────────────────────────────────────────┘
 */

const API_URL = import.meta.env.VITE_API_URL || '/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function VectorBadge({ isVectorized }) {
  return isVectorized ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
      </svg>
      Indexed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
      Pending
    </span>
  );
}

function Spinner({ size = 'md' }) {
  const sz = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6';
  return (
    <svg className={`animate-spin ${sz} text-violet-600`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
  );
}

function EmptyState({ onNew, onCrawl }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4 py-20 text-slate-400">
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-14 h-14 opacity-20">
        <path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"/>
      </svg>
      <div className="text-center">
        <p className="text-sm font-semibold text-slate-600 mb-1">No articles yet</p>
        <p className="text-xs text-slate-400">Create your first article or crawl a website to populate the knowledge base.</p>
      </div>
      <div className="flex gap-2 mt-2">
        <button onClick={onCrawl}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-slate-400">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
          </svg>
          Crawl Website
        </button>
        <button onClick={onNew}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          New Article
        </button>
      </div>
    </div>
  );
}

// ─── Article row ──────────────────────────────────────────────────────────────
function ArticleRow({ article, isActive, onSelect, onDelete, deleting }) {
  return (
    <div
      onClick={() => onSelect(article)}
      className={`group flex items-start gap-3 px-5 py-4 border-b border-slate-100 cursor-pointer
        hover:bg-slate-50 transition-colors
        ${isActive ? 'bg-violet-50 border-l-[3px] border-l-violet-600' : ''}`}
    >
      {/* Visibility icon */}
      <div className={`mt-0.5 shrink-0 w-7 h-7 rounded-lg flex items-center justify-center
        ${article.is_public ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
        {article.is_public ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
          </svg>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{article.title}</p>
        <p className="text-xs text-slate-500 truncate mt-0.5">
          {article.plain_text_content?.slice(0, 90) || 'No content yet…'}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <VectorBadge isVectorized={article.is_vectorized} />
          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold
            ${article.is_public ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {article.is_public ? 'Public' : 'Internal'}
          </span>
          <span className="text-[10px] text-slate-400">{fmtDate(article.updated_at)}</span>
        </div>
      </div>

      {/* Delete button — appears on hover */}
      <button
        onClick={e => { e.stopPropagation(); onDelete(article.id); }}
        disabled={deleting === article.id}
        className="opacity-0 group-hover:opacity-100 shrink-0 p-1.5 rounded-lg text-slate-400
                   hover:text-red-500 hover:bg-red-50 transition-all"
        aria-label="Delete article"
      >
        {deleting === article.id ? <Spinner size="sm" /> : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z"/>
          </svg>
        )}
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function KnowledgeBase() {
  const { authFetch } = useAuth();

  const [articles,    setArticles]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [filterVisib, setFilterVisib] = useState('all');   // 'all' | 'public' | 'internal'
  const [filterIndex, setFilterIndex] = useState('all');   // 'all' | 'indexed' | 'pending'
  const [activeArt,   setActiveArt]   = useState(null);    // article being edited
  const [isNewMode,   setIsNewMode]   = useState(false);
  const [crawlerOpen, setCrawlerOpen] = useState(false);
  const [deleting,    setDeleting]    = useState(null);
  const [saveStatus,  setSaveStatus]  = useState('');      // '' | 'saving' | 'saved' | 'error'

  // ── Fetch articles ──────────────────────────────────────────────────────────
  const loadArticles = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await authFetch(`${API_URL}/knowledge-articles`);
      const data = await res.json();
      setArticles(Array.isArray(data) ? data : data.rows || []);
    } catch (err) {
      console.error('[KB] load error', err);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => { loadArticles(); }, [loadArticles]);

  // ── Filtered view ───────────────────────────────────────────────────────────
  const filtered = articles.filter(a => {
    if (search) {
      const q = search.toLowerCase();
      if (!a.title?.toLowerCase().includes(q) && !a.plain_text_content?.toLowerCase().includes(q))
        return false;
    }
    if (filterVisib === 'public'   && !a.is_public)   return false;
    if (filterVisib === 'internal' &&  a.is_public)   return false;
    if (filterIndex === 'indexed'  && !a.is_vectorized) return false;
    if (filterIndex === 'pending'  &&  a.is_vectorized) return false;
    return true;
  });

  // ── Save article ────────────────────────────────────────────────────────────
  const handleSave = useCallback(async (data) => {
    setSaveStatus('saving');
    try {
      const isNew = !data.id;
      const url   = isNew
        ? `${API_URL}/knowledge-articles`
        : `${API_URL}/knowledge-articles/${data.id}`;
      const res   = await authFetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        body:   JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Save failed');
      const saved = await res.json();
      setArticles(prev =>
        isNew
          ? [saved, ...prev]
          : prev.map(a => a.id === saved.id ? saved : a)
      );
      setActiveArt(saved);
      setIsNewMode(false);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2500);
    } catch (err) {
      console.error('[KB] save error', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 3000);
    }
  }, [authFetch]);

  // ── Delete article ──────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (id) => {
    if (!confirm('Delete this article? This also removes all its embeddings.')) return;
    setDeleting(id);
    try {
      await authFetch(`${API_URL}/knowledge-articles/${id}`, { method: 'DELETE' });
      setArticles(prev => prev.filter(a => a.id !== id));
      if (activeArt?.id === id) { setActiveArt(null); setIsNewMode(false); }
    } catch (err) {
      console.error('[KB] delete error', err);
    } finally {
      setDeleting(null);
    }
  }, [authFetch, activeArt]);

  // ── Crawler done callback ───────────────────────────────────────────────────
  const handleCrawlComplete = useCallback(() => {
    setCrawlerOpen(false);
    loadArticles();
  }, [loadArticles]);

  const openNew = () => { setActiveArt(null); setIsNewMode(true); };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex flex-wrap items-center gap-3 px-6 py-4 bg-white border-b border-slate-200">
        <div className="flex-1 min-w-[200px] relative">
          <svg viewBox="0 0 24 24" fill="currentColor"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input
            type="search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search articles…"
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-100 border border-transparent rounded-xl
                       outline-none focus:bg-white focus:border-violet-400 focus:ring-2 focus:ring-violet-200
                       placeholder:text-slate-400"
          />
        </div>

        {/* Visibility filter */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {[['all','All'],['public','Public'],['internal','Internal']].map(([v, l]) => (
            <button key={v} onClick={() => setFilterVisib(v)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                ${filterVisib === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {l}
            </button>
          ))}
        </div>

        {/* Index filter */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {[['all','All'],['indexed','Indexed'],['pending','Pending']].map(([v, l]) => (
            <button key={v} onClick={() => setFilterIndex(v)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                ${filterIndex === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="flex-1 hidden sm:block" />

        {/* Crawl button */}
        <button onClick={() => setCrawlerOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white
                     text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-slate-400">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
          </svg>
          Crawl URL
        </button>

        {/* New article button */}
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 text-white
                     text-sm font-semibold hover:bg-violet-700 transition-colors shadow-sm">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          New Article
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Article list */}
        <div className={`flex flex-col overflow-hidden border-r border-slate-200 bg-white
          transition-all duration-200
          ${activeArt || isNewMode ? 'w-[320px] shrink-0' : 'flex-1'}`}>

          {/* List stats */}
          {!loading && articles.length > 0 && (
            <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <p className="text-xs text-slate-500">
                {filtered.length} of {articles.length} article{articles.length !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-slate-400">
                {articles.filter(a => a.is_vectorized).length} indexed
              </p>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center pt-16"><Spinner /></div>
          ) : filtered.length === 0 && articles.length === 0 ? (
            <EmptyState onNew={openNew} onCrawl={() => setCrawlerOpen(true)} />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
              <p className="text-sm">No articles match your filters.</p>
              <button onClick={() => { setSearch(''); setFilterVisib('all'); setFilterIndex('all'); }}
                className="text-xs text-violet-600 hover:underline">Clear filters</button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {filtered.map(a => (
                <ArticleRow
                  key={a.id}
                  article={a}
                  isActive={activeArt?.id === a.id}
                  onSelect={art => { setActiveArt(art); setIsNewMode(false); }}
                  onDelete={handleDelete}
                  deleting={deleting}
                />
              ))}
            </div>
          )}
        </div>

        {/* Editor panel */}
        {(activeArt || isNewMode) && (
          <div className="flex-1 min-w-0 h-full overflow-hidden">
            <ArticleEditor
              article={activeArt}
              isNew={isNewMode}
              saveStatus={saveStatus}
              onSave={handleSave}
              onClose={() => { setActiveArt(null); setIsNewMode(false); }}
            />
          </div>
        )}
      </div>

      {/* Crawler modal */}
      {crawlerOpen && (
        <CrawlerModal
          onClose={() => setCrawlerOpen(false)}
          onComplete={handleCrawlComplete}
        />
      )}
    </div>
  );
}
