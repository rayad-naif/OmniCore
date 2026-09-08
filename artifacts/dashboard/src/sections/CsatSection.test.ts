import { describe, expect, it } from 'vitest';
import type { CsatAgent } from '../lib/dashboardTypes';
import { getCsatTotals, sortCsatAgents } from './CsatSection';

const agent = (
  id: string,
  score: number | null,
  responseTime: number | null,
): CsatAgent => ({
  agent_id: id,
  agent_name: id,
  agent_email: id + '@example.com',
  total_assigned: id === 'a' ? 4 : 2,
  closed_count: 1,
  avg_csat_score: score,
  positive_ratings: 1,
  five_star: 1,
  four_star: 0,
  three_star: 0,
  two_star: 0,
  one_star: 0,
  rated_count: score === null ? 0 : 1,
  avg_first_response_minutes: responseTime,
  closed_today: 1,
  participated_today: 2,
});

describe('CSAT helpers', () => {
  it('sorts response times ascending and scores descending', () => {
    const agents = [agent('a', 4, 10), agent('b', 5, 4)];
    expect(
      sortCsatAgents(agents, 'avg_first_response_minutes').map(
        (a) => a.agent_id,
      ),
    ).toEqual(['b', 'a']);
    expect(
      sortCsatAgents(agents, 'avg_csat_score').map((a) => a.agent_id),
    ).toEqual(['b', 'a']);
  });

  it('aggregates summary metrics', () => {
    expect(getCsatTotals([agent('a', 4, 10), agent('b', null, null)])).toEqual({
      total_assigned: 6,
      closed_count: 2,
      rated_count: 1,
      positive_ratings: 2,
      closed_today: 2,
      participated_today: 4,
    });
  });
});
