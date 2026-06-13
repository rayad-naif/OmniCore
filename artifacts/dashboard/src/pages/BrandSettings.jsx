import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * BrandSettings.jsx
 * Atelier OmniCore — Brand configuration page
 *
 * Sections:
 *  1. Identity       — display name, logo upload (R2 pre-signed PUT)
 *  2. Widget Theme   — primary HEX, accent HEX, live preview bubble
 *  3. Email Routing  — unique inbound email prefix (read-only suffix appended)
 *  4. CORS Origins   — tag-input array, validated URLs
 *  5. AI System Prompt — textarea for brand-scoped Gemini system instructions
 *
 * Persistence: PATCH /api/brands/:brandId
 * Logo upload:  POST /api/brands/:brandId/logo-upload-url → presigned PUT → R2
 */

const API_URL = import.meta.env.VITE_API_URL || '/api';
const EMAIL_SUFFIX = '@inbound.omnicore.app';
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const URL_RE = /^https?:\/\/.+/;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isValidHex(v) { return HEX_RE.test(v); }
function isValidOrigin(v) { return URL_RE.test(v.trim()); }

function hexToRgb(hex) {
  const full = hex.length === 4
    ? '#' + [...hex.slice(1)].map(c => c + c).join('')
    : hex;
  const n = parseInt(full.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luminance({ r, g, b }) {
  const toLinear = c => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastColor(hex) {
  if (!isValidHex(hex)) return '#ffffff';
  return luminance(hexToRgb(hex)) > 0.179 ? '#111827' : '#ffffff';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner({ size = 'sm' }) {
  const sz = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <svg className={`animate-spin ${sz} text-violet-600`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
  );
}

function SectionCard({ title, description, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      <div className="px-6 py-5 space-y-5">{children}</div>
    </div>
  );
}

function Field({ label, hint, error, children }) {
  return (
    <div>
      {label && <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>}
      {children}
      {hint  && !error && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
      {error && <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">⚠ {error}</p>}
    </div>
  );
}

// ── HEX color input with inline swatch ────────────────────────────────────────
function HexInput({ label, value, onChange, hint }) {
  const [raw, setRaw]   = useState(value);
  const [err, setErr]   = useState('');
  const nativeRef       = useRef(null);

  useEffect(() => { setRaw(value); }, [value]);

  function handleText(e) {
    const v = e.target.value;
    setRaw(v);
    if (!v) { setErr(''); return; }
    if (!isValidHex(v)) { setErr('Must be a valid hex colour, e.g. #6366f1'); return; }
    setErr('');
    onChange(v);
  }

  function handleNative(e) {
    const v = e.target.value;
    setRaw(v); setErr(''); onChange(v);
  }

  const valid = isValidHex(raw);

  return (
    <Field label={label} hint={hint} error={err}>
      <div className="flex items-center gap-3">
        {/* Native colour picker hidden behind swatch */}
        <button
          type="button"
          onClick={() => nativeRef.current?.click()}
          className="w-10 h-10 rounded-xl border-2 border-white shadow-md shrink-0 transition-transform hover:scale-110"
          style={{ background: valid ? raw : '#e2e8f0' }}
          aria-label="Open colour picker"
        />
        <input
          ref={nativeRef}
          type="color"
          value={valid ? raw : '#6366f1'}
          onChange={handleNative}
          className="sr-only"
          aria-hidden="true"
        />
        <input
          type="text"
          value={raw}
          onChange={handleText}
          maxLength={7}
          placeholder="#6366f1"
          className={`w-32 px-3 py-2 rounded-xl border text-sm font-mono outline-none
            focus:ring-2 focus:ring-violet-400 focus:border-violet-400 transition
            ${err ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white'}`}
        />
        {valid && (
          <span className="text-xs text-slate-500">
            rgb({hexToRgb(raw).r}, {hexToRgb(raw).g}, {hexToRgb(raw).b})
          </span>
        )}
      </div>
    </Field>
  );
}

// ── Logo uploader ─────────────────────────────────────────────────────────────
function LogoUploader({ brandId, currentLogoUrl, onUploaded, authFetch }) {
  const [uploading,  setUploading]  = useState(false);
  const [progress,   setProgress]   = useState(0);
  const [preview,    setPreview]    = useState(currentLogoUrl || '');
  const [error,      setError]      = useState('');
  const inputRef = useRef(null);

  useEffect(() => { setPreview(currentLogoUrl || ''); }, [currentLogoUrl]);

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Only image files are accepted.'); return; }
    if (file.size > 2 * 1024 * 1024)    { setError('Max logo size is 2 MB.'); return; }
    setError(''); setUploading(true); setProgress(0);

    // Local preview
    const reader = new FileReader();
    reader.onload = e => setPreview(e.target.result);
    reader.readAsDataURL(file);

    try {
      // 1. Get presigned PUT URL from backend
      const res  = await authFetch(`${API_URL}/brands/${brandId}/logo-upload-url`, {
        method: 'POST',
        body:   JSON.stringify({ fileName: file.name, fileType: file.type }),
      });
      if (!res.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl, publicUrl } = await res.json();

      // 2. PUT directly to R2
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload  = () => xhr.status < 300 ? resolve() : reject(new Error(`R2 HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error('Upload network error'));
        xhr.send(file);
      });

      setPreview(publicUrl);
      setProgress(100);
      onUploaded(publicUrl);
    } catch (err) {
      setError(err.message || 'Upload failed');
      setPreview(currentLogoUrl || '');
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <Field label="Brand Logo" hint="PNG or SVG recommended. Max 2 MB." error={error}>
      <div className="flex items-center gap-5">
        {/* Preview */}
        <div className="w-20 h-20 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50
                        flex items-center justify-center overflow-hidden shrink-0">
          {preview ? (
            <img src={preview} alt="Logo" className="w-full h-full object-contain" />
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-slate-300">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
            </svg>
          )}
        </div>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          className="flex-1 flex flex-col items-center gap-2 px-4 py-5 rounded-xl border-2 border-dashed
                     border-slate-200 bg-slate-50 hover:border-violet-400 hover:bg-violet-50 transition-colors cursor-pointer"
          onClick={() => !uploading && inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept="image/*" className="sr-only"
            onChange={e => handleFile(e.target.files?.[0])} />

          {uploading ? (
            <div className="flex flex-col items-center gap-2 w-full">
              <Spinner />
              <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-violet-500 rounded-full transition-all duration-200"
                  style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-slate-500">Uploading… {progress}%</p>
            </div>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-slate-400">
                <path d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
              </svg>
              <p className="text-xs text-slate-600 font-medium">Click to upload or drag & drop</p>
              <p className="text-[11px] text-slate-400">PNG, JPG, SVG, WebP</p>
            </>
          )}
        </div>
      </div>
    </Field>
  );
}

// ── CORS tag input ─────────────────────────────────────────────────────────────
function CorsTagInput({ value, onChange }) {
  const [inputVal, setInputVal] = useState('');
  const [err,      setErr]      = useState('');

  function addOrigin() {
    const v = inputVal.trim();
    if (!v) return;
    if (!isValidOrigin(v)) { setErr('Must be a full URL, e.g. https://example.com'); return; }
    if (value.includes(v)) { setErr('Already added'); return; }
    setErr('');
    onChange([...value, v]);
    setInputVal('');
  }

  function removeOrigin(origin) {
    onChange(value.filter(o => o !== origin));
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addOrigin(); }
    if (e.key === 'Backspace' && !inputVal && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <Field
      label="Allowed CORS Origins"
      hint="Add the domains where your widget is embedded. Press Enter or comma to add."
      error={err}
    >
      <div className={`flex flex-wrap gap-2 p-3 rounded-xl border min-h-[48px]
        focus-within:ring-2 focus-within:ring-violet-400 focus-within:border-violet-400 transition
        ${err ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white'}`}>
        {value.map(origin => (
          <span key={origin}
            className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-full
                       bg-violet-100 text-violet-800 text-xs font-medium">
            {origin}
            <button
              type="button"
              onClick={() => removeOrigin(origin)}
              className="w-4 h-4 flex items-center justify-center rounded-full
                         hover:bg-violet-300 transition-colors text-violet-600"
              aria-label={`Remove ${origin}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="url"
          value={inputVal}
          onChange={e => { setInputVal(e.target.value); setErr(''); }}
          onKeyDown={handleKeyDown}
          onBlur={() => inputVal.trim() && addOrigin()}
          placeholder={value.length === 0 ? 'https://yoursite.com' : ''}
          className="flex-1 min-w-[160px] outline-none text-sm bg-transparent placeholder:text-slate-400"
        />
      </div>
      {value.length > 0 && (
        <p className="mt-1.5 text-[11px] text-slate-400">{value.length} origin{value.length !== 1 ? 's' : ''} allowed</p>
      )}
    </Field>
  );
}

// ── Widget preview bubble ─────────────────────────────────────────────────────
function WidgetPreview({ primaryColor, accentColor, brandName, logoUrl }) {
  const primary = isValidHex(primaryColor) ? primaryColor : '#6366f1';
  const accent  = isValidHex(accentColor)  ? accentColor  : '#8b5cf6';
  const textCol = contrastColor(primary);

  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-slate-100 p-4" style={{ minHeight: 260 }}>
      {/* Fake browser chrome */}
      <div className="mb-3 flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
        <div className="flex-1 h-4 bg-slate-200 rounded-md ml-2" />
      </div>

      {/* Website mock */}
      <div className="bg-white rounded-xl h-32 flex items-center justify-center">
        <p className="text-slate-300 text-xs font-medium">Your Website</p>
      </div>

      {/* Widget launcher */}
      <div className="absolute bottom-7 right-7 flex flex-col items-end gap-3">
        {/* Chat bubble */}
        <div className="bg-white rounded-2xl rounded-br-sm shadow-xl border border-slate-100
                        px-4 py-3 w-52 text-xs text-slate-700 leading-relaxed">
          <div className="flex items-center gap-2 mb-2">
            {logoUrl ? (
              <img src={logoUrl} alt="logo" className="w-5 h-5 rounded-full object-contain" />
            ) : (
              <div className="w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: primary }}>
                <svg viewBox="0 0 24 24" fill={textCol} className="w-3 h-3">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                </svg>
              </div>
            )}
            <span className="font-semibold text-slate-900 text-[11px]">{brandName || 'Support'}</span>
          </div>
          <p className="text-[11px] text-slate-500">Hi there! 👋 How can we help you today?</p>
        </div>

        {/* FAB */}
        <div
          className="w-12 h-12 rounded-full shadow-lg flex items-center justify-center cursor-pointer
                     transition-transform hover:scale-110"
          style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}
        >
          <svg viewBox="0 0 24 24" fill={textCol} className="w-6 h-6">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
          </svg>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function BrandSettings() {
  const { agent, authFetch } = useAuth();

  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [saveStatus,   setSaveStatus]   = useState('');   // '' | 'saved' | 'error'
  const [errors,       setErrors]       = useState({});

  // Form state
  const [brandId,      setBrandId]      = useState('');
  const [brandName,    setBrandName]    = useState('');
  const [logoUrl,      setLogoUrl]      = useState('');
  const [primaryColor, setPrimary]      = useState('#6366f1');
  const [accentColor,  setAccent]       = useState('#8b5cf6');
  const [emailPrefix,  setEmailPrefix]  = useState('');
  const [corsOrigins,  setCorsOrigins]  = useState([]);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [charCount,    setCharCount]    = useState(0);

  const PROMPT_MAX = 4000;

  // ── Load brand ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!agent) return;
    setLoading(true);
    authFetch(`${API_URL}/brands/mine`)
      .then(r => r.json())
      .then(data => {
        const b = Array.isArray(data) ? data[0] : data;
        if (!b) return;
        setBrandId(b.id || '');
        setBrandName(b.name || '');
        setLogoUrl(b.logo_url || '');
        setPrimary(b.widget_primary_color  || '#6366f1');
        setAccent(b.widget_accent_color   || '#8b5cf6');
        setEmailPrefix(b.inbound_email_prefix || '');
        setCorsOrigins(Array.isArray(b.cors_origins) ? b.cors_origins : []);
        setSystemPrompt(b.ai_system_prompt || '');
        setCharCount((b.ai_system_prompt || '').length);
      })
      .catch(err => console.error('[BrandSettings] load', err))
      .finally(() => setLoading(false));
  }, [agent, authFetch]);

  // ── Validate ────────────────────────────────────────────────────────────────
  function validate() {
    const e = {};
    if (!brandName.trim()) e.brandName = 'Brand name is required';
    if (primaryColor && !isValidHex(primaryColor)) e.primaryColor = 'Invalid hex colour';
    if (accentColor  && !isValidHex(accentColor))  e.accentColor  = 'Invalid hex colour';
    if (emailPrefix && !/^[a-z0-9-]{3,40}$/.test(emailPrefix))
      e.emailPrefix = 'Use 3–40 lowercase letters, numbers, or hyphens only';
    if (systemPrompt.length > PROMPT_MAX)
      e.systemPrompt = `Max ${PROMPT_MAX} characters`;
    return e;
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setSaving(true);
    try {
      const payload = {
        name:                  brandName.trim(),
        logo_url:              logoUrl,
        widget_primary_color:  primaryColor,
        widget_accent_color:   accentColor,
        inbound_email_prefix:  emailPrefix.trim().toLowerCase(),
        cors_origins:          corsOrigins,
        ai_system_prompt:      systemPrompt,
      };
      const url = brandId
        ? `${API_URL}/brands/${brandId}`
        : `${API_URL}/brands`;
      const res = await authFetch(url, {
        method: brandId ? 'PATCH' : 'POST',
        body:   JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json();
      if (!brandId) setBrandId(saved.id);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      console.error('[BrandSettings] save', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 4000);
    } finally {
      setSaving(false);
    }
  }, [brandId, brandName, logoUrl, primaryColor, accentColor,
      emailPrefix, corsOrigins, systemPrompt, authFetch]); // eslint-disable-line

  // ─── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Brand Settings</h1>
            <p className="text-sm text-slate-500 mt-0.5">Configure your brand's identity, widget appearance, and AI behaviour.</p>
          </div>
          <div className="flex items-center gap-3">
            {saveStatus === 'saved' && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 bg-emerald-100 px-3 py-1.5 rounded-xl">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                </svg>
                Saved
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-sm font-medium text-red-600 bg-red-100 px-3 py-1.5 rounded-xl">
                Save failed — try again
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold
                transition-all shadow-sm
                ${saving ? 'bg-violet-400 cursor-not-allowed text-white'
                         : 'bg-violet-600 hover:bg-violet-700 active:scale-[.98] text-white'}`}
            >
              {saving ? <Spinner size="sm" /> : (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
                </svg>
              )}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* ── 1. Identity ─────────────────────────────────────────────────── */}
        <SectionCard
          title="Brand Identity"
          description="Your brand's display name and logo, shown in the widget header and agent inbox."
        >
          <Field label="Brand Name" error={errors.brandName}>
            <input
              type="text"
              value={brandName}
              onChange={e => { setBrandName(e.target.value); setErrors(v => ({ ...v, brandName: '' })); }}
              placeholder="Acme Corp Support"
              className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none
                focus:ring-2 focus:ring-violet-400 focus:border-violet-400 transition
                ${errors.brandName ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white'}`}
            />
          </Field>

          <LogoUploader
            brandId={brandId}
            currentLogoUrl={logoUrl}
            onUploaded={url => setLogoUrl(url)}
            authFetch={authFetch}
          />
        </SectionCard>

        {/* ── 2. Widget Theme ──────────────────────────────────────────────── */}
        <SectionCard
          title="Widget Theme"
          description="Customise the chat widget colours to match your brand palette."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-5">
              <HexInput
                label="Primary Colour"
                value={primaryColor}
                onChange={v => { setPrimary(v); setErrors(e => ({ ...e, primaryColor: '' })); }}
                hint="Used for the launcher FAB and message bubbles."
              />
              {errors.primaryColor && <p className="text-xs text-red-600">⚠ {errors.primaryColor}</p>}

              <HexInput
                label="Accent Colour"
                value={accentColor}
                onChange={v => { setAccent(v); setErrors(e => ({ ...e, accentColor: '' })); }}
                hint="Used for gradient FAB and hover states."
              />
              {errors.accentColor && <p className="text-xs text-red-600">⚠ {errors.accentColor}</p>}
            </div>

            {/* Live widget preview */}
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Live Preview</p>
              <WidgetPreview
                primaryColor={primaryColor}
                accentColor={accentColor}
                brandName={brandName}
                logoUrl={logoUrl}
              />
            </div>
          </div>
        </SectionCard>

        {/* ── 3. Email Routing ─────────────────────────────────────────────── */}
        <SectionCard
          title="Inbound Email Routing"
          description="Set a unique email prefix. Emails sent to this address create support tickets automatically."
        >
          <Field
            label="Email Prefix"
            hint={`Full address: ${emailPrefix || 'your-prefix'}${EMAIL_SUFFIX}`}
            error={errors.emailPrefix}
          >
            <div className="flex items-center">
              <input
                type="text"
                value={emailPrefix}
                onChange={e => {
                  const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                  setEmailPrefix(v);
                  setErrors(er => ({ ...er, emailPrefix: '' }));
                }}
                placeholder="acme-support"
                maxLength={40}
                className={`flex-1 px-4 py-2.5 rounded-l-xl border border-r-0 text-sm font-mono outline-none
                  focus:ring-2 focus:ring-violet-400 focus:border-violet-400 transition z-10 relative
                  ${errors.emailPrefix ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white'}`}
              />
              <span className="px-4 py-2.5 rounded-r-xl border border-l-0 border-slate-300 bg-slate-100
                               text-sm text-slate-500 font-mono whitespace-nowrap select-none">
                {EMAIL_SUFFIX}
              </span>
            </div>
          </Field>

          {emailPrefix && !errors.emailPrefix && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-violet-50 border border-violet-200">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-violet-500 shrink-0">
                <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
              </svg>
              <div>
                <p className="text-xs font-semibold text-violet-900">Your inbound email address:</p>
                <p className="text-sm font-mono text-violet-700 mt-0.5">
                  {emailPrefix}{EMAIL_SUFFIX}
                </p>
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(`${emailPrefix}${EMAIL_SUFFIX}`)}
                className="ml-auto p-1.5 rounded-lg text-violet-500 hover:bg-violet-200 transition-colors"
                title="Copy to clipboard"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                </svg>
              </button>
            </div>
          )}
        </SectionCard>

        {/* ── 4. CORS Origins ──────────────────────────────────────────────── */}
        <SectionCard
          title="CORS Allowed Origins"
          description="Domains permitted to embed your chat widget and call the widget API."
        >
          <CorsTagInput value={corsOrigins} onChange={setCorsOrigins} />

          {corsOrigins.length === 0 && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0 mt-0.5 text-amber-500">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
              </svg>
              <p>No origins configured. Without CORS origins, widget requests will be blocked by browsers.</p>
            </div>
          )}
        </SectionCard>

        {/* ── 5. AI System Prompt ──────────────────────────────────────────── */}
        <SectionCard
          title="AI System Prompt"
          description="Custom instructions injected into every Gemini context for this brand. Guides tone, scope, and escalation rules."
        >
          <Field
            label="System Instructions"
            hint="Write instructions in plain English. They are prepended to all AI conversations for this brand."
            error={errors.systemPrompt}
          >
            <div className="relative">
              <textarea
                value={systemPrompt}
                onChange={e => {
                  const v = e.target.value;
                  if (v.length <= PROMPT_MAX) {
                    setSystemPrompt(v);
                    setCharCount(v.length);
                    setErrors(er => ({ ...er, systemPrompt: '' }));
                  }
                }}
                placeholder={`You are a helpful support agent for {{brand_name}}. Always respond in a friendly, professional tone.\n\nNever discuss competitor products. Escalate to a human agent if the customer mentions billing disputes or account cancellations.\n\nContext: {{rag_results}}`}
                rows={10}
                className={`w-full px-4 py-3 rounded-xl border text-sm font-mono leading-relaxed
                  outline-none resize-y transition
                  focus:ring-2 focus:ring-violet-400 focus:border-violet-400
                  placeholder:font-sans placeholder:text-slate-400
                  ${errors.systemPrompt ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white'}`}
              />
              {/* Character counter */}
              <div className={`absolute bottom-3 right-3 text-[10px] font-mono
                ${charCount > PROMPT_MAX * 0.9 ? 'text-amber-500' : 'text-slate-400'}`}>
                {charCount} / {PROMPT_MAX}
              </div>
            </div>
          </Field>

          {/* Template variable hint */}
          <div className="flex flex-wrap gap-2">
            <p className="text-xs text-slate-500 w-full">Available template variables:</p>
            {['{{brand_name}}', '{{rag_results}}', '{{visitor_name}}', '{{ticket_id}}', '{{channel}}'].map(v => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setSystemPrompt(p => p + v);
                  setCharCount(c => c + v.length);
                }}
                className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-mono
                           hover:bg-violet-100 hover:text-violet-700 transition-colors"
              >
                {v}
              </button>
            ))}
          </div>

          {/* Reset to default */}
          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={() => {
                const def = 'You are a helpful and professional support agent for {{brand_name}}.\n\nUse the following knowledge base context to answer questions:\n{{rag_results}}\n\nIf you cannot answer, respond with: "Let me connect you with a human agent."';
                setSystemPrompt(def);
                setCharCount(def.length);
              }}
              className="text-xs text-slate-500 hover:text-violet-600 underline decoration-dashed transition-colors"
            >
              Reset to default template
            </button>
          </div>
        </SectionCard>

        {/* Bottom save bar (sticky) */}
        <div className="sticky bottom-4 flex justify-end">
          <div className="flex items-center gap-3 px-4 py-3 bg-white rounded-2xl border border-slate-200 shadow-lg">
            {saveStatus === 'saved' && (
              <span className="text-sm text-emerald-600 font-medium">✓ Changes saved</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-sm text-red-600 font-medium">✗ Save failed</span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold
                transition-all shadow-sm
                ${saving ? 'bg-violet-400 cursor-not-allowed text-white'
                         : 'bg-violet-600 hover:bg-violet-700 active:scale-[.98] text-white'}`}
            >
              {saving ? <Spinner size="sm" /> : null}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
