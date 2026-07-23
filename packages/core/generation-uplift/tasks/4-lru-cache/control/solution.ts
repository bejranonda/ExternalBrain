export class LRUCache<K, V> {
  private readonly maxSize: number;
  private readonly map: Map<K, V>;

  constructor(maxSize: number) {
    if (maxSize <= 0) {
      throw new Error("maxSize must be greater than 0");
    }
    this.maxSize = maxSize;
    this.map = new Map<K, V>();
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    const value = this.map.get(key) as V;
    // Refresh recency by re-inserting the key.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const leastRecentlyUsedKey = this.map.keys().next().value as K;
      this.map.delete(leastRecentlyUsedKey);
    }
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }
}
