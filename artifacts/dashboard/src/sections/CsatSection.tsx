import { useCallback, useEffect, useState } from 'react';
import {
  Award,
  BarChart2,
  CheckCircle2,
  MessageCircle,
  RefreshCw,
  Star,
  ThumbsUp,
} from 'lucide-react';
import type { Brand, CsatAgent } from '../lib/dashboardTypes';

export type CsatSortField =
  | 'avg_csat_score'
  | 'total_assigned'
  | 'closed_today'
  | 'participated_today'
  | 'avg_first_response_minutes';

export function sortCsatAgents(
  data: CsatAgent[],
  sortBy: CsatSortField,
): CsatAgent[] {
  return [...data].sort((a, b) => {
    const av = (a[sortBy] as number | null) ?? -1;
    const bv = (b[sortBy] as number | null) ?? -1;
    return sortBy === 'avg_first_response_minutes' ? av - bv : bv - av;
  });
}

export function getCsatTotals(data: CsatAgent[]) {
  return data.reduce(
    (acc, agent) => ({
      total_assigned: acc.total_assigned + agent.total_assigned,
      closed_count: acc.closed_count + agent.closed_count,
      rated_count: acc.rated_count + agent.rated_count,
      positive_ratings: acc.positive_ratings + agent.positive_ratings,
      closed_today: acc.closed_today + agent.closed_today,
      participated_today: acc.participated_today + agent.participated_today,
    }),
    {
      total_assigned: 0,
      closed_count: 0,
      rated_count: 0,
      positive_ratings: 0,
      closed_today: 0,
      participated_today: 0,
    },
  );
}

function CsatStarRating({ score }: { score: number | null | undefined }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={10}
          className={
            n <= (score ?? 0)
              ? 'text-amber-400 fill-amber-400'
              : 'text-slate-200 fill-slate-200'
          }
        />
      ))}
    </span>
  );
}

export interface CsatApi {
  getCsatReport: (params?: {
    brand_id?: string;
    date_from?: string;
    date_to?: string;
  }) => Promise<CsatAgent[]>;
}

export function CsatSection({
  brands,
  api,
}: {
  brands: Brand[];
  api: CsatApi;
}) {
  const [data, setData] = useState<CsatAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [brandFilter, setBrand] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState<
    | 'avg_csat_score'
    | 'total_assigned'
    | 'closed_today'
    | 'participated_today'
    | 'avg_first_response_minutes'
  >('avg_csat_score');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (brandFilter) params.brand_id = brandFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const result = await api.getCsatReport(params);
      setData(result);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [brandFilter, dateFrom, dateTo]); // eslint-disable-line

  useEffect(() => {
    load();
  }, [load]);

  const sorted = sortCsatAgents(data, sortBy);

  const totals = getCsatTotals(data);

  const overallCsat =
    data.length && data.some((a) => a.avg_csat_score !== null)
      ? (
          data.reduce(
            (s, a) => s + (a.avg_csat_score ?? 0) * a.rated_count,
            0,
          ) / Math.max(1, totals.rated_count)
        ).toFixed(2)
      : null;

  const SortBtn = ({
    field,
    label,
  }: {
    field: typeof sortBy;
    label: string;
  }) => (
    <button
      onClick={() => setSortBy(field)}
      className={`text-[11px] font-medium px-2 py-1 rounded transition-colors ${sortBy === field ? 'bg-sky-100 text-sky-700' : 'text-slate-500 hover:bg-slate-100'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex-1 overflow-auto p-6 bg-slate-50">
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <BarChart2 size={16} className="text-sky-600" /> CSAT & Agent
              Performance
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Customer satisfaction scores and productivity metrics per agent
            </p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <select
            value={brandFilter}
            onChange={(e) => setBrand(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500/30 min-w-[140px]"
          >
            <option value="">All Brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.brand_name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
            placeholder="From"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
            placeholder="To"
          />
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            {
              label: 'Overall CSAT',
              value: overallCsat ? `${overallCsat}/5.0` : '—',
              icon: <Star size={16} className="text-amber-500" />,
              color: 'bg-amber-50 border-amber-200',
            },
            {
              label: 'Total Assigned',
              value: totals.total_assigned,
              icon: <MessageCircle size={16} className="text-sky-500" />,
              color: 'bg-sky-50 border-sky-200',
            },
            {
              label: 'Closed Today',
              value: totals.closed_today,
              icon: <CheckCircle2 size={16} className="text-emerald-500" />,
              color: 'bg-emerald-50 border-emerald-200',
            },
            {
              label: 'Positive Ratings',
              value: totals.rated_count
                ? `${Math.round((totals.positive_ratings / totals.rated_count) * 100)}%`
                : '—',
              icon: <ThumbsUp size={16} className="text-indigo-500" />,
              color: 'bg-indigo-50 border-indigo-200',
            },
          ].map((card) => (
            <div
              key={card.label}
              className={`bg-white border rounded-xl p-4 ${card.color}`}
            >
              <div className="flex items-center gap-2 mb-1">
                {card.icon}
                <span className="text-xs font-medium text-slate-600">
                  {card.label}
                </span>
              </div>
              <p className="text-2xl font-bold text-slate-900">{card.value}</p>
            </div>
          ))}
        </div>

        {/* Sort controls */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <span className="text-xs text-slate-400 mr-1">Sort by:</span>
          <SortBtn field="avg_csat_score" label="CSAT Score" />
          <SortBtn field="total_assigned" label="Assigned" />
          <SortBtn field="closed_today" label="Closed Today" />
          <SortBtn field="participated_today" label="Active Today" />
          <SortBtn field="avg_first_response_minutes" label="Response Time ↑" />
        </div>

        {/* Agent Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
            <RefreshCw size={16} className="animate-spin" /> Loading…
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <BarChart2 size={28} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm text-slate-400">No data yet</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {[
                      'Agent',
                      'CSAT Score',
                      'Rating Distribution',
                      'Assigned',
                      'Closed',
                      'Closed Today',
                      'Active Today',
                      'Avg 1st Reply',
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map((agent, i) => (
                    <tr
                      key={agent.agent_id}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {i < 3 && (
                            <Award
                              size={13}
                              className={
                                i === 0
                                  ? 'text-amber-400'
                                  : i === 1
                                    ? 'text-slate-400'
                                    : 'text-amber-700'
                              }
                            />
                          )}
                          <div className="w-7 h-7 bg-sky-600 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {agent.agent_name[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-slate-800">
                              {agent.agent_name}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {agent.agent_email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {agent.avg_csat_score !== null ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-slate-800">
                              {agent.avg_csat_score}
                            </span>
                            <CsatStarRating
                              score={Math.round(agent.avg_csat_score)}
                            />
                            <span className="text-[10px] text-slate-400">
                              ({agent.rated_count})
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">
                            No ratings
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-0.5 items-center">
                          {[5, 4, 3, 2, 1].map((n) => {
                            const count = agent[
                              `${['five', 'four', 'three', 'two', 'one'][5 - n]}_star` as keyof CsatAgent
                            ] as number;
                            const pct = agent.rated_count
                              ? Math.round((count / agent.rated_count) * 100)
                              : 0;
                            return (
                              <div
                                key={n}
                                className="flex flex-col items-center gap-0.5"
                                title={`${n}★: ${count}`}
                              >
                                <div
                                  className="w-4 bg-slate-100 rounded-full overflow-hidden"
                                  style={{ height: 24 }}
                                >
                                  <div
                                    className={`w-full rounded-full ${n >= 4 ? 'bg-emerald-400' : n === 3 ? 'bg-amber-400' : 'bg-red-400'}`}
                                    style={{
                                      height: `${pct}%`,
                                      marginTop: `${100 - pct}%`,
                                    }}
                                  />
                                </div>
                                <span className="text-[8px] text-slate-400">
                                  {n}★
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-semibold text-slate-700">
                          {agent.total_assigned}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-slate-600">
                          {agent.closed_count}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-semibold ${agent.closed_today > 0 ? 'text-emerald-600' : 'text-slate-400'}`}
                        >
                          {agent.closed_today}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-semibold ${agent.participated_today > 0 ? 'text-sky-600' : 'text-slate-400'}`}
                        >
                          {agent.participated_today}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-slate-600">
                          {agent.avg_first_response_minutes !== null
                            ? `${agent.avg_first_response_minutes}m`
                            : '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
