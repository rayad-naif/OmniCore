import { io } from 'socket.io-client';

let socket;

export const connectSocket = (token) => {
  if (socket && socket.connected) return socket;
  if (!token) return null;

  // Real-time events come from OmniCore's Socket.io server (namespace /hrms).
  // Set VITE_ENABLE_REALTIME=false to turn them off.
  if (import.meta.env.VITE_ENABLE_REALTIME === 'false') return null;

  socket = io(`${import.meta.env.VITE_SOCKET_URL || window.location.origin}/hrms`, {
    path: '/api/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection failed:', err.message || err);
  });

  socket.on('reconnect_attempt', (attempt) => {
    console.info(`Socket reconnect attempt ${attempt}`);
  });

  socket.on('reconnect_failed', () => {
    console.warn('Socket reconnect failed after multiple attempts');
  });

  socket.on('disconnect', (reason) => {
    console.info('Socket disconnected:', reason);
  });

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
