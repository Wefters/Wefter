/** Returns a new list with `item` added, keeping at most the last `cap` items. */
export function appendRecord<T>(list: T[], item: T, cap = Infinity): T[] {
  const next = [...list, item];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * Returns a new list in which the newest record whose `key` matches `patch` is merged with it. The
 * original list is returned when nothing matches.
 */
export function mergeRecordById<T, K extends keyof T>(list: T[], key: K, patch: Partial<T> & Pick<T, K>): T[] {
  let idx = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]![key] === patch[key]) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return list;
  const copy = list.slice();
  copy[idx] = { ...copy[idx], ...patch };
  return copy;
}
