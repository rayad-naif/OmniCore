import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Filter, Download, Upload, MoreVertical, Edit, Trash2, Eye, Settings, UserCheck, X, Wallet, Loader2, Lock, BarChart3, StickyNote, Monitor } from 'lucide-react';
import { employeeAPI, departmentAPI, performanceBonusAPI, stationAPI, shiftAssignmentAPI } from '@/services/api';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const STATUS_COLORS = {
  active:      'badge-success',
  on_leave:    'badge-warning',
  probation:   'badge-primary',
  resigned:    'badge-danger',
  terminated:  'badge-danger',
};


const ROLE_LABELS = {
  super_admin:    'Super Admin',
  admin:          'Admin',
  senior_manager: 'Sr. Manager',
  hr_recruiter:   'HR Recruiter',
  employee:       'Employee',
};

const HOLD_STATUS = {
  not_clear: { cls: 'badge-warning', label: 'Not Clear' },
  clear:     { cls: 'badge-success', label: 'Clear'     },
};

export default function EmployeeManagement() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editActiveTab, setEditActiveTab] = useState('details');
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const limit = 12;

  // Hold Salary panel — lists every employee with a clear/not-clear toggle
  const [showHoldSalaryModal, setShowHoldSalaryModal] = useState(false);
  const [holdSalaryEmployees, setHoldSalaryEmployees] = useState([]);
  const [holdSalaryLoading, setHoldSalaryLoading] = useState(false);
  const [holdTogglingId, setHoldTogglingId] = useState(null);

  // Payroll-based SalaryHold records per employee — fetched when Hold Salary modal opens
  // { [empId]: SalaryHoldRecord | null } — null means no active installment-based hold
  const [payrollHoldsMap, setPayrollHoldsMap] = useState({});
  // Full Hold Salary form (same as Payroll Management popup) — opened for clear employees
  const [showHoldFormModal, setShowHoldFormModal] = useState(false);
  const [holdFormTargetEmp, setHoldFormTargetEmp] = useState(null);

  // Edit / delete an existing installment-based hold record, directly from
  // the Hold Salary panel — { emp, hold } | null
  const [editHoldTarget, setEditHoldTarget] = useState(null);
  const [cancellingHoldId, setCancellingHoldId] = useState(null);

  // ── Hold Salary Stats modal ──────────────────────────────────────────────
  // Shows hold records only for employees whose salary is still on hold.
  const [showHoldStatsModal, setShowHoldStatsModal] = useState(false);
  const [holdStatsRows, setHoldStatsRows] = useState([]);   // [{ emp, hold }]
  const [holdStatsLoading, setHoldStatsLoading] = useState(false);
  const [holdStatsEditTarget, setHoldStatsEditTarget] = useState(null); // { emp, hold }
  const [holdStatsCancellingId, setHoldStatsCancellingId] = useState(null);
  const [holdStatsStatusFilter, setHoldStatsStatusFilter] = useState('all');

  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showCreateStationModal, setShowCreateStationModal] = useState(false);
  const [newStationLabel, setNewStationLabel] = useState('');
  const [creatingStation, setCreatingStation] = useState(false);
  const [selectedStationId, setSelectedStationId] = useState('');
  const [pcEmployees, setPcEmployees] = useState([]);
  const [pcEmployeesLoading, setPcEmployeesLoading] = useState(false);
  const [pcEmployeeSearch, setPcEmployeeSearch] = useState('');
  const [selectedPcEmployeeIds, setSelectedPcEmployeeIds] = useState(new Set());
  const [showAssignStationsModal, setShowAssignStationsModal] = useState(false);
  const [assignStationsEmployee, setAssignStationsEmployee] = useState(null);
  const [assignStationsEmployeeUserId, setAssignStationsEmployeeUserId] = useState(null);
  const [stations, setStations] = useState([]);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [selectedStations, setSelectedStations] = useState(new Set());
  const [assignSaving, setAssignSaving] = useState(false);
  const [advancedEmployee, setAdvancedEmployee] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [newCredential, setNewCredential] = useState({
    application: '',
    loginUrl: '',
    usernameOrEmail: '',
    password: '',
    twoFactorAuthentication: '',
    securityQa: '',
    notes: '',
  });
  const [advancedFormData, setAdvancedFormData] = useState({
    id: '',
    role: 'employee',
    shiftType: 'morning',
    shiftStartTime: '09:00',
    shiftEndTime: '18:00',
    workMode: 'office',
    breakEnabled: true,
    breakDurationMinutes: 60,
    roles: '',
    permissions: '',
  });
  const [agreementFile, setAgreementFile] = useState(null);
  const [cnicFiles, setCnicFiles] = useState({ front: null, back: null });
  const [editFormData, setEditFormData] = useState({
    id: '',
    firstName: '',
    lastName: '',
    email: '',
    role: 'employee',
    department: '',
    position: '',
    phone: '',
    dateOfJoining: new Date().toISOString().split('T')[0],
    status: 'active',
    shiftType: 'morning',
    shiftStartTime: '09:00',
    shiftEndTime: '18:00',
    workMode: 'office',
    breakEnabled: true,
    breakDurationMinutes: 60,
    salaryBasic: 0,
    salaryAllowances: 0,
    salaryHold: 0,
    salaryHoldStatus: 'clear',
    reason: '',
    roles: '',
    permissions: '',
    salaryCurrency: 'PKR',
  });
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: 'employee',
    department: '',
    position: '',
    phone: '',
    dateOfJoining: new Date().toISOString().split('T')[0],
    status: 'active',
    shiftType: 'morning',
    shiftStartTime: '09:00',
    shiftEndTime: '18:00',
    workMode: 'office',
    breakEnabled: true,
    breakDurationMinutes: 60,
    salaryBasic: 0,
    salaryAllowances: 0,
    salaryHold: 0,
    salaryHoldStatus: 'clear',
    roles: '',
    permissions: '',
    password: '',
    salaryCurrency: 'PKR',
  });

  const fetchDepartments = useCallback(async () => {
    try {
      const { data } = await departmentAPI.getAll();
      setDepartments(data.data || []);
    } catch (error) {
      console.error('Failed to fetch departments:', error);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleEditChange = (e) => {
    const { name, value, type, checked } = e.target;
    setEditFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleCredentialChange = (e) => {
    const { name, value } = e.target;
    setNewCredential((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleAgreementFileChange = (e) => {
    setAgreementFile(e.target.files?.[0] || null);
  };

  const handleCnicFileChange = (side) => (e) => {
    setCnicFiles((prev) => ({ ...prev, [side]: e.target.files?.[0] || null }));
  };

  const addCredential = async () => {
    if (!editFormData.id) return;
    if (!newCredential.application || !newCredential.usernameOrEmail || !newCredential.password) {
      toast.error('Please provide the application, username or email, and password');
      return;
    }
    try {
      const { data } = await employeeAPI.addCredential(editFormData.id, newCredential);
      if (data.success) {
        toast.success('Credential added');
        const { data: refreshed } = await employeeAPI.getById(editFormData.id);
        setSelectedEmployee(refreshed.data);
        setNewCredential({ application: '', loginUrl: '', usernameOrEmail: '', password: '', twoFactorAuthentication: '', securityQa: '', notes: '' });
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not add credential');
    }
  };

  const removeCredential = async (credId) => {
    if (!editFormData.id) return;
    try {
      const { data } = await employeeAPI.removeCredential(editFormData.id, credId);
      if (data.success) {
        toast.success('Credential removed');
        const { data: refreshed } = await employeeAPI.getById(editFormData.id);
        setSelectedEmployee(refreshed.data);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not remove credential');
    }
  };

  const uploadAgreement = async () => {
    if (!editFormData.id || !agreementFile) {
      toast.error('Please select an agreement file');
      return;
    }
    try {
      const { data } = await employeeAPI.uploadAgreement(editFormData.id, agreementFile);
      if (data.success) {
        toast.success('Agreement uploaded successfully');
        const { data: refreshed } = await employeeAPI.getById(editFormData.id);
        setSelectedEmployee(refreshed.data);
        setAgreementFile(null);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Agreement upload failed');
    }
  };

  const uploadCnic = async () => {
    if (!editFormData.id || !cnicFiles.front || !cnicFiles.back) {
      toast.error('Please select both CNIC front and back images');
      return;
    }
    try {
      const { data } = await employeeAPI.uploadCnic(editFormData.id, cnicFiles.front, cnicFiles.back);
      if (data.success) {
        toast.success('CNIC images uploaded successfully');
        const { data: refreshed } = await employeeAPI.getById(editFormData.id);
        setSelectedEmployee(refreshed.data);
        setCnicFiles({ front: null, back: null });
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'CNIC upload failed');
    }
  };

  const openViewModal = async (id) => {
    try {
      setDetailsLoading(true);
      const { data } = await employeeAPI.getById(id);
      setSelectedEmployee(data.data);
      setShowViewModal(true);
    } catch (error) {
      toast.error('Failed to load employee details');
    } finally {
      setDetailsLoading(false);
    }
  };

  const openEditModal = async (id) => {
    try {
      setDetailsLoading(true);
      const { data } = await employeeAPI.getById(id);
      const emp = data.data;
      setAgreementFile(null);
      setCnicFiles({ front: null, back: null });

      let salaryHoldActive = false;
      let salaryHoldRemaining = 0;
      try {
        const { data: holdsRes } = await employeeAPI.getSalaryHolds(id);
        const activeHolds = (holdsRes.data || []).filter((h) => h.status === 'active');
        salaryHoldActive = activeHolds.length > 0;
        salaryHoldRemaining = activeHolds.reduce((sum, h) => sum + (h.remainingBalance || 0), 0);
      } catch {
        // Non-fatal — toggle will just show as "no active hold"
      }

      const employeeData = {
        id: emp._id || emp.id,
        firstName: emp.firstName || '',
        lastName: emp.lastName || '',
        email: emp.email || '',
        role: emp.role || 'employee',
        department: emp.department?._id || emp.department || '',
        position: emp.position || '',
        phone: emp.phone || '',
        dateOfJoining: emp.dateOfJoining ? new Date(emp.dateOfJoining).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        // salary lives on the User document (emp.salary), not on the Employee profile
        salaryCurrency: emp.salary?.currency ?? 'PKR',
        status: emp.status || 'active',
        salaryBasic: emp.salary?.basic ?? 0,
        salaryAllowances: emp.salary?.allowances ?? 0,
        salaryHold: emp.employeeProfile?.salaryHold?.amount ?? emp.salaryHold?.amount ?? 0,
        salaryHoldStatus: emp.employeeProfile?.salaryHold?.status ?? 'clear',
        salaryHoldActive,
        salaryHoldRemaining,
        reason: emp.employeeProfile?.salaryHold?.reason ?? '',
      };
      setEditFormData(employeeData);
      setSelectedEmployee(emp);
      setEditActiveTab('details');
      setShowEditModal(true);
    } catch (error) {
      toast.error('Failed to load employee for edit');
    } finally {
      setDetailsLoading(false);
    }
  };

  const openAdvancedModal = async (id) => {
    try {
      setDetailsLoading(true);
      const { data } = await employeeAPI.getById(id);
      const emp = data.data;
      setAdvancedEmployee(emp);
      setAdvancedFormData({
        id: emp._id || emp.id,
        role: emp.role || 'employee',
        shiftType: emp.employeeProfile?.shift?.type || 'morning',
        shiftStartTime: emp.employeeProfile?.shift?.startTime || '09:00',
        shiftEndTime: emp.employeeProfile?.shift?.endTime || '18:00',
        workMode: emp.employeeProfile?.shift?.workMode || 'office',
        breakEnabled: emp.employeeProfile?.shift?.breakEnabled ?? true,
        breakDurationMinutes: emp.employeeProfile?.shift?.breakDurationMinutes || 60,
        roles: emp.roles ? emp.roles.join(', ') : '',
        permissions: emp.permissions ? emp.permissions.join(', ') : '',
      });
      setShowAdvancedModal(true);
    } catch (error) {
      toast.error('Failed to load employee advanced settings');
    } finally {
      setDetailsLoading(false);
    }
  };

  const fetchStations = async () => {
    setStationsLoading(true);
    try {
      const { data } = await stationAPI.getAll();
      setStations(data.data || []);
    } catch (err) {
      console.error('Failed to load stations:', err);
      toast.error('Could not load stations');
    } finally {
      setStationsLoading(false);
    }
  };

  const openAssignStationsModal = async (employeeId) => {
    try {
      setStationsLoading(true);
      const [{ data: stationsRes }, { data: empRes }] = await Promise.all([
        stationAPI.getAll(),
        employeeAPI.getById(employeeId),
      ]);
      const stationsList = stationsRes.data || [];
      setStations(stationsList);

      const employeeProfileId = empRes.data.employeeProfile?._id || empRes.data.employeeProfile?.id;
      const employeeUserId = empRes.data._id || empRes.data.id;
      const assignId = employeeProfileId || employeeUserId;

      const assignedSet = new Set();
      for (const s of stationsList) {
        const assigned = (s.assignedEmployees || []).map((a) => (a._id ? a._id : a));
        if (
          assigned.includes(assignId) ||
          assigned.includes(employeeUserId) ||
          assigned.includes(employeeProfileId)
        ) {
          assignedSet.add(s.stationId);
        }
      }
      setSelectedStations(assignedSet);
      setAssignStationsEmployee(assignId);
      setAssignStationsEmployeeUserId(employeeUserId);
      setShowAssignStationsModal(true);
    } catch (err) {
      console.error('Failed to load stations or employee:', err);
      toast.error('Could not load stations');
    } finally {
      setStationsLoading(false);
    }
  };

  const toggleStationSelection = (stationId) => {
    setSelectedStations((prev) => {
      const copy = new Set(prev);
      if (copy.has(stationId)) copy.delete(stationId); else copy.add(stationId);
      return copy;
    });
  };

  const saveAssignedStations = async () => {
    if (!assignStationsEmployee) return;
    setAssignSaving(true);
    try {
      const promises = stations.map((s) => {
        const current = (s.assignedEmployees || []).map((a) => (a._id ? a._id : a));
        const shouldHave = selectedStations.has(s.stationId);
        const has = current.includes(assignStationsEmployee);
        const updated = current
          .filter((id) => id !== assignStationsEmployeeUserId)
          .filter((id) => id !== assignStationsEmployee)
          .slice();

        if (shouldHave) updated.push(assignStationsEmployee);

        return stationAPI.update(s.stationId, { assignedEmployees: updated });
      });
      await Promise.all(promises);
      toast.success('Station assignments updated');
      setShowAssignStationsModal(false);
      setAssignStationsEmployee(null);
      setAssignStationsEmployeeUserId(null);
      await fetchStations();
      fetchEmployees();
    } catch (err) {
      console.error('Failed to update station assignments:', err);
      toast.error('Failed to save assignments');
    } finally {
      setAssignSaving(false);
    }
  };

  const closeAdvancedModal = () => {
    setShowAdvancedModal(false);
    setAdvancedEmployee(null);
    setAdvancedFormData({
      id: '',
      role: 'employee',
      shiftType: 'morning',
      shiftStartTime: '09:00',
      shiftEndTime: '18:00',
      workMode: 'office',
      breakEnabled: true,
      breakDurationMinutes: 60,
      roles: '',
      permissions: '',
    });
  };

  // PCs auto-register themselves the first time logger.py checks in, so this
  // form only ever edits an existing one — it never creates a new station.
  const saveStationDetails = async () => {
    if (!selectedStationId) return;

    if (!newStationLabel.trim()) {
      toast.error('Please enter a label');
      return;
    }

    setCreatingStation(true);
    try {
      const payload = {
        label: newStationLabel.trim(),
        assignedEmployees: Array.from(selectedPcEmployeeIds),
      };
      const { data } = await stationAPI.update(selectedStationId, payload);
      if (data.success) {
        toast.success('PC updated successfully');
        setSelectedStationId('');
        setNewStationLabel('');
        setSelectedPcEmployeeIds(new Set());
        await fetchStations();
        fetchEmployees();
      } else {
        toast.error(data.message || 'Failed to update PC');
      }
    } catch (err) {
      console.error('Update station failed:', err);
      toast.error(err.response?.data?.message || 'Failed to update PC');
    } finally {
      setCreatingStation(false);
    }
  };

  const closeCreateStationModal = () => {
    setShowCreateStationModal(false);
    setSelectedStationId('');
    setNewStationLabel('');
    setSelectedPcEmployeeIds(new Set());
    setPcEmployeeSearch('');
  };

  const openCreateStationModal = async () => {
    setShowCreateStationModal(true);
    setStationsLoading(true);
    setPcEmployeesLoading(true);
    try {
      const [{ data: stationsRes }, { data: empRes }, { data: assignRes }] = await Promise.all([
        stationAPI.getAll(),
        employeeAPI.getAll({ limit: 1000 }),
        // Shift assignments live in their own collection (see ShiftAssignment
        // model / shift-assignments routes) — NOT on employeeProfile.shift,
        // and the employee list endpoint doesn't populate employeeProfile at
        // all, so we cross-reference against this separately.
        shiftAssignmentAPI.getAll({ limit: 5000 }),
      ]);
      setStations(stationsRes.data || []);

      const allEmployees = empRes.data || [];
      const assignments = assignRes.data || [];

      // Employee IDs that have at least one ACTIVE shift assignment.
      const activelyAssignedIds = new Set(
        assignments
          .filter((a) => a.status === 'active')
          .map((a) => String(a.employee?._id || a.employee))
      );

      const eligible = allEmployees
        .filter((emp) => {
          const empUserId = String(emp._id || emp.id);
          const isActive = (emp.status || 'active') === 'active';
          const hasActiveShift = activelyAssignedIds.has(empUserId);
          const hasProfile = !!emp.employeeProfileId;
          return isActive && hasActiveShift && hasProfile;
        });

      setPcEmployees(eligible);
    } catch (err) {
      console.error('Failed to load PCs or employees:', err);
      toast.error('Could not load PC types');
    } finally {
      setStationsLoading(false);
      setPcEmployeesLoading(false);
    }
  };

  const handleStationSelect = (stationId) => {
    const station = stations.find((s) => s.stationId === stationId);
    setSelectedStationId(stationId);
    setNewStationLabel(station?.label || stationId);
    setPcEmployeeSearch('');
    setSelectedPcEmployeeIds(
      new Set((station?.assignedEmployees || []).map((a) => (a?._id ? a._id : a)))
    );
  };

  const clearSelectedStation = () => {
    setSelectedStationId('');
    setNewStationLabel('');
    setPcEmployeeSearch('');
    setSelectedPcEmployeeIds(new Set());
  };

  const togglePcEmployeeSelection = (employeeId) => {
    setSelectedPcEmployeeIds((prev) => {
      const copy = new Set(prev);
      if (copy.has(employeeId)) copy.delete(employeeId); else copy.add(employeeId);
      return copy;
    });
  };

  const handleAdvancedChange = (e) => {
    const { name, value, type, checked } = e.target;
    setAdvancedFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleAdvancedSave = async (e) => {
    e.preventDefault();
    if (!advancedFormData.id) return;

    setSubmitting(true);
    try {
      const promises = [];
      promises.push(employeeAPI.update(advancedFormData.id, {
        shift: {
          type: advancedFormData.shiftType,
          startTime: advancedFormData.shiftStartTime,
          endTime: advancedFormData.shiftEndTime,
          workMode: advancedFormData.workMode,
          breakEnabled: advancedFormData.breakEnabled,
          breakDurationMinutes: Number(advancedFormData.breakDurationMinutes || 60),
        },
      }));

      const roles = advancedFormData.roles ? advancedFormData.roles.split(',').map((r) => r.trim()).filter(Boolean) : [];
      const permissions = advancedFormData.permissions ? advancedFormData.permissions.split(',').map((p) => p.trim()).filter(Boolean) : [];

      promises.push(employeeAPI.updateRoles(advancedFormData.id, { roles }));
      promises.push(employeeAPI.updatePermissions(advancedFormData.id, { permissions }));

      if (advancedFormData.role) {
        promises.push(employeeAPI.update(advancedFormData.id, { role: advancedFormData.role }));
      }

      await Promise.all(promises);
      toast.success('Advanced employee settings updated');
      closeAdvancedModal();
      fetchEmployees();
    } catch (error) {
      console.error('Advanced update error:', error);
      const errMsg = error.response?.data?.message || 'Failed to update advanced settings';
      toast.error(errMsg);
    } finally {
      setSubmitting(false);
    }
  };


  const closeViewModal = () => {
    setShowViewModal(false);
    setSelectedEmployee(null);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditFormData({
      id: '',
      firstName: '',
      lastName: '',
      email: '',
      role: 'employee',
      department: '',
      position: '',
      phone: '',
      dateOfJoining: new Date().toISOString().split('T')[0],
      status: 'active',
      salaryBasic: 0,
      salaryAllowances: 0,
    });
    setNewCredential({ application: '', loginUrl: '', usernameOrEmail: '', password: '', twoFactorAuthentication: '', securityQa: '', notes: '' });
    setAgreementFile(null);
    setCnicFiles({ front: null, back: null });
    setEditActiveTab('details');
  };

  const handleCloseModal = () => {
    setShowAddModal(false);
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      role: 'employee',
      department: '',
      position: '',
      phone: '',
      dateOfJoining: new Date().toISOString().split('T')[0],
      status: 'active',
      shiftType: 'morning',
      shiftStartTime: '09:00',
      shiftEndTime: '18:00',
      workMode: 'office',
      breakEnabled: true,
      breakDurationMinutes: 60,
      salaryBasic: 0,
      salaryAllowances: 0,
      salaryHoldAmount: 0,
      salaryHoldStatus: 'clear',
      roles: '',
      permissions: '',
      password: '',
    });
    setAgreementFile(null);
    setCnicFiles({ front: null, back: null });
  };

  // Employee Management's "Hold Salary" status is the simple flag stored on
  // the Employee profile (Employee.salaryHold). The list endpoint
  // (GET /employees) already derives `salaryHoldStatus` / `salaryHoldRemaining`
  // straight from that flag, so no extra per-employee sync call is needed
  // here — and, importantly, this status is independent of payroll's
  // installment-based holds, so it never reflects (or affects) a payroll deduction.

  // Active employees float to the top, terminated/resigned sink to the
  // bottom. Sort is stable, so within each status group the original
  // ordering from the API (newest-first) is preserved.
  const STATUS_SORT_ORDER = {
    active:      0,
    probation:   1,
    on_leave:    2,
    resigned:    3,
    terminated:  4,
  };
  const sortEmployeesByStatus = (list) =>
    [...list].sort(
      (a, b) => (STATUS_SORT_ORDER[a.status] ?? 1) - (STATUS_SORT_ORDER[b.status] ?? 1)
    );

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await employeeAPI.getAll({ search, role: roleFilter, page, limit });
      setEmployees(sortEmployeesByStatus(data.data || []));
      setTotal(data.total || 0);
    } catch {
      // Show mock data for demo
      setEmployees(sortEmployeesByStatus(MOCK_EMPLOYEES));
      setTotal(MOCK_EMPLOYEES.length);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, page]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const openHoldSalaryModal = async () => {
    setShowHoldSalaryModal(true);
    setHoldSalaryLoading(true);
    try {
      // Pull the full roster (not just the current page) so nobody is missed
      const { data } = await employeeAPI.getAll({ limit: 1000 });
      const emps = (data.data || []).filter(
        (e) => e.status !== 'terminated' && e.status !== 'resigned'
      );
      setHoldSalaryEmployees(emps);

      // Also fetch active installment-based SalaryHold records for every employee
      // so the list can show how much is being deducted from payroll and block
      // new holds when one is already in progress.
      const holdResults = await Promise.allSettled(
        emps.map((e) =>
          employeeAPI.getSalaryHolds(e._id || e.id).catch(() => ({ data: { data: [] } }))
        )
      );
      const map = {};
      emps.forEach((e, i) => {
        const id = e._id || e.id;
        const res = holdResults[i];
        const holds = res.status === 'fulfilled' ? (res.value?.data?.data || []) : [];
        const active = holds.find((h) => h.status === 'active' && (h.remainingBalance ?? 0) > 0);
        map[id] = active || null;
      });
      setPayrollHoldsMap(map);
    } catch {
      toast.error('Failed to load employees');
      setHoldSalaryEmployees([]);
    } finally {
      setHoldSalaryLoading(false);
    }
  };

  const closeHoldSalaryModal = () => {
    setShowHoldSalaryModal(false);
    setHoldSalaryEmployees([]);
    setHoldTogglingId(null);
    setPayrollHoldsMap({});
    setShowHoldFormModal(false);
    setHoldFormTargetEmp(null);
    // The main table's "Salary Hold" and "Hold Status" columns may have changed — keep in sync
    fetchEmployees();
  };

  const toggleEmployeeSalaryHold = async (emp) => {
    const id = emp._id || emp.id;
    const isCurrentlyClear = emp.salaryHoldStatus === 'clear';

    if (isCurrentlyClear) {
      // Going CLEAR → NOT CLEAR: open the full Payroll-style Hold Salary form
      setHoldFormTargetEmp(emp);
      setShowHoldFormModal(true);
      return;
    }

    // "Release Hold Amount" (NOT CLEAR → CLEAR):
    // Placing the hold never touched payroll, but releasing it does — the
    // held amount is paid back to the employee through Payroll's own credit
    // mechanism (the same one used for "Grant Performance Bonus"): a
    // PerformanceBonus record that Payroll automatically folds into
    // `earnings.performanceBonus` the next time payroll is run for this
    // employee. This is the only point where Employee Management's
    // Hold Salary touches payroll.
    const releasedAmount = emp.salaryHoldRemaining || 0;
    const currency = emp.salary?.currency || 'PKR';
    const employeeName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Employee';

    setHoldTogglingId(id);
    try {
      if (releasedAmount > 0) {
        const now = new Date();
        await performanceBonusAPI.create({
          employee: id,
          amount: releasedAmount,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          bonusType: 'released_hold',
          note: `Salary hold released for ${employeeName} — refunded through payroll`,
        });
      }

      await employeeAPI.clearSalaryHold(id);

      setHoldSalaryEmployees((prev) =>
        prev.map((e) => {
          const eid = e._id || e.id;
          if (eid !== id) return e;
          return { ...e, salaryHoldStatus: 'clear', salaryHoldRemaining: 0, salaryHoldDate: null };
        })
      );
      toast.success(
        `${emp.firstName} ${emp.lastName} salary hold released${releasedAmount > 0 ? ` — ${releasedAmount.toLocaleString()} ${currency} will be added to their next payroll run` : ''}`
      );
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to release salary hold');
    } finally {
      setHoldTogglingId(null);
    }
  };

  // Cancel (delete) an active installment-based hold placed via Payroll →
  // Hold Salary, directly from the Employee Management Hold Salary panel.
  // Stops future deductions; any amount already deducted stays deducted.
  const handleCancelPayrollHold = async (emp, hold) => {
    const id = emp._id || emp.id;
    const employeeName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'this employee';
    if (!window.confirm(
      `Cancel the active salary hold for ${employeeName}? Future deductions will stop; any amount already deducted stays deducted.`
    )) return;

    setCancellingHoldId(hold._id);
    try {
      await employeeAPI.cancelSalaryHold(id, hold._id);
      setPayrollHoldsMap((prev) => ({ ...prev, [id]: null }));
      setHoldSalaryEmployees((prev) =>
        prev.map((e) => {
          const eid = e._id || e.id;
          if (eid !== id) return e;
          return { ...e, salaryHoldStatus: 'clear', salaryHoldRemaining: 0 };
        })
      );
      toast.success('Salary hold cancelled');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to cancel salary hold');
    } finally {
      setCancellingHoldId(null);
    }
  };

  // Called after an in-place edit to a hold record succeeds — refreshes
  // the payroll-holds map for that employee and closes the edit modal.
  const handleHoldRecordUpdated = (emp, updatedHold) => {
    const id = emp._id || emp.id;
    setPayrollHoldsMap((prev) => ({ ...prev, [id]: updatedHold }));
    setHoldSalaryEmployees((prev) =>
      prev.map((e) => {
        const eid = e._id || e.id;
        if (eid !== id) return e;
        return { ...e, salaryHoldRemaining: updatedHold.remainingBalance || 0 };
      })
    );
    setEditHoldTarget(null);
    toast.success('Salary hold updated');
  };

  // ── Hold Salary Stats handlers ───────────────────────────────────────────
  const openHoldStatsModal = async () => {
    setShowHoldStatsModal(true);
    setHoldStatsLoading(true);
    setHoldStatsRows([]);
    try {
      const { data } = await employeeAPI.getAll({ limit: 1000 });
      // A released salary is represented by `salaryHoldStatus: 'clear'`.
      // Exclude those employees before fetching their hold history so released
      // salary holds do not appear in this stats modal.
      const emps = (data.data || []).filter((emp) => emp.salaryHoldStatus !== 'clear');
      const results = await Promise.allSettled(
        emps.map((e) =>
          employeeAPI.getSalaryHolds(e._id || e.id).catch(() => ({ data: { data: [] } }))
        )
      );
      const rows = [];
      emps.forEach((emp, i) => {
        const res = results[i];
        const holds = res.status === 'fulfilled' ? (res.value?.data?.data || []) : [];
        holds.forEach((hold) => rows.push({ emp, hold }));
      });
      // Sort: active first, then by hold date desc
      rows.sort((a, b) => {
        if (a.hold.status === 'active' && b.hold.status !== 'active') return -1;
        if (a.hold.status !== 'active' && b.hold.status === 'active') return 1;
        return new Date(b.hold.holdDate || 0) - new Date(a.hold.holdDate || 0);
      });
      setHoldStatsRows(rows);
    } catch {
      toast.error('Failed to load salary hold stats');
    } finally {
      setHoldStatsLoading(false);
    }
  };

  const closeHoldStatsModal = () => {
    setShowHoldStatsModal(false);
    setHoldStatsRows([]);
    setHoldStatsEditTarget(null);
    setHoldStatsCancellingId(null);
    setHoldStatsStatusFilter('all');
  };

  const handleHoldStatsCancel = async (emp, hold) => {
    const employeeName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'this employee';
    if (!window.confirm(
      `Cancel the salary hold for ${employeeName}? Future deductions will stop; any amount already deducted stays deducted.`
    )) return;
    setHoldStatsCancellingId(hold._id);
    try {
      const empId = emp._id || emp.id;
      await employeeAPI.cancelSalaryHold(empId, hold._id);
      setHoldStatsRows((prev) =>
        prev.map((r) =>
          r.hold._id === hold._id ? { ...r, hold: { ...r.hold, status: 'cancelled', remainingBalance: 0 } } : r
        )
      );
      toast.success('Salary hold cancelled');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to cancel salary hold');
    } finally {
      setHoldStatsCancellingId(null);
    }
  };

  const handleHoldStatsUpdated = (updatedHold) => {
    setHoldStatsRows((prev) =>
      prev.map((r) => r.hold._id === updatedHold._id ? { ...r, hold: updatedHold } : r)
    );
    setHoldStatsEditTarget(null);
    toast.success('Salary hold updated');
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to deactivate this employee?')) return;
    try {
      await employeeAPI.delete(id);
      toast.success('Employee deactivated');
      fetchEmployees();
    } catch {
      toast.error('Failed to deactivate employee');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.role || !formData.department) {
      toast.error('Please fill in all required fields');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        email: formData.email.trim(),
        role: formData.role,
        department: formData.department,
        position: formData.position.trim(),
        phone: formData.phone.trim(),
        dateOfJoining: formData.dateOfJoining,
        status: formData.status,
        salary: {
          basic: Number(formData.salaryBasic) || 0,
          allowances: Number(formData.salaryAllowances) || 0,
          currency: formData.salaryCurrency || 'PKR',
        },
        salaryHold: {
          amount: Number(formData.salaryHold) || 0,
          status: formData.salaryHoldStatus || 'clear',
        }
      };

      if (formData.password.trim()) {
        payload.password = formData.password.trim();
      }

      const { data } = await employeeAPI.create(payload);
      if (data.success) {
        toast.success(data.message || 'Employee created successfully');
        handleCloseModal();
        fetchEmployees();
      } else {
        toast.error(data.message || 'Failed to create employee');
      }
    } catch (error) {
      console.error('Error creating employee:', error);
      const errMsg = error.response?.data?.message || 'Failed to create employee';
      toast.error(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const pages = Math.ceil(total / limit);

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!editFormData.firstName || !editFormData.lastName || !editFormData.email || !editFormData.role || !editFormData.department) {
      toast.error('Please fill in all required fields');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        firstName: editFormData.firstName.trim(),
        lastName: editFormData.lastName.trim(),
        email: editFormData.email.trim(),
        role: editFormData.role,
        department: editFormData.department,
        position: editFormData.position.trim(),
        phone: editFormData.phone.trim(),
        dateOfJoining: editFormData.dateOfJoining,
        status: editFormData.status,
        reason: editFormData.reason.trim(),
        // Only include fields the Edit Modal actually exposes.
        // salaryHold is intentionally excluded here — it is managed
        // through the dedicated salary-hold panel / routes only.
        salary: {
          basic: Number(editFormData.salaryBasic) || 0,
          allowances: Number(editFormData.salaryAllowances) || 0,
          currency: editFormData.salaryCurrency || 'PKR',
        },
      };

      const { data } = await employeeAPI.update(editFormData.id, payload);
      if (data.success) {
        toast.success(data.message || 'Employee updated successfully');
        closeEditModal();
        fetchEmployees();
      } else {
        toast.error(data.message || 'Failed to update employee');
      }
    } catch (error) {
      console.error('Error updating employee:', error);
      const errMsg = error.response?.data?.message || 'Failed to update employee';
      toast.error(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="flex-between flex-wrap gap-3"
      >
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Employee Management</h1>
          <p className="text-slate-400 text-sm mt-0.5">{total.toLocaleString()} total employees</p>
        </div>
        <div className="flex items-center gap-2">
          {/* <button className="btn-secondary text-xs">
            <Upload className="w-3.5 h-3.5" /> Import CSV
          </button> */}
          <button className="btn-secondary text-xs">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button onClick={openHoldSalaryModal} className="btn-secondary text-xs">
            <Wallet className="w-3.5 h-3.5" /> Hold Salary
          </button>
          <button onClick={openHoldStatsModal} className="btn-secondary text-xs">
            <BarChart3 className="w-3.5 h-3.5" /> Show Hold Salary Stats
          </button>
          <button onClick={openCreateStationModal} className="btn-secondary text-xs">
            <Monitor className="w-3.5 h-3.5" /> PC Type
          </button>
          <button onClick={() => setShowAddModal(true)} className="btn-primary text-xs">
            <Plus className="w-3.5 h-3.5" /> Add Employee
          </button>
        </div>
      </motion.div>

      {/* Filters */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
        className="glass-card p-4 flex flex-wrap gap-3"
      >
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name, ID, email..."
            className="input-field pl-9 py-2 text-xs"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
          className="input-field w-auto py-2 text-xs"
        >
          <option value="">All Roles</option>
          {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn-secondary text-xs py-2">
          <Filter className="w-3.5 h-3.5" /> More Filters
        </button>
      </motion.div>

      {/* Table */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="glass-card overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>ID</th>
                <th>Role</th>
                <th>Department</th>
                <th>Date Joined</th>
                <th>Status</th>
                <th>Salary Hold</th>
                <th>Hold Status</th>
                <th>Reason</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j}><div className="skeleton h-3 rounded w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-slate-500">
                    <UserCheck className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    No employees found
                  </td>
                </tr>
              ) : (
                employees.map((emp) => (
                  <tr key={emp._id || emp.id} className="group">
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500/50 to-accent-500/50 flex-center flex-shrink-0">
                          {emp.avatar
                            ? <img src={emp.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                            : <span className="text-xs font-semibold text-white">
                                {emp.firstName?.[0]}{emp.lastName?.[0]}
                              </span>
                          }
                        </div>
                        <div>
                          <p className="font-medium text-white text-xs">{emp.firstName} {emp.lastName}</p>
                          <p className="text-[10px] text-slate-500">{emp.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-slate-400 font-mono text-xs">{emp.employeeId || '—'}</td>
                    <td>
                      <span className="text-xs text-slate-300">{ROLE_LABELS[emp.role] || emp.role}</span>
                    </td>
                    <td className="text-slate-400 text-xs">{emp.department?.name || emp.department || '—'}</td>
                    <td className="text-slate-400 text-xs">
                      {emp.dateOfJoining ? new Date(emp.dateOfJoining).toLocaleDateString() : '—'}
                    </td>
                    <td>
                      <span className={clsx('badge text-[10px]', STATUS_COLORS[emp.status] || 'badge-neutral')}>
                        {emp.status || 'active'}
                      </span>
                    </td>
                    <td>
                      {emp.salaryHoldStatus === 'processing' ? (
                        <span className="badge badge-primary text-[10px]">Processing</span>
                      ) : emp.salaryHoldStatus === 'on_hold' ? (
                        <span className="badge badge-warning text-[10px]">On Hold</span>
                      ) : (
                        <span className="badge badge-neutral text-[10px]">Not Hold</span>
                      )}
                      {(emp.salaryHoldStatus === 'on_hold' || emp.salaryHoldStatus === 'processing') && emp.salaryHoldRemaining > 0 && (
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {emp.salaryHoldRemaining.toLocaleString()} PKR
                        </p>
                      )}
                    </td>
                    <td>
                      {emp.salaryHoldStatus === 'clear' ? (
                        <span className="badge badge-success text-[10px]">Clear</span>
                      ) : emp.salaryHoldStatus === 'processing' ? (
                        <span className="badge badge-primary text-[10px]">Processing</span>
                      ) : (
                        <span className="badge badge-danger text-[10px]">Not Clear</span>
                      )}
                    </td>
                    <td>
                      {emp.salaryHoldReason?.trim() ? (
                        <div
                          title={emp.salaryHoldReason}
                          className="flex items-center gap-1.5 max-w-[180px] rounded-lg border border-white/5 bg-slate-950/40 px-2.5 py-1.5"
                        >
                          <StickyNote className="w-3 h-3 text-amber-400/80 shrink-0" />
                          <span className="text-[11px] text-slate-300 truncate">{emp.salaryHoldReason}</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-600 italic">No reason</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openViewModal(emp._id || emp.id)}
                          className="btn-ghost p-1.5"
                          title="View"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openEditModal(emp._id || emp.id)}
                          className="btn-ghost p-1.5"
                          title="Edit"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        {/* <button
                          onClick={() => openAdvancedModal(emp._id || emp.id)}
                          className="btn-ghost p-1.5"
                          title="Advanced Settings"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openAssignStationsModal(emp._id || emp.id)}
                          className="btn-ghost p-1.5"
                          title="Assign PCs"
                        >
                          <Monitor className="w-3.5 h-3.5" />
                        </button> */}
                        <button
                          onClick={() => handleDelete(emp._id || emp.id)}
                          className="p-1.5 text-slate-500 hover:text-danger-400 hover:bg-danger-500/10 rounded-lg transition-all"
                          title="Deactivate"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex-between px-4 py-3 border-t border-white/5">
            <p className="text-xs text-slate-500">
              Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
              >← Prev</button>
              {Array.from({ length: Math.min(5, pages) }).map((_, i) => {
                const p = i + 1;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={clsx('px-3 py-1.5 rounded-lg text-xs transition-all',
                      page === p ? 'bg-primary-600 text-white' : 'btn-secondary')}
                  >{p}</button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page === pages}
                className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
              >Next →</button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Hold Salary Modal */}
      <AnimatePresence>
        {showHoldSalaryModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-5xl shadow-glow-primary overflow-hidden relative flex flex-col max-h-[85vh]"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
                <div>
                  <h3 className="font-display text-lg font-bold text-white">Hold Salary</h3>
                  <p className="text-slate-400 text-xs mt-0.5">
                    Toggle to mark someone <span className="text-amber-400">Not Clear</span> and record the held amount.
                    This is just a record for this employee — it does not deduct anything from payroll. Use
                    <span className="text-slate-300"> Release Hold Amount</span> to pay that amount back to them
                    through payroll. To actually deduct a hold amount over a time period, use Payroll → Hold Salary.
                  </p>
                </div>
                <button
                  onClick={closeHoldSalaryModal}
                  className="text-slate-400 hover:text-white transition-colors shrink-0 ml-3"
                  type="button"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="overflow-y-auto px-6 py-4 space-y-2">
                {holdSalaryLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="skeleton h-12 rounded-xl w-full" />
                  ))
                ) : holdSalaryEmployees.length === 0 ? (
                  <p className="text-center text-slate-500 text-xs py-8">No employees found</p>
                ) : (
                  holdSalaryEmployees.map((emp) => {
                    const id = emp._id || emp.id;
                    const isClear = emp.salaryHoldStatus === 'clear';
                    const isToggling = holdTogglingId === id;
                    const basicSalary = emp.salary?.basic ?? emp.salaryBasic ?? 0;
                    const currency = emp.salary?.currency || 'PKR';
                    // Active installment-based hold placed via Payroll → Hold Salary
                    const activePayrollHold = payrollHoldsMap[id];
                    return (
                      <div
                        key={id}
                        className={clsx(
                          'rounded-xl border px-4',
                          activePayrollHold
                            ? 'border-amber-500/30 bg-amber-500/5 py-3'
                            : 'flex items-center justify-between gap-3 border-white/10 bg-slate-950/50 py-2.5'
                        )}
                      >
                        {activePayrollHold ? (
                          /* ── Payroll-hold info panel — mirrors Payroll Mgmt's "Salary Already On Hold" block ── */
                          <div className="flex items-start gap-3">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500/50 to-accent-500/50 flex-center flex-shrink-0 mt-0.5">
                              {emp.avatar
                                ? <img src={emp.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                                : <span className="text-xs font-semibold text-white">
                                    {emp.firstName?.[0]}{emp.lastName?.[0]}
                                  </span>
                              }
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap mb-2">
                                <p className="font-medium text-white text-xs">{emp.firstName} {emp.lastName}</p>
                                {activePayrollHold.isProcessing ? (
                                  <span className="text-[10px] font-medium bg-sky-500/15 text-sky-400 border border-sky-500/25 px-2 py-0.5 rounded-full">
                                    Processing
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/25 px-2 py-0.5 rounded-full">
                                    Active Hold
                                  </span>
                                )}
                              </div>
                              {/* Info card */}
                              <div className={clsx(
                                'rounded-lg border px-3 py-2.5 space-y-1.5',
                                activePayrollHold.isProcessing
                                  ? 'bg-sky-500/8 border-sky-500/20'
                                  : 'bg-amber-500/8 border-amber-500/20'
                              )}>
                                <div className="flex items-center gap-1.5">
                                  <Lock className={clsx('w-3 h-3 shrink-0', activePayrollHold.isProcessing ? 'text-sky-400' : 'text-amber-400')} />
                                  <span className={clsx('text-[11px] font-semibold', activePayrollHold.isProcessing ? 'text-sky-400' : 'text-amber-400')}>
                                    {activePayrollHold.isProcessing ? 'Salary Hold Under Processing' : 'Salary Already On Hold'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-[10px]">
                                  <span className="text-slate-400 font-medium">Hold Status</span>
                                  <span className={activePayrollHold.isProcessing ? 'text-sky-400' : 'text-amber-400'}>
                                    {activePayrollHold.isProcessing ? 'Processing · This Month\'s Payroll Run' : 'On Hold · Payroll Management'}
                                  </span>
                                </div>
                                <p className="text-[10px] text-slate-400 leading-relaxed">
                                  This employee has an active installment hold of{' '}
                                  <span className="text-white font-medium">{currency} {(activePayrollHold.amount || 0).toLocaleString()}</span> total,{' '}
                                  <span className="text-white font-medium">{currency} {(activePayrollHold.remainingBalance || 0).toLocaleString()}</span> remaining
                                  {activePayrollHold.endDate && (
                                    <> · ends <span className="text-white font-medium">{new Date(activePayrollHold.endDate).toLocaleDateString()}</span></>
                                  )}.
                                  {activePayrollHold.isProcessing
                                    ? ' This month\'s payroll run has already pulled a deduction from it, so editing and cancelling are locked until that run is approved.'
                                    : ' A new hold can\'t be started until this one is completed or cancelled.'}
                                </p>
                                {activePayrollHold.isProcessing ? null : (
                                  <div className="flex items-center gap-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setEditHoldTarget({ emp, hold: activePayrollHold })}
                                      className="btn-secondary text-[10px] px-2 py-1 flex items-center gap-1"
                                    >
                                      <Edit className="w-3 h-3" /> Edit
                                    </button>
                                    <button
                                      type="button"
                                      disabled={cancellingHoldId === activePayrollHold._id}
                                      onClick={() => handleCancelPayrollHold(emp, activePayrollHold)}
                                      className="btn-secondary text-[10px] px-2 py-1 flex items-center gap-1 text-danger-400 hover:text-danger-300 disabled:opacity-50"
                                    >
                                      {cancellingHoldId === activePayrollHold._id
                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                        : <Trash2 className="w-3 h-3" />
                                      }
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* ── Normal row ── */
                          <>
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500/50 to-accent-500/50 flex-center flex-shrink-0">
                                {emp.avatar
                                  ? <img src={emp.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                                  : <span className="text-xs font-semibold text-white">
                                      {emp.firstName?.[0]}{emp.lastName?.[0]}
                                    </span>
                                }
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-white text-xs truncate">{emp.firstName} {emp.lastName}</p>
                                <p className="text-[10px] text-slate-500">
                                  Basic: {basicSalary.toLocaleString()} {currency}
                                  {!isClear && emp.salaryHoldRemaining > 0 && (
                                    <span className="text-amber-400"> · {emp.salaryHoldRemaining.toLocaleString()} on hold</span>
                                  )}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className={clsx('text-[10px] font-medium', isClear ? 'text-slate-400' : 'text-amber-400')}>
                                {isClear ? 'Clear' : 'Not Clear'}
                              </span>

                              {isClear ? (
                                /* Clear → open full Payroll-style form to place a new hold */
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={false}
                                  disabled={isToggling}
                                  onClick={() => { setHoldFormTargetEmp(emp); setShowHoldFormModal(true); }}
                                  className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 bg-slate-700"
                                >
                                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white transition-transform translate-x-1">
                                    {isToggling && <Loader2 className="w-3 h-3 animate-spin text-slate-500" />}
                                  </span>
                                </button>
                              ) : (
                                /* Simple EM hold is active → release it */
                                <button
                                  type="button"
                                  disabled={isToggling}
                                  onClick={() => toggleEmployeeSalaryHold(emp)}
                                  className="btn-secondary text-[10px] px-2 py-1 flex items-center gap-1 disabled:opacity-50"
                                >
                                  {isToggling && <Loader2 className="w-3 h-3 animate-spin" />}
                                  Release Hold Amount
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex justify-end px-6 py-4 border-t border-white/5 shrink-0">
                <button type="button" onClick={closeHoldSalaryModal} className="btn-secondary text-xs">
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Full Hold Salary Form Modal — same popup as Payroll Management's Hold Salary */}
      <AnimatePresence>
        {showHoldFormModal && holdFormTargetEmp && (
          <EmpHoldSalaryFormModal
            employee={holdFormTargetEmp}
            activePayrollHold={payrollHoldsMap[holdFormTargetEmp._id || holdFormTargetEmp.id]}
            onClose={() => { setShowHoldFormModal(false); setHoldFormTargetEmp(null); }}
            onSuccess={async () => {
              setShowHoldFormModal(false);
              setHoldFormTargetEmp(null);
              // Re-fetch holds so the list reflects the newly created hold
              await openHoldSalaryModal();
            }}
          />
        )}
      </AnimatePresence>

      {/* Edit Salary Hold Modal — amend amount / end date / reason on an active hold */}
      <AnimatePresence>
        {editHoldTarget && (
          <EditSalaryHoldModal
            employee={editHoldTarget.emp}
            hold={editHoldTarget.hold}
            onClose={() => setEditHoldTarget(null)}
            onSuccess={(updatedHold) => handleHoldRecordUpdated(editHoldTarget.emp, updatedHold)}
          />
        )}
      </AnimatePresence>

      {/* ── Hold Salary Stats Modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showHoldStatsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-6xl shadow-glow-primary overflow-hidden relative flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
                    <BarChart3 className="w-4 h-4 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-bold text-white">Hold Salary Stats</h3>
                    <p className="text-slate-400 text-xs mt-0.5">Salary hold records for employees with an active hold</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* Status filter */}
                  <select
                    value={holdStatsStatusFilter}
                    onChange={(e) => setHoldStatsStatusFilter(e.target.value)}
                    className="input-field py-1.5 text-xs w-auto"
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                  <button onClick={closeHoldStatsModal} className="text-slate-400 hover:text-white transition-colors" type="button">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Summary chips */}
              {!holdStatsLoading && holdStatsRows.length > 0 && (() => {
                const active = holdStatsRows.filter((r) => r.hold.status === 'active');
                // Deducted = amount − remainingBalance across ALL records (active + completed + cancelled)
                // so cancelled/completed holds that already had money taken still count correctly.
                const totalDed = holdStatsRows.reduce((s, r) => {
                  const ded = Math.max(0, Math.round(((r.hold.amount || 0) - (r.hold.remainingBalance || 0)) * 100) / 100);
                  return s + ded;
                }, 0);
                // Remaining is only meaningful on active holds
                const totalRem = active.reduce((s, r) => s + (r.hold.remainingBalance || 0), 0);
                return (
                  <div className="flex items-center gap-3 px-6 py-3 border-b border-white/5 shrink-0 flex-wrap">
                    <div className="rounded-lg bg-slate-800/60 border border-white/8 px-3 py-1.5 text-center">
                      <p className="text-[10px] text-slate-400">Total Records</p>
                      <p className="text-sm font-bold text-white">{holdStatsRows.length}</p>
                    </div>
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 text-center">
                      <p className="text-[10px] text-amber-400">Active Holds</p>
                      <p className="text-sm font-bold text-amber-400">{active.length}</p>
                    </div>
                    <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-1.5 text-center">
                      <p className="text-[10px] text-red-400">Total Deducted</p>
                      <p className="text-sm font-bold text-red-400">{totalDed.toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-center">
                      <p className="text-[10px] text-emerald-400">Total Remaining</p>
                      <p className="text-sm font-bold text-emerald-400">{totalRem.toLocaleString()}</p>
                    </div>
                  </div>
                );
              })()}

              {/* Table */}
              <div className="overflow-auto flex-1 px-6 py-4">
                {holdStatsLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="skeleton h-12 rounded-xl w-full" />
                    ))}
                  </div>
                ) : (() => {
                  const filtered = holdStatsStatusFilter === 'all'
                    ? holdStatsRows
                    : holdStatsRows.filter((r) => r.hold.status === holdStatsStatusFilter);

                  if (filtered.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <BarChart3 className="w-10 h-10 text-slate-600 mb-3" />
                        <p className="text-slate-400 text-sm font-medium">No salary hold records found</p>
                        <p className="text-slate-500 text-xs mt-1">
                          {holdStatsStatusFilter !== 'all' ? 'Try changing the status filter.' : 'Use the Hold Salary panel to create a new hold.'}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-white/8">
                          {['Employee', 'Amount', 'Start Date', 'End Date', 'Duration', 'Monthly Deduction', 'Deducted', 'Remaining', 'Status', 'Reason', 'Actions'].map((h) => (
                            <th key={h} className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wide pb-2.5 pr-4 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {filtered.map(({ emp, hold }, idx) => {
                          const id = emp._id || emp.id;
                          const currency = emp.salary?.currency || 'PKR';
                          const deducted = Math.round(((hold.amount || 0) - (hold.remainingBalance || 0)) * 100) / 100;
                          const isActive = hold.status === 'active';
                          const isCancelled = hold.status === 'cancelled';
                          const isCancelling = holdStatsCancellingId === hold._id;

                          const statusBadge = {
                            active:    { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25', label: 'Active' },
                            completed: { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25', label: 'Completed' },
                            cancelled: { cls: 'bg-red-500/15 text-red-400 border-red-500/25', label: 'Cancelled' },
                          }[hold.status] || { cls: 'bg-slate-500/15 text-slate-400 border-slate-500/25', label: hold.status };

                          return (
                            <tr key={`${id}-${hold._id}-${idx}`} className="group hover:bg-white/[0.02] transition-colors">
                              {/* Employee */}
                              <td className="py-3 pr-4">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500/50 to-accent-500/50 flex items-center justify-center shrink-0 text-[10px] font-bold text-white overflow-hidden">
                                    {emp.avatar
                                      ? <img src={emp.avatar} alt="" className="w-7 h-7 object-cover" />
                                      : <>{emp.firstName?.[0]}{emp.lastName?.[0]}</>
                                    }
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-medium text-white truncate max-w-[120px]">{emp.firstName} {emp.lastName}</p>
                                    <p className="text-[10px] text-slate-500 truncate">{emp.employeeId || '—'}</p>
                                  </div>
                                </div>
                              </td>

                              {/* Amount */}
                              <td className="py-3 pr-4">
                                <span className="font-semibold text-white">{currency} {(hold.amount || 0).toLocaleString()}</span>
                              </td>

                              {/* Start Date */}
                              <td className="py-3 pr-4 text-slate-300 whitespace-nowrap">
                                {hold.holdDate ? new Date(hold.holdDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                              </td>

                              {/* End Date */}
                              <td className="py-3 pr-4 text-slate-300 whitespace-nowrap">
                                {hold.endDate ? new Date(hold.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                              </td>

                              {/* Duration */}
                              <td className="py-3 pr-4 text-slate-300 whitespace-nowrap">
                                {hold.durationMonths ? `${hold.durationMonths} mo.` : '—'}
                              </td>

                              {/* Monthly Deduction */}
                              <td className="py-3 pr-4">
                                <span className="text-amber-400 font-medium">
                                  {hold.monthlyDeduction ? `${currency} ${hold.monthlyDeduction.toLocaleString()}` : '—'}
                                </span>
                              </td>

                              {/* Deducted */}
                              <td className="py-3 pr-4">
                                <span className="text-red-400 font-medium">{currency} {deducted.toLocaleString()}</span>
                              </td>

                              {/* Remaining */}
                              <td className="py-3 pr-4">
                                <span className={clsx('font-semibold', (hold.remainingBalance || 0) > 0 ? 'text-emerald-400' : 'text-slate-500')}>
                                  {currency} {(hold.remainingBalance || 0).toLocaleString()}
                                </span>
                              </td>

                              {/* Status */}
                              <td className="py-3 pr-4">
                                <span className={clsx('text-[10px] font-medium px-2 py-0.5 rounded-full border', statusBadge.cls)}>
                                  {statusBadge.label}
                                  {hold.isProcessing && ' · Processing'}
                                </span>
                              </td>

                              {/* Reason saved from Employee Management (fall back to the hold record reason). */}
                              <td className="py-3 pr-4 text-slate-300 max-w-[220px]">
                                <p className="truncate" title={emp.salaryHoldReason || hold.reason || ''}>
                                  {emp.salaryHoldReason?.trim() || hold.reason?.trim() || '—'}
                                </p>
                              </td>

                              {/* Actions */}
                              <td className="py-3">
                                {isActive && !hold.isProcessing ? (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setHoldStatsEditTarget({ emp, hold })}
                                      className="btn-secondary text-[10px] px-2 py-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      <Edit className="w-3 h-3" /> Edit
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isCancelling}
                                      onClick={() => handleHoldStatsCancel(emp, hold)}
                                      className="btn-secondary text-[10px] px-2 py-1 flex items-center gap-1 text-danger-400 hover:text-danger-300 disabled:opacity-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      {isCancelling
                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                        : <Trash2 className="w-3 h-3" />
                                      }
                                      Delete
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-slate-600 italic">
                                    {hold.isProcessing ? 'Processing…' : isCancelled ? 'Cancelled' : 'Completed'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  );
                })()}
              </div>

              {/* Footer */}
              <div className="flex justify-end px-6 py-4 border-t border-white/5 shrink-0">
                <button type="button" onClick={closeHoldStatsModal} className="btn-secondary text-xs">
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Hold from Stats Modal */}
      <AnimatePresence>
        {holdStatsEditTarget && (
          <EditSalaryHoldModal
            employee={holdStatsEditTarget.emp}
            hold={holdStatsEditTarget.hold}
            onClose={() => setHoldStatsEditTarget(null)}
            onSuccess={handleHoldStatsUpdated}
          />
        )}
      </AnimatePresence>

      {/* Add Employee Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[calc(100vh-2rem)] p-6 shadow-glow-primary overflow-y-auto relative"
            >
              {/* Close Button */}
              <button
                onClick={handleCloseModal}
                className="absolute right-4 top-4 text-slate-400 hover:text-white transition-colors"
                type="button"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="font-display text-xl font-bold text-white mb-4">Add New Employee</h3>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* First Name */}
                  <div>
                    <label className="input-label">First Name *</label>
                    <input
                      required
                      type="text"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleChange}
                      placeholder="e.g. Harry"
                      className="input-field"
                    />
                  </div>

                  {/* Last Name */}
                  <div>
                    <label className="input-label">Last Name</label>
                    <input
                      type="text"
                      name="lastName"
                      value={formData.lastName}
                      onChange={handleChange}
                      placeholder="e.g. Wilson"
                      className="input-field"
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label className="input-label">Email Address *</label>
                    <input
                      required
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="e.g. emma@company.com"
                      className="input-field"
                    />
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="input-label">Phone Number</label>
                    <input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      placeholder="e.g. +1 (555) 0199"
                      className="input-field"
                    />
                  </div>

                  {/* Department */}
                  <div>
                    <label className="input-label">Department *</label>
                    <select
                      required
                      name="department"
                      value={formData.department}
                      onChange={handleChange}
                      className="input-field"
                    >
                      <option value="">Select Department</option>
                      {departments.map((dept) => (
                        <option key={dept._id} value={dept._id}>
                          {dept.name} ({dept.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Role */}
                  <div>
                    <label className="input-label">System Role *</label>
                    <select
                      required
                      name="role"
                      value={formData.role}
                      onChange={handleChange}
                      className="input-field"
                    >
                      {Object.entries(ROLE_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Status */}
                  <div>
                    <label className="input-label">Employment Status</label>
                    <select
                      name="status"
                      value={formData.status}
                      onChange={handleChange}
                      className="input-field"
                    >
                      <option value="active">Active</option>
                      <option value="on_leave">On Leave</option>
                      <option value="resigned">Resigned</option>
                      <option value="terminated">Terminated</option>
                    </select>
                  </div>

                  {/* Position */}
                  <div>
                    <label className="input-label">Position / Job Title</label>
                    <input
                      type="text"
                      name="position"
                      value={formData.position}
                      onChange={handleChange}
                      placeholder="e.g. Senior Software Engineer"
                      className="input-field"
                    />
                  </div>

                  {/* Date of Joining */}
                  <div>
                    <label className="input-label">Date of Joining</label>
                    <input
                      type="date"
                      name="dateOfJoining"
                      value={formData.dateOfJoining}
                      onChange={handleChange}
                      className="input-field"
                    />
                  </div>

                  {/* Basic Salary */}
                  <div>
                    <label className="input-label">Basic Salary (PKR)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      name="salaryBasic"
                      value={formData.salaryBasic}
                      onChange={handleChange}
                      placeholder="e.g. 50000"
                      className="input-field"
                    />
                  </div>
                  {/* <div>
                    <label className="input-label">Salary Hold (PKR)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      name="salaryHold"
                      value={formData.salaryHold.amount}
                      onChange={handleChange}
                      placeholder="e.g. 50000"
                      className="input-field"
                    />
                  </div> */}
                      <div>
                        <label className="input-label">Currency</label>
                        <select name="salaryCurrency" value={formData.salaryCurrency} onChange={handleChange} className="input-field">
                          <option value="USD">USD</option>
                          <option value="PKR">PKR</option>
                          <option value="EUR">EUR</option>
                          <option value="GBP">GBP</option>
                        </select>
                      </div>
                  {/* Allowances */}
                  {/* <div>
                    <label className="input-label">Allowances (PKR)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      name="salaryAllowances"
                      value={formData.salaryAllowances}
                      onChange={handleChange}
                      placeholder="e.g. 5000"
                      className="input-field"
                    />
                  </div> */}

                  <div className="md:col-span-2">
                    <label className="input-label">Password (Optional - defaults to Glitch@2026)</label>
                    <input
                      type="password"
                      name="password"
                      value={formData.password}
                      onChange={handleChange}
                      placeholder="Leave blank for default password"
                      className="input-field"
                    />
                  </div>
                </div>
                <div className="p-4 rounded-2xl bg-surface-800 border border-white/5">
                  <p className="text-xs text-slate-400">
                    Advanced employee assignments (role permissions, shift assignment, salary hold, remote work mode) are managed separately after employee creation.
                  </p>
                </div>
                <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="btn-secondary"
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={submitting}
                  >
                    {submitting ? 'Creating...' : 'Register Employee'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {showAssignStationsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-2xl p-6 shadow-glow-primary overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-lg font-bold text-white">Assign PCs to Employee</h3>
                <button onClick={() => setShowAssignStationsModal(false)} className="btn-ghost">Close</button>
              </div>
              <div>
                {stationsLoading ? (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/60 p-4 text-sm text-slate-400">
                    Loading stations…
                  </div>
                ) : stations.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/60 p-4 text-sm text-slate-400">
                    No PC types available. Create a PC Type first.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                    {stations.map((s) => {
                      const assignedEmployees = (s.assignedEmployees || []).map((a) => (a._id ? a._id : a));
                      const employeeCount = assignedEmployees.length;
                      const departments = [...new Set((s.assignedEmployees || []).map((emp) => {
                        const dept = emp?.user?.department?.name || emp?.user?.department || emp?.department;
                        return dept || 'Unknown';
                      }))].join(', ');
                      const isChecked = selectedStations.has(s.stationId);

                      return (
                        <label
                          key={s.stationId}
                          className={clsx(
                            'cursor-pointer rounded-3xl border p-4 transition duration-150',
                            isChecked
                              ? 'border-primary-400 bg-primary-500/10 text-white'
                              : 'border-white/10 bg-slate-950/90 hover:border-slate-200'
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium text-sm">{s.label || s.stationId}</div>
                              <div className="text-[11px] text-slate-400">{s.stationId}</div>
                            </div>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleStationSelection(s.stationId)}
                              className="mt-1 h-4 w-4 rounded border-slate-600 text-primary-500 focus:ring-primary-500"
                            />
                          </div>
                          <p className="mt-2 text-[11px] text-slate-500">
                            {employeeCount} employee{employeeCount === 1 ? '' : 's'} assigned{departments ? ` · ${departments}` : ''}
                          </p>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                <button onClick={() => setShowAssignStationsModal(false)} className="btn-secondary">Cancel</button>
                <button onClick={saveAssignedStations} className="btn-primary" disabled={assignSaving}>{assignSaving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          </div>
        )}

        {showCreateStationModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-4xl p-6 shadow-glow-primary overflow-hidden">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500/10 text-primary-300">
                    <Monitor className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-bold text-white">PC Types</h3>
                    <p className="text-[11px] text-slate-500">
                      Workstations that self-register the first time logger.py checks in
                    </p>
                  </div>
                </div>
                <button onClick={closeCreateStationModal} className="btn-ghost">Close</button>
              </div>

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                {/* ── PC wall: each tile styled like an LCD monitor on a stand ── */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      {selectedStationId ? 'Editing a PC' : 'Select a PC to edit'}
                    </p>
                    <span className="text-xs text-slate-500">{stations.length} total</span>
                  </div>

                  {stationsLoading ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/60 p-4 text-sm text-slate-400">
                      Loading PC types…
                    </div>
                  ) : stations.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/60 p-4 text-sm text-slate-400">
                      No PCs yet. They show up here automatically the first time a workstation checks in through logger.py.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-6 max-h-[26rem] overflow-y-auto p-1">
                      {stations.map((s) => {
                        const isSelected = selectedStationId === s.stationId;
                        const employeeCount = (s.assignedEmployees || []).length;
                        const isOnline = employeeCount > 0;

                        return (
                          <button
                            key={s.stationId}
                            type="button"
                            onClick={() => handleStationSelect(s.stationId)}
                            className="group text-left"
                          >
                            {/* Screen */}
                            <div
                              className={clsx(
                                'relative rounded-lg border-[3px] p-3 pb-3.5 transition-all duration-200',
                                isSelected
                                  ? 'border-primary-400 bg-slate-950 shadow-glow-primary'
                                  : 'border-slate-700/80 bg-slate-950/90 group-hover:border-slate-500'
                              )}
                              style={{ minHeight: '88px' }}
                            >
                              {isSelected && (
                                <span className="absolute -top-2 left-3 rounded-full bg-primary-500 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white shadow">
                                  Selected
                                </span>
                              )}
                              <span
                                title={isOnline ? 'Has assigned employees' : 'Unassigned'}
                                className={clsx(
                                  'absolute right-3 top-3 h-1.5 w-1.5 rounded-full',
                                  isOnline
                                    ? 'bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.55)]'
                                    : 'bg-slate-600'
                                )}
                              />
                              <div
                                className={clsx(
                                  'pr-4 font-display text-sm font-bold leading-snug break-words',
                                  isSelected ? 'text-white' : 'text-slate-200'
                                )}
                              >
                                {s.label || s.stationId}
                              </div>
                              <div className="mt-1 font-mono text-[10px] tracking-wide text-slate-500">
                                {s.stationId}
                              </div>
                              <div className="mt-2 text-[10px] text-slate-500">
                                {employeeCount} employee{employeeCount === 1 ? '' : 's'}
                              </div>
                            </div>
                            {/* Stand */}
                            <div className="mx-auto h-2 w-8 bg-slate-700/80 group-hover:bg-slate-600" />
                            <div className="mx-auto h-1 w-16 rounded-full bg-slate-800" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ── Right panel: locked ID + label + employee assignment ── */}
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  {!selectedStationId ? (
                    <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 text-center text-slate-500">
                      <Monitor className="w-6 h-6 text-slate-600" />
                      <p className="text-sm">Select a PC on the left to rename it or assign employees to it.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="input-label flex items-center gap-1.5">
                          <Lock className="w-3 h-3" /> Station ID
                        </label>
                        <div className="input-field flex items-center justify-between bg-slate-900/80 text-slate-400 cursor-not-allowed select-none">
                          <span className="font-mono text-sm">{selectedStationId}</span>
                          <span className="text-[10px] uppercase tracking-wide text-slate-600">Locked</span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Assigned automatically the first time this PC checks in — only the label can be renamed.
                        </p>
                      </div>

                      <div>
                        <label className="input-label">Label</label>
                        <input
                          value={newStationLabel}
                          onChange={(e) => setNewStationLabel(e.target.value)}
                          placeholder="Front Desk PC"
                          className="input-field"
                          autoFocus
                        />
                      </div>

                      <div className="border-t border-white/10 pt-4">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <label className="input-label mb-0">Assigned employees</label>
                          <span className="text-[11px] text-slate-500">{selectedPcEmployeeIds.size} selected</span>
                        </div>
                        <input
                          value={pcEmployeeSearch}
                          onChange={(e) => setPcEmployeeSearch(e.target.value)}
                          placeholder="Search employees…"
                          className="input-field mb-2"
                        />

                        {pcEmployeesLoading ? (
                          <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/60 p-3 text-xs text-slate-400">
                            Loading employees…
                          </div>
                        ) : (
                          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                            {pcEmployees
                              .filter((emp) => {
                                const name = `${emp.firstName || ''} ${emp.lastName || ''}`.toLowerCase();
                                return name.includes(pcEmployeeSearch.trim().toLowerCase());
                              })
                              .map((emp) => {
                                // Station.assignedEmployees stores Employee-profile
                                // ids, not User ids — key selection off that.
                                const empId = emp.employeeProfileId;
                                const isChecked = selectedPcEmployeeIds.has(empId);
                                const deptName = emp.department?.name || emp.department || '';

                                return (
                                  <label
                                    key={empId}
                                    className={clsx(
                                      'flex cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 py-2 transition',
                                      isChecked
                                        ? 'border-primary-400 bg-primary-500/10'
                                        : 'border-white/5 bg-slate-900/60 hover:border-slate-600'
                                    )}
                                  >
                                    {emp.avatar ? (
                                      <img src={emp.avatar} alt="" className="h-6 w-6 rounded-full object-cover shrink-0" />
                                    ) : (
                                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold text-slate-300">
                                        {emp.firstName?.[0]}{emp.lastName?.[0]}
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-xs font-medium text-white">
                                        {emp.firstName} {emp.lastName}
                                      </p>
                                      {deptName && <p className="truncate text-[10px] text-slate-500">{deptName}</p>}
                                    </div>
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => togglePcEmployeeSelection(empId)}
                                      className="h-4 w-4 shrink-0 rounded border-slate-600 text-primary-500 focus:ring-primary-500"
                                    />
                                  </label>
                                );
                              })}

                            {!pcEmployeesLoading && pcEmployees.length > 0 &&
                              pcEmployees.filter((emp) =>
                                `${emp.firstName || ''} ${emp.lastName || ''}`
                                  .toLowerCase()
                                  .includes(pcEmployeeSearch.trim().toLowerCase())
                              ).length === 0 && (
                                <p className="px-1 py-2 text-xs text-slate-500">No employees match "{pcEmployeeSearch}".</p>
                              )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-between gap-3 pt-5 mt-5 border-t border-white/5">
                <button onClick={closeCreateStationModal} className="btn-secondary">Cancel</button>
                <button
                  onClick={saveStationDetails}
                  className="btn-primary"
                  disabled={creatingStation || !selectedStationId}
                >
                  {creatingStation ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showAdvancedModal && advancedEmployee && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-2xl p-6 shadow-glow-primary overflow-hidden relative"
            >
              <button
                onClick={closeAdvancedModal}
                className="absolute right-4 top-4 text-slate-400 hover:text-white transition-colors"
                type="button"
              >
                <X className="w-5 h-5" />
              </button>
              <h3 className="font-display text-xl font-bold text-white mb-4">Advanced Employee Settings</h3>
              <form onSubmit={handleAdvancedSave} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="input-label">System Role</label>
                    <select
                      name="role"
                      value={advancedFormData.role}
                      onChange={handleAdvancedChange}
                      className="input-field"
                    >
                      {Object.entries(ROLE_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="input-label">Shift Type</label>
                    <select
                      name="shiftType"
                      value={advancedFormData.shiftType}
                      onChange={handleAdvancedChange}
                      className="input-field"
                    >
                      <option value="morning">Morning</option>
                      <option value="evening">Evening</option>
                      <option value="night">Night</option>
                      <option value="flexible">Flexible</option>
                    </select>
                  </div>
                  <div>
                    <label className="input-label">Shift Start Time</label>
                    <input
                      type="time"
                      name="shiftStartTime"
                      value={advancedFormData.shiftStartTime}
                      onChange={handleAdvancedChange}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="input-label">Shift End Time</label>
                    <input
                      type="time"
                      name="shiftEndTime"
                      value={advancedFormData.shiftEndTime}
                      onChange={handleAdvancedChange}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="input-label">Work Mode</label>
                    <select
                      name="workMode"
                      value={advancedFormData.workMode}
                      onChange={handleAdvancedChange}
                      className="input-field"
                    >
                      <option value="office">Office</option>
                      <option value="remote">Remote</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="input-label flex-1">Break Enabled</label>
                    <input
                      type="checkbox"
                      name="breakEnabled"
                      checked={advancedFormData.breakEnabled}
                      onChange={handleAdvancedChange}
                      className="form-checkbox mt-2"
                    />
                  </div>
                  <div>
                    <label className="input-label">Break Duration (minutes)</label>
                    <input
                      type="number"
                      name="breakDurationMinutes"
                      value={advancedFormData.breakDurationMinutes}
                      onChange={handleAdvancedChange}
                      min="0"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="input-label">Roles</label>
                    <input
                      type="text"
                      name="roles"
                      value={advancedFormData.roles}
                      onChange={handleAdvancedChange}
                      placeholder="Comma-separated roles"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="input-label">Permissions</label>
                    <input
                      type="text"
                      name="permissions"
                      value={advancedFormData.permissions}
                      onChange={handleAdvancedChange}
                      placeholder="Comma-separated permissions"
                      className="input-field"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                  <button
                    type="button"
                    onClick={closeAdvancedModal}
                    className="btn-secondary"
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={submitting}
                  >
                    {submitting ? 'Saving...' : 'Save Settings'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {showViewModal && selectedEmployee && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-2xl p-6 shadow-glow-primary overflow-hidden relative"
            >
              <button
                onClick={closeViewModal}
                className="absolute right-4 top-4 text-slate-400 hover:text-white transition-colors"
                type="button"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="font-display text-xl font-bold text-white mb-4">Employee Details</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-300">
                <div>
                  <p className="text-slate-500">Name</p>
                  <p className="text-white">{selectedEmployee.firstName} {selectedEmployee.lastName}</p>
                </div>
                <div>
                  <p className="text-slate-500">Email</p>
                  <p className="text-white">{selectedEmployee.email}</p>
                </div>
                <div>
                  <p className="text-slate-500">Role</p>
                  <p className="text-white">{ROLE_LABELS[selectedEmployee.role] || selectedEmployee.role}</p>
                </div>
                <div>
                  <p className="text-slate-500">Department</p>
                  <p className="text-white">{selectedEmployee.department?.name || selectedEmployee.department || '—'}</p>
                </div>
                <div>
                  <p className="text-slate-500">Position</p>
                  <p className="text-white">{selectedEmployee.position || '—'}</p>
                </div>
                <div>
                  <p className="text-slate-500">Date of Joining</p>
                  <p className="text-white">{selectedEmployee.dateOfJoining ? new Date(selectedEmployee.dateOfJoining).toLocaleDateString() : '—'}</p>
                </div>
                <div>
                  <p className="text-slate-500">Shift</p>
                  <p className="text-white">{selectedEmployee.employeeProfile?.shift?.startTime || '09:00'} — {selectedEmployee.employeeProfile?.shift?.endTime || '18:00'}</p>
                </div>
                <div>
                  <p className="text-slate-500">Work Mode</p>
                  <p className="text-white">{selectedEmployee.employeeProfile?.shift?.workMode || 'office'}</p>
                </div>
                <div>
                  <p className="text-slate-500">Break</p>
                  <p className="text-white">{selectedEmployee.employeeProfile?.shift?.breakEnabled ? 'Enabled' : 'Disabled'} ({selectedEmployee.employeeProfile?.shift?.breakDurationMinutes || 0} mins)</p>
                </div>
                <div>
                  <p className="text-slate-500">Basic Salary</p>
                  <p className="text-white">{selectedEmployee.salary?.basic ?? selectedEmployee.salaryBasic ?? 0} PKR</p>
                </div>
                {/* <div>
                  <p className="text-slate-500">Allowances</p>
                  <p className="text-white">{selectedEmployee.employeeProfile?.salary?.allowances ?? selectedEmployee.salaryAllowances ?? 0} PKR</p>
                </div> */}
                <div>
                  <p className="text-slate-500">Salary Hold</p>
                  <p className="text-white">{selectedEmployee.employeeProfile?.salaryHold?.amount || 0} PKR — {selectedEmployee.employeeProfile?.salaryHold?.status || 'not_clear'}</p>
                </div>
                {/* <div>
                  <p className="text-slate-500">Roles</p>
                  <p className="text-white">{selectedEmployee.roles?.join(', ') || '—'}</p>
                </div>
                <div>
                  <p className="text-slate-500">Permissions</p>
                  <p className="text-white">{selectedEmployee.permissions?.join(', ') || '—'}</p>
                </div> */}
                <div>
                  <p className="text-slate-500">Signed Agreement</p>
                  {selectedEmployee.employeeProfile?.signedAgreement?.url ? (
                    <a
                      className="text-primary-300 hover:text-primary-200 text-sm"
                      href={selectedEmployee.employeeProfile.signedAgreement.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View agreement
                    </a>
                  ) : (
                    <p className="text-white">No agreement uploaded</p>
                  )}
                </div>
              </div>

              <div className="mt-5 border-t border-white/5 pt-4">
                <h4 className="text-sm font-semibold text-white mb-3">Freelance Credentials</h4>
                {selectedEmployee.employeeProfile?.freelanceCredentials?.length ? (
                  <div className="space-y-3">
                    {selectedEmployee.employeeProfile.freelanceCredentials.map((cred) => (
                      <div key={cred._id} className="border border-white/10 bg-slate-950/50 p-3 rounded-xl text-sm">
                        <p className="font-medium text-white mb-2">{cred.application || cred.platform || 'Application'}</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 text-slate-300">
                          <p><span className="text-slate-500">Login URL: </span>{cred.loginUrl || cred.profileUrl || '—'}</p>
                          <p><span className="text-slate-500">Username / Email: </span>{cred.usernameOrEmail || cred.username || '—'}</p>
                          <p><span className="text-slate-500">Password: </span>{cred.password || '—'}</p>
                          <p><span className="text-slate-500">Two-Factor Authentication: </span>{cred.twoFactorAuthentication || '—'}</p>
                          <p><span className="text-slate-500">Security Q&A: </span>{cred.securityQa || '—'}</p>
                          <p><span className="text-slate-500">Notes: </span>{cred.notes || '—'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No freelance credentials added.</p>
                )}
              </div>

              <div className="mt-5 border-t border-white/5 pt-4">
                <h4 className="text-sm font-semibold text-white mb-3">CNIC Images</h4>
                <div className="flex gap-4 text-sm">
                  {selectedEmployee.employeeProfile?.cnicImages?.front?.url ? (
                    <a className="text-primary-300 hover:text-primary-200" href={selectedEmployee.employeeProfile.cnicImages.front.url} target="_blank" rel="noreferrer">View CNIC front</a>
                  ) : (
                    <p className="text-slate-500">No CNIC front uploaded</p>
                  )}
                  {selectedEmployee.employeeProfile?.cnicImages?.back?.url ? (
                    <a className="text-primary-300 hover:text-primary-200" href={selectedEmployee.employeeProfile.cnicImages.back.url} target="_blank" rel="noreferrer">View CNIC back</a>
                  ) : (
                    <p className="text-slate-500">No CNIC back uploaded</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={closeViewModal}
                  className="btn-secondary"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showEditModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-2xl shadow-glow-primary relative max-h-[85vh] flex flex-col overflow-hidden"
            >
              <button
                onClick={closeEditModal}
                className="absolute right-4 top-4 text-slate-400 hover:text-white transition-colors z-10"
                type="button"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="p-6 pb-0 shrink-0">
                <h3 className="font-display text-xl font-bold text-white mb-4">Edit Employee</h3>

                <div className="flex gap-2 border-b border-white/10">
                  <button
                    type="button"
                    onClick={() => setEditActiveTab('details')}
                    className={clsx(
                      'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                      editActiveTab === 'details'
                        ? 'border-primary-400 text-white'
                        : 'border-transparent text-slate-400 hover:text-white'
                    )}
                  >
                    Employee Details
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditActiveTab('credentials')}
                    className={clsx(
                      'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                      editActiveTab === 'credentials'
                        ? 'border-primary-400 text-white'
                        : 'border-transparent text-slate-400 hover:text-white'
                    )}
                  >
                    Credentials &amp; Agreement
                  </button>
                </div>
              </div>

              <form onSubmit={handleUpdate} className="flex flex-col flex-1 overflow-hidden">
                <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
                {editActiveTab === 'details' && (
                <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="input-label">First Name *</label>
                    <input
                      required
                      type="text"
                      name="firstName"
                      value={editFormData.firstName}
                      onChange={handleEditChange}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="input-label">Last Name *</label>
                    <input
                      required
                      type="text"
                      name="lastName"
                      value={editFormData.lastName}
                      onChange={handleEditChange}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="input-label">Email Address *</label>
                    <input
                      required
                      type="email"
                      name="email"
                      value={editFormData.email}
                      onChange={handleEditChange}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="input-label">Phone Number</label>
                    <input
                      type="tel"
                      name="phone"
                      value={editFormData.phone}
                      onChange={handleEditChange}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="input-label">Department *</label>
                    <select
                      required
                      name="department"
                      value={editFormData.department}
                      onChange={handleEditChange}
                      className="input-field"
                    >
                      <option value="">Select Department</option>
                      {departments.map((dept) => (
                        <option key={dept._id} value={dept._id}>
                          {dept.name} ({dept.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="input-label">System Role *</label>
                    <select
                      required
                      name="role"
                      value={editFormData.role}
                      onChange={handleEditChange}
                      className="input-field"
                    >
                      {Object.entries(ROLE_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="input-label">Employment Status</label>
                    <select
                      name="status"
                      value={editFormData.status}
                      onChange={handleEditChange}
                      className="input-field"
                    >
                      <option value="active">Active</option>
                      <option value="on_leave">On Leave</option>
                      <option value="probation">Probation</option>
                      <option value="suspended">Suspended</option>
                      <option value="resigned">Resigned</option>
                      <option value="terminated">Terminated</option>
                    </select>
                  </div>
                  <div>
                    <label className="input-label">Position / Job Title</label>
                    <input
                      type="text"
                      name="position"
                      value={editFormData.position}
                      onChange={handleEditChange}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="input-label">Date of Joining</label>
                    <input
                      type="date"
                      name="dateOfJoining"
                      value={editFormData.dateOfJoining}
                      onChange={handleEditChange}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="input-label">Basic Salary (PKR)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      name="salaryBasic"
                      value={editFormData.salaryBasic}
                      onChange={handleEditChange}
                      className="input-field"
                    />
                  </div>
                  {/* <div>
                    <label className="input-label">Basic Salary (PKR)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      name="salaryHold"
                      value={editFormData.salaryHold.amount || 0}
                      onChange={handleEditChange}
                      className="input-field"
                    />
                  </div> */}
                  {/* <div>
                    <label className="input-label">Allowances (PKR)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      name="salaryAllowances"
                      value={editFormData.salaryAllowances}
                      onChange={handleEditChange}
                      className="input-field"
                    />
                  </div> */}
                  <div className="md:col-span-2">
                    <label className="input-label">Salary Hold Reason</label>
                    <textarea
                      name="reason"
                      rows={2}
                      value={editFormData.reason}
                      onChange={handleEditChange}
                      placeholder="e.g. Salary held pending equipment return"
                      className="input-field resize-none"
                    />
                  </div>
                </div>

                <div className="mt-4 border-t border-white/5 pt-4">
                  <p className="text-xs text-slate-400">
                    Advanced employee settings such as shift assignment, work mode, and role permissions are managed in a separate panel.
                  </p>
                </div>
                </>
                )}

                {editActiveTab === 'credentials' && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                    <h4 className="text-white text-sm font-semibold mb-3">Freelance Credentials</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="input-label">Application</label>
                        <input
                          type="text"
                          name="application"
                          value={newCredential.application}
                          onChange={handleCredentialChange}
                          className="input-field"
                          placeholder="e.g. Upwork"
                        />
                      </div>
                      <div>
                        <label className="input-label">Login URL</label>
                        <input
                          type="url"
                          name="loginUrl"
                          value={newCredential.loginUrl}
                          onChange={handleCredentialChange}
                          className="input-field"
                          placeholder="https://..."
                        />
                      </div>
                      <div>
                        <label className="input-label">Username / Email</label>
                        <input
                          type="text"
                          name="usernameOrEmail"
                          value={newCredential.usernameOrEmail}
                          onChange={handleCredentialChange}
                          className="input-field"
                          placeholder="name@example.com"
                        />
                      </div>
                      <div>
                        <label className="input-label">Password</label>
                        <input
                          type="password"
                          name="password"
                          value={newCredential.password}
                          onChange={handleCredentialChange}
                          className="input-field"
                          autoComplete="new-password"
                        />
                      </div>
                      <div>
                        <label className="input-label">Two-Factor Authentication</label>
                        <input
                          type="text"
                          name="twoFactorAuthentication"
                          value={newCredential.twoFactorAuthentication}
                          onChange={handleCredentialChange}
                          className="input-field"
                          placeholder="Authenticator app, backup code, etc."
                        />
                      </div>
                      <div>
                        <label className="input-label">Security Q&A</label>
                        <input
                          type="text"
                          name="securityQa"
                          value={newCredential.securityQa}
                          onChange={handleCredentialChange}
                          className="input-field"
                          placeholder="Question and answer"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="input-label">Notes</label>
                        <textarea
                          name="notes"
                          value={newCredential.notes}
                          onChange={handleCredentialChange}
                          rows={2}
                          className="input-field resize-none"
                          placeholder="Optional note"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-3">
                      <button type="button" onClick={addCredential} className="btn-primary text-xs">
                        Add Credential
                      </button>
                    </div>
                    {selectedEmployee?.employeeProfile?.freelanceCredentials?.length > 0 && (
                      <div className="mt-4 text-xs text-slate-300">
                        <p className="text-slate-400 mb-2">Existing Credentials</p>
                        <div className="space-y-2">
                          {selectedEmployee.employeeProfile.freelanceCredentials.map((cred) => (
                            <div key={cred._id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-900 p-3">
                              <div className="min-w-0">
                                <p className="text-white text-sm">{cred.application || cred.platform || 'Application'}</p>
                                <p className="text-slate-400 text-[11px] break-all">{cred.usernameOrEmail || cred.username || 'No username or email'}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeCredential(cred._id)}
                                className="btn-secondary text-[11px] px-3 py-1"
                              >Remove</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                    <h4 className="text-white text-sm font-semibold mb-3">Signed Agreement</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="input-label">Upload Agreement</label>
                        <input
                          type="file"
                          accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          onChange={handleAgreementFileChange}
                          className="input-field"
                        />
                      </div>
                      <div className="flex items-end justify-end">
                        <button type="button" onClick={uploadAgreement} className="btn-primary text-xs">
                          Upload Signed Agreement
                        </button>
                      </div>
                    </div>
                    {selectedEmployee?.employeeProfile?.signedAgreement?.url && (
                      <div className="mt-3 text-slate-300 text-xs">
                        <p className="text-slate-400">Existing agreement</p>
                        <a
                          className="text-primary-300 hover:text-primary-200"
                          href={selectedEmployee.employeeProfile.signedAgreement.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View uploaded agreement
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                    <h4 className="text-white text-sm font-semibold mb-3">CNIC Images</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="input-label">CNIC Front</label>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleCnicFileChange('front')}
                          className="input-field"
                        />
                      </div>
                      <div>
                        <label className="input-label">CNIC Back</label>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleCnicFileChange('back')}
                          className="input-field"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-3">
                      <button type="button" onClick={uploadCnic} className="btn-primary text-xs">
                        Upload CNIC Images
                      </button>
                    </div>
                    {(selectedEmployee?.employeeProfile?.cnicImages?.front?.url || selectedEmployee?.employeeProfile?.cnicImages?.back?.url) && (
                      <div className="mt-3 flex gap-4 text-xs">
                        {selectedEmployee.employeeProfile.cnicImages.front?.url && (
                          <a
                            className="text-primary-300 hover:text-primary-200"
                            href={selectedEmployee.employeeProfile.cnicImages.front.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View CNIC front
                          </a>
                        )}
                        {selectedEmployee.employeeProfile.cnicImages.back?.url && (
                          <a
                            className="text-primary-300 hover:text-primary-200"
                            href={selectedEmployee.employeeProfile.cnicImages.back.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View CNIC back
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                )}
                </div>

                <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/5 shrink-0">
                  <button
                    type="button"
                    onClick={closeEditModal}
                    className="btn-secondary"
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={submitting}
                  >
                    {submitting ? 'Updating...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

// ─── EmpHoldSalaryFormModal ───────────────────────────────────────────────────
// Same form as Payroll Management → Hold Salary, but with the employee
// pre-selected (no dropdown). Opened when toggling ON a clear employee's hold
// from Employee Management's Hold Salary list.
function EmpHoldSalaryFormModal({ employee, activePayrollHold, onClose, onSuccess }) {
  const [submitting, setSubmitting] = useState(false);

  const toLocalDT = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [form, setForm] = useState({
    startDateTime: toLocalDT(new Date()),
    endDateTime: '',
    amount: '',
    reason: '',
  });

  const basicSalary = employee?.salary?.basic ?? employee?.salaryBasic ?? 0;
  const currency    = employee?.salary?.currency || 'PKR';

  const monthsBetween = (s, e) => {
    if (!s || !e) return 0;
    const sd = new Date(s), ed = new Date(e);
    if (isNaN(sd) || isNaN(ed) || ed <= sd) return 0;
    let m = (ed.getFullYear() - sd.getFullYear()) * 12 + (ed.getMonth() - sd.getMonth());
    if (ed.getDate() > sd.getDate()) m += 1;
    return Math.max(1, m);
  };

  const amountNum    = Number(form.amount) || 0;
  const durationNum  = monthsBetween(form.startDateTime, form.endDateTime);
  const dateValid    = durationNum > 0;
  const monthly      = dateValid ? Math.round((amountNum / durationNum) * 100) / 100 : 0;
  const exceedsBasic = basicSalary > 0 && amountNum > basicSalary;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (activePayrollHold) { toast.error('A salary hold is already in progress for this employee'); return; }
    if (!amountNum || amountNum <= 0) { toast.error('Please enter a hold amount greater than 0'); return; }
    if (basicSalary <= 0)            { toast.error('This employee has no basic salary configured'); return; }
    if (exceedsBasic)                { toast.error(`Hold amount cannot exceed the basic salary (${basicSalary.toLocaleString()})`); return; }
    if (!dateValid)                  { toast.error('End date must be after the start date'); return; }

    setSubmitting(true);
    try {
      const empId = employee._id || employee.id;
      const { data } = await employeeAPI.createSalaryHold(empId, {
        amount:    amountNum,
        startDate: new Date(form.startDateTime).toISOString(),
        endDate:   new Date(form.endDateTime).toISOString(),
        reason:    form.reason.trim(),
      });
      if (data.success) {
        toast.success(data.message || 'Salary hold created successfully');
        onSuccess();
      } else {
        toast.error(data.message || 'Failed to create salary hold');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create salary hold');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-lg p-6 shadow-glow-primary relative"
      >
        <button onClick={onClose} className="absolute right-4 top-4 text-slate-400 hover:text-white transition-colors" type="button">
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-2 mb-5">
          <Lock className="w-5 h-5 text-warning-400" />
          <h3 className="font-display text-xl font-bold text-white">Hold Salary</h3>
        </div>

        {/* Employee info bar — pre-selected, no dropdown */}
        <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500/50 to-accent-500/50 flex-center shrink-0">
              {employee.avatar
                ? <img src={employee.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                : <span className="text-xs font-semibold text-white">{employee.firstName?.[0]}{employee.lastName?.[0]}</span>
              }
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{employee.firstName} {employee.lastName}</p>
              <p className="text-[11px] text-slate-400">{employee.employeeId || '—'} · {employee.position || '—'}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500">Basic Salary</p>
            <p className="text-sm font-semibold text-white">{currency} {basicSalary.toLocaleString()}</p>
          </div>
        </div>

        {/* Blocked: active payroll hold already running */}
        {activePayrollHold ? (
          <div className="rounded-xl border border-warning-500/30 bg-warning-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-warning-400" />
              <p className="text-xs text-warning-400 font-semibold">Salary Hold Already In Progress</p>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              This employee already has an active hold of{' '}
              <span className="text-white font-medium">{currency} {(activePayrollHold.amount || 0).toLocaleString()}</span>,
              with{' '}
              <span className="text-warning-400 font-semibold">
                {currency} {(activePayrollHold.remainingBalance || 0).toLocaleString()}
              </span>{' '}
              still to be deducted through payroll. A new hold can't be created until this one is complete.
            </p>
            <div className="flex justify-end pt-2 border-t border-white/5">
              <button type="button" onClick={onClose} className="btn-secondary text-xs">Close</button>
            </div>
          </div>
        ) : (
          /* Hold form */
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Start Date & Time */}
              <div>
                <label className="input-label">Start Date &amp; Time *</label>
                <input
                  required
                  type="datetime-local"
                  name="startDateTime"
                  value={form.startDateTime}
                  onChange={handleChange}
                  className="input-field"
                />
              </div>

              {/* End Date & Time */}
              <div>
                <label className="input-label">End Date &amp; Time *</label>
                <input
                  required
                  type="datetime-local"
                  name="endDateTime"
                  value={form.endDateTime}
                  onChange={handleChange}
                  min={form.startDateTime || undefined}
                  className="input-field"
                />
                {form.endDateTime && !dateValid && (
                  <p className="text-[11px] text-danger-400 mt-1">End must be after start</p>
                )}
              </div>

              {/* Amount */}
              <div className="md:col-span-2">
                <label className="input-label">Amount to Hold *</label>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  max={basicSalary || undefined}
                  name="amount"
                  value={form.amount}
                  onChange={handleChange}
                  placeholder={basicSalary ? `Max ${basicSalary.toLocaleString()}` : 'Enter amount'}
                  className={clsx('input-field', exceedsBasic && 'border-danger-500 focus:border-danger-500')}
                />
                {exceedsBasic && (
                  <p className="text-[11px] text-danger-400 mt-1">
                    Amount cannot exceed basic salary ({basicSalary.toLocaleString()})
                  </p>
                )}
                {!exceedsBasic && amountNum > 0 && dateValid && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    ≈ {monthly.toLocaleString()} {currency} will be deducted per payroll run across {durationNum} month{durationNum > 1 ? 's' : ''}
                  </p>
                )}
              </div>

              {/* Reason */}
              <div className="md:col-span-2">
                <label className="input-label">Reason (optional)</label>
                <textarea
                  name="reason"
                  value={form.reason}
                  onChange={handleChange}
                  rows={2}
                  placeholder="e.g. Equipment damage, advance recovery, policy violation..."
                  className="input-field"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-white/5">
              <button type="button" onClick={onClose} className="btn-secondary" disabled={submitting}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={submitting || exceedsBasic || !dateValid || amountNum <= 0}
              >
                {submitting
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" />Holding…</>
                  : 'Hold Salary'
                }
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}

// ─── EditSalaryHoldModal ────────────────────────────────────────────────────
// Edit an existing active installment-based hold's amount, end date, and
// reason. Opened from Employee Management's Hold Salary panel via the
// "Edit" button on the active-hold info card.
function EditSalaryHoldModal({ employee, hold, onClose, onSuccess }) {
  const [submitting, setSubmitting] = useState(false);

  const toLocalDate = (d) => {
    const dt = new Date(d);
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  };

  const [form, setForm] = useState({
    amount: hold.amount ?? '',
    endDate: hold.endDate ? toLocalDate(hold.endDate) : '',
    reason: hold.reason || '',
  });

  const basicSalary = employee?.salary?.basic ?? employee?.salaryBasic ?? 0;
  const currency = employee?.salary?.currency || 'PKR';
  const alreadyDeducted = Math.round(((hold.amount || 0) - (hold.remainingBalance || 0)) * 100) / 100;

  const amountNum = Number(form.amount) || 0;
  const startDate = hold.holdDate ? new Date(hold.holdDate) : null;
  const endDateValue = form.endDate ? new Date(form.endDate) : null;
  const dateValid = startDate && endDateValue && endDateValue > startDate;
  const belowDeducted = amountNum > 0 && amountNum < alreadyDeducted;
  const exceedsBasic = basicSalary > 0 && amountNum > basicSalary;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!amountNum || amountNum <= 0) { toast.error('Please enter a hold amount greater than 0'); return; }
    if (belowDeducted) { toast.error(`Amount can't be less than what's already been deducted (${alreadyDeducted.toLocaleString()})`); return; }
    if (exceedsBasic) { toast.error(`Hold amount cannot exceed the basic salary (${basicSalary.toLocaleString()})`); return; }
    if (!dateValid) { toast.error('End date must be after the start date'); return; }

    setSubmitting(true);
    try {
      const empId = employee._id || employee.id;
      const { data } = await employeeAPI.updateSalaryHoldRecord(empId, hold._id, {
        amount: amountNum,
        endDate: new Date(form.endDate).toISOString(),
        reason: form.reason.trim(),
      });
      if (data.success) {
        onSuccess(data.data);
      } else {
        toast.error(data.message || 'Failed to update salary hold');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update salary hold');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-lg p-6 shadow-glow-primary relative"
      >
        <button onClick={onClose} className="absolute right-4 top-4 text-slate-400 hover:text-white transition-colors" type="button">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-5">
          <Edit className="w-5 h-5 text-warning-400" />
          <h3 className="font-display text-xl font-bold text-white">Edit Salary Hold</h3>
        </div>

        {/* Employee info bar */}
        <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500/50 to-accent-500/50 flex-center shrink-0">
              {employee.avatar
                ? <img src={employee.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                : <span className="text-xs font-semibold text-white">{employee.firstName?.[0]}{employee.lastName?.[0]}</span>
              }
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{employee.firstName} {employee.lastName}</p>
              <p className="text-[11px] text-slate-400">
                Started {startDate ? startDate.toLocaleDateString() : '—'} · {alreadyDeducted.toLocaleString()} {currency} deducted so far
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500">Basic Salary</p>
            <p className="text-sm font-semibold text-white">{currency} {basicSalary.toLocaleString()}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Amount */}
            <div>
              <label className="input-label">Total Hold Amount *</label>
              <input
                required
                type="number"
                min={alreadyDeducted || 0}
                step="0.01"
                max={basicSalary || undefined}
                name="amount"
                value={form.amount}
                onChange={handleChange}
                className={clsx('input-field', (exceedsBasic || belowDeducted) && 'border-danger-500 focus:border-danger-500')}
              />
              {exceedsBasic && (
                <p className="text-[11px] text-danger-400 mt-1">Cannot exceed basic salary ({basicSalary.toLocaleString()})</p>
              )}
              {belowDeducted && (
                <p className="text-[11px] text-danger-400 mt-1">Cannot be less than what's already deducted ({alreadyDeducted.toLocaleString()})</p>
              )}
            </div>

            {/* End Date */}
            <div>
              <label className="input-label">End Date *</label>
              <input
                required
                type="date"
                name="endDate"
                value={form.endDate}
                onChange={handleChange}
                min={startDate ? toLocalDate(startDate) : undefined}
                className="input-field"
              />
              {form.endDate && !dateValid && (
                <p className="text-[11px] text-danger-400 mt-1">End must be after start</p>
              )}
            </div>

            {/* Reason */}
            <div className="md:col-span-2">
              <label className="input-label">Reason (optional)</label>
              <textarea
                name="reason"
                value={form.reason}
                onChange={handleChange}
                rows={2}
                placeholder="e.g. Equipment damage, advance recovery, policy violation..."
                className="input-field"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-white/5">
            <button type="button" onClick={onClose} className="btn-secondary" disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting || exceedsBasic || belowDeducted || !dateValid || amountNum <= 0}
            >
              {submitting
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" />Saving…</>
                : 'Save Changes'
              }
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// Mock data for demo
const MOCK_EMPLOYEES = [
  { id: '1', firstName: 'Emma',   lastName: 'Wilson',  email: 'emma@company.com',   employeeId: 'EMP00001', role: 'senior_manager', department: { name: 'Engineering' }, dateOfJoining: '2022-01-15', status: 'active'   },
  { id: '2', firstName: 'James',  lastName: 'Carter',  email: 'james@company.com',  employeeId: 'EMP00002', role: 'hr_recruiter',   department: { name: 'HR'          }, dateOfJoining: '2021-06-10', status: 'active'   },
  { id: '3', firstName: 'Priya',  lastName: 'Sharma',  email: 'priya@company.com',  employeeId: 'EMP00003', role: 'employee',       department: { name: 'Product'     }, dateOfJoining: '2023-03-20', status: 'active'   },
  { id: '4', firstName: 'Marcus', lastName: 'Chen',    email: 'marcus@company.com', employeeId: 'EMP00004', role: 'employee',       department: { name: 'Sales'       }, dateOfJoining: '2020-09-05', status: 'on_leave' },
  { id: '5', firstName: 'Sofia',  lastName: 'Reyes',   email: 'sofia@company.com',  employeeId: 'EMP00005', role: 'employee',       department: { name: 'Marketing'   }, dateOfJoining: '2023-07-12', status: 'probation'},
  { id: '6', firstName: 'Liam',   lastName: 'O\'Brien',email: 'liam@company.com',   employeeId: 'EMP00006', role: 'employee',       department: { name: 'DevOps'      }, dateOfJoining: '2022-11-01', status: 'active'   },
  { id: '7', firstName: 'Aisha',  lastName: 'Patel',   email: 'aisha@company.com',  employeeId: 'EMP00007', role: 'employee',       department: { name: 'Finance'     }, dateOfJoining: '2021-04-18', status: 'active'   },
  { id: '8', firstName: 'Ryan',   lastName: 'Park',    email: 'ryan@company.com',   employeeId: 'EMP00008', role: 'employee',       department: { name: 'Engineering' }, dateOfJoining: '2024-01-08', status: 'active'   },
];
