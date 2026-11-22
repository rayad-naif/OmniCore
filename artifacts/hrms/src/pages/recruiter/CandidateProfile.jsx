import { motion } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bot, Star, Mail, Phone, Briefcase, Download, CheckCircle, XCircle, Calendar } from 'lucide-react';
import clsx from 'clsx';

const CANDIDATE = {
  id:'APP-001', name:'Arjun Mehta', email:'arjun.mehta@email.com', phone:'+91-98765-43210',
  currentPosition:'Senior Software Engineer', currentCompany:'Infosys', experience:6,
  expectedSalary:120000, noticePeriod:30, location:'Bangalore, India',
  linkedin:'linkedin.com/in/arjunmehta', stage:'technical_interview',
  aiScore:89, aiRec:'strong_yes',
  aiSummary:'Arjun demonstrates excellent alignment with the Senior Full Stack Developer role. Strong proficiency in React and Node.js with relevant project experience at scale. Leadership experience as tech lead is a strong differentiator.',
  aiStrengths:['Expert React + Node.js skills','Microservices architecture experience','Team leadership (5 engineers)','AWS certified','Strong problem-solving track record'],
  aiWeaknesses:['Limited MongoDB experience (PostgreSQL primary)','No remote team management'],
  skillMatch:[{skill:'React',matched:true,score:95},{skill:'Node.js',matched:true,score:90},{skill:'MongoDB',matched:false,score:45},{skill:'AWS',matched:true,score:80},{skill:'TypeScript',matched:true,score:85}],
  interviews:[
    { type:'HR Round',        date:'Dec 10',mode:'Video',interviewer:'Priya Patel',  result:'pass',  rating:4, notes:'Strong communication, culture fit confirmed.'  },
    { type:'Technical Round', date:'Dec 14',mode:'Video',interviewer:'Sarah Chen',  result:'pending',rating:null,notes:''  },
  ],
};

const STAGE_LIST = ['applied','ai_screening','shortlisted','hr_interview','technical_interview','offer_sent','hired'];

export default function CandidateProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const c = CANDIDATE;

  const stageIdx = STAGE_LIST.indexOf(c.stage);

  return (
    <div className="space-y-5">
      <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} className="flex items-center gap-3">
        <button onClick={()=>navigate(-1)} className="btn-ghost p-2"><ArrowLeft className="w-4 h-4"/></button>
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Candidate Profile</h1>
          <p className="text-slate-400 text-sm mt-0.5">Application #{id || 'APP-001'}</p>
        </div>
      </motion.div>

      {/* Pipeline progress */}
      <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.1}} className="glass-card p-5">
        <h3 className="font-semibold text-white text-sm mb-4">Hiring Pipeline</h3>
        <div className="flex items-center gap-1 overflow-x-auto pb-2 no-scrollbar">
          {STAGE_LIST.map((stage,i) => (
            <div key={stage} className="flex items-center flex-shrink-0">
              <div className={clsx('px-3 py-1.5 rounded-full text-[10px] font-medium transition-all',
                i < stageIdx  ? 'bg-accent-500/20 text-accent-400' :
                i === stageIdx? 'bg-primary-600 text-white' :
                               'bg-surface-700 text-slate-500')}>
                {stage.replace(/_/g,' ')}
              </div>
              {i < STAGE_LIST.length-1 && <div className={`h-0.5 w-4 mx-1 ${i<stageIdx?'bg-accent-500':'bg-surface-700'}`}/>}
            </div>
          ))}
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Profile */}
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.15}} className="glass-card p-5">
          <div className="text-center mb-5">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex-center mx-auto mb-3">
              <span className="text-xl font-bold text-white">{c.name.split(' ').map(n=>n[0]).join('')}</span>
            </div>
            <h3 className="font-semibold text-white">{c.name}</h3>
            <p className="text-xs text-slate-400">{c.currentPosition}</p>
            <p className="text-xs text-slate-500">{c.currentCompany}</p>
            <span className={clsx('badge mt-2 text-[10px]',
              c.aiRec==='strong_yes'?'badge-success':c.aiRec==='yes'?'badge-success':c.aiRec==='maybe'?'badge-warning':'badge-danger')}>
              {c.aiRec.replace('_',' ')}
            </span>
          </div>
          <div className="space-y-2.5">
            {[
              { icon:Mail,      value:c.email },
              { icon:Phone,     value:c.phone },
              { icon:Briefcase, value:`${c.experience} years exp` },
              { icon:Calendar,  value:`${c.noticePeriod}d notice` },
            ].map((item,i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-slate-400">
                <item.icon className="w-3.5 h-3.5 text-slate-600 flex-shrink-0"/>
                <span className="truncate">{item.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-accent-500/10 border border-accent-500/20 rounded-xl text-center">
            <p className="text-xs text-slate-400">Expected CTC</p>
            <p className="text-lg font-bold text-accent-400">${(c.expectedSalary/1000).toFixed(0)}k/yr</p>
          </div>
          <div className="flex gap-2 mt-4">
            <button className="btn-primary flex-1 justify-center text-xs"><CheckCircle className="w-3.5 h-3.5"/>Schedule</button>
            <button className="btn-danger flex-1 justify-center text-xs"><XCircle className="w-3.5 h-3.5"/>Reject</button>
          </div>
          <button className="btn-secondary w-full justify-center text-xs mt-2"><Download className="w-3.5 h-3.5"/>Download Resume</button>
        </motion.div>

        {/* Right: AI + Interviews */}
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.2}} className="lg:col-span-2 space-y-4">
          {/* AI Score */}
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-primary-600 flex-center"><Bot className="w-4 h-4 text-white"/></div>
              <h3 className="font-semibold text-white text-sm">AI Screening Report</h3>
              <span className="badge-primary badge text-[9px]">Gemini AI</span>
            </div>
            <div className="flex items-center gap-6 mb-4">
              <div className="text-center">
                <p className="text-4xl font-display font-bold text-primary-400">{c.aiScore}</p>
                <p className="text-[10px] text-slate-500">Match Score</p>
              </div>
              <div className="flex-1">
                <div className="h-3 bg-surface-700 rounded-full overflow-hidden mb-2">
                  <motion.div initial={{width:0}} animate={{width:`${c.aiScore}%`}} transition={{duration:1}}
                    className="h-full rounded-full bg-gradient-to-r from-primary-600 to-accent-500"/>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{c.aiSummary}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Strengths</p>
                {c.aiStrengths.map((s,i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-slate-300 mb-1.5">
                    <CheckCircle className="w-3 h-3 text-accent-400 flex-shrink-0"/>{s}
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Skill Match</p>
                {c.skillMatch.map((sk,i) => (
                  <div key={i} className="flex items-center gap-2 mb-1.5">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${sk.matched?'bg-accent-400':'bg-danger-400'}`}/>
                    <span className="text-xs text-slate-300 flex-1">{sk.skill}</span>
                    <div className="w-20 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{width:`${sk.score}%`,background:sk.matched?'#10b981':'#ef4444'}}/>
                    </div>
                    <span className="text-[10px] text-slate-500 w-8 text-right">{sk.score}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Interview History */}
          <div className="glass-card p-5">
            <h3 className="font-semibold text-white text-sm mb-4">Interview History</h3>
            <div className="space-y-3">
              {c.interviews.map((iv,i) => (
                <div key={i} className="p-3 bg-surface-800/60 rounded-xl border border-white/5">
                  <div className="flex-between mb-1">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-white">{iv.type}</p>
                      <span className={clsx('badge text-[10px]',iv.result==='pass'?'badge-success':iv.result==='fail'?'badge-danger':'badge-warning')}>
                        {iv.result}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500">{iv.date} · {iv.mode}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mb-1">By: {iv.interviewer}</p>
                  {iv.rating && (
                    <div className="flex gap-0.5 mb-1">
                      {[1,2,3,4,5].map(s=><Star key={s} className={clsx('w-3 h-3',s<=iv.rating?'text-warning-400 fill-warning-400':'text-slate-700')}/>)}
                    </div>
                  )}
                  {iv.notes && <p className="text-[10px] text-slate-400 italic">"{iv.notes}"</p>}
                </div>
              ))}
            </div>
            <button className="btn-secondary w-full justify-center text-xs mt-3">
              <Plus className="w-3.5 h-3.5"/>Schedule Next Interview
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function Plus({ className }) { return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>; }
