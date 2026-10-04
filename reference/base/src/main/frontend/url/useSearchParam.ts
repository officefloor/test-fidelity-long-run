import { useNavigate, useSearch } from '@tanstack/react-router';

/**
 * Read and write ONE search-param key.
 *
 * State that outlives a click lives in the URL, not in a parent component — a filter, a sort, a
 * toggle, which row is selected. That is why adding one never edits a page: the control that owns
 * the key is a self-contained file, and whoever reads the key does so directly. Search params are
 * an open namespace (declared once in routes/__root.tsx), so a new key needs no schema change.
 *
 *     const [status, setStatus] = useSearchParam('status', asString);
 */
export function useSearchParam<T>(
  key: string,
  decode: (raw: unknown) => T,
): [T, (value: T | undefined) => void] {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();

  const set = (value: T | undefined) => {
    void navigate({
      to: '.', // stay on the current route; only the search changes
      // Only the one key changes; every other param is left exactly as it was, so two controls
      // never clobber each other.
      search: (prev: Record<string, unknown>) => {
        const next = { ...prev };
        if (value === undefined || value === '') {
          delete next[key];
        } else {
          next[key] = value;
        }
        return next;
      },
      replace: true,
    });
  };

  return [decode(search[key]), set];
}

export const asString = (raw: unknown): string => (typeof raw === 'string' ? raw : '');
export const asNumber = (raw: unknown): number | undefined => {
  const n = Number(raw);
  return raw === undefined || raw === '' || Number.isNaN(n) ? undefined : n;
};
export const asFlag = (raw: unknown): boolean => raw === 'true' || raw === true;
