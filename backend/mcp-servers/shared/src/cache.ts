// Tiny in-memory LRU. Each MCP server is meant to be small and stateless, so a
// 200-entry process-local cache is enough to absorb repeated reads of the same
// case or law in a single chat session. Restart the process to flush.

type Entry<V> = { value: V; expiresAt: number };

export class MemoryCache<V> {
    private readonly map = new Map<string, Entry<V>>();
    constructor(
        private readonly maxEntries = 200,
        private readonly ttlMs = 15 * 60 * 1000,
    ) {}

    get(key: string): V | undefined {
        const entry = this.map.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt < Date.now()) {
            this.map.delete(key);
            return undefined;
        }
        // LRU bump
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }

    set(key: string, value: V): void {
        if (this.map.size >= this.maxEntries) {
            const firstKey = this.map.keys().next().value;
            if (firstKey !== undefined) this.map.delete(firstKey);
        }
        this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    }
}
