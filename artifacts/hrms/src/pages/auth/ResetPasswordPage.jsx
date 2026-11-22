import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, CheckCircle } from 'lucide-react';
import { authAPI } from '@/services/api';
import BrandMark from '@/components/common/BrandMark';
import { productName } from '@/services/brand';
import toast from 'react-hot-toast';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm]   = useState({ password:'', confirm:'' });
  const [show, setShow]   = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return; }
    if (form.password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      await authAPI.resetPassword({
        token: params.get('token'),
        workspace: params.get('w'),
        password: form.password,
      });
      toast.success('Password reset successfully!');
      navigate(`/login?w=${encodeURIComponent(params.get('w') || '')}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'This reset link is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-950 bg-mesh flex-center p-6">
      <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-8">
          <BrandMark className="w-8 h-8" />
          <span className="font-display font-bold text-lg text-white">{productName()}</span>
        </div>
        <h2 className="font-display text-2xl font-bold text-white mb-1">Reset Password</h2>
        <p className="text-slate-400 text-sm mb-6">Enter your new password below.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {['password','confirm'].map(key => (
            <div key={key}>
              <label className="input-label">{key==='password'?'New Password':'Confirm Password'}</label>
              <div className="relative">
                <input type={show?'text':'password'} value={form[key]}
                  onChange={e=>setForm({...form,[key]:e.target.value})}
                  placeholder="••••••••" className="input-field pr-10"/>
                <button type="button" onClick={()=>setShow(!show)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                  {show?<EyeOff className="w-4 h-4"/>:<Eye className="w-4 h-4"/>}
                </button>
              </div>
            </div>
          ))}
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3">
            {loading?<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>Resetting...</>
              :<><CheckCircle className="w-4 h-4"/>Reset Password</>}
          </button>
        </form>
        <div className="mt-6 text-center">
          <Link to="/login" className="text-xs text-primary-400 hover:text-primary-300">Back to Sign In</Link>
        </div>
      </motion.div>
    </div>
  );
}
