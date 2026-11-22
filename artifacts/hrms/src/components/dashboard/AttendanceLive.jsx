import { useState, useEffect } from 'react';
import { Clock, Wifi } from 'lucide-react';
import clsx from 'clsx';

const MOCK_LIVE = [
  { name: 'Emma Wilson',   dept: 'Engineering', time: '09:02 AM', status: 'checked_in',  wfh: false },
  { name: 'Jake Torres',   dept: 'Marketing',   time: '09:08 AM', status: 'checked_in',  wfh: true  },
  { name: 'Nora Kim',      dept: 'Finance',     time: '09:15 AM', status: 'checked_in',  wfh: false },
  { name: 'Dev Patel',     dept: 'Engineering', time: '09:22 AM', status: 'checked_in',  wfh: true  },
  { name: 'Chloe Martin',  dept: 'HR',          time: '09:45 AM', status: 'late',        wfh: false },
  { name: 'Raj Mehta',     dept: 'Sales',       time: '10:01 AM', status: 'late',        wfh: false },
  { name: 'Alex Nguyen',   dept: 'Product',     time: '—',        status: 'absent',      wfh: false },
  { name: 'Leila Hassan',  dept: 'Design',      time: '09:00 AM', status: 'checked_in',  wfh: true  },
];

const STATUS_MAP = {
  checked_in: { label: 'Present', cls: 'badge-success' },
  late:        { label: 'Late',    cls: 'badge-warning' },
  absent:      { label: 'Absent',  cls: 'badge-danger'  },
};

export default function AttendanceLive() {
  const [pulse, setPulse] = useState(true);
  const [records, setRecords] = useState(MOCK_LIVE);

  // Simulate real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setPulse((p) => !p);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const counts = {
    present: records.filter((r) => r.status === 'checked_in').length,
    late:    records.filter((r) => r.status === 'late').length,
    absent:  records.filter((r) => r.status === 'absent').length,
    wfh:     records.filter((r) => r.wfh).length,
  };

  return (
    <div className="glass-card p-5">
      <div className="flex-between mb-5">
        <div className="flex items-center gap-2.5">
          <h3 className="font-semibold text-slate-900 dark:text-white text-sm">Live Attendance</h3>
          <span className="flex items-center gap-1.5 text-[10px] text-accent-400 bg-accent-500/10 border border-accent-500/20 px-2 py-0.5 rounded-full">
            <span className={clsx('w-1.5 h-1.5 rounded-full bg-accent-400', pulse ? 'opacity-100' : 'opacity-30')} />
            LIVE
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-accent-400">{counts.present} Present</span>
          <span className="text-warning-400">{counts.late} Late</span>
          <span className="text-danger-400">{counts.absent} Absent</span>
          <span className="text-primary-400 hidden sm:inline">{counts.wfh} WFH</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th>Check-in</th>
              <th>Mode</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r, i) => {
              const s = STATUS_MAP[r.status];
              return (
                <tr key={i}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500/40 to-accent-500/40 flex-center flex-shrink-0">
                        <span className="text-[10px] font-semibold text-slate-900 dark:text-white">
                          {r.name.split(' ').map((n) => n[0]).join('')}
                        </span>
                      </div>
                      <span className="font-medium text-slate-900 dark:text-white text-xs">{r.name}</span>
                    </div>
                  </td>
                  <td className="text-slate-400">{r.dept}</td>
                  <td>
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <Clock className="w-3 h-3 text-slate-500" />
                      {r.time}
                    </div>
                  </td>
                  <td>
                    {r.wfh ? (
                      <span className="flex items-center gap-1 text-[10px] text-primary-400">
                        <Wifi className="w-3 h-3" /> WFH
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-500">Office</span>
                    )}
                  </td>
                  <td>
                    <span className={clsx('badge', s.cls)}>{s.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
