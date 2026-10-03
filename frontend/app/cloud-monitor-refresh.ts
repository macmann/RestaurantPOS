export interface RefreshScheduler {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

const browserScheduler: RefreshScheduler = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (id) => window.clearTimeout(id),
};

/** One polling loop for the active route. It never overlaps requests and resumes
 * with an immediate snapshot when a hidden browser tab becomes visible. */
export class CloudMonitorRefreshController {
  private timer: number | undefined;
  private running = false;
  private stopped = true;
  private readonly visibilityHandler = () => {
    if (this.isVisible()) void this.run();
    else this.clearTimer();
  };

  constructor(
    private readonly refresh: () => Promise<void>,
    private readonly intervalMs = 60_000,
    private readonly enabled = true,
    private readonly scheduler: RefreshScheduler = browserScheduler,
    private readonly isVisible: () => boolean = () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  ) {}

  start(): void {
    if (!this.enabled || !this.stopped) return;
    this.stopped = false;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.visibilityHandler);
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibilityHandler);
  }

  async run(): Promise<void> {
    if (this.stopped || this.running || !this.isVisible()) return;
    this.clearTimer();
    this.running = true;
    try { await this.refresh(); }
    finally { this.running = false; this.schedule(); }
  }

  private schedule(): void {
    if (this.stopped || this.running || !this.isVisible()) return;
    this.clearTimer();
    this.timer = this.scheduler.setTimeout(() => void this.run(), Math.max(1_000, this.intervalMs));
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
