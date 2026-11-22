// The OmniCore workspace (company) the signed-in HR user belongs to:
// { id, name, timezone, tzOffsetMinutes, aiEnabled }. Kept in localStorage so
// time-zone aware screens work before /auth/me returns.

const KEY = 'hrWorkspace';
let current = null;
try {
  current = JSON.parse(localStorage.getItem(KEY) || 'null');
} catch {
  current = null;
}

export function setWorkspace(ws) {
  current = ws || null;
  try {
    if (current) localStorage.setItem(KEY, JSON.stringify(current));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export const getWorkspace = () => current;

export const companyName = () => current?.name || '';

/** Milliseconds between UTC and the workspace's wall clock (was fixed UTC+5). */
export const workspaceOffsetMs = () => (Number(current?.tzOffsetMinutes) || 0) * 60000;

/** Workspace id from ?w= on the current URL (employee login links). */
export const workspaceFromUrl = () => {
  try {
    const w = new URLSearchParams(window.location.search).get('w');
    return w && /^[0-9a-f-]{36}$/i.test(w) ? w : null;
  } catch {
    return null;
  }
};
