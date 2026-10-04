import { createFileRoute } from '@tanstack/react-router';

// The base home page: nothing here until a feature adds itself. A page is ONE new file under
// routes/ — `createFileRoute('<its url>')` — plus its nav link under features/.
export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return <p data-testid="home-empty">Nothing here yet.</p>;
}
