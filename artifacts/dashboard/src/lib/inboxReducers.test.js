import { describe, expect, it } from 'vitest';
import { messagesReducer, ticketsReducer } from './inboxReducers';

describe('ticketsReducer', () => {
  it('patches the matching ticket without mutating other tickets', () => {
    const state = [
      { id: 'a', status: 'open' },
      { id: 'b', status: 'pending' },
    ];

    expect(
      ticketsReducer(state, {
        type: 'PATCH',
        id: 'b',
        patch: { status: 'closed' },
      }),
    ).toEqual([
      { id: 'a', status: 'open' },
      { id: 'b', status: 'closed' },
    ]);
  });

  it('prepends a ticket and replaces an existing version of it', () => {
    const state = [{ id: 'a' }, { id: 'b', stale: true }];

    expect(
      ticketsReducer(state, {
        type: 'PREPEND',
        payload: { id: 'b', stale: false },
      }),
    ).toEqual([{ id: 'b', stale: false }, { id: 'a' }]);
  });
});

describe('messagesReducer', () => {
  it('deduplicates identified socket echoes but keeps id-less messages', () => {
    const state = [{ id: 'message-1', body: 'Existing' }];

    expect(
      messagesReducer(state, {
        type: 'PUSH',
        payload: { id: 'message-1', body: 'Echo' },
      }),
    ).toBe(state);
    expect(
      messagesReducer(state, {
        type: 'PUSH',
        payload: { body: 'Optimistic message' },
      }),
    ).toEqual([...state, { body: 'Optimistic message' }]);
  });

  it('sets and clears the complete message state', () => {
    expect(
      messagesReducer([{ id: 'old' }], {
        type: 'SET',
        payload: [{ id: 'new' }],
      }),
    ).toEqual([{ id: 'new' }]);
    expect(messagesReducer([{ id: 'old' }], { type: 'CLEAR' })).toEqual([]);
  });
});
