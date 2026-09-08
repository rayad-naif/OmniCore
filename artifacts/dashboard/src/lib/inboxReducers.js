export function ticketsReducer(state, action) {
  switch (action.type) {
    case 'SET':
      return action.payload;
    case 'PATCH':
      return state.map((ticket) =>
        ticket.id === action.id ? { ...ticket, ...action.patch } : ticket,
      );
    case 'PREPEND':
      return [
        action.payload,
        ...state.filter((ticket) => ticket.id !== action.payload.id),
      ];
    default:
      return state;
  }
}

export function messagesReducer(state, action) {
  switch (action.type) {
    case 'SET':
      return action.payload;
    case 'PUSH':
      if (
        action.payload.id &&
        state.some((message) => message.id === action.payload.id)
      )
        return state;
      return [...state, action.payload];
    case 'CLEAR':
      return [];
    default:
      return state;
  }
}
