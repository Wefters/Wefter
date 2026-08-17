export class RingBuffer<T> {
  private items: T[] = [];

  constructor(private readonly cap: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.cap) this.items.shift();
  }

  toArray(): T[] {
    return this.items.slice();
  }

  clear(): void {
    this.items = [];
  }

  updateLast(pred: (item: T) => boolean, update: (item: T) => T): boolean {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (pred(this.items[i])) {
        this.items[i] = update(this.items[i]);
        return true;
      }
    }
    return false;
  }
}
