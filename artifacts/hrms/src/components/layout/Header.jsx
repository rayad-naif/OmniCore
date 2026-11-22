import { useState, useRef, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Menu, Search, Bell, Sun, Moon, ChevronDown, Settings, LogOut, User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toggleSidebar } from '@/store/slices/uiSlice';
import { logoutUser, selectUser } from '@/store/slices/authSlice';
import { setNotifications, addNotification, markRead, markAllRead } from '@/store/slices/notificationSlice';
import { notificationAPI } from '@/services/api';
import { connectSocket } from '@/services/socket';
import clsx from 'clsx';
import { fadeDown, dropdown, spring } from '@/motion/variants';

export default function Header() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector(selectUser);
  const { unreadCount, list: notifications } = useSelector((s) => s.notifications);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const notifRef = useRef(null);
  const userMenuRef = useRef(null);

  useEffect(() => {
    if (!user?.role) return;

    const loadNotifications = async () => {
      try {
        const { data } = await notificationAPI.getAll();
        dispatch(setNotifications(data.data));
      } catch (err) {
        console.error('Failed to load notifications:', err?.message || err);
      }
    };

    loadNotifications();
  }, [dispatch, user?.role]);

  useEffect(() => {
    if (!user?.role) return;
    const token = localStorage.getItem('accessToken');
    if (!token || token === 'demo-mode-token') return;

    const socket = connectSocket(token);
    if (!socket) return;

    const getNotificationId = (payload) =>
      payload._id || payload.id || payload.notificationId || payload.leaveId || payload.requestId || `${Date.now()}`;

    const handleNotification = (payload) => {
      dispatch(addNotification({
        _id: getNotificationId(payload),
        title: payload.title,
        message: payload.message,
        type: payload.type,
        link: payload.link,
        read: false,
        time: payload.time || 'Just now',
        createdAt: new Date().toISOString(),
      }));
    };

    const handleNotificationUpdated = (payload) => {
      if (payload?.id) dispatch(markRead(payload.id));
    };

    socket.on('notification:new', handleNotification);
    socket.on('notification:updated', handleNotificationUpdated);

    return () => {
      socket.off('notification:new', handleNotification);
      socket.off('notification:updated', handleNotificationUpdated);
    };
  }, [dispatch, user?.role]);

  // Sync theme on mount
  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const prefersDark = stored
      ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDark(prefersDark);
    document.documentElement.classList.toggle('dark', prefersDark);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifs(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setShowUserMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (next) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  const handleLogout = async () => {
    await dispatch(logoutUser());
    navigate('/login');
  };

  const markAllNotificationsRead = async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n._id);
    if (!unreadIds.length) return;

    try {
      await Promise.all(unreadIds.map((id) => notificationAPI.markRead(id).catch(() => null)));
    } catch (err) {
      console.error('Failed to mark notifications as read:', err?.message || err);
    }
    dispatch(markAllRead());
  };

  const getRoleLabel = (role) => {
    const labels = {
      super_admin:    'Super Admin',
      admin:          'Admin',
      senior_manager: 'Senior Manager',
      hr_recruiter:   'HR Recruiter',
      employee:       'Employee',
    };
    return labels[role] || role;
  };

  const getRoleBadgeColor = (role) => {
    const colors = {
      super_admin:    'badge-danger',
      admin:          'badge-primary',
      senior_manager: 'badge-warning',
      hr_recruiter:   'badge-accent',
      employee:       'badge-neutral',
    };
    return colors[role] || 'badge-neutral';
  };

  return (
     <motion.header
      variants={fadeDown}
      initial="hidden"
      animate="visible"
      className="h-16 bg-white dark:bg-surface-900/80 backdrop-blur-sm border-b border-slate-200 dark:border-white/5 flex items-center px-4 lg:px-6 gap-4 flex-shrink-0 sticky top-0 z-10"
    >
      {/* Sidebar toggle */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => dispatch(toggleSidebar())}
        className="btn-ghost p-2"
        aria-label="Toggle sidebar"
      >
        <Menu className="w-5 h-5" />
      </motion.button>

      {/* Search */}
      {/* <div className="relative flex-1 max-w-md hidden sm:block">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search employees, jobs, reports..."
          className="w-full bg-slate-100 dark:bg-surface-800/60 border border-slate-200 dark:border-white/10
                     text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-600
                     rounded-xl pl-10 pr-4 py-2 text-sm transition-all duration-200
                     focus:outline-none focus:border-primary-500/50 focus:bg-white dark:focus:bg-surface-800"
        />
        {searchQuery && (
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 dark:text-slate-600 bg-slate-200 dark:bg-surface-700 px-1.5 py-0.5 rounded">
            ESC
          </kbd>
        )}
      </div> */}

      <div className="flex items-center gap-2 ml-auto">
        {/* Theme toggle */}
        <motion.button
          whileHover={{ scale: 1.08, rotate: 15 }}
          whileTap={{ scale: 0.92 }}
          onClick={toggleTheme}
          className="btn-ghost p-2"
          aria-label="Toggle theme"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={isDark ? 'sun' : 'moon'}
              initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
              transition={{ duration: 0.2 }}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </motion.span>
          </AnimatePresence>
        </motion.button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
         <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowNotifs(!showNotifs)}
            className="btn-ghost p-2 relative"
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4" />
            <AnimatePresence>
              {unreadCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={spring.snappy}
                  className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-danger-500 text-white text-[9px] font-bold rounded-full flex-center"
                >
                  <motion.span
                    animate={{ scale: [1, 1.15, 1] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </motion.span>
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>

          <AnimatePresence>
            {showNotifs && (
              <motion.div
                variants={dropdown}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="absolute right-0 mt-2 w-80 bg-white dark:bg-surface-800 border border-slate-200 dark:border-white/10 rounded-2xl shadow-card dark:shadow-xl overflow-hidden z-50"
              >
                <div className="flex-between px-4 py-3 border-b border-slate-100 dark:border-white/5">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</h3>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllNotificationsRead}
                      className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-500 dark:hover:text-primary-300 transition-colors"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="flex-center flex-col gap-2 py-10 text-slate-400 dark:text-slate-500">
                      <Bell className="w-6 h-6 opacity-30" />
                      <p className="text-xs">No notifications</p>
                    </div>
                  ) : (
                    notifications.slice(0, 8).map((n, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04 }}
                        whileHover={{ x: 4, backgroundColor: 'rgba(255,255,255,0.05)' }}
                        className={clsx(
                          'px-4 py-3 transition-colors border-b border-slate-100 dark:border-white/5 cursor-pointer',
                          !n.read && 'bg-primary-50 dark:bg-primary-500/5'
                        )}
                      >
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{n.message || n.text}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1">{n.time || 'Just now'}</p>
                      </motion.div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* User menu */}
        <div className="relative" ref={userMenuRef}>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 transition-all duration-200"
          >
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex-center flex-shrink-0 overflow-hidden">
              {user?.avatar ? (
                <img src={user.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[11px] font-bold text-white">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </span>
              )}
            </div>
            <div className="hidden md:block text-left">
              <p className="text-xs font-medium text-slate-900 dark:text-white leading-none">{user?.firstName} {user?.lastName}</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-500 mt-0.5 capitalize">{getRoleLabel(user?.role)}</p>
            </div>
            <ChevronDown className={clsx('w-3 h-3 text-slate-400 dark:text-slate-500 transition-transform', showUserMenu && 'rotate-180')} />
          </motion.button>

          <AnimatePresence>
            {showUserMenu && (
              <motion.div
                variants={dropdown}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="absolute right-0 mt-2 w-52 bg-white dark:bg-surface-800 border border-slate-200 dark:border-white/10 rounded-2xl shadow-card dark:shadow-xl overflow-hidden z-50"
              >
                <div className="px-4 py-3 border-b border-slate-100 dark:border-white/5">
                  <p className="text-xs font-medium text-slate-900 dark:text-white">{user?.firstName} {user?.lastName}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-500 mt-0.5">{user?.email}</p>
                  <span className={clsx('badge mt-2 text-[10px]', getRoleBadgeColor(user?.role))}>
                    {getRoleLabel(user?.role)}
                  </span>
                </div>
                 <div className="p-1.5">
                  <motion.button
                    whileHover={{ x: 4 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { navigate('/dashboard/employee/profile'); setShowUserMenu(false); }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white transition-all"
                  >
                    <User className="w-3.5 h-3.5" /> My Profile
                  </motion.button>
                  <motion.button
                    whileHover={{ x: 4 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { navigate('/dashboard/admin/settings'); setShowUserMenu(false); }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white transition-all"
                  >
                    <Settings className="w-3.5 h-3.5" /> Settings
                  </motion.button>
                  <hr className="border-slate-100 dark:border-white/5 my-1" />
                  <motion.button
                    whileHover={{ x: 4 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleLogout}
                    className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-xs text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-500/10 transition-all"
                  >
                    <LogOut className="w-3.5 h-3.5" /> Sign Out
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
        </motion.header>

  );
}