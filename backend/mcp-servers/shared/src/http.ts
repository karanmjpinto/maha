// Throttled HTTP client with a polite User-Agent and a basic per-host rate limit.
// Each MCP server creates one HttpClient and reuses it for every fetch so the
// request queue stays serialised against the upstream portal.

const DEFAULT_USER_AGENT =
    "MahaQatarLegalMCP/0.1 (+https://github.com/karanmjpinto/maha) public records mirror, contact via github issues";

type HttpClientOptions = {
    minIntervalMs?: number;
    userAgent?: string;
    timeoutMs?: number;
};

export class HttpClient {
    private lastRequestAt = 0;
    private readonly minIntervalMs: number;
    private readonly userAgent: string;
    private readonly timeoutMs: number;

    constructor(opts: HttpClientOptions = {}) {
        this.minIntervalMs = opts.minIntervalMs ?? 1500;
        this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
        this.timeoutMs = opts.timeoutMs ?? 20_000;
    }

    private async throttle(): Promise<void> {
        const now = Date.now();
        const wait = this.minIntervalMs - (now - this.lastRequestAt);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.lastRequestAt = Date.now();
    }

    async get(
        url: string,
        init: RequestInit = {},
    ): Promise<{ status: number; text: string; finalUrl: string }> {
        await this.throttle();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        try {
            const res = await fetch(url, {
                ...init,
                signal: ctrl.signal,
                headers: {
                    "User-Agent": this.userAgent,
                    "Accept-Language": "en,ar;q=0.9",
                    Accept: "text/html,application/xhtml+xml",
                    ...(init.headers ?? {}),
                },
                redirect: "follow",
            });
            const text = await res.text();
            return { status: res.status, text, finalUrl: res.url };
        } finally {
            clearTimeout(timer);
        }
    }
}
