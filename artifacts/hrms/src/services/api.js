import axios from 'axios';

const api = axios.create({
  // The HR API lives inside OmniCore's API.
  baseURL: import.meta.env.VITE_HRMS_API_URL || '/api/hrms/v1',
  timeout: 30000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor – attach token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor – handle 401 and token refresh
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

// Endpoints that should NEVER trigger the refresh-token flow.
// A 401 from these means "bad credentials" / "no session yet" —
// not "access token expired" — so let the error pass through as-is.
const AUTH_EXCLUDED_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh-token',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/sso',
];

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const isAuthExcluded = AUTH_EXCLUDED_PATHS.some((path) =>
      originalRequest?.url?.includes(path)
    );

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthExcluded) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await api.post('/auth/refresh-token');
        const newToken = data.accessToken;
        localStorage.setItem('accessToken', newToken);
        processQueue(null, newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('accessToken');
        window.location.href = '/hrms/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// API service helpers
export const authAPI = {
  login: (data) => api.post('/auth/login', data),
  register: (data) => api.post('/auth/register', data),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me'),
  changePassword: (data) => api.put('/auth/change-password', data),
  forgotPassword: (email, workspace) => api.post('/auth/forgot-password', { email, workspace }),
  resetPassword: (data) => api.post('/auth/reset-password', data),
};

export const employeeAPI = {
  getAll: (params) => api.get('/employees', { params }),
  getBirthdays: () => api.get('/employees/birthdays'),
  getById: (id) => api.get(`/employees/${id}`),
  create: (data) => api.post('/employees', data),
  update: (id, data) => api.put(`/employees/${id}`, data),
  delete: (id) => api.delete(`/employees/${id}`),
  updateStatus: (id, data) => api.patch(`/employees/${id}/status`, data),
  updateSalaryHold: (id, data) => api.patch(`/employees/${id}/salary-hold`, data),
  // Installment-based salary holds (separate from the legacy single-flag one above)
  createSalaryHold: (id, data) => api.post(`/employees/${id}/salary-holds`, data),
  getSalaryHolds: (id) => api.get(`/employees/${id}/salary-holds`),
  updateSalaryHoldRecord: (id, holdId, data) => api.patch(`/employees/${id}/salary-holds/${holdId}`, data),
  cancelSalaryHold: (id, holdId) => api.patch(`/employees/${id}/salary-holds/${holdId}/cancel`),
  clearSalaryHold: (id) => api.patch(`/employees/${id}/salary-holds/clear`),
  // Toggle back to "not clear" — places the employee's full basic salary on hold again
  holdSalary: (id) => api.patch(`/employees/${id}/salary-holds/hold`),
  addCredential: (id, data) => api.patch(`/employees/${id}/credentials`, data),
  removeCredential: (id, credId) => api.delete(`/employees/${id}/credentials/${credId}`),
  uploadAgreement: (id, file) => {
    const fd = new FormData();
    fd.append('agreement', file);
    return api.post(`/employees/${id}/agreement`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  uploadCnic: (id, front, back) => {
    const fd = new FormData();
    fd.append('cnicFront', front);
    fd.append('cnicBack', back);
    return api.post(`/employees/${id}/cnic`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  updateRoles: (id, data) => api.patch(`/employees/${id}/roles`, data),
  updatePermissions: (id, data) => api.patch(`/employees/${id}/permissions`, data),
  uploadAvatar: (id, file) => {
    const fd = new FormData();
    fd.append('avatar', file);
    return api.post(`/employees/${id}/avatar`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    
  },
  getMyProfile:    ()      => api.get('/employees/me/profile'),
  updateMyProfile: (data)  => api.put('/employees/me/profile', data),
};

export const shiftTypeAPI = {
  getAll: () => api.get('/shift-types'),
  create: (data) => api.post('/shift-types', data),
  update: (id, data) => api.put(`/shift-types/${id}`, data),
  delete: (id) => api.delete(`/shift-types/${id}`),
};

export const roleAPI = {
  getAll: () => api.get('/roles'),
  create: (data) => api.post('/roles', data),
  update: (id, data) => api.put(`/roles/${id}`, data),
  delete: (id) => api.delete(`/roles/${id}`),
};

export const permissionAPI = {
  getAll: () => api.get('/permissions'),
  create: (data) => api.post('/permissions', data),
  update: (id, data) => api.put(`/permissions/${id}`, data),
  delete: (id) => api.delete(`/permissions/${id}`),
};

export const shiftAssignmentAPI = {
  getAll: (params) => api.get('/shift-assignments', { params }),
  create: (data) => api.post('/shift-assignments', data),
  update: (id, data) => api.put(`/shift-assignments/${id}`, data),
  delete: (id) => api.delete(`/shift-assignments/${id}`),
};

export const departmentAPI = {
  getAll:   ()         => api.get('/departments'),
  getById:  (id)       => api.get(`/departments/${id}`),
  create:   (data)     => api.post('/departments', data),
  update:   (id, data) => api.put(`/departments/${id}`, data),
  delete:   (id)       => api.delete(`/departments/${id}`),
};

export const stationAPI = {
  getAll: () => api.get('/stations'),
  create: (data) => api.post('/stations', data),
  update: (stationId, data) => api.patch(`/stations/${stationId}`, data),
};
 


export const attendanceAPI = {
  checkIn:        (data)   => api.post('/attendance/checkin', data),
  checkOut:       (data)   => api.post('/attendance/checkout', data),
  getToday:       ()       => api.get('/attendance/today'),
  getHistory:     (params) => api.get('/attendance', { params }),
  getReport:      (params) => api.get('/attendance/report', { params }),
  getMyStats:     (params) => api.get('/attendance/my-stats', { params }),
  getAdminToday:  ()       => api.get('/attendance/admin/today'),   // ← new
  getAdminWeekly: ()       => api.get('/attendance/admin/weekly'),  // ← new
  getAdminRange:  (params) => api.get('/attendance/admin/range', { params }), // ← new
  rectify: (data) => api.patch('/attendance/rectify', data),

};

export const payrollAPI = {
  getAll:          (params)     => api.get('/payroll', { params }),
  getMine:         (params)     => api.get('/payroll/mine', { params }),   // ← employee self-service
  getTrend:        ()           => api.get('/payroll/trend'),
  getEligible:     (params)     => api.get('/payroll/eligible', { params }),
  run:             (data)       => api.post('/payroll/run', data),
  approve:         (id)         => api.patch(`/payroll/${id}/approve`),
  update: (id, data) => api.patch(`/payroll/${id}`, data),
  remove: (id) => api.delete(`/payroll/${id}`),
  generatePayslip: (id)         => api.get(`/payroll/${id}/payslip`, { responseType: 'blob' }),
};
export const advanceAPI = {
  getAll:      (params) => api.get('/advances', { params }),
  getSummary:  (empId)  => api.get(`/advances/summary/${empId}`),
  create:      (data)   => api.post('/advances', data),
  approve:     (id)     => api.patch(`/advances/${id}/approve`),
  reject:      (id, data) => api.patch(`/advances/${id}/reject`, data),
  cancel:      (id)     => api.delete(`/advances/${id}`),
};
export const recruitmentAPI = {
  getJobs: (params) => api.get('/recruitment/jobs', { params }),
  createJob: (data) => api.post('/recruitment/jobs', data),
  updateJob: (id, data) => api.put(`/recruitment/jobs/${id}`, data),
  getApplications: (params) => api.get('/recruitment/applications', { params }),
  applyJob: (data) => {
    const fd = new FormData();
    Object.entries(data).forEach(([k, v]) => fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v));
    return api.post('/recruitment/applications', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  updateStage: (id, data) => api.patch(`/recruitment/applications/${id}/stage`, data),
  getPipelineStats: () => api.get('/recruitment/pipeline/stats'),
};

export const performanceAPI = {
  getReviews: (params) => api.get('/performance', { params }),
  createReview: (data) => api.post('/performance', data),
  updateReview: (id, data) => api.put(`/performance/${id}`, data),
  submitSelfAssessment: (id, data) => api.post(`/performance/${id}/self-assessment`, data),
};

export const aiAPI = {
  chat: (messages) => api.post('/ai/chat', { messages }),
  getStatus: () => api.get('/ai/status'),
  getPerformanceInsights: (data) => api.post('/ai/performance-insights', data),
  optimizePayroll: (data) => api.post('/ai/payroll-optimize', data),
};

export const dashboardAPI = {
  getAdminStats: () => api.get('/dashboard/admin'),
  getManagerStats: () => api.get('/dashboard/manager'),
  getEmployeeStats: () => api.get('/dashboard/employee'),
};

export const notificationAPI = {
  getAll: () => api.get('/notifications'),
  markRead: (id) => api.patch(`/notifications/${id}/read`),
};

export const activityLogAPI = {
  getAll: () => api.get('/activity-logs/all'),
  getAllCurrent: () => api.get('/activity-logs/all-current'),
  getScreenshots: (employeeId) => api.get('/activity-logs/screenshots', { params: { employeeId, limit: 100 } }),
  deleteScreenshot: (screenshotId) => api.delete(`/activity-logs/screenshots/${screenshotId}`),
  deleteAllScreenshots: (employeeId) => api.delete('/activity-logs/screenshots', { params: { employeeId } }),
  getCurrentLogContent: (employeeId) => api.get(`/activity-logs/${employeeId}/current/content`),
  getHistory: (employeeId) => api.get(`/activity-logs/${employeeId}/history`),
  getStationByShift: (stationId, month) => api.get(`/activity-logs/station/${stationId}/by-shift`, { params: { month } }),
  getScreenshotStorageStats: () => api.get('/activity-logs/screenshots/storage-stats'),
};

export const leaveAPI = {
  getAll: (params) => api.get('/leaves', { params }),
  create: (data) => api.post('/leaves', data),
  approve: (id, data) => api.patch(`/leaves/${id}/approve`, data),
  reject: (id, data) => api.patch(`/leaves/${id}/reject`, data),
  convertToUnpaid: (id, data) => api.patch(`/leaves/${id}/convert-unpaid`, data),
};

export const calendarEventAPI = {
  getAll: () => api.get('/calendar-events'),
  create: (data) => api.post('/calendar-events', data),
  update: (id, data) => api.put(`/calendar-events/${id}`, data),   // ✅ api, not axios
  delete: (id) => api.delete(`/calendar-events/${id}`),  
};
// ─── Add these exports to your existing api.js file ───────────────────────
// Paste below the existing exports
 
export const expenseAPI = {
  getAll:      (params) => api.get('/expenses', { params }),
  getSummary:  (params) => api.get('/expenses/summary', { params }),
  getYearly:   (params) => api.get('/expenses/yearly', { params }),
  getLiabilities: (params) => api.get('/expenses/liabilities', { params }),
  updateReturnStatus: (id, payload) => api.patch(`/expenses/${id}/return-status`, payload),
  getById:     (id)     => api.get(`/expenses/${id}`),
  create:      (data)   => api.post('/expenses', data),
  update:      (id, data) => api.put(`/expenses/${id}`, data),
  delete:      (id)     => api.delete(`/expenses/${id}`),
  // inside expenseAPI in services/api.js
};
 
export const earningAPI = {
  getAll:      (params) => api.get('/earnings', { params }),
  getSummary:  (params) => api.get('/earnings/summary', { params }),
  getYearly:   (params) => api.get('/earnings/yearly', { params }),
  getById:     (id)     => api.get(`/earnings/${id}`),
  create:      (data)   => api.post('/earnings', data),
  update:      (id, data) => api.put(`/earnings/${id}`, data),
  delete:      (id)     => api.delete(`/earnings/${id}`),
};
 
export const financeAPI = {
  getDashboard:    (params) => api.get('/finance/dashboard', { params }),
  getYearlySummary:(params) => api.get('/finance/yearly-summary', { params }),
  getSettings:     ()       => api.get('/finance/settings'),
  updateRate:      (data)   => api.patch('/finance/settings/rate', data),
  addPerson:       (data)   => api.post('/finance/settings/persons', data),
  removePerson:    (id)     => api.delete(`/finance/settings/persons/${id}`),
  addOwner:        (data)   => api.post('/finance/settings/owners', data),
  removeOwner:     (id)     => api.delete(`/finance/settings/owners/${id}`),
};

export const performanceBonusAPI = {
  getAll:  (params) => api.get('/performance-bonuses', { params }),
  create:  (data)   => api.post('/performance-bonuses', data),
  revoke:  (id)     => api.delete(`/performance-bonuses/${id}`),
};

export const expenseCategoryAPI = {
  getAll:  ()       => api.get('/expense-categories'),
  create:  (data)   => api.post('/expense-categories', data),
  update:  (id, data) => api.put(`/expense-categories/${id}`, data),
  delete:  (id)     => api.delete(`/expense-categories/${id}`),
};

export const fixedExpenseAPI = {
  getAll:  ()       => api.get('/fixed-expenses'),
  create:  (data)   => api.post('/fixed-expenses', data),
  update:  (id, data) => api.put(`/fixed-expenses/${id}`, data),
  toggle:  (id, enabled) => api.patch(`/fixed-expenses/${id}/toggle`, { enabled }),
  delete:  (id)     => api.delete(`/fixed-expenses/${id}`),
};

export const loanAPI = {
  getAll: (params) => api.get('/loans', { params }),               // Fetch with query strings: ?status=active
  create: (data)   => api.post('/loans', data),                    // Request body items: { employee, loanAmount, interestPercentage, tenureMonths, termsAndConditions }
  update: (id, data) => api.put(`/loans/${id}`, data),             // Modifies status or manually adjusts parameters
  delete: (id)     => api.delete(`/loans/${id}`),                  // Deletes a pending/new loan setup safely
};

 export const salaryHoldAPI = {
  // Manual toggle bypass when admin clears it directly on the frontend
  clearManually: (employeeId) => api.patch(`/employee/${employeeId}/clear-salary-hold`),
};
export const shiftSwapAPI = {
  create: (data) => api.post('/shift-swap-requests', data),
  getMine: () => api.get('/shift-swap-requests/mine'),
  cancel: (id) => api.delete(`/shift-swap-requests/${id}`),
  getAll: (params) => api.get('/shift-swap-requests', { params }),
  updateStatus: (id, data) => api.patch(`/shift-swap-requests/${id}/status`, data),
  getDirectory: (params) => api.get('/employees/directory', { params }),
};
export const lateRequestAPI = {
  getMine:  (params)      => api.get('/late-requests/mine', { params }),
  getAll:   (params)      => api.get('/late-requests', { params }),
  create:   (data)        => api.post('/late-requests', data),
  approve:  (id, note)    => api.patch(`/late-requests/${id}/approve`, { note }),
  reject:   (id, note)    => api.patch(`/late-requests/${id}/reject`, { note }),
  cancel:   (id)          => api.delete(`/late-requests/${id}`),
};
export const workFromHomeAPI = {
  getAll:  (params) => api.get('/work-from-home-requests', { params }),
  create:  (data) => api.post('/work-from-home-requests', data),
  approve: (id, data) => api.patch(`/work-from-home-requests/${id}/approve`, data),
  reject:  (id, data) => api.patch(`/work-from-home-requests/${id}/reject`, data),
};
export default api;
