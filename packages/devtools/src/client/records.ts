/** Returns a new list with `item` appended, dropping the oldest entries beyond `cap`. */
export function appendRecord<T>(list: T[], item: T, cap = Infinity): T[] {
  const next = [...list, item];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

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
