import { Link } from '@tanstack/react-router';
import { AppNav } from '../../slots/defs/appNav';

// WORKED EXAMPLE of the one mechanism every shared region uses. This file is the whole of Home's
// presence in the nav bar; the shell was not touched to put it there. A new page adds its own file
// exactly like this one.
export const contribution = AppNav.fill({
  order: 0,
  Component: () => (
    <Link to="/" data-testid="nav-home">
      Home
    </Link>
  ),
});
