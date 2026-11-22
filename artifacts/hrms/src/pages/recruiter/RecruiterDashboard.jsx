import { motion } from 'framer-motion';
import { Briefcase, Users, Bot, CheckCircle, TrendingUp, Clock, Star } from 'lucide-react';
import { FunnelChart, Funnel, LabelList, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import clsx from 'clsx';

const PIPELINE_DATA = [
  { value:83, name:'Applied',     fill:'#475569' },
  { value:52, name:'AI Screened', fill:'#6366f1' },
  { value:31, name:'Shortlisted', fill:'#8b5cf6' },
  { value:18, name:'Interviewed', fill:'#f59e0b' },
  { value:9,  name:'Offer Sent',  fill:'#10b981' },
  { value:5,  name:'Hired',       fill:'#22c55e' },
];

const WEEKLY_APPS = [
  { day:'Mon', apps:12 }, { day:'Tue', apps:18 }, { day:'Wed', apps:9 },
  { day:'Thu', apps:22 }, { day:'Fri', apps:15 },
];

const RECENT_APPS = [
  { name:'Arjun Mehta',   role:'Sr. Developer', score:89, rec:'strong_yes', stage:'shortlisted',        time:'2h ago'  },
  { name:'Zoe Laurent',   role:'Frontend Dev',  score:76, rec:'yes',        stage:'hr_interview',       time:'3h ago'  },
  { name:'Mei Zhang',     role:'Tech Lead',     score:93, rec:'strong_yes', stage:'technical_interview',time:'5h ago'  },
  { name:'David Osei',    role:'Backend Eng.',  score:88, rec:'strong_yes', stage:'offer_sent',         time:'1d ago'  },
  { name:'Nina Patel',    role:'Junior Dev',    score:54, rec:'maybe',      stage:'rejected',           time:'1d ago'  },
];

const REC_COLORS = { strong_yes:'badge-success', yes:'badge-success', maybe:'badge-warning', no:'badge-danger' };
const STAGE_COLORS = { shortlisted:'badge-primary', hr_interview:'badge-warning', technical_interview:'badge-warning', offer_sent:'badge-success', rejected:'badge-danger' };

export default function RecruiterDashboard() {
  return (
    <div className="space-y-6">
      <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} className="flex-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Recruiter Dashboard</h1>
          <p className="text-slate-400 text-sm mt-0.5">AI-Powered Talent Acquisition Platform</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-primary-400 bg-primary-500/10 border border-primary-500/20 px-3 py-1.5 rounded-full">
            <Bot className="w-3.5 h-3.5"/>AI Screening Active
          </span>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Open Positions', value:'6',   icon:Briefcase, color:'text-primary-400', bg:'bg-primary-500/10' },
          { label:'Total Applications', value:'83', icon:Users,    color:'text-accent-400',  bg:'bg-accent-500/10'  },
          { label:'AI Screened Today', value:'14', icon:Bot,      color:'text-warning-400', bg:'bg-warning-500/10' },
          { label:'Hired This Month',  value:'5',  icon:CheckCircle,color:'text-accent-400',bg:'bg-accent-500/10'  },
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Funnel */}
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.2}} className="glass-card p-5">
          <h3 className="font-semibold text-white text-sm mb-4">Hiring Funnel</h3>
          <div className="space-y-2">
            {PIPELINE_DATA.map((stage,i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-20 text-[10px] text-slate-400 flex-shrink-0 truncate">{stage.name}</div>
                <div className="flex-1 h-5 bg-surface-700 rounded-lg overflow-hidden">
                  <div className="h-full rounded-lg flex items-center px-2 transition-all duration-700"
                    style={{width:`${(stage.value/83)*100}%`, background:stage.fill}}>
                    <span className="text-[10px] font-semibold text-white ml-auto">{stage.value}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-accent-500/10 border border-accent-500/20 rounded-xl">
            <p className="text-xs text-slate-400">Conversion Rate</p>
            <p className="text-lg font-bold text-accent-400">6.0% <span className="text-xs text-slate-500">applied → hired</span></p>
          </div>
        </motion.div>

        {/* Weekly applications */}
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.25}} className="glass-card p-5">
          <h3 className="font-semibold text-white text-sm mb-4">Applications This Week</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={WEEKLY_APPS} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false}/>
              <XAxis dataKey="day" tick={{fill:'#64748b',fontSize:11}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fill:'#64748b',fontSize:11}} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{background:'#1e293b',border:'1px solid rgba(255,255,255,0.1)',borderRadius:'12px',fontSize:'11px'}}/>
              <Bar dataKey="apps" name="Applications" fill="#6366f1" radius={[6,6,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="p-2.5 bg-surface-800 rounded-xl text-center">
              <p className="text-base font-bold text-white">76</p>
              <p className="text-[10px] text-slate-500">Total this week</p>
            </div>
            <div className="p-2.5 bg-surface-800 rounded-xl text-center">
              <p className="text-base font-bold text-primary-400">15.2</p>
              <p className="text-[10px] text-slate-500">Avg per day</p>
            </div>
          </div>
        </motion.div>

        {/* Recent AI screenings */}
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.3}} className="glass-card p-5">
          <div className="flex-between mb-4">
            <h3 className="font-semibold text-white text-sm">Recent AI Screenings</h3>
            <Bot className="w-4 h-4 text-primary-400"/>
          </div>
          <div className="space-y-3">
            {RECENT_APPS.map((a,i) => (
              <div key={i} className="flex items-start gap-2.5 p-2.5 hover:bg-white/5 rounded-xl transition-colors cursor-pointer">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500/40 to-accent-500/40 flex-center flex-shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-white">{a.name.split(' ').map(n=>n[0]).join('')}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex-between">
                    <p className="text-xs font-medium text-white truncate">{a.name}</p>
                    <span className={`badge text-[10px] ml-1 flex-shrink-0 ${
                      a.score>=80?'badge-success':a.score>=65?'badge-warning':'badge-danger'}`}>
                      {a.score}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">{a.role}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`badge text-[10px] ${REC_COLORS[a.rec]}`}>{a.rec.replace('_',' ')}</span>
                    <span className="text-[10px] text-slate-600">{a.time}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
