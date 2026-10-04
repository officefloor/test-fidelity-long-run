import { Fragment, createElement } from 'react';
import type { ComponentType, ReactElement } from 'react';
import { forSlot } from './registry';

// ── Slots: how features add UI without anything being edited ──────────────────────────────────
// A SLOT is a region of the UI that features fill. Whatever renders a region never lists what goes
// in it, so adding a panel, a table column, a row action, a toolbar control or a nav link is a NEW
// FILE and nothing existing is touched.
//
//   1. declare a region  ->  slots/defs/projectDetail.ts
//        export const ProjectDetail = defineSlot<{ projectId: number }>('project.detail');
//   2. render it         ->  <ProjectDetail.Slot projectId={id} />
//   3. fill it           ->  features/projects/notes.slot.tsx
//        export const contribution = ProjectDetail.fill({ order: 30, Component: ProjectNotes });
//
// This file, slots/registry.ts and slots/discover.ts are the mechanism — do not edit them. ADD a
// file under slots/defs/ to declare a new region.

export type Contribution<Ctx> = {
  /** Lower renders first; equal orders fall back to file path, so the order is always stable. */
  order?: number;
  Component: ComponentType<Ctx>;
};

export type SlotDef<Ctx extends object> = {
  id: string;
  /** Renders the region. Its props ARE the context handed to every contribution. */
  Slot: (ctx: Ctx) => ReactElement;
  /** A feature wraps its contribution in this, to be typed against the region's context. */
  fill: (contribution: Contribution<Ctx>) => Contribution<Ctx> & { slot: string };
};

export function defineSlot<Ctx extends object = Record<string, never>>(id: string): SlotDef<Ctx> {
  return {
    id,
    // A Fragment, never a wrapper element: a slot must be usable inside <thead>/<tr> (columns and
    // row actions are slots too), where a stray <div> would be invalid markup.
    Slot: (ctx: Ctx) =>
      createElement(
        Fragment,
        null,
        forSlot(id).map((c) =>
          createElement(c.Component as ComponentType<Ctx>, { key: c.from, ...ctx }),
        ),
      ),
    fill: (contribution) => ({ slot: id, ...contribution }),
  };
}
