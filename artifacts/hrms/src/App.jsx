import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { fetchCurrentUser } from '@/store/slices/authSlice';
import { selectAuth, selectUserRole } from '@/store/slices/authSlice';

// Layout
import DashboardLayout from '@/components/layout/DashboardLayout';
import AuthLayout from '@/components/layout/AuthLayout';

// Auth pages
import LoginPage from '@/pages/auth/LoginPage';
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage';
import SsoPage from '@/pages/auth/SsoPage';

// Admin pages
import AdminDashboard from '@/pages/admin/AdminDashboard';
import EmployeeManagement from '@/pages/admin/EmployeeManagement';
import PayrollManagement from '@/pages/admin/PayrollManagement';
import DepartmentManagement from '@/pages/admin/DepartmentManagement';
import ShiftTypeManagement from '@/pages/admin/ShiftTypeManagement';
import ShiftAssignmentManagement from '@/pages/admin/ShiftAssignmentManagement';
import RoleManagement from '@/pages/admin/RoleManagement';
import PermissionManagement from '@/pages/admin/PermissionManagement';
import SystemSettings from '@/pages/admin/SystemSettings';

// Manager pages
import ManagerDashboard from '@/pages/manager/ManagerDashboard';
import TeamPerformance from '@/pages/manager/TeamPerformance';
import LeaveApprovals from '@/pages/manager/LeaveApprovals';

// HR Recruiter pages
import RecruiterDashboard from '@/pages/recruiter/RecruiterDashboard';
import JobListings from '@/pages/recruiter/JobListings';
import ApplicationPipeline from '@/pages/recruiter/ApplicationPipeline';
import CandidateProfile from '@/pages/recruiter/CandidateProfile';

// Employee pages
import EmployeeDashboard from '@/pages/employee/EmployeeDashboard';
import MyAttendance from '@/pages/employee/MyAttendance';
import MyPayslips from '@/pages/employee/MyPayslips';
import MyPerformance from '@/pages/employee/MyPerformance';
import MyLeaves from '@/pages/employee/MyLeaves';
import MyProfile from '@/pages/employee/MyProfile';

// Shared pages
import AttendancePage from '@/pages/shared/AttendancePage';
import PerformancePage from '@/pages/shared/PerformancePage';
import ReportsPage from '@/pages/shared/ReportsPage';
import CalenderPage from '@/pages/shared/CalenderPage';

// Components
import LoadingScreen from '@/components/common/LoadingScreen';
import NotFoundPage from '@/pages/NotFoundPage';

import ExpensesPage      from '@/pages/admin/Expensespage';
import FinanceDashboard  from '@/pages/admin/Financedashboard';
import MyShifts from '@/pages/employee/MyShifts'; // match your actual path
import MyLateRequests  from '@/pages/employee/MyLateRequests'; // match your actual path
import LateReuestsApprovals  from '@/pages/manager/LateReuestsApprovals'; // match your actual path
import ActivityDashboard  from '@/pages/admin/ActivityDashboard'; // match your actual path
import ActivityLogs from '@/pages/admin/ActivityLogs';



// Role-based redirect
const getRoleDefaultPath = (role) => {
  switch (role) {
    case 'super_admin':
    case 'admin':         return '/dashboard/admin';
    case 'senior_manager': return '/dashboard/manager';
    case 'hr_recruiter':  return '/dashboard/recruiter';
    case 'employee':      return '/dashboard/employee';
    default:              return '/login';
  }
};

// Protected route
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { isAuthenticated, isInitializing, user } = useSelector(selectAuth);
  if (isInitializing) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to={getRoleDefaultPath(user?.role)} replace />;
  }
  return children;
};

// Public route (redirect if authenticated)
const PublicRoute = ({ children }) => {
  const { isAuthenticated, isInitializing, user } = useSelector(selectAuth);
  if (isInitializing) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to={getRoleDefaultPath(user?.role)} replace />;
  return children;
};

export default function App() {
  const dispatch = useDispatch();
  const { accessToken } = useSelector(selectAuth);

  useEffect(() => {
    if (accessToken) {
      dispatch(fetchCurrentUser());
    } else {
      // setInitialized
      import('@/store/slices/authSlice').then(({ setInitialized }) => {
        dispatch(setInitialized());
      });
    }
  }, [dispatch, accessToken]);

  return (
    <Routes>
      {/* Public routes */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
        <Route path="/reset-password" element={<PublicRoute><ResetPasswordPage /></PublicRoute>} />
      </Route>

      {/* Protected dashboard routes */}
      <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        {/* Admin */}
        <Route path="admin" element={
          <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
            <AdminDashboard />
          </ProtectedRoute>
        } />
        <Route path="admin/employees" element={
          <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
            <EmployeeManagement />
          </ProtectedRoute>
        } />
        <Route path="admin/payroll" element={
          <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
            <PayrollManagement />
          </ProtectedRoute>
        } />
        <Route path="admin/departments" element={
          <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
            <DepartmentManagement />
          </ProtectedRoute>
        } />
        <Route path="admin/shifts" element={
          <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
            <ShiftTypeManagement />
          </ProtectedRoute>
        } />
        <Route path="admin/shift-assignments" element={
          <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
            <ShiftAssignmentManagement />
          </ProtectedRoute>
        } />
        <Route path="admin/roles" element={
          <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
            <RoleManagement />
          </ProtectedRoute>
        } />
        <Route path="admin/permissions" element={
          <ProtectedRoute allowedRoles={['super_admin', 'admin']}>
            <PermissionManagement />
          </ProtectedRoute>
        } />
        <Route path="admin/settings" element={
          <ProtectedRoute allowedRoles={['super_admin']}>
            <SystemSettings />
          </ProtectedRoute>
        } />
          <Route path="admin/financedashboard" element={
          <ProtectedRoute allowedRoles={['super_admin']}>
            <FinanceDashboard />
          </ProtectedRoute>
        } />
        <Route path="admin/expenses" element={
          <ProtectedRoute allowedRoles={['super_admin']}>
            <ExpensesPage />
          </ProtectedRoute>
        } />
        <Route path="admin/activitylogs" element={
          <ProtectedRoute allowedRoles={['super_admin']}>
            <ActivityLogs />
          </ProtectedRoute>
        } />
        <Route path="admin/activitydashboard" element={
          <Navigate to="/dashboard/admin/activitylogs" replace />
        } />

        {/* Manager */}
        <Route path="manager" element={
          <ProtectedRoute allowedRoles={['senior_manager', 'super_admin', 'admin']}>
            <ManagerDashboard />
          </ProtectedRoute>
        } />
        <Route path="manager/performance" element={
          <ProtectedRoute allowedRoles={['senior_manager', 'super_admin', 'admin']}>
            <TeamPerformance />
          </ProtectedRoute>
        } />
        <Route path="manager/leaves" element={
          <ProtectedRoute allowedRoles={['senior_manager', 'super_admin', 'admin']}>
            <LeaveApprovals />
          </ProtectedRoute>
        } />
        <Route path="manager/laterequestsapprovals" element={
          <ProtectedRoute allowedRoles={['senior_manager', 'super_admin', 'admin']}>
            <LateReuestsApprovals />
          </ProtectedRoute>
        } />

        {/* Recruiter */}
        <Route path="recruiter" element={
          <ProtectedRoute allowedRoles={['hr_recruiter', 'senior_manager', 'super_admin', 'admin']}>
            <RecruiterDashboard />
          </ProtectedRoute>
        } />
        <Route path="recruiter/jobs" element={
          <ProtectedRoute allowedRoles={['hr_recruiter', 'senior_manager', 'super_admin', 'admin']}>
            <JobListings />
          </ProtectedRoute>
        } />
        <Route path="recruiter/pipeline" element={
          <ProtectedRoute allowedRoles={['hr_recruiter', 'senior_manager', 'super_admin', 'admin']}>
            <ApplicationPipeline />
          </ProtectedRoute>
        } />
        <Route path="recruiter/candidates/:id" element={
          <ProtectedRoute allowedRoles={['hr_recruiter', 'senior_manager', 'super_admin', 'admin']}>
            <CandidateProfile />
          </ProtectedRoute>
        } />

        {/* Employee */}
        <Route path="employee" element={
          <ProtectedRoute allowedRoles={['employee', 'hr_recruiter', 'senior_manager', 'super_admin', 'admin']}>
            <EmployeeDashboard />
          </ProtectedRoute>
        } />
        <Route path="employee/attendance" element={<ProtectedRoute><MyAttendance /></ProtectedRoute>} />
        <Route path="employee/payslips"   element={<ProtectedRoute><MyPayslips /></ProtectedRoute>} />
        <Route path="employee/performance" element={<ProtectedRoute><MyPerformance /></ProtectedRoute>} />
        <Route path="employee/leaves"     element={<ProtectedRoute><MyLeaves /></ProtectedRoute>} />
        <Route path="employee/profile"    element={<ProtectedRoute><MyProfile /></ProtectedRoute>} />
        <Route path="employee/shifts"     element={<ProtectedRoute><MyShifts /></ProtectedRoute>} />
        <Route path="employee/laterequests" element={<ProtectedRoute><MyLateRequests /></ProtectedRoute>} />
        {/* Shared */}
        <Route path="attendance" element={<ProtectedRoute><AttendancePage /></ProtectedRoute>} />
        <Route path="performance" element={<ProtectedRoute><PerformancePage /></ProtectedRoute>} />
        <Route path="reports"    element={<ProtectedRoute allowedRoles={['super_admin','admin','senior_manager']}><ReportsPage /></ProtectedRoute>} />
        <Route path="calender"    element={<ProtectedRoute allowedRoles={['super_admin','admin','senior_manager','hr_recruiter','employee']}><CalenderPage /></ProtectedRoute>} />

      </Route>

      {/* Default redirects */}
      <Route path="/sso" element={<SsoPage />} />
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
