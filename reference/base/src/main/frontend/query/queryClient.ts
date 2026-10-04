import { QueryClient } from '@tanstack/react-query';

// Server data is NEVER copied into component state. A feature reads it with useQuery under its own
// key (e.g. ['clients'] / ['project', id, 'notes']) and changes it with useMutation +
// invalidateQueries. Two features share data by sharing a KEY, never by a parent holding it.
// retry:false + no focus refetching keep the e2e runs deterministic.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
