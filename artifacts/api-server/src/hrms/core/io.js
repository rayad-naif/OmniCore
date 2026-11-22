'use strict';

/**
 * hrms/core/io.js
 * Real-time events for the HR app on OmniCore's Socket.io server, namespace
 * "/hrms" (path /api/socket.io). Rooms are prefixed with the workspace id so
 * an emit can never reach another workspace:
 *   <tid>:all · <tid>:user:<userId> · <tid>:role:<role>
 * scopedIo(tid) mimics the subset of the Socket.io API the HRMS code uses
 * (io.to(room).to(room2).emit(...), io.emit(...)).
 */

const logger = require('../../utils/logger');
const tokens = require('./tokens');
const tenants = require('./tenants');

let nsp = null;

function scopedIo(tenantId) {
  const tid = String(tenantId);
  const make = (rooms) => ({
    to: (room) => make([...rooms, `${tid}:${room}`]),
    in: (room) => make([...rooms, `${tid}:${room}`]),
    emit: (event, ...args) => {
      if (!nsp) return false;
      let op = nsp;
      for (const r of rooms.length ? rooms : [`${tid}:all`]) op = op.to(r);
      return op.emit(event, ...args);
    },
  });
  return make([]);
}

function attach(io) {
  if (!io || nsp) return nsp;
  nsp = io.of('/hrms');
  nsp.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) return next(new Error('Authentication required'));
      const decoded = tokens.verifyAccess(token);
      const ws = await tenants.workspaceInfo(decoded.tid);
      if (!ws?.enabled) return next(new Error('HR module disabled'));
      if (await tenants.isTokenRevoked(token)) return next(new Error('Invalid token'));
      socket.data.tid = decoded.tid;
      socket.data.userId = decoded.id;
      socket.data.role = decoded.role;
      return next();
    } catch {
      return next(new Error('Invalid token'));
    }
  });
  nsp.on('connection', (socket) => {
    const { tid, userId, role } = socket.data;
    const io = scopedIo(tid);
    socket.join([`${tid}:all`, `${tid}:user:${userId}`, `${tid}:role:${role}`]);
    io.emit('user:online', { userId });

    const relay = (action) => (data) =>
      io
        .to('role:admin')
        .to('role:super_admin')
        .to('role:senior_manager')
        .emit('attendance:live', {
          ...(data && typeof data === 'object' ? data : {}),
          userId,
          action,
          time: new Date(),
        });
    socket.on('attendance:checkin', relay('checkin'));
    socket.on('attendance:checkout', relay('checkout'));
    socket.on('notification:read', (notificationId) => {
      socket
        .to(`${tid}:user:${userId}`)
        .emit('notification:updated', { id: notificationId, read: true });
    });
    socket.on('leave:request', (data) =>
      io.to('role:hr_recruiter').to('role:senior_manager').emit('leave:pending', data),
    );
    socket.on('payroll:process', (data) =>
      io.to('role:admin').emit('payroll:update', data),
    );
    socket.on('disconnect', () => io.emit('user:offline', { userId }));
  });
  logger.info('hrms_socket_namespace_ready');
  return nsp;
}

module.exports = { attach, scopedIo };
