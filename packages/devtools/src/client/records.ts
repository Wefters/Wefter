export function appendRecord<T>(list: T[], item: T): T[] {
  return [...list, item];
}

export function mergeRecordById<T, K extends keyof T>(list: T[], key: K, patch: Partial<T> & Pick<T, K>): T[] {
  const idx = list.findIndex((record) => record[key] === patch[key]);
  if (idx === -1) return list;
  const copy = list.slice();
  copy[idx] = { ...copy[idx], ...patch };
  return copy;
}
