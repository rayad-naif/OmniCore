import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import api from '@/services/api';
import toast from 'react-hot-toast';

import { setWorkspace } from '@/services/workspace';

// Demo accounts from the original HRMS were removed: every sign-in goes
// through the OmniCore HR API (password login or single sign-on).

const finishSignIn = (data) => {
  localStorage.setItem('accessToken', data.accessToken);
  setWorkspace(data.workspace);
  return data;
};

// ─── Thunks ──────────────────────────────────────────────────────────────────
// credentials: { email, password, workspace? }. When the email exists in more
// than one company the API answers 409 choose_workspace with the choices.
export const loginUser = createAsyncThunk('auth/login', async (credentials, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/auth/login', credentials);
    return finishSignIn(data);
  } catch (err) {
    const body = err.response?.data;
    if (err.response?.status === 409 && body?.code === 'choose_workspace') {
      return rejectWithValue({ chooseWorkspace: body.workspaces, message: body.message });
    }
    return rejectWithValue({ message: body?.message || 'Login failed. Please try again.' });
  }
});

// One-time code from the OmniCore dashboard ("Open HR").
export const ssoLogin = createAsyncThunk('auth/sso', async (code, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/auth/sso', { code });
    return finishSignIn(data);
  } catch (err) {
    return rejectWithValue({ message: err.response?.data?.message || 'Single sign-on failed.' });
  }
});

export const logoutUser = createAsyncThunk('auth/logout', async () => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    try {
      await api.post('/auth/logout', {}, { timeout: 3000 });
    } catch (err) {
      console.warn('Logout API call failed or timed out:', err.message);
    }
  }
  localStorage.removeItem('accessToken');
  setWorkspace(null);
});

export const fetchCurrentUser = createAsyncThunk('auth/me', async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/auth/me');
    setWorkspace(data.workspace);
    return data.data;
  } catch (err) {
    return rejectWithValue({
      message: err.response?.data?.message || 'Unable to restore your session.',
      status: err.response?.status,
    });
  }
});

export const refreshToken = createAsyncThunk('auth/refresh', async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/auth/refresh-token');
    return finishSignIn(data);
  } catch (err) {
    localStorage.removeItem('accessToken');
    return rejectWithValue(err.response?.data?.message);
  }
});

// ─── Slice ───────────────────────────────────────────────────────────────────
const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: null,
    accessToken: localStorage.getItem('accessToken') || null,
    isAuthenticated: !!localStorage.getItem('accessToken'),
    isLoading: false,
    isInitializing: true,
    isDemo: false,
    error: null,
    workspaceChoices: null,
  },
  reducers: {
    clearError: (state) => { state.error = null; state.workspaceChoices = null; },
    setInitialized: (state) => { state.isInitializing = false; },
    updateUserPreferences: (state, action) => {
      if (state.user) state.user.preferences = { ...state.user.preferences, ...action.payload };
    },
    updateUserAvatar: (state, action) => {
      if (!state.user) return;
      state.user.avatar = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginUser.pending, (state) => { state.isLoading = true; state.error = null; })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.isLoading = false;
        state.isAuthenticated = true;
        state.isInitializing = false;
        state.workspaceChoices = null;
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        toast.success(`Welcome back, ${action.payload.user.firstName}! 👋`);
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.isLoading = false;
        if (action.payload?.chooseWorkspace) {
          state.workspaceChoices = action.payload.chooseWorkspace;
          state.error = null;
          return;
        }
        state.error = action.payload?.message || 'Login failed';
        toast.error(state.error);
      })
      .addCase(ssoLogin.pending, (state) => { state.isLoading = true; state.error = null; })
      .addCase(ssoLogin.fulfilled, (state, action) => {
        state.isLoading = false;
        state.isAuthenticated = true;
        state.isInitializing = false;
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
      })
      .addCase(ssoLogin.rejected, (state, action) => {
        state.isLoading = false;
        state.isInitializing = false;
        state.error = action.payload?.message || 'Single sign-on failed.';
      })
      .addCase(logoutUser.fulfilled, (state) => {
        state.user = null;
        state.accessToken = null;
        state.isAuthenticated = false;
        state.isDemo = false;
        toast.success('Logged out successfully');
      })
      .addCase(fetchCurrentUser.pending, (state) => { state.isLoading = true; })
      .addCase(fetchCurrentUser.fulfilled, (state, action) => {
        state.isLoading = false;
        state.isInitializing = false;
        state.user = action.payload;
        state.isAuthenticated = true;
      })
      .addCase(fetchCurrentUser.rejected, (state, action) => {
        state.isLoading = false;
        state.isInitializing = false;
        state.error = action.payload?.message || 'Unable to restore your session.';
        // A 429 or temporary server issue does not mean a saved session has
        // expired. Clear it only after an explicit authentication failure.
        if ([401, 403].includes(action.payload?.status)) {
          state.isAuthenticated = false;
          state.user = null;
          state.accessToken = null;
          localStorage.removeItem('accessToken');
        }
      })
      .addCase(refreshToken.fulfilled, (state, action) => {
        state.accessToken = action.payload.accessToken;
        state.isAuthenticated = true;
      })
      .addCase(refreshToken.rejected, (state) => {
        state.user = null;
        state.accessToken = null;
        state.isAuthenticated = false;
        state.isDemo = false;
      });
  },
});

export const { clearError, setInitialized, updateUserPreferences, updateUserAvatar } = authSlice.actions;

export const selectAuth = (state) => state.auth;
export const selectUser = (state) => state.auth.user;
export const selectIsAuthenticated = (state) => state.auth.isAuthenticated;
export const selectUserRole = (state) => state.auth.user?.role;
export const selectIsDemo = (state) => state.auth.isDemo;

export default authSlice.reducer;
