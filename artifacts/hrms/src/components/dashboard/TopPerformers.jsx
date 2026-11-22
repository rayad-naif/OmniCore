import { useEffect, useState } from 'react';
import { Star, TrendingUp, Loader2 } from 'lucide-react';
import { activityLogAPI } from '@/services/api';

const COLORS = ['from-yellow-400 to-orange-400', 'from-slate-300 to-slate-400', 'from-orange-600 to-amber-600'];
const LOG_LINE = /^\[(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}:\d{2})\]\s*\|\s*(?:Process:\s*[^|]+\|\s*)?(?:Window:\s*)?(.+?)(?:\s*\|\s*Duration:\s*([^|]+?))?(?:\s*\||$)/i;

function parseDuration(value) {
  const match = String(value || '').trim().match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/i);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function isWorkActivity(title) {
  const text = String(title || '').toLowerCase();
  return [
    'code', 'visual studio', 'terminal', 'powershell', 'cmd.exe', 'slack',
    'hubspot', 'salesforce', 'pipedrive', 'zoho', 'gohighlevel', 'crm',
    'gmail', 'mail.google.com', 'glitchgone', 'voxility', 'localhost',
  ].some((keyword) => text.includes(keyword));
}

function getEmployeeProfile(record) {
  const employee = record?.employee || {};
  const user = employee.user || employee;
  const name = user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.name || 'Unknown employee';
  return {
    id: employee._id || employee.id || record._id,
    name,
    role: employee.position || user.position || 'Employee',
    dept: user.department?.name || employee.department?.name || 'Unassigned',
  };
}

async function getEmployeeText(employeeId) {
  const { data } = await activityLogAPI.getHistory(employeeId);
  const records = data.data || [];
  const texts = await Promise.all(records.map(async (record) => {
    if (record.filteredText != null) return record.filteredText;
    if (!record.stationId) return '';
    try {
      const { data: stationResponse } = await activityLogAPI.getStationByShift(record.stationId, record.month);
      const attributed = stationResponse.data?.byEmployee?.[employeeId];
      return attributed ? [...(attributed.confirmed || []), ...(attributed.scheduleInferred || [])].join('\n') : '';
    } catch {
      return '';
    }
  }));
  return texts.filter(Boolean).join('\n');
}

function summarizeActivity(text) {
  const start = new Date();
  start.setDate(start.getDate() - 29);
  const startDate = start.toISOString().slice(0, 10);
  const days = new Set();
  let workSeconds = 0;
  let totalSeconds = 0;

  text.split('\n').forEach((line) => {
    const match = line.trim().match(LOG_LINE);
    if (!match) return;
    const [, date, , title, duration] = match;
    if (date < startDate) return;
    const seconds = parseDuration(duration);
    if (!seconds) return;
    totalSeconds += seconds;
    if (isWorkActivity(title)) workSeconds += seconds;
    days.add(date);
  });

  return { workSeconds, totalSeconds, activeDays: days.size };
}

function formatHours(seconds) {
  const hours = seconds / 3600;
  return hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
}

export default function TopPerformers() {
  const [performers, setPerformers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    activityLogAPI.getAll()
      .then(async ({ data }) => {
        const uniqueEmployees = new Map();
        (data.data || []).forEach((record) => {
          const profile = getEmployeeProfile(record);
          if (profile.id) uniqueEmployees.set(String(profile.id), profile);
        });

        const summaries = await Promise.all([...uniqueEmployees.values()].map(async (profile) => {
          try {
            return { ...profile, ...summarizeActivity(await getEmployeeText(profile.id)) };
          } catch {
            return null;
          }
        }));

        const eligible = summaries.filter((item) => item?.workSeconds > 0 && item.totalSeconds > 0);
        const mostWorkSeconds = Math.max(...eligible.map((item) => item.workSeconds), 1);
        const ranked = eligible
          .map((item) => {
            const focus = item.workSeconds / item.totalSeconds;
            const activityDays = Math.min(item.activeDays / 22, 1);
            const score = Math.round((item.workSeconds / mostWorkSeconds) * 50 + focus * 30 + activityDays * 20);
            return { ...item, focus, score };
          })
          .sort((a, b) => b.score - a.score || b.workSeconds - a.workSeconds)
          .slice(0, 5);
        if (active) setPerformers(ranked);
      })
      .catch(() => { if (active) setPerformers([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <>
      <div className="flex-between mb-4">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white text-sm">Top Performers</h3>
          <p className="text-[10px] text-slate-500 mt-0.5">Activity insights · last 30 days</p>
        </div>
        <TrendingUp className="w-4 h-4 text-warning-400" />
      </div>
      <div className="space-y-3">
        {loading ? (
          <div className="h-[180px] flex items-center justify-center text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading activity insights…</div>
        ) : performers.length > 0 ? performers.map((performer, index) => (
          <div key={performer.id} className="flex items-center gap-3">
            <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${COLORS[index] || 'from-primary-500 to-accent-500'} flex-center flex-shrink-0`}>
              <span className="text-[10px] font-bold text-white">{index + 1}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{performer.name}</p>
              <p className="text-[10px] text-slate-500 truncate">{formatHours(performer.workSeconds)} work · {Math.round(performer.focus * 100)}% focus · {performer.activeDays} active days</p>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="flex items-center gap-0.5 justify-end">
                <Star className="w-3 h-3 text-warning-400 fill-warning-400" />
                <span className="text-xs font-semibold text-slate-900 dark:text-white">{performer.score}</span>
              </div>
              <span className="text-[10px] text-slate-500">Activity score</span>
            </div>
          </div>
        )) : (
          <div className="h-[180px] flex items-center justify-center text-slate-500 text-sm text-center px-4">No attributed work activity is available for the last 30 days.</div>
        )}
      </div>
    </>
  );
}
