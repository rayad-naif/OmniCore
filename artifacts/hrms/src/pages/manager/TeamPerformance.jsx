import { useState } from 'react';
import { motion } from 'framer-motion';
import { Star, TrendingUp, Bot, Target, CheckCircle, Plus } from 'lucide-react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import clsx from 'clsx';

const TEAM = [
  { name:'James Wilson',  role:'Frontend Dev',    q4:4.6, technical:5, communication:4, teamwork:5, leadership:4, productivity:5, strengths:['React expertise','Team player'],     improvements:['Backend skills','Documentation'] },
  { name:'Emma Johnson',  role:'Senior Dev',      q4:4.9, technical:5, communication:5, teamwork:5, leadership:5, productivity:5, strengths:['Full-stack master','Mentorship'],   improvements:['Work-life balance'] },
  { name:'Sophia Thomas', role:'Backend Dev',     q4:4.4, technical:4, communication:4, teamwork:5, leadership:4, productivity:5, strengths:['Node.js expert','Reliable'],         improvements:['Communication in standups'] },
  { name:'Lucas Harris',  role:'DevOps Engineer', q4:4.7, technical:5, communication:4, teamwork:4, leadership:4, productivity:5, strengths:['Infrastructure','Automation'],       improvements:['Cross-team visibility'] },
  { name:'Ethan Anderson',role:'UI/UX Designer',  q4:4.3, technical:4, communication:4, teamwork:4, leadership:3, productivity:5, strengths:['Creative design','User research'],   improvements:['Dev handoff process'] },
];

export default function TeamPerformance() {
  const [selected, setSelected] = useState(TEAM[0]);
  const radarData = ['technical','communication','teamwork','leadership','productivity'].map(k=>({
    subject: k.charAt(0).toUpperCase()+k.slice(1), value: selected[k], fullMark: 5,
  }));
  const avgRating = (TEAM.reduce((s,t)=>s+t.q4,0)/TEAM.length).toFixed(1);

  return (
    <div className="space-y-5">
      <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} className="flex-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Team Performance</h1>
          <p className="text-slate-400 text-sm mt-0.5">Q4 2025 · Engineering Team · {TEAM.length} members</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge-success badge">Team Avg: {avgRating}/5</span>
          <button className="btn-primary text-xs"><Plus className="w-3.5 h-3.5"/>New Review</button>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Member list */}
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.1}} className="glass-card p-4 space-y-2">
          <h3 className="font-semibold text-white text-sm mb-3">Team Members</h3>
          {TEAM.map((m,i) => (
            <button key={i} onClick={()=>setSelected(m)}
              className={clsx('w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all',
                selected.name===m.name?'bg-primary-500/15 border border-primary-500/25':'hover:bg-white/5')}>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500/50 to-accent-500/50 flex-center flex-shrink-0">
                <span className="text-[10px] font-bold text-white">{m.name.split(' ').map(n=>n[0]).join('')}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate">{m.name}</p>
                <p className="text-[10px] text-slate-500">{m.role}</p>
              </div>
              <div className="flex items-center gap-0.5">
                <Star className="w-3 h-3 text-warning-400 fill-warning-400"/>
                <span className="text-xs font-bold text-white">{m.q4}</span>
              </div>
            </button>
          ))}
        </motion.div>

        {/* Detail */}
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.15}} className="lg:col-span-2 space-y-4">
          {/* Header */}
          <div className="glass-card p-5 flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex-center flex-shrink-0">
              <span className="text-lg font-bold text-white">{selected.name.split(' ').map(n=>n[0]).join('')}</span>
            </div>
            <div className="flex-1">
              <h3 className="font-display font-bold text-white text-lg">{selected.name}</h3>
              <p className="text-slate-400 text-sm">{selected.role}</p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1 justify-end">
                <Star className="w-5 h-5 text-warning-400 fill-warning-400"/>
                <span className="text-3xl font-display font-bold text-white">{selected.q4}</span>
                <span className="text-slate-500 text-sm">/5</span>
              </div>
              <p className="text-xs text-slate-500">Q4 2025</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Radar */}
            <div className="glass-card p-4">
              <h4 className="text-xs font-semibold text-white mb-2">Competency Radar</h4>
              <ResponsiveContainer width="100%" height={160}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="rgba(255,255,255,0.07)"/>
                  <PolarAngleAxis dataKey="subject" tick={{fill:'#64748b',fontSize:9}}/>
                  <Radar name={selected.name} dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} strokeWidth={2}/>
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Strengths + improvements */}
            <div className="glass-card p-4 flex flex-col gap-3">
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Strengths</p>
                {selected.strengths.map((s,i)=>(
                  <div key={i} className="flex items-center gap-2 text-xs text-slate-300 mb-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-accent-400 flex-shrink-0"/>{s}
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Growth Areas</p>
                {selected.improvements.map((s,i)=>(
                  <div key={i} className="flex items-center gap-2 text-xs text-slate-300 mb-1.5">
                    <Target className="w-3.5 h-3.5 text-warning-400 flex-shrink-0"/>{s}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* AI insight */}
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-lg bg-primary-600 flex-center"><Bot className="w-3.5 h-3.5 text-white"/></div>
              <span className="text-xs font-semibold text-white">ARIA AI Insight</span>
              <span className="badge-primary badge text-[9px]">Gemini</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {selected.name.split(' ')[0]} demonstrates {selected.q4>=4.7?'exceptional':'strong'} performance at {selected.q4}/5 this quarter.
              {selected.q4>=4.5?' Promotion consideration recommended within 6 months.'
               :' Continued growth trajectory observed — targeted development plan advised.'}
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
