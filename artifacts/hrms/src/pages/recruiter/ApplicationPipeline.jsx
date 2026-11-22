import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Star, Mail, Phone, Briefcase, ChevronRight, ChevronDown, TrendingUp, Filter } from 'lucide-react';
import { recruitmentAPI } from '@/services/api';
import clsx from 'clsx';

const STAGES = [
  { id: 'applied',              label: 'Applied',            color: 'border-slate-500'   },
  { id: 'ai_screening',         label: 'AI Screening',       color: 'border-primary-500' },
  { id: 'shortlisted',          label: 'Shortlisted',        color: 'border-accent-500'  },
  { id: 'hr_interview',         label: 'HR Interview',       color: 'border-warning-500' },
  { id: 'technical_interview',  label: 'Technical',          color: 'border-purple-500'  },
  { id: 'offer_sent',           label: 'Offer Sent',         color: 'border-blue-500'    },
  { id: 'hired',                label: 'Hired',              color: 'border-green-500'   },
];

const SCORE_COLOR = (score) => {
  if (score >= 80) return 'text-accent-400 bg-accent-500/10';
  if (score >= 60) return 'text-warning-400 bg-warning-500/10';
  return 'text-danger-400 bg-danger-500/10';
};

const RECOMMEND_BADGE = {
  strong_yes: { label: 'Strong Yes', cls: 'badge-success'  },
  yes:         { label: 'Yes',        cls: 'badge-success'  },
  maybe:       { label: 'Maybe',      cls: 'badge-warning'  },
  no:          { label: 'No',         cls: 'badge-danger'   },
};

// Mock pipeline data
const MOCK_APPS = [
  { _id: '1', stage: 'shortlisted', candidate: { firstName: 'Arjun', lastName: 'Mehta', currentPosition: 'Sr. Developer', totalExperience: 6 }, aiScreening: { score: 89, recommendation: 'strong_yes', summary: 'Excellent match for the role with strong full-stack skills.' } },
  { _id: '2', stage: 'hr_interview', candidate: { firstName: 'Zoe', lastName: 'Laurent', currentPosition: 'Frontend Dev', totalExperience: 4 }, aiScreening: { score: 76, recommendation: 'yes', summary: 'Good React experience, minor gaps in backend knowledge.' } },
  { _id: '3', stage: 'applied', candidate: { firstName: 'Rohan', lastName: 'Gupta', currentPosition: 'Fullstack Dev', totalExperience: 5 }, aiScreening: { score: 82, recommendation: 'yes', summary: 'Solid profile with relevant tech stack.' } },
  { _id: '4', stage: 'technical_interview', candidate: { firstName: 'Mei', lastName: 'Zhang', currentPosition: 'Tech Lead', totalExperience: 8 }, aiScreening: { score: 93, recommendation: 'strong_yes', summary: 'Outstanding candidate with leadership experience.' } },
  { _id: '5', stage: 'offer_sent', candidate: { firstName: 'David', lastName: 'Osei', currentPosition: 'Backend Eng.', totalExperience: 7 }, aiScreening: { score: 88, recommendation: 'strong_yes', summary: 'Top-tier backend expertise, culture fit verified.' } },
  { _id: '6', stage: 'ai_screening', candidate: { firstName: 'Nina', lastName: 'Patel', currentPosition: 'Junior Dev', totalExperience: 2 }, aiScreening: { score: 54, recommendation: 'maybe', summary: 'Some skills matched but lacks required experience.' } },
  { _id: '7', stage: 'hired', candidate: { firstName: 'Carlos', lastName: 'Fuentes', currentPosition: 'DevOps Eng.', totalExperience: 6 }, aiScreening: { score: 91, recommendation: 'strong_yes', summary: 'Perfect match — offer accepted.' } },
];

export default function ApplicationPipeline() {
  const [applications, setApplications] = useState(MOCK_APPS);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [activeDropdownId, setActiveDropdownId] = useState(null);

  useEffect(() => {
    recruitmentAPI.getApplications()
      .then(({ data }) => { if (data.data?.length) setApplications(data.data); })
      .catch(() => {});
  }, []);

  const byStage = (stageId) => applications.filter((a) =>
    a.stage === stageId && (!filter || a.candidate.firstName.toLowerCase().includes(filter.toLowerCase()) ||
      a.candidate.lastName.toLowerCase().includes(filter.toLowerCase()))
  );

  const handleStageChange = async (appId, newStage) => {
    setApplications((prev) => prev.map((a) => a._id === appId ? { ...a, stage: newStage } : a));
    try {
      await recruitmentAPI.updateStage(appId, { stage: newStage });
    } catch {}
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Candidate Pipeline</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            AI-powered screening · {applications.length} total applications
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter candidates..."
              className="input-field pl-9 py-2 text-xs w-48"
            />
          </div>
        </div>
      </motion.div>

      {/* Kanban pipeline */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
        className="flex gap-3 overflow-x-auto pb-4 no-scrollbar"
      >
        {STAGES.map((stage) => {
          const stageApps = byStage(stage.id);
          return (
            <div key={stage.id} className="flex-shrink-0 w-64">
              {/* Column header */}
              <div className={clsx('flex-between px-3 py-2.5 mb-2 rounded-xl border-l-2 bg-surface-800/60', stage.color)}>
                <p className="text-xs font-semibold text-white">{stage.label}</p>
                <span className="w-5 h-5 rounded-full bg-white/10 flex-center text-[10px] text-slate-400 font-medium">
                  {stageApps.length}
                </span>
              </div>

              {/* Cards */}
              <div className="space-y-2">
                {stageApps.map((app) => {
                  const rec = RECOMMEND_BADGE[app.aiScreening?.recommendation];
                  return (
                    <motion.div
                      key={app._id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="glass-card-hover p-3.5 cursor-pointer"
                      onClick={() => setSelected(app)}
                    >
                      {/* Candidate */}
                      <div className="flex items-start gap-2.5 mb-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500/50 to-accent-500/50 flex-center flex-shrink-0">
                          <span className="text-[10px] font-bold text-white">
                            {app.candidate.firstName?.[0]}{app.candidate.lastName?.[0]}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white truncate">
                            {app.candidate.firstName} {app.candidate.lastName}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate">{app.candidate.currentPosition}</p>
                        </div>
                      </div>

                      {/* AI Score */}
                      {app.aiScreening?.score !== undefined && (
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <Bot className="w-3 h-3 text-primary-400" />
                            <span className="text-[10px] text-slate-400">AI Score</span>
                          </div>
                          <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-full', SCORE_COLOR(app.aiScreening.score))}>
                            {app.aiScreening.score}/100
                          </span>
                        </div>
                      )}

                      {/* Score bar */}
                      {app.aiScreening?.score && (
                        <div className="h-1 bg-surface-700 rounded-full mb-2.5 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${app.aiScreening.score}%`,
                              background: app.aiScreening.score >= 80 ? '#10b981' : app.aiScreening.score >= 60 ? '#f59e0b' : '#ef4444',
                            }}
                          />
                        </div>
                      )}

                      {/* Tags */}
                      <div className="flex items-center justify-between">
                        {rec && <span className={clsx('badge text-[10px]', rec.cls)}>{rec.label}</span>}
                        <span className="text-[10px] text-slate-600">{app.candidate.totalExperience}y exp</span>
                      </div>

                      {/* Move controls */}
                      <div className="mt-2.5 flex gap-1 items-center relative" onClick={(e) => e.stopPropagation()}>
                        <div className="relative flex-1">
                          <button
                            onClick={() => setActiveDropdownId(activeDropdownId === app._id ? null : app._id)}
                            className="w-full flex items-center justify-between bg-surface-800/90 border border-white/10 hover:border-white/20 text-slate-200 text-[10px] rounded-lg px-2 py-1.5 transition-all focus:outline-none focus:ring-1 focus:ring-primary-500/50"
                          >
                            <span className="flex items-center gap-1.5 truncate">
                              <span className={clsx("w-1.5 h-1.5 rounded-full", STAGES.find(s => s.id === app.stage)?.color.replace('border-', 'bg-'))} />
                              {STAGES.find(s => s.id === app.stage)?.label}
                            </span>
                            <ChevronDown className="w-2.5 h-2.5 text-slate-400" />
                          </button>
                          
                          <AnimatePresence>
                            {activeDropdownId === app._id && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setActiveDropdownId(null)} />
                                <motion.div
                                  initial={{ opacity: 0, y: 4, scale: 0.95 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: 4, scale: 0.95 }}
                                  transition={{ duration: 0.1 }}
                                  className="absolute left-0 right-0 bottom-full mb-1.5 z-20 bg-surface-900 border border-white/10 rounded-lg shadow-xl overflow-hidden py-1 max-h-40 overflow-y-auto no-scrollbar"
                                >
                                  {STAGES.map((s) => (
                                    <button
                                      key={s.id}
                                      onClick={() => {
                                        handleStageChange(app._id, s.id);
                                        setActiveDropdownId(null);
                                      }}
                                      className={clsx(
                                        "w-full text-left px-2.5 py-1.5 text-[10px] transition-colors flex items-center gap-2",
                                        app.stage === s.id 
                                          ? "bg-primary-600/30 text-primary-400 font-semibold" 
                                          : "text-slate-300 hover:bg-white/5"
                                      )}
                                    >
                                      <span className={clsx("w-1.5 h-1.5 rounded-full", s.color.replace('border-', 'bg-'))} />
                                      {s.label}
                                    </button>
                                  ))}
                                </motion.div>
                              </>
                            )}
                          </AnimatePresence>
                        </div>
                        <button
                          className="btn-ghost p-1.5 flex-shrink-0"
                          onClick={() => setSelected(app)}
                          title="View details"
                        >
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}

                {stageApps.length === 0 && (
                  <div className="border-2 border-dashed border-white/5 rounded-xl p-4 text-center">
                    <p className="text-[10px] text-slate-600">No candidates</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </motion.div>

      {/* Candidate detail drawer */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setSelected(null)}
            />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed right-0 top-0 h-full w-full max-w-md bg-surface-900 border-l border-white/10 z-50 overflow-y-auto"
            >
              <div className="p-6">
                {/* Header */}
                <div className="flex-between mb-6">
                  <h3 className="font-display font-bold text-white">Candidate Profile</h3>
                  <button
                    onClick={() => setSelected(null)}
                    className="btn-ghost p-2 text-slate-400"
                  >✕</button>
                </div>

                {/* Candidate info */}
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex-center">
                    <span className="text-lg font-bold text-white">
                      {selected.candidate.firstName?.[0]}{selected.candidate.lastName?.[0]}
                    </span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-white">{selected.candidate.firstName} {selected.candidate.lastName}</h4>
                    <p className="text-sm text-slate-400">{selected.candidate.currentPosition}</p>
                    <p className="text-xs text-slate-500">{selected.candidate.totalExperience} years experience</p>
                  </div>
                </div>

                {/* AI Screening Results */}
                {selected.aiScreening && (
                  <div className="glass-card p-4 mb-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Bot className="w-4 h-4 text-primary-400" />
                      <h5 className="text-sm font-semibold text-white">AI Screening Report</h5>
                    </div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-slate-400">Match Score</span>
                      <span className={clsx('font-bold text-lg px-3 py-1 rounded-xl', SCORE_COLOR(selected.aiScreening.score))}>
                        {selected.aiScreening.score}/100
                      </span>
                    </div>
                    <div className="h-2 bg-surface-700 rounded-full mb-4 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${selected.aiScreening.score}%` }}
                        transition={{ duration: 0.8 }}
                        className="h-full rounded-full"
                        style={{ background: selected.aiScreening.score >= 80 ? '#10b981' : selected.aiScreening.score >= 60 ? '#f59e0b' : '#ef4444' }}
                      />
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed mb-3">{selected.aiScreening.summary}</p>
                    {selected.aiScreening.recommendation && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">Recommendation:</span>
                        <span className={clsx('badge', RECOMMEND_BADGE[selected.aiScreening.recommendation]?.cls)}>
                          {RECOMMEND_BADGE[selected.aiScreening.recommendation]?.label}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-primary text-xs justify-center">Schedule Interview</button>
                  <button className="btn-secondary text-xs justify-center">Send Offer</button>
                  <button className="btn-secondary text-xs justify-center">
                    <Mail className="w-3.5 h-3.5" /> Email
                  </button>
                  <button className="btn-danger text-xs justify-center">Reject</button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
