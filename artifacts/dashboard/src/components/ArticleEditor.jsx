import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * ArticleEditor.jsx
 * Atelier OmniCore — Knowledge article rich-text editor
 *
 * Features:
 *  - Title field
 *  - Rich-text body (contenteditable div with toolbar commands)
 *  - Public / Internal visibility toggle
 *  - Auto-save with debounce (3 s after last keystroke)
 *  - Manual Save button with status indicator
 *  - "Vectorise Now" — triggers POST /api/knowledge-articles/:id/vectorise
 *  - Preview tab — renders article HTML as it appears in the Help Center
 *
 * Note: For production use replace the contenteditable implementation
 * with Tiptap or Quill for full collaborative editing, history, etc.
 */

const API_URL = import.meta.env.VITE_API_URL || '/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ─── Toolbar button ───────────────────────────────────────────────────────────
function ToolBtn({ command, value, title, children, onClick }) {
  const handleClick = (e) => {
    e.preventDefault();
    if (onClick) { onClick(); return; }
    document.execCommand(command, false, value || null);
  };
  return (
    <button
      onMouseDown={handleClick}
      title={title}
      className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-200 hover:text-slate-900
                 transition-colors text-sm leading-none select-none"
    >
      {children}
    </button>
  );
}

function ToolDivider() {
  return <div className="w-px h-5 bg-slate-300 mx-0.5" />;
}

// ─── Save status pill ─────────────────────────────────────────────────────────
function SavePill({ status }) {
  if (!status) return null;
  const map = {
    saving: { text: 'Saving…',    cls: 'bg-slate-100 text-slate-500' },
    saved:  { text: '✓ Saved',   cls: 'bg-emerald-100 text-emerald-700' },
    error:  { text: '✗ Error',   cls: 'bg-red-100 text-red-600' },
  };
  const s = map[status];
  return <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${s.cls}`}>{s.text}</span>;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner({ size = 'sm' }) {
  return (
    <svg className={`animate-spin ${size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-violet-600`}
      viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
  );
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────
function EditorToolbar({ onInsertLink }) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 px-3 py-2 border-b border-slate-200 bg-slate-50">
      {/* Text style */}
      <ToolBtn command="bold"      title="Bold (⌘B)">      <b className="text-xs">B</b>          </ToolBtn>
      <ToolBtn command="italic"    title="Italic (⌘I)">    <i className="text-xs">I</i>          </ToolBtn>
      <ToolBtn command="underline" title="Underline (⌘U)"> <u className="text-xs">U</u>          </ToolBtn>
      <ToolBtn command="strikeThrough" title="Strikethrough">
        <s className="text-xs">S</s>
      </ToolBtn>

      <ToolDivider />

      {/* Headings */}
      <ToolBtn command="formatBlock" value="h2" title="Heading 2">
        <span className="text-xs font-bold">H2</span>
      </ToolBtn>
      <ToolBtn command="formatBlock" value="h3" title="Heading 3">
        <span className="text-xs font-bold">H3</span>
      </ToolBtn>
      <ToolBtn command="formatBlock" value="p" title="Paragraph">
        <span className="text-xs">¶</span>
      </ToolBtn>

      <ToolDivider />

      {/* Lists */}
      <ToolBtn command="insertUnorderedList" title="Bullet list">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z"/>
        </svg>
      </ToolBtn>
      <ToolBtn command="insertOrderedList" title="Numbered list">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/>
        </svg>
      </ToolBtn>
      <ToolBtn command="formatBlock" value="blockquote" title="Blockquote">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>
        </svg>
      </ToolBtn>

      <ToolDivider />

      {/* Link */}
      <ToolBtn title="Insert link" onClick={onInsertLink}>
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
        </svg>
      </ToolBtn>

      {/* Code block */}
      <ToolBtn command="formatBlock" value="pre" title="Code block">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
        </svg>
      </ToolBtn>

      <ToolDivider />

      {/* Clear formatting */}
      <ToolBtn command="removeFormat" title="Clear formatting">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M3.27 5L2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.27 5zM6 5v.18L8.82 8h2.4l-.72 1.68 2.1 2.1L14.21 8H20V5H6z"/>
        </svg>
      </ToolBtn>
    </div>
  );
}

// ─── ArticleEditor ────────────────────────────────────────────────────────────
export default function ArticleEditor({ article, isNew, saveStatus: externalSaveStatus, onSave, onClose }) {
  const { authFetch } = useAuth();

  const [title,        setTitle]       = useState('');
  const [isPublic,     setIsPublic]    = useState(false);
  const [activeTab,    setActiveTab]   = useState('write');  // 'write' | 'preview'
  const [vectorising,  setVectorising] = useState(false);
  const [vectorDone,   setVectorDone]  = useState(false);
  const [dirty,        setDirty]       = useState(false);

  const editorRef     = useRef(null);
  const autoSaveRef   = useRef(null);

  // ── Populate editor when article prop changes ─────────────────────────────
  useEffect(() => {
    const a = article;
    setTitle(a?.title || '');
    setIsPublic(a?.is_public || false);
    setVectorDone(a?.is_vectorized || false);
    setDirty(false);
    if (editorRef.current) {
      editorRef.current.innerHTML = a?.public_html_content || '';
    }
  }, [article?.id]); // eslint-disable-line

  // ── Auto-save debounce ────────────────────────────────────────────────────
  const triggerAutoSave = useCallback(
    debounce(() => {
      if (!dirty) return;
      collectAndSave(false);
    }, 3000),
    [dirty] // eslint-disable-line
  );

  function markDirty() {
    setDirty(true);
    triggerAutoSave();
  }

  function collectAndSave(manual = true) {
    if (!title.trim()) { if (manual) alert('Title is required'); return; }
    const htmlContent  = editorRef.current?.innerHTML  || '';
    const plainContent = editorRef.current?.innerText  || '';
    onSave({
      id:                  article?.id,
      title:               title.trim(),
      public_html_content: htmlContent,
      plain_text_content:  plainContent,
      is_public:           isPublic,
    });
    setDirty(false);
  }

  // ── Insert link ───────────────────────────────────────────────────────────
  function handleInsertLink() {
    const url  = prompt('URL:');
    if (!url) return;
    const text = prompt('Link text (optional):') || url;
    document.execCommand('insertHTML', false, `<a href="${url}" target="_blank">${text}</a>`);
    markDirty();
  }

  // ── Vectorise ─────────────────────────────────────────────────────────────
  async function handleVectorise() {
    if (!article?.id) { alert('Save the article first before indexing.'); return; }
    setVectorising(true);
    try {
      const res = await authFetch(`${API_URL}/knowledge-articles/${article.id}/vectorise`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setVectorDone(true);
    } catch (err) {
      alert('Vectorisation failed: ' + err.message);
    } finally {
      setVectorising(false);
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  function handleKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      collectAndSave(true);
    }
  }

  const hasChanges = dirty;
  const saveStatus = externalSaveStatus;

  return (
    <div className="flex flex-col h-full bg-white" onKeyDown={handleKeyDown}>
      {/* ── Editor header ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {/* Tab switcher */}
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            {['write', 'preview'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors
                  ${activeTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {tab}
              </button>
            ))}
          </div>

          {/* Dirty indicator */}
          {hasChanges && !saveStatus && (
            <span className="text-[10px] text-amber-600 font-medium">● Unsaved changes</span>
          )}
          <SavePill status={saveStatus} />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Vectorise button */}
          {article?.id && (
            <button
              onClick={handleVectorise}
              disabled={vectorising || vectorDone}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all
                ${vectorDone
                  ? 'bg-emerald-100 text-emerald-700 cursor-default'
                  : vectorising
                    ? 'bg-violet-100 text-violet-600 cursor-wait'
                    : 'bg-slate-100 text-slate-600 hover:bg-violet-100 hover:text-violet-700'}`}
            >
              {vectorising ? <Spinner size="sm" /> : (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95A5.469 5.469 0 0112 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11A2.98 2.98 0 0122 15c0 1.65-1.35 3-3 3z"/>
                </svg>
              )}
              {vectorDone ? '✓ Indexed' : vectorising ? 'Indexing…' : 'Index Now'}
            </button>
          )}

          {/* Public / Internal toggle */}
          <button
            onClick={() => { setIsPublic(p => !p); markDirty(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all
              ${isPublic
                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {isPublic ? (
              <>
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                </svg>
                Public
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                </svg>
                Internal
              </>
            )}
          </button>

          {/* Save */}
          <button
            onClick={() => collectAndSave(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-violet-600 text-white
                       text-xs font-semibold hover:bg-violet-700 transition-colors shadow-sm"
          >
            {saveStatus === 'saving' ? <Spinner size="sm" /> : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
              </svg>
            )}
            {saveStatus === 'saving' ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </button>

          {/* Close */}
          <button onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Title ──────────────────────────────────────────────────────────── */}
      <div className="px-8 pt-6 pb-2 shrink-0">
        <input
          type="text"
          value={title}
          onChange={e => { setTitle(e.target.value); markDirty(); }}
          placeholder="Article title…"
          className="w-full text-2xl font-bold text-slate-900 placeholder:text-slate-300
                     outline-none border-b-2 border-transparent focus:border-violet-400
                     transition-colors pb-2 bg-transparent"
        />
        <div className="flex items-center gap-3 mt-2">
          <span className={`inline-flex items-center gap-1 text-xs font-medium
            ${isPublic ? 'text-emerald-600' : 'text-slate-400'}`}>
            {isPublic
              ? <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Published to Help Center</>
              : <><span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Internal only</>
            }
          </span>
          {vectorDone && (
            <span className="text-xs text-violet-600 font-medium flex items-center gap-1">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
              </svg>
              AI indexed
            </span>
          )}
        </div>
      </div>

      {/* ── Write / Preview tabs ────────────────────────────────────────────── */}
      {activeTab === 'write' ? (
        <div className="flex flex-col flex-1 overflow-hidden mx-6 mb-6 mt-3
                        rounded-xl border border-slate-200 overflow-hidden">
          <EditorToolbar onInsertLink={handleInsertLink} />
          {/* contenteditable editor */}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={markDirty}
            className="flex-1 overflow-y-auto px-6 py-5 outline-none text-slate-800 text-sm leading-relaxed
                       prose prose-sm max-w-none
                       prose-headings:font-bold prose-headings:text-slate-900
                       prose-a:text-violet-600 prose-a:underline
                       prose-code:bg-slate-100 prose-code:px-1 prose-code:rounded
                       prose-blockquote:border-l-4 prose-blockquote:border-violet-300 prose-blockquote:pl-4
                       prose-pre:bg-slate-900 prose-pre:text-slate-200 prose-pre:rounded-xl
                       empty:before:content-[attr(data-placeholder)] empty:before:text-slate-300
                       empty:before:pointer-events-none empty:before:absolute"
            data-placeholder="Start writing your article…"
            style={{ minHeight: 300 }}
          />

          {/* Word count footer */}
          <div className="px-6 py-2 border-t border-slate-100 bg-slate-50 flex justify-between text-[11px] text-slate-400">
            <span>{editorRef.current?.innerText?.trim().split(/\s+/).filter(Boolean).length ?? 0} words</span>
            <span>⌘S to save</span>
          </div>
        </div>
      ) : (
        /* ── Preview tab ─────────────────────────────────────────────────── */
        <div className="flex-1 overflow-y-auto mx-6 mb-6 mt-3 rounded-xl border border-slate-200 bg-white">
          <div className="max-w-2xl mx-auto px-8 py-8">
            {/* Simulated Help Center header */}
            <div className="mb-6 pb-6 border-b border-slate-100">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
                <span>Help Center</span>
                <span>›</span>
                <span>Article</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900">{title || 'Untitled Article'}</h1>
              <div className="flex items-center gap-3 mt-3">
                {isPublic ? (
                  <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">
                    Public
                  </span>
                ) : (
                  <span className="text-xs text-slate-500 font-medium bg-slate-100 px-2 py-0.5 rounded-full">
                    Internal
                  </span>
                )}
              </div>
            </div>

            {/* Rendered HTML */}
            {editorRef.current?.innerHTML ? (
              <div
                className="prose prose-slate max-w-none text-sm
                           prose-headings:font-bold prose-headings:text-slate-900
                           prose-a:text-violet-600 prose-code:bg-slate-100 prose-code:px-1
                           prose-code:rounded prose-blockquote:border-l-4
                           prose-blockquote:border-violet-300 prose-pre:bg-slate-900
                           prose-pre:text-slate-200 prose-pre:rounded-xl"
                dangerouslySetInnerHTML={{ __html: editorRef.current?.innerHTML || '' }}
              />
            ) : (
              <p className="text-slate-400 text-sm italic">Nothing to preview yet.</p>
            )}

            {/* Help Center footer */}
            <div className="mt-10 pt-6 border-t border-slate-100 text-center">
              <p className="text-sm text-slate-500 mb-3">Was this article helpful?</p>
              <div className="flex justify-center gap-2">
                <button className="px-4 py-1.5 rounded-xl border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">
                  👍 Yes
                </button>
                <button className="px-4 py-1.5 rounded-xl border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">
                  👎 No
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
