import type { ComponentType } from 'react';

// The contribution store. It imports NOTHING — that is deliberate: discovery (slots/discover.ts)
// pulls in every feature's contribution file, and those files reach a slot definition, which
// reaches defineSlot, which reaches this file. Keeping the arrows one-way (discover -> features ->
// defs -> Slot -> registry) is what stops the module graph forming a cycle.

export type Registered = {
  slot: string;
  order: number;
  /** Source file — the React key and the deterministic tie-break for equal `order`. */
  from: string;
  Component: ComponentType<never>;
};

const contributions: Registered[] = [];

/** Called once per contribution at startup, by slots/discover.ts. */
export function register(entry: Registered): void {
  contributions.push(entry);
}

export function forSlot(id: string): Registered[] {
  return contributions
    .filter((c) => c.slot === id)
    .sort((a, b) => a.order - b.order || a.from.localeCompare(b.from));
}
