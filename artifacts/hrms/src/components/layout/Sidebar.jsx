import { NavLink, useNavigate } from 'react-router-dom';
import BrandMark from '@/components/common/BrandMark';
import { displayName } from '@/services/brand';
import { useDispatch, useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, LayoutDashboard, Users, Clock, DollarSign, BarChart2,
  Briefcase, Settings, ChevronLeft, ChevronRight, LogOut,
  Target, UserCheck, FileText, Building2, Bell, Calendar,
  TrendingUp, Search, User,Radar,
  CalendarCheck2Icon,
} from 'lucide-react';
import { logoutUser, selectUser } from '@/store/slices/authSlice';
import { toggleSidebarCollapse } from '@/store/slices/uiSlice';
import clsx from 'clsx';
import { fadeUp, staggerContainer, staggerItem, spring } from '@/motion/variants';

function SidebarNavItem({ item, collapsed, index }) {
  const Icon = item.icon;

  return (
    <motion.div
      variants={staggerItem}
      custom={index}
      whileHover={{ x: collapsed ? 0 : 4 }}
      whileTap={{ scale: 0.97 }}
    >
      <NavLink
        to={item.to}
        end={item.to.split('/').length <= 3}
        className={({ isActive }) =>
          clsx('nav-link', isActive && 'active', collapsed && 'justify-center px-2')
        }
        title={collapsed ? item.label : undefined}
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </NavLink>
    </motion.div>
  );
}
const NAV_CONFIG = {
  super_admin: [
    { group: 'Overview',    items: [
      { to: '/dashboard/admin',              icon: LayoutDashboard, label: 'Dashboard'    },
      
    ] },
    { group: 'Management',  items: [
      { to: '/dashboard/admin/employees',   icon: Users,        label: 'Employees'    },
      { to: '/dashboard/admin/departments', icon: Building2,    label: 'Departments'  },
      { to: '/dashboard/admin/shifts',      icon: Clock,        label: 'Shift Types'  },
      { to: '/dashboard/admin/shift-assignments', icon: Zap,      label: 'Shift Assignments' },
      { to: '/dashboard/admin/payroll',     icon: DollarSign,   label: 'Payroll'      },
      { to: '/dashboard/calender',     icon: CalendarCheck2Icon,   label: 'Calendar'      },
      { to: '/dashboard/manager/laterequestsapprovals',     icon: Calendar,    label: ' Requests & Approvals' },

      
    ]},
    // { group: 'Access Control', items: [
    //   { to: '/dashboard/admin/roles',       icon: UserCheck,    label: 'Roles'        },
    //   { to: '/dashboard/admin/permissions', icon: Target,       label: 'Permissions'  },
    // ]},
    { group: 'Analytics',   items: [
      { to: '/dashboard/attendance',        icon: Clock,        label: 'Attendance'   },
      { to: '/dashboard/admin/activitylogs', icon: Radar, label: 'Activity Logs' },

      // { to: '/dashboard/manager/leaves',     icon: Calendar,    label: 'Leave Approvals' },
      { to: '/dashboard/reports',           icon: BarChart2,    label: 'Reports'      },
    ]},
    { group: 'Accounting & Finance', items: [
      { to: '/dashboard/admin/expenses', icon: Target,       label: 'Expenses & Earnings'  },
      { to: '/dashboard/admin/financedashboard',       icon: UserCheck,    label: 'Finance Dashboard'        },
      
    ]},
    // { group: 'System',      items: [{ to: '/dashboard/admin/settings',     icon: Settings,     label: 'Settings'     }] },
  ],
  admin: [
    { group: 'Overview',    items: [{ to: '/dashboard/admin',              icon: LayoutDashboard, label: 'Dashboard'    }] },
    { group: 'Management',  items: [
      { to: '/dashboard/admin/employees',   icon: Users,        label: 'Employees'    },
      { to: '/dashboard/admin/departments', icon: Building2,    label: 'Departments'  },
      { to: '/dashboard/admin/shifts',      icon: Clock,        label: 'Shift Types'  },
      { to: '/dashboard/admin/shift-assignments', icon: Zap,      label: 'Shift Assignments' },
      { to: '/dashboard/admin/payroll',     icon: DollarSign,   label: 'Payroll'      },
      { to: '/dashboard/calender',     icon: CalendarCheck2Icon,   label: 'Calendar'      },
    ]},
    // { group: 'Access Control', items: [
    //   { to: '/dashboard/admin/roles',       icon: UserCheck,    label: 'Roles'        },
    //   { to: '/dashboard/admin/permissions', icon: Target,       label: 'Permissions'  },
    // ]},
    
    { group: 'Analytics',   items: [
      { to: '/dashboard/attendance',        icon: Clock,        label: 'Attendance'   },
      // { to: '/dashboard/performance',       icon: Target,       label: 'Performance'  },
      // { to: '/dashboard/manager/leaves',     icon: Calendar,    label: 'Leave Approvals' },
      { to: '/dashboard/reports',           icon: BarChart2,    label: 'Reports'      },
    ]},
    { group: 'Accounting & Finance', items: [
      { to: '/dashboard/admin/financedashboard',       icon: UserCheck,    label: 'Finance Dashboard'        },
      { to: '/dashboard/admin/expenses', icon: Target,       label: 'Expenses'  },
    ]},
  ],
  senior_manager: [
    { group: 'Overview',    items: [{ to: '/dashboard/manager',            icon: LayoutDashboard, label: 'Dashboard'    }] },
    { group: 'Management',        items: [
      // { to: '/dashboard/manager/performance', icon: TrendingUp,  label: 'Performance'  },
      { to: '/dashboard/manager/laterequestsapprovals',     icon: Calendar,    label: ' Requests & Approvals' },
      { to: '/dashboard/attendance',         icon: Clock,       label: 'Attendance'   },
      { to: '/dashboard/admin/employees',   icon: Users,        label: 'Employees'    },
      { to: '/dashboard/calender',     icon: CalendarCheck2Icon,   label: 'Calendar'      },

    ]},
    // { group: 'Recruitment', items: [
    //   { to: '/dashboard/recruiter/jobs',     icon: Briefcase,   label: 'Job Openings' },
    //   { to: '/dashboard/recruiter/pipeline', icon: UserCheck,   label: 'Pipeline'     },
    // ]},
    // { group: 'Analytics',   items: [{ to: '/dashboard/reports', icon: BarChart2, label: 'Reports' }] },
  ],
  hr_recruiter: [
    // { group: 'Overview',    items: [{ to: '/dashboard/recruiter',           icon: LayoutDashboard, label: 'Dashboard'    }] },
    // { group: 'Recruitment', items: [
    //   { to: '/dashboard/recruiter/jobs',    icon: Briefcase,    label: 'Job Listings' },
    //   { to: '/dashboard/recruiter/pipeline',icon: UserCheck,    label: 'Candidate Pipeline' },
    // ]},
    { group: 'HR Ops',      items: [
      { to: '/dashboard/attendance',        icon: Clock,        label: 'Attendance'   },
      // { to: '/dashboard/performance',       icon: Target,       label: 'Performance'  },
     { to: '/dashboard/manager/laterequestsapprovals',     icon: Calendar,    label: ' Requests & Approvals' },
      { to: '/dashboard/admin/shifts',      icon: Clock,        label: 'Shift Types'  },
      { to: '/dashboard/admin/shift-assignments', icon: Zap,      label: 'Shift Assignments' },
      { to: '/dashboard/reports',           icon: BarChart2,    label: 'Reports'      },
      { to: '/dashboard/calender',     icon: CalendarCheck2Icon,   label: 'Calendar'      },

    ]},
  ],
  employee: [
    { group: 'My Workspace', items: [{ to: '/dashboard/employee',          icon: LayoutDashboard, label: 'Dashboard'    }] },
    { group: 'My Data',     items: [
      { to: '/dashboard/employee/attendance', icon: Clock,      label: 'Attendance'   },
       { to: '/dashboard/calender',     icon: CalendarCheck2Icon,   label: 'Calendar'      },
      { to: '/dashboard/employee/shifts',     icon: Target,      label: 'Shifts'   },
      { to: '/dashboard/employee/payslips',   icon: DollarSign, label: 'Payslips'     },
      // { to: '/dashboard/employee/performance',icon: Target,     label: 'Performance'  },
      { to: '/dashboard/employee/leaves',     icon: Calendar,   label: 'Leaves'       },
      { to: '/dashboard/employee/laterequests',     icon: Calendar,   label: 'Late Requests'       },
      { to: '/dashboard/employee/profile',    icon: User,       label: 'My Profile'   },

    ]},
  ],
};

export default function Sidebar() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector(selectUser);
  const { sidebarOpen, sidebarCollapsed } = useSelector((s) => s.ui);
  const { unreadCount } = useSelector((s) => s.notifications);

  const navItems = NAV_CONFIG[user?.role] || NAV_CONFIG.employee;

  const handleLogout = () => {
    dispatch(logoutUser()).then(() => navigate('/login'));
  };

  return (
    <AnimatePresence>
      {sidebarOpen && (
                <motion.aside
          layout
          initial={{ x: -280 }}
          animate={{ x: 0 }}
          exit={{ x: -280 }}
          transition={spring.smooth}
          className={clsx(
            'fixed left-0 top-0 h-full z-30 flex flex-col',
            'bg-white dark:bg-surface-900 border-r border-slate-200 dark:border-white/5',
            sidebarCollapsed ? 'w-[72px]' : 'w-[260px]'
          )}
        >
          {/* Logo */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="flex items-center gap-3 px-4 h-16 border-b border-slate-200 dark:border-white/5 flex-shrink-0"
          >
            <motion.div
              whileHover={{ rotate: 8, scale: 1.05 }}
              transition={spring.snappy}
              className="w-8 h-8 rounded-lg flex-center flex-shrink-0 overflow-hidden"
            >
              <BrandMark className="w-8 h-8" textClassName="text-xs" />
            </motion.div>
            <AnimatePresence mode="wait">
              {!sidebarCollapsed && (
                <motion.div
                  key="logo-text"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.2 }}
                  className="min-w-0"
                >
                  <p className="font-display font-bold text-sm text-slate-900 dark:text-white truncate">
                    {displayName()}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Nav */}
                    {/* Nav */}
          <nav className="flex-1 overflow-y-auto py-4 px-2 no-scrollbar space-y-4">
            {navItems.map((group, groupIndex) => (
              <motion.div
                key={group.group}
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
                custom={groupIndex}
              >
                <AnimatePresence mode="wait">
                  {!sidebarCollapsed && (
                    <motion.p
                      key={`label-${group.group}`}
                      variants={fadeUp}
                      initial="hidden"
                      animate="visible"
                      className="px-3 mb-1.5 text-[10px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-widest"
                    >
                      {group.group}
                    </motion.p>
                  )}
                </AnimatePresence>
                <div className="space-y-0.5">
                  {group.items.map((item, itemIndex) => (
                    <SidebarNavItem
                      key={item.to}
                      item={item}
                      collapsed={sidebarCollapsed}
                      index={groupIndex * 10 + itemIndex}
                    />
                  ))}
                </div>
              </motion.div>
            ))}
          </nav>

          {/* User footer */}
                    {/* User footer */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={2}
            className="border-t border-slate-200 dark:border-white/5 p-2 flex-shrink-0"
          >
            {!sidebarCollapsed ? (
              <motion.div
                whileHover={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                className="flex items-center gap-2.5 px-2 py-2 rounded-xl transition-colors"
              >
                <motion.div
                  whileHover={{ scale: 1.08 }}
                  transition={spring.snappy}
                  className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex-center flex-shrink-0 overflow-hidden"
                >
                  {user?.avatar ? (
                    <img src={user.avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-white">
                      {user?.firstName?.[0]}{user?.lastName?.[0]}
                    </span>
                  )}
                </motion.div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-900 dark:text-white truncate">
                    {user?.firstName} {user?.lastName}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate capitalize">
                    {user?.role?.replace(/_/g, ' ')}
                  </p>
                </div>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleLogout}
                  className="text-slate-500 dark:text-slate-300 hover:text-danger-400 transition-colors p-1"
                  title="Logout"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </motion.button>
              </motion.div>
            ) : (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleLogout}
                className="w-full flex-center p-2.5 text-slate-500 dark:text-slate-300 hover:text-danger-400 hover:bg-danger-500/10 rounded-xl transition-all"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </motion.button>
            )}

            {/* Collapse toggle */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => dispatch(toggleSidebarCollapse())}
              className="hidden lg:flex w-full items-center justify-center mt-1 p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl transition-all text-xs gap-1"
            >
              <motion.span
                animate={{ rotate: sidebarCollapsed ? 180 : 0 }}
                transition={spring.smooth}
                className="flex items-center gap-1"
              >
                {sidebarCollapsed
                  ? <ChevronRight className="w-3.5 h-3.5" />
                  : <><ChevronLeft className="w-3.5 h-3.5" /><span>Collapse</span></>
                }
              </motion.span>
            </motion.button>
          </motion.div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
