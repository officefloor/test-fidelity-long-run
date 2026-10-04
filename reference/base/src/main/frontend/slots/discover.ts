import { register } from './registry';
import type { Registered } from './registry';

// Discovery: every `features/**/*.slot.tsx` in the app is found here and registered, so no list of
// features exists anywhere. A file exports `contribution`, or `contributions` for more than one.
// Imported once, for its side effect, by main.tsx. Do not edit.
const modules = import.meta.glob('../features/**/*.slot.tsx', { eager: true }) as Record<
  string,
  { contribution?: Omit<Registered, 'from' | 'order'> & { order?: number }; contributions?: Array<Omit<Registered, 'from' | 'order'> & { order?: number }> }
>;

for (const [from, mod] of Object.entries(modules)) {
  const declared = mod.contributions ?? (mod.contribution ? [mod.contribution] : []);
  for (const c of declared) {
    register({ ...c, from, order: c.order ?? 0 });
  }
}
