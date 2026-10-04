import { defineSlot } from '../Slot';

/**
 * The shell's nav bar. Every page contributes its own link — the shell never lists the pages.
 * A nav link carries `data-testid="nav-<section>"` (the test contract; CLAUDE.md).
 */
export const AppNav = defineSlot('app.nav');
