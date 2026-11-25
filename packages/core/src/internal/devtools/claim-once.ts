/**
 * Page-wide "first one wins" guard. A bundle can contain several copies of @wefterjs/core (e.g.
 * one per plugin); each copy's module-level flags are separate, so without this every copy would
 * patch console/fetch again and every log or request would reach devtools once per copy.
 */
export function claimOnce(name: string): boolean {
  const key = Symbol.for(`wefter.devtools.installed.${name}`);
  const holder = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (holder[key]) return false;
  holder[key] = true;
  return true;
}
