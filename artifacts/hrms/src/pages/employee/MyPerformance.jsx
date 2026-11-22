import { useState } from 'react';
import { motion } from 'framer-motion';
import { Target, Star, TrendingUp, Award, CheckCircle, Bot } from 'lucide-react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import clsx from 'clsx';

const REVIEWS = [
  {
    period:'Q4 2025', rating:4.6, status:'completed',
    ratings:{ technical:5, communication:4, teamwork:5, leadership:4, productivity:5 },
    strengths:['Excellent React skills','Proactive problem solver','Strong team collaborator'],
    improvements:['Could document code more thoroughly','Public speaking skills'],
    managerComment:'James has had an outstanding quarter. His work on the dashboard redesign was exceptional.',
    aiInsights:'James shows exceptional performance with 4.6/5. On track for senior developer promotion within 6 months.',
    aiRecs:['Consider mentoring junior developers','Lead the next sprint planning session'],
  },
  {
    period:'Q3 2025', rating:4.4, status:'completed',
    ratings:{ technical:4, communication:4, teamwork:5, leadership:4, productivity:5 },
    strengths:['Reliable delivery','Good communication','Strong React knowledge'],
    improvements:['Backend skills need development','Leadership opportunities'],
    managerComment:'Consistent performer throughout Q3. Keep up the great work.',
    aiInsights:'Solid Q3 performance at 4.4/5. Improvement noted from Q2.',
    aiRecs:['Node.js upskilling recommended','Take on cross-team projects'],
  },
  {
    period:'Q2 2025', rating:4.1, status:'completed',
    ratings:{ technical:4, communication:4, teamwork:4, leadership:3, productivity:5 },
    strengths:['Technical delivery','Meeting deadlines'],
    improvements:['Communication in standups','Cross-team collaboration'],
    managerComment:'Good performance, room to grow in communication.',
    aiInsights:'Good baseline at 4.1/5. Upward trajectory observed.',
    aiRecs:['Communication workshops','Pair programming sessions'],
  },
];

const TREND_DATA = REVIEWS.slice().reverse().map(r => ({ period: r.period.split(' ')[0]+' '+r.period.split(' ')[1], rating: r.rating }));

const GOALS = [
  { title:'Complete React Advanced Course',  progress:85,  due:'Jan 15',  status:'in_progress' },
  { title:'Lead a sprint planning session',  progress:50,  due:'Dec 31',  status:'in_progress' },
  { title:'Document 3 core components',      progress:100, due:'Dec 20',  status:'completed'   },
  { title:'Mentoring session with intern',   progress:30,  due:'Jan 30',  status:'in_progress' },
];

export default function MyPerformance() {
  const [activeReview, setActiveReview] = useState(REVIEWS[0]);
  const radarData = Object.entries(activeReview.ratings).map(([k,v]) => ({ subject: k.charAt(0).toUpperCase()+k.slice(1), value: v, fullMark: 5 }));

  return (
    <div className="space-y-5">
      <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}}>
        <h1 className="font-display text-2xl font-bold text-white">My Performance</h1>
        <p className="text-slate-400 text-sm mt-0.5">Reviews, ratings and career goals</p>
      </motion.div>

      {/* Period selector */}
      <div className="flex gap-2 flex-wrap">
        {REVIEWS.map(r => (
          <button key={r.period} onClick={()=>setActiveReview(r)}
            className={clsx('px-4 py-2 rounded-xl text-xs font-medium transition-all',
              activeReview.period===r.period ? 'bg-primary-600 text-white' : 'btn-secondary')}>
            {r.period}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Overall rating */}
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.1}} className="glass-card p-5 flex flex-col items-center justify-center gap-3">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{activeReview.period}</p>
          <div className="relative flex-center w-28 h-28">
            <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8"/>
              <circle cx="50" cy="50" r="40" fill="none" stroke="#6366f1" strokeWidth="8"
                strokeDasharray={`${(activeReview.rating/5)*251.2} 251.2`} strokeLinecap="round"/>
            </svg>
            <div className="absolute text-center">
              <p className="text-3xl font-display font-bold text-white">{activeReview.rating}</p>
              <p className="text-[10px] text-slate-500">out of 5</p>
            </div>
          </div>
          <div className="flex gap-0.5">
            {[1,2,3,4,5].map(s => <Star key={s} className={clsx('w-4 h-4', s<=Math.round(activeReview.rating)?'text-warning-400 fill-warning-400':'text-slate-700')}/>)}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-accent-400 bg-accent-500/10 px-3 py-1.5 rounded-full">
            <Award className="w-3.5 h-3.5"/>Top 15% of team
          </div>
        </motion.div>

        {/* Radar */}
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.15}} className="glass-card p-5">
          <h3 className="font-semibold text-white text-sm mb-2">Competency Breakdown</h3>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(255,255,255,0.07)"/>
              <PolarAngleAxis dataKey="subject" tick={{fill:'#64748b',fontSize:10}}/>
              <Radar name="Score" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} strokeWidth={2}/>
            </RadarChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Trend */}
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.2}} className="glass-card p-5">
          <h3 className="font-semibold text-white text-sm mb-4">Rating Trend</h3>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={TREND_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
              <XAxis dataKey="period" tick={{fill:'#64748b',fontSize:9}} axisLine={false} tickLine={false}/>
              <YAxis domain={[3.5,5]} tick={{fill:'#64748b',fontSize:10}} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{background:'#1e293b',border:'1px solid rgba(255,255,255,0.1)',borderRadius:'12px',fontSize:'11px'}}/>
              <Line type="monotone" dataKey="rating" stroke="#6366f1" strokeWidth={2.5} dot={{fill:'#6366f1',r:4}} name="Rating"/>
            </LineChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-1.5 text-xs text-accent-400 mt-2">
            <TrendingUp className="w-3.5 h-3.5"/>+0.5 improvement over 3 quarters
          </div>
        </motion.div>
      </div>

      {/* AI Insights */}
      <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.25}} className="glass-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-primary-600 flex-center"><Bot className="w-4 h-4 text-white"/></div>
          <h3 className="font-semibold text-white text-sm">AI Performance Insights</h3>
          <span className="badge-primary badge text-[10px]">ARIA AI</span>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed mb-3">{activeReview.aiInsights}</p>
        <div className="flex flex-wrap gap-2">
          {activeReview.aiRecs.map((rec,i) => (
            <span key={i} className="text-xs text-primary-300 bg-primary-500/10 border border-primary-500/20 px-3 py-1.5 rounded-full">
              💡 {rec}
            </span>
          ))}
        </div>
      </motion.div>

      {/* Strengths + Areas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.3}} className="glass-card p-5">
          <h3 className="font-semibold text-white text-sm mb-3">Strengths</h3>
          <div className="space-y-2">
            {activeReview.strengths.map((s,i) => (
              <div key={i} className="flex items-center gap-2.5 text-sm text-slate-300">
                <CheckCircle className="w-4 h-4 text-accent-400 flex-shrink-0"/>{s}
              </div>
            ))}
          </div>
        </motion.div>
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.35}} className="glass-card p-5">
          <h3 className="font-semibold text-white text-sm mb-3">Areas for Improvement</h3>
          <div className="space-y-2">
            {activeReview.improvements.map((s,i) => (
              <div key={i} className="flex items-center gap-2.5 text-sm text-slate-300">
                <Target className="w-4 h-4 text-warning-400 flex-shrink-0"/>{s}
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-surface-800 rounded-xl">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Manager Comment</p>
            <p className="text-xs text-slate-300 italic">"{activeReview.managerComment}"</p>
          </div>
        </motion.div>
      </div>

      {/* Goals */}
      <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.4}} className="glass-card p-5">
        <h3 className="font-semibold text-white text-sm mb-4">My Goals</h3>
        <div className="space-y-4">
          {GOALS.map((g,i) => (
            <div key={i}>
              <div className="flex-between mb-1.5">
                <div className="flex items-center gap-2">
                  {g.status==='completed'
                    ? <CheckCircle className="w-4 h-4 text-accent-400 flex-shrink-0"/>
                    : <Target className="w-4 h-4 text-primary-400 flex-shrink-0"/>}
                  <span className="text-sm text-white">{g.title}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-[10px] text-slate-500">Due {g.due}</span>
                  <span className={clsx('text-xs font-bold', g.progress===100?'text-accent-400':'text-primary-400')}>{g.progress}%</span>
                </div>
              </div>
              <div className="h-2 bg-surface-700 rounded-full overflow-hidden">
                <motion.div initial={{width:0}} animate={{width:`${g.progress}%`}} transition={{duration:0.8,delay:0.5+i*0.1}}
                  className="h-full rounded-full"
                  style={{background: g.progress===100?'#10b981': g.progress>60?'#6366f1':'#f59e0b'}}/>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
