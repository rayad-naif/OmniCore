import { motion } from 'framer-motion';
import { Users, TrendingUp, Calendar, Clock, CheckCircle, Star, AlertTriangle, Target } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis } from 'recharts';
import { useSelector } from 'react-redux';
import { selectUser } from '@/store/slices/authSlice';

const TEAM = [
  { name:'James Wilson',  role:'Frontend Dev',    rating:4.6, attendance:95, tasks:8,  completed:7, status:'active'   },
  { name:'Emma Johnson',  role:'Senior Dev',      rating:4.9, attendance:98, tasks:10, completed:9, status:'active'   },
  { name:'Sophia Thomas', role:'Backend Dev',     rating:4.4, attendance:91, tasks:6,  completed:5, status:'active'   },
  { name:'Lucas Harris',  role:'DevOps Engineer', rating:4.7, attendance:97, tasks:5,  completed:5, status:'active'   },
  { name:'Ethan Anderson',role:'UI/UX Designer',  rating:4.3, attendance:88, tasks:7,  completed:6, status:'on_leave' },
];

const PERF_TREND = [
  { month:'Sep', team:4.1, company:3.9 },
  { month:'Oct', team:4.3, company:4.0 },
  { month:'Nov', team:4.5, company:4.1 },
  { month:'Dec', team:4.6, company:4.2 },
];

const RADAR_DATA = [
  { subject:'Technical',     value:4.7 },
  { subject:'Communication', value:4.2 },
  { subject:'Teamwork',      value:4.8 },
  { subject:'Delivery',      value:4.5 },
  { subject:'Innovation',    value:4.0 },
  { subject:'Leadership',    value:3.8 },
];

const PENDING_LEAVES = [
  { name:'Ethan Anderson', type:'Annual',  days:3, from:'Dec 20', to:'Dec 22', reason:'Family event' },
  { name:'Sophia Thomas',  type:'Sick',    days:1, from:'Dec 18', to:'Dec 18', reason:'Medical appointment' },
  { name:'James Wilson',   type:'Casual',  days:2, from:'Dec 26', to:'Dec 27', reason:'Personal work' },
];

export default function ManagerDashboard() {
  const user = useSelector(selectUser);
  const avgRating  = (TEAM.reduce((s,t)=>s+t.rating,0)/TEAM.length).toFixed(1);
  const avgAttend  = Math.round(TEAM.reduce((s,t)=>s+t.attendance,0)/TEAM.length);

  return (
    <div className="space-y-6">
      <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} className="flex-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Manager Dashboard</h1>
          <p className="text-slate-400 text-sm mt-0.5">Engineering Team · {TEAM.length} direct reports</p>
        </div>
        <div className="flex gap-2">
          <span className="badge-success badge">Team performing well</span>
        </div>
      </motion.div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Team Size',       value:TEAM.length,          icon:Users,       color:'text-primary-400', bg:'bg-primary-500/10' },
          { label:'Avg Rating',      value:`${avgRating}/5`,     icon:Star,        color:'text-warning-400', bg:'bg-warning-500/10' },
          { label:'Avg Attendance',  value:`${avgAttend}%`,      icon:Clock,       color:'text-accent-400',  bg:'bg-accent-500/10'  },
          { label:'Pending Leaves',  value:PENDING_LEAVES.length,icon:Calendar,    color:'text-danger-400',  bg:'bg-danger-500/10'  },
        ].map((s,i) => (
          <motion.div key={s.label} initial={{opacity:0,y:15}} animate={{opacity:1,y:0}} transition={{delay:i*0.08}}
            className="stat-card">
            <div className={`w-9 h-9 rounded-xl flex-center ${s.bg}`}>
              <s.icon className={`w-4 h-4 ${s.color}`}/>
            </div>
            <div>
              <p className="text-2xl font-display font-bold text-white">{s.value}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Performance trend */}
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.2}} className="glass-card p-5 lg:col-span-2">
          <h3 className="font-semibold text-white text-sm mb-4">Team vs Company Performance</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={PERF_TREND}>
              <defs>
                <linearGradient id="gTeam" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="gCo" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
              <XAxis dataKey="month" tick={{fill:'#64748b',fontSize:11}} axisLine={false} tickLine={false}/>
              <YAxis domain={[3.5,5]} tick={{fill:'#64748b',fontSize:11}} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{background:'#1e293b',border:'1px solid rgba(255,255,255,0.1)',borderRadius:'12px',fontSize:'11px'}}/>
              <Area type="monotone" dataKey="team"    name="My Team"  stroke="#6366f1" fill="url(#gTeam)" strokeWidth={2}/>
              <Area type="monotone" dataKey="company" name="Company"  stroke="#10b981" fill="url(#gCo)"  strokeWidth={2} strokeDasharray="4 4"/>
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Radar */}
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.25}} className="glass-card p-5">
          <h3 className="font-semibold text-white text-sm mb-2">Team Competency</h3>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={RADAR_DATA}>
              <PolarGrid stroke="rgba(255,255,255,0.08)"/>
              <PolarAngleAxis dataKey="subject" tick={{fill:'#64748b',fontSize:10}}/>
              <Radar name="Team" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} strokeWidth={2}/>
            </RadarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Team table + Leave requests */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.3}} className="glass-card overflow-hidden lg:col-span-2">
          <div className="p-4 border-b border-white/5 flex-between">
            <h3 className="font-semibold text-white text-sm">Team Members</h3>
            <span className="text-xs text-slate-500">{TEAM.length} members</span>
          </div>
          <table className="data-table">
            <thead><tr><th>Member</th><th>Rating</th><th>Attendance</th><th>Tasks</th><th>Status</th></tr></thead>
            <tbody>
              {TEAM.map((m,i) => (
                <tr key={i}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500/40 to-accent-500/40 flex-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-white">{m.name.split(' ').map(n=>n[0]).join('')}</span>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-white">{m.name}</p>
                        <p className="text-[10px] text-slate-500">{m.role}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <Star className="w-3 h-3 text-warning-400 fill-warning-400"/>
                      <span className="text-xs text-white">{m.rating}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-accent-500" style={{width:`${m.attendance}%`}}/>
                      </div>
                      <span className="text-[10px] text-slate-400">{m.attendance}%</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-accent-400">{m.completed}</span>
                      <span className="text-slate-600">/</span>
                      <span className="text-slate-400">{m.tasks}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge text-[10px] ${m.status==='active'?'badge-success':'badge-warning'}`}>
                      {m.status==='active'?'Active':'On Leave'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>

        {/* Pending leave requests */}
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.35}} className="glass-card p-5">
          <div className="flex-between mb-4">
            <h3 className="font-semibold text-white text-sm">Pending Leave Requests</h3>
            <span className="badge-warning badge text-[10px]">{PENDING_LEAVES.length} pending</span>
          </div>
          <div className="space-y-3">
            {PENDING_LEAVES.map((l,i) => (
              <div key={i} className="p-3 bg-surface-800/60 rounded-xl border border-white/5">
                <div className="flex-between mb-1">
                  <p className="text-xs font-medium text-white">{l.name}</p>
                  <span className="badge-primary badge text-[10px]">{l.type}</span>
                </div>
                <p className="text-[10px] text-slate-500 mb-2">{l.from} → {l.to} · {l.days}d · {l.reason}</p>
                <div className="flex gap-1.5">
                  <button className="flex-1 py-1.5 bg-accent-500/10 border border-accent-500/20 text-accent-400 text-[10px] rounded-lg hover:bg-accent-500/20 transition-all flex-center gap-1">
                    <CheckCircle className="w-3 h-3"/>Approve
                  </button>
                  <button className="flex-1 py-1.5 bg-danger-500/10 border border-danger-500/20 text-danger-400 text-[10px] rounded-lg hover:bg-danger-500/20 transition-all flex-center gap-1">
                    <AlertTriangle className="w-3 h-3"/>Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
