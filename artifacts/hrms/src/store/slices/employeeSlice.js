import { createSlice } from '@reduxjs/toolkit';

const employeeSlice = createSlice({
  name: 'employees',
  initialState: { list: [], selected: null, isLoading: false, error: null, total: 0, page: 1 },
  reducers: {
    setEmployees: (state, action) => { state.list = action.payload.data; state.total = action.payload.total; },
    setSelected: (state, action) => { state.selected = action.payload; },
    setLoading: (state, action) => { state.isLoading = action.payload; },
    setError: (state, action) => { state.error = action.payload; },
    setPage: (state, action) => { state.page = action.payload; },
  },
});
export const { setEmployees, setSelected, setLoading, setError, setPage } = employeeSlice.actions;
export default employeeSlice.reducer;
