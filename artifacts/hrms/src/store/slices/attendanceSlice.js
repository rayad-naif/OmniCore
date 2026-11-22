import { createSlice } from '@reduxjs/toolkit';

export const attendanceSlice = createSlice({
  name: 'attendance',
  initialState: { todayRecord: null, history: [], isCheckedIn: false, checkInTime: null, isLoading: false },
  reducers: {
    setTodayRecord: (state, action) => {
      state.todayRecord = action.payload;
      state.isCheckedIn = !!action.payload?.checkIn && !action.payload?.checkOut;
      state.checkInTime = action.payload?.checkIn?.time;
    },
    setHistory: (state, action) => { state.history = action.payload; },
    setLoading: (state, action) => { state.isLoading = action.payload; },
    markCheckIn: (state, action) => { state.isCheckedIn = true; state.checkInTime = action.payload; },
    markCheckOut: (state) => { state.isCheckedIn = false; },
  },
});
export const { setTodayRecord, setHistory, markCheckIn, markCheckOut } = attendanceSlice.actions;

export const notificationSlice = createSlice({
  name: 'notifications',
  initialState: { list: [], unreadCount: 0, isLoading: false },
  reducers: {
    setNotifications: (state, action) => {
      state.list = action.payload;
      state.unreadCount = action.payload.filter((n) => !n.read).length;
    },
    addNotification: (state, action) => {
      state.list.unshift(action.payload);
      state.unreadCount += 1;
    },
    markRead: (state, action) => {
      const n = state.list.find((n) => n._id === action.payload);
      if (n && !n.read) { n.read = true; state.unreadCount = Math.max(0, state.unreadCount - 1); }
    },
    markAllRead: (state) => {
      state.list.forEach((n) => (n.read = true));
      state.unreadCount = 0;
    },
  },
});
export const { setNotifications, addNotification, markRead, markAllRead } = notificationSlice.actions;

export const uiSlice = createSlice({
  name: 'ui',
  initialState: { sidebarOpen: true, sidebarCollapsed: false, theme: 'dark', activeModal: null },
  reducers: {
    toggleSidebar: (state) => { state.sidebarOpen = !state.sidebarOpen; },
    setSidebarOpen: (state, action) => { state.sidebarOpen = action.payload; },
    toggleSidebarCollapse: (state) => { state.sidebarCollapsed = !state.sidebarCollapsed; },
    setTheme: (state, action) => { state.theme = action.payload; },
    openModal: (state, action) => { state.activeModal = action.payload; },
    closeModal: (state) => { state.activeModal = null; },
  },
});
export const { toggleSidebar, setSidebarOpen, toggleSidebarCollapse, setTheme, openModal, closeModal } = uiSlice.actions;

export default {
  attendance: attendanceSlice.reducer,
  notifications: notificationSlice.reducer,
  ui: uiSlice.reducer,
};
