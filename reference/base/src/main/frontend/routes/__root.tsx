import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { AppNav } from '../slots/defs/appNav';

// The whole shell. It renders the nav region and the matched route — it does NOT know what pages
// exist (they contribute to app.nav and appear under routes/), and it holds no state (what is open
// or filtered is in the URL). Nothing about a new feature belongs in this file. Do not edit it.
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Search params are an OPEN namespace, declared once here and inherited by every route: a feature
  // claims a key just by reading/writing it (url/useSearchParam), so adding a filter or a selection
  // is never an edit to a schema.
  validateSearch: (search: Record<string, unknown>) => search,
  component: AppShell,
});

function AppShell() {
  return (
    <div data-testid="app-root">
      <nav data-testid="app-nav">
        <AppNav.Slot />
      </nav>
      <main data-testid="app-home">
        <Outlet />
      </main>
    </div>
  );
}
