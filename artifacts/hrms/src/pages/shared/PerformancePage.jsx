import { useState } from 'react';
import { motion } from 'framer-motion';
import { Target, Star, TrendingUp, Users, Bot, Award } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import clsx from 'clsx';

const TEAM_RATINGS = [
  { name:'Emma Johnson',  dept:'Engineering', q2:4.1, q3:4.4, q4:4.9, role:'Sr. Developer'    },
  { name:'Lucas Harris',  dept:'Engineering', q2:4.3, q3:4.5, q4:4.7, role:'DevOps Engineer'  },
  { name:'James Wilson',  dept:'Engineering', q2:3.8, q3:4.1, q4:4.6, role:'Frontend Dev'     },
  { name:'Sophia Thomas', dept:'Engineering', q2:4.0, q3:4.2, q4:4.4, role:'Backend Dev'      },
  { name:'Ethan Anderson',dept:'Design',      q2:3.9, q3:4.0, q4:4.3, role:'UI/UX Designer'   },
  { name:'Liam Brown',    dept:'Sales',       q2:4.2, q3:4.3, q4:4.5, role:'Sales Executive'  },
  { name:'Olivia Davis',  dept:'Marketing',   q2:3.7, q3:3.9, q4:4.1, role:'Mktg Specialist'  },
];

const DEPT_AVG = [
  { dept:'Engineering', q2:4.1, q3:4.3, q4:4.7 },
  { dept:'HR',          q2:4.0, q3:4.2, q4:4.4 },
  { dept:'Sales',       q2:3.9, q3:4.1, q4:4.3 },
  { dept:'Marketing',   q2:3.8, q3:3.9, q4:4.1 },
  { dept:'Finance',     q2:4.0, q3:4.1, q4:4.2 },
  { dept:'Product',     q2:4.2, q3:4.3, q4:4.5 },
];

export default function PerformancePage() {
  const [period, setPeriod] = useState('q4');
  const companyAvg = (TEAM_RATINGS.reduce((s,e)=>s+e[period],0)/TEAM_RATINGS.length).toFixed(2);

  return (
    <div className="space-y-5">
      <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} className="flex-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Performance Overview</h1>
          <p className="text-slate-400 text-sm mt-0.5">Company-wide ratings and reviews</p>
        </div>
        <div className="flex gap-2">
          {['q2','q3','q4'].map(q => (
            <button key={q} onClick={()=>setPeriod(q)}
              className={clsx('px-4 py-2 rounded-xl text-xs font-medium transition-all uppercase',
                period===q?'bg-primary-600 text-white':'btn-secondary')}>
              {q} 2025
            </button>
          ))}
        </div>
      </motion.div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Company Avg',   value:companyAvg+'/5', icon:Star,      color:'text-warning-400', bg:'bg-warning-500/10' },
          { label:'Employees Rated',value:TEAM_RATINGS.length, icon:Users, color:'text-primary-400', bg:'bg-primary-500/10' },
          { label:'Top Performer', value:'4.9',           icon:Award,     color:'text-accent-400',  bg:'bg-accent-500/10'  },
          { label:'Needs Support', value:'1',             icon:Target,    color:'text-danger-400',  bg:'bg-danger-500/10'  },
        ].map((s,i) => (
          <motion.div key={s.label} initial={{opacity:0,y:15}} animate={{opacity:1,y:0}} transition={{delay:i*0.08}} className="stat-card">
            <div className={`w-9 h-9 rounded-xl flex-center ${s.bg}`}><s.icon className={`w-4 h-4 ${s.color}`}/></div>
            <div>
              <p className="text-2xl font-display font-bold text-white">{s.value}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Dept avg chart */}
      <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.15}} className="glass-card p-5">
        <h3 className="font-semibold text-white text-sm mb-4">Department Average Ratings — {period.toUpperCase()} 2025</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={DEPT_AVG} barSize={36}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false}/>
            <XAxis dataKey="dept" tick={{fill:'#64748b',fontSize:11}} axisLine={false} tickLine={false}/>
            <YAxis domain={[3.5,5]} tick={{fill:'#64748b',fontSize:11}} axisLine={false} tickLine={false}/>
            <Tooltip contentStyle={{background:'#1e293b',border:'1px solid rgba(255,255,255,0.1)',borderRadius:'12px',fontSize:'11px'}}/>
            <Bar dataKey={period} name="Avg Rating" radius={[6,6,0,0]}>
              {DEPT_AVG.map((_,i)=>(
                <rect key={i} fill={i===0?'#6366f1':'rgba(99,102,241,0.4)'}/>
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Team ratings table */}
      <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.2}} className="glass-card overflow-hidden">
        <div className="p-4 border-b border-white/5 flex-between">
          <h3 className="font-semibold text-white text-sm">Individual Ratings</h3>
          <div className="flex items-center gap-1.5 text-xs text-primary-400 bg-primary-500/10 px-2.5 py-1 rounded-full border border-primary-500/20">
            <Bot className="w-3.5 h-3.5"/>AI Insights Available
          </div>
        </div>
        <table className="data-table">
          <thead><tr><th>Employee</th><th>Department</th><th>Role</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Trend</th></tr></thead>
          <tbody>
            {TEAM_RATINGS.sort((a,b)=>b[period]-a[period]).map((e,i)=>{
              const trend = e.q4 - e.q2;
              return (
                <tr key={i}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-full flex-center flex-shrink-0 text-[10px] font-bold text-white
                        ${i===0?'bg-yellow-500':i===1?'bg-slate-400':i===2?'bg-orange-600':'bg-gradient-to-br from-primary-500/40 to-accent-500/40'}`}>
                        {i<3?i+1:e.name.split(' ').map(n=>n[0]).join('')}
                      </div>
                      <span className="text-xs font-medium text-white">{e.name}</span>
                    </div>
                  </td>
                  <td className="text-slate-400 text-xs">{e.dept}</td>
                  <td className="text-slate-400 text-xs">{e.role}</td>
                  <td className="text-xs text-slate-400">{e.q2}</td>
                  <td className="text-xs text-slate-400">{e.q3}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <Star className="w-3 h-3 text-warning-400 fill-warning-400"/>
                      <span className="text-xs font-semibold text-white">{e.q4}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`text-xs flex items-center gap-0.5 ${trend>0?'text-accent-400':trend<0?'text-danger-400':'text-slate-500'}`}>
                      {trend>0?'↑':trend<0?'↓':'→'}{Math.abs(trend).toFixed(1)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </motion.div>
    </div>
  );
}
