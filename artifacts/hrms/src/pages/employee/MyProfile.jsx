import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { User, Mail, Phone, MapPin, Briefcase, Calendar, Edit, Save, Camera, Key, Eye, EyeOff } from 'lucide-react';
import { useSelector, useDispatch } from 'react-redux';
import { selectUser } from '@/store/slices/authSlice';
import { authAPI, employeeAPI } from '@/services/api';
import StatusModal from '@/pages/shared/StatusModal';
import AvatarCropModal from '@/pages/shared/AvatarCropModal';
import toast from 'react-hot-toast';

export default function MyProfile() {
  const reduxUser = useSelector(selectUser);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState('personal');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ── Canonical profile from the server (source of truth for display) ──────
  const [profile, setProfile] = useState(null);

  // ── Editable form — only synced from `profile` when NOT editing ─────────
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', address: '', dateOfBirth: '', bio: '' });

  const fetchProfile = async () => {
    try {
      const { data } = await employeeAPI.getMyProfile(); // GET /employees/me/profile
      const p = data.data;
      setProfile(p);
      setForm({
        firstName: p.firstName || '',
        lastName:  p.lastName  || '',
        phone:     p.phone     || '',
        address:   p.address?.city || '',
        dateOfBirth: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : '',
        bio:       p.bio || '',
      });
    } catch (err) {
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProfile(); }, []);

  // ── Avatar upload ────────────────────────────────────────────────────────
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(reduxUser?.avatar || null);

  const handleAvatarSave = async (croppedBlob) => {
    const employeeId = reduxUser?._id || reduxUser?.id;
    const file = new File([croppedBlob], 'avatar.jpg', { type: 'image/jpeg' });
    const { data } = await employeeAPI.uploadAvatar(employeeId, file);
    setAvatarUrl(data.data.avatar);
    toast.success('Profile picture updated!');
  };

  const handleEditToggle = () => {
    if (!editing) {
      // entering edit mode — resync form with latest server data
      setForm({
        firstName: profile?.firstName || '',
        lastName:  profile?.lastName  || '',
        phone:     profile?.phone     || '',
        address:   profile?.address?.city || '',
        dateOfBirth: profile?.dateOfBirth ? profile.dateOfBirth.slice(0, 10) : '',
        bio:       profile?.bio || '',
      });
      setEditing(true);
    } else {
      handleSave();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await employeeAPI.updateMyProfile({
        firstName: form.firstName,
        lastName:  form.lastName,
        phone:     form.phone,
        address:   form.address,
        dateOfBirth: form.dateOfBirth,
        bio:       form.bio,
      });
      setProfile(data.data);          // <-- this is what fixes the "shows old data" problem
      setEditing(false);
      toast.success('Profile updated successfully!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update profile');
      // stay in edit mode so the user doesn't lose their input
    } finally {
      setSaving(false);
    }
  };

  const TABS = ['personal', 'security'];

  // ── Change password (unchanged) ─────────────────────────────────────────
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwLoading, setPwLoading] = useState(false);
  const [showPw, setShowPw] = useState({ currentPassword: false, newPassword: false, confirmPassword: false });
  const [showPwSuccessModal, setShowPwSuccessModal] = useState(false);

  const PW_FIELDS = [
    { key: 'currentPassword', label: 'Current Password' },
    { key: 'newPassword',     label: 'New Password' },
    { key: 'confirmPassword', label: 'Confirm New Password' },
  ];

  const toggleShowPw = (key) => setShowPw(prev => ({ ...prev, [key]: !prev[key] }));

  const handleChangePassword = async () => {
    const { currentPassword, newPassword, confirmPassword } = pwForm;
    if (!currentPassword || !newPassword || !confirmPassword) return toast.error('Please fill in all password fields');
    if (newPassword.length < 8) return toast.error('New password must be at least 8 characters');
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/.test(newPassword))
      return toast.error('New password must include uppercase, lowercase, a number and a special character');
    if (newPassword !== confirmPassword) return toast.error('New password and confirmation do not match');
    if (newPassword === currentPassword) return toast.error('New password must be different from your current password');

    setPwLoading(true);
    try {
      await authAPI.changePassword({ currentPassword, newPassword, confirmPassword });
      setShowPwSuccessModal(true);
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowPw({ currentPassword: false, newPassword: false, confirmPassword: false });
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update password');
    } finally {
      setPwLoading(false);
    }
  };

  if (loading) {
    return <div className="glass-card p-6 text-sm text-slate-400">Loading profile…</div>;
  }

  return (
    <div className="space-y-5">
      <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}}>
        <h1 className="font-display text-2xl font-bold text-white">My Profile</h1>
        <p className="text-slate-400 text-sm mt-0.5">Manage your personal information and settings</p>
      </motion.div>

      {/* Profile header card */}
      <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.1}} className="glass-card p-6">
        <div className="flex items-start gap-5 flex-wrap">
          <div className="relative">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex-center shadow-glow-primary overflow-hidden">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-white">
                  {(profile?.firstName||'?')[0]}{(profile?.lastName||'')[0]}
                </span>
              )}
            </div>
            <button
              onClick={() => setShowAvatarModal(true)}
              className="absolute -bottom-1 -right-1 w-7 h-7 bg-primary-600 rounded-full flex-center border-2 border-surface-900 hover:bg-primary-500 transition-colors"
            >
              <Camera className="w-3.5 h-3.5 text-white"/>
            </button>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-display text-xl font-bold text-white">{profile?.firstName} {profile?.lastName}</h2>
                <p className="text-slate-400 text-sm">{profile?.position || '—'}</p>
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <span className="badge-primary badge text-[10px] capitalize">{profile?.role?.replace(/_/g,' ')}</span>
                  <span className="badge-success badge text-[10px]">{profile?.status === 'active' ? 'Active' : (profile?.status || 'Active')}</span>
                  <span className="text-[10px] text-slate-500 font-mono">{profile?.employeeId || '—'}</span>
                </div>
              </div>
              <button
                onClick={handleEditToggle}
                disabled={saving}
                className={`${editing ? 'btn-primary text-xs' : 'btn-secondary text-xs'} ${saving ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {editing ? <><Save className="w-3.5 h-3.5"/>{saving ? 'Saving…' : 'Save Changes'}</> : <><Edit className="w-3.5 h-3.5"/>Edit Profile</>}
              </button>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
              {[
                { icon:Mail,     label:profile?.email || '—' },
                { icon:Phone,    label:profile?.phone || '—' },
                { icon:MapPin,   label:profile?.address?.city || '—' },
                { icon:Calendar, label:`Joined ${profile?.dateOfJoining ? new Date(profile.dateOfJoining).toLocaleDateString('en-US',{month:'short',year:'numeric'}) : '—'}` },
              ].map((item,i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-slate-400">
                  <item.icon className="w-3.5 h-3.5 text-slate-600 flex-shrink-0"/>
                  <span className="truncate">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-2">
        {TABS.map(t => (
          <button key={t} onClick={()=>setTab(t)}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-all capitalize ${tab===t?'bg-primary-600 text-white':'btn-secondary'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Personal tab */}
      {tab==='personal' && (
        <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="glass-card p-5">
            <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
              <User className="w-4 h-4 text-primary-400"/>Personal Information
            </h3>
            <div className="space-y-4">
              {[
                { label:'First Name', key:'firstName', type:'text' },
                { label:'Last Name',  key:'lastName',  type:'text' },
                { label:'Phone',      key:'phone',     type:'tel'  },
                { label:'Location',   key:'address',   type:'text' },
                { label:'Birthday',   key:'dateOfBirth', type:'date' },
              ].map(f => (
                <div key={f.key}>
                  <label className="input-label">{f.label}</label>
                  <input type={f.type} value={form[f.key]} max={f.key === 'dateOfBirth' ? new Date().toISOString().slice(0, 10) : undefined} disabled={!editing}
                    onChange={e=>setForm({...form,[f.key]:e.target.value})}
                    className={`input-field text-sm ${!editing?'opacity-60 cursor-not-allowed':''}`}/>
                </div>
              ))}
              <div>
                <label className="input-label">Bio</label>
                <textarea value={form.bio} disabled={!editing} rows={3}
                  onChange={e=>setForm({...form,bio:e.target.value})}
                  className={`input-field text-sm resize-none ${!editing?'opacity-60 cursor-not-allowed':''}`}/>
              </div>
            </div>
          </div>

          {/* Employment Details — now dynamic, and NEVER editable here */}
          <div className="glass-card p-5">
            <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-accent-400"/>Employment Details
            </h3>
            <div className="space-y-3">
              {[
                { label:'Employee ID',   value: profile?.employeeId || '—' },
                { label:'Department',    value: profile?.department?.name || '—' },
                { label:'Position',      value: profile?.position || '—' },
                { label:'Employee Type', value: profile?.employmentType || '—' },
                { label:'Work Mode',     value: profile?.employeeProfile?.shift?.workMode || '—' },
                { label:'Shift',         value: profile?.employeeProfile?.shift
                    ? `${profile.employeeProfile.shift.startTime} – ${profile.employeeProfile.shift.endTime} (${profile.employeeProfile.shift.type})`
                    : '—' },
                { label:'Reporting To',  value: profile?.reportingManager
                    ? `${profile.reportingManager.firstName} ${profile.reportingManager.lastName}`
                    : '—' },
                { label:'Date Joined',   value: profile?.dateOfJoining
                    ? new Date(profile.dateOfJoining).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
                    : '—' },
              ].map(item => (
                <div key={item.label} className="flex-between py-2 border-b border-white/5 text-xs">
                  <span className="text-slate-500">{item.label}</span>
                  <span className="text-slate-200 font-medium">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Security tab — unchanged from your version */}
      {tab==='security' && (
        <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="glass-card p-5">
            <h3 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
              <Key className="w-4 h-4 text-warning-400"/>Change Password
            </h3>
            <div className="space-y-4">
              {PW_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="input-label">{f.label}</label>
                  <div className="relative">
                    <input
                      type={showPw[f.key] ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={pwForm[f.key]}
                      onChange={e => setPwForm({ ...pwForm, [f.key]: e.target.value })}
                      disabled={pwLoading}
                      className={`input-field text-sm pr-10 ${pwLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
                    />
                    <button type="button" onClick={() => toggleShowPw(f.key)} tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                      {showPw[f.key] ? <EyeOff className="w-3.5 h-3.5"/> : <Eye className="w-3.5 h-3.5"/>}
                    </button>
                  </div>
                </div>
              ))}
              <button onClick={handleChangePassword} disabled={pwLoading}
                className={`btn-primary text-xs w-full justify-center mt-2 ${pwLoading ? 'opacity-60 cursor-not-allowed' : ''}`}>
                <Key className="w-3.5 h-3.5"/>{pwLoading ? 'Updating…' : 'Update Password'}
              </button>
            </div>
          </div>
        </motion.div>
      )}

      <StatusModal
        isOpen={showPwSuccessModal}
        type="success"
        title="Password Updated"
        message="Your password has been changed successfully. Use your new password the next time you log in."
        confirmLabel="Done"
        onConfirm={() => setShowPwSuccessModal(false)}
        onClose={() => setShowPwSuccessModal(false)}
      />

      <AvatarCropModal isOpen={showAvatarModal} onClose={() => setShowAvatarModal(false)} onSave={handleAvatarSave} />
    </div>
  );
}
