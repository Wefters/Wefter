/**
 * Returns `true` the first time it is called with `name` in this JavaScript realm and `false` after that.
 *
 * The flag lives on `globalThis` under a registered symbol, so it survives hot module reloads and
 * duplicate copies of this package. It keeps each DevTools patch from being installed twice.
 */
export function claimOnce(name: string): boolean {
  const key = Symbol.for(`wefter.devtools.installed.${name}`);
  const holder = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (holder[key]) return false;
  holder[key] = true;
  return true;
}
