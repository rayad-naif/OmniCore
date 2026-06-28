import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

/**
 * AuthContext.jsx
 * Atelier OmniCore — JWT authentication context
 *
 * Token lifecycle:
 *  - Access token stored in memory only (never localStorage — XSS safe)
 *  - Refresh token stored in an httpOnly cookie (set by the server)
 *  - Silent refresh runs 60 s before access token expiry via setTimeout
 *  - Axios-style 401 interceptor via a bare fetch wrapper is exposed
 *    so any component can call `authFetch` and get automatic token rotation
 */

// ─── Constants ────────────────────────────────────────────────────────────────
const API_URL          = import.meta.env.VITE_API_URL || '/api';
const REFRESH_BUFFER_S = 60;   // refresh this many seconds before expiry

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

function msUntilExpiry(token) {
  const payload = parseJwtPayload(token);
  if (!payload?.exp) return 0;
  return payload.exp * 1000 - Date.now() - REFRESH_BUFFER_S * 1000;
}

// ─── Context ──────────────────────────────────────────────────────────────────
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [accessToken, setAccessToken]   = useState(null);   // in-memory only
  const [agent, setAgent]               = useState(null);   // { id, name, email, role, tenantId }
  const [isLoading, setIsLoading]       = useState(true);   // true during initial silent refresh
  const [error, setError]               = useState(null);
  // Super-admin "view as workspace" override: { tenantId, name } | null.
  // When set, authFetch sends X-Workspace-Id so the server scopes data to that tenant.
  const [workspaceOverride, setWorkspaceOverride] = useState(null);

  const refreshTimerRef = useRef(null);

  // ── Silent refresh ──────────────────────────────────────────────────────────
  const scheduleRefresh = useCallback((token) => {
    clearTimeout(refreshTimerRef.current);
    const delay = msUntilExpiry(token);
    if (delay <= 0) return;
    refreshTimerRef.current = setTimeout(() => silentRefresh(), delay);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const silentRefresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method:      'POST',
        credentials: 'include',   // sends httpOnly refresh-token cookie
      });
      if (!res.ok) throw new Error('Refresh failed');
      const { accessToken: newToken, agent: agentData } = await res.json();
      setAccessToken(newToken);
      setAgent(agentData);
      scheduleRefresh(newToken);
      return newToken;
    } catch {
      // Refresh token expired or invalid — force logout
      setAccessToken(null);
      setAgent(null);
      return null;
    }
  }, [scheduleRefresh]);

  // ── Boot: attempt silent refresh on mount ────────────────────────────────────
  useEffect(() => {
    silentRefresh().finally(() => setIsLoading(false));
    return () => clearTimeout(refreshTimerRef.current);
  }, [silentRefresh]);

  // ── Login ────────────────────────────────────────────────────────────────────
  const login = useCallback(async ({ email, password }) => {
    setError(null);
    const res = await fetch(`${API_URL}/auth/login`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error || 'Login failed';
      setError(msg);
      throw new Error(msg);
    }
    setAccessToken(data.accessToken);
    setAgent(data.agent);
    scheduleRefresh(data.accessToken);
    return data;
  }, [scheduleRefresh]);

  // ── Logout ───────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    clearTimeout(refreshTimerRef.current);
    try {
      await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch { /* best-effort */ }
    setAccessToken(null);
    setAgent(null);
  }, []);

  // ── authFetch — drop-in fetch wrapper with auto token injection + 401 retry ──
  const authFetch = useCallback(async (url, options = {}) => {
    const doRequest = async (token) => {
      return fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(workspaceOverride ? { 'X-Workspace-Id': workspaceOverride.tenantId } : {}),
        },
      });
    };

    let res = await doRequest(accessToken);

    // On 401, attempt one silent refresh and retry
    if (res.status === 401) {
      const newToken = await silentRefresh();
      if (newToken) {
        res = await doRequest(newToken);
      }
    }
    return res;
  }, [accessToken, silentRefresh, workspaceOverride]);

  // ── Derived helpers ──────────────────────────────────────────────────────────
  const isAuthenticated = Boolean(accessToken && agent);
  const isAdmin         = agent?.role === 'admin';

  // Per-feature RBAC check. Admins always pass. `level` is 'read' | 'edit'.
  // The server sends the resolved effective permission map on `agent.permissions`.
  const can = useCallback((feature, level = 'read') => {
    if (!agent) return false;
    if (agent.role === 'admin' || agent.isSuperAdmin) return true;
    const rank = { none: 0, read: 1, edit: 2 };
    const held = agent.permissions?.[feature] ?? 'none';
    return (rank[held] ?? 0) >= (rank[level] ?? 1);
  }, [agent]);

  const value = {
    agent,
    accessToken,
    isAuthenticated,
    isAdmin,
    isLoading,
    error,
    login,
    logout,
    authFetch,
    can,
    workspaceOverride,
    setWorkspaceOverride,
    clearError: () => setError(null),
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

export default AuthContext;
