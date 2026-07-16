export type ReplayStatus = "ready" | "playing" | "paused" | "ended";

export interface ReplaySnapshot {
  readonly offsetUs: number;
  readonly durationUs: number;
  readonly rate: number;
  readonly status: ReplayStatus;
  readonly progress: number;
}

export type ReplayListener = () => void;

export interface ReplayClockOptions {
  durationUs: number;
  initialOffsetUs?: number;
  initialRate?: number;
  now?: () => number;
  scheduleFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

const defaultNow = (): number => {
  if (typeof performance !== "undefined") {
    return performance.now();
  }

  return Date.now();
};

const defaultScheduleFrame = (callback: FrameRequestCallback): number => {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(callback);
  }

  return globalThis.setTimeout(
    () => callback(defaultNow()),
    16,
  ) as unknown as number;
};

const defaultCancelFrame = (handle: number): void => {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(handle);
    return;
  }

  globalThis.clearTimeout(handle);
};

const assertDuration = (durationUs: number): void => {
  if (!Number.isSafeInteger(durationUs) || durationUs < 0) {
    throw new RangeError("Replay duration must be a non-negative safe integer in microseconds.");
  }
};

const assertRate = (rate: number): void => {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError("Replay rate must be a finite number greater than zero.");
  }
};

const normalizeOffset = (offsetUs: number, durationUs: number): number => {
  if (!Number.isFinite(offsetUs)) {
    throw new RangeError("Replay offset must be finite.");
  }

  return Math.min(durationUs, Math.max(0, Math.trunc(offsetUs)));
};

const statusForOffset = (offsetUs: number, durationUs: number): ReplayStatus => {
  if (offsetUs >= durationUs) {
    return "ended";
  }

  return offsetUs === 0 ? "ready" : "paused";
};

const makeSnapshot = (
  offsetUs: number,
  durationUs: number,
  rate: number,
  status: ReplayStatus,
): ReplaySnapshot =>
  Object.freeze({
    offsetUs,
    durationUs,
    rate,
    status,
    progress: durationUs === 0 ? 1 : offsetUs / durationUs,
  });

/**
 * A deterministic, monotonic replay clock.
 *
 * Time is stored as integer microsecond offsets. Browser animation frames only
 * schedule updates; elapsed replay time is always derived from the injected
 * monotonic `now` source, which keeps rate changes and background-tab recovery
 * free of cumulative frame drift.
 */
export class ReplayClock {
  private readonly now: () => number;
  private readonly scheduleFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly listeners = new Set<ReplayListener>();

  private snapshot: ReplaySnapshot;
  private anchorOffsetUs: number;
  private anchorNowMs: number;
  private lastNowMs: number;
  private frameHandle: number | null = null;

  public constructor(options: ReplayClockOptions) {
    assertDuration(options.durationUs);

    const rate = options.initialRate ?? 1;
    assertRate(rate);

    const offsetUs = normalizeOffset(options.initialOffsetUs ?? 0, options.durationUs);
    this.now = options.now ?? defaultNow;
    this.scheduleFrame = options.scheduleFrame ?? defaultScheduleFrame;
    this.cancelFrame = options.cancelFrame ?? defaultCancelFrame;

    const initialNowMs = this.readRawNow();
    this.lastNowMs = initialNowMs;
    this.anchorNowMs = initialNowMs;
    this.anchorOffsetUs = offsetUs;
    this.snapshot = makeSnapshot(
      offsetUs,
      options.durationUs,
      rate,
      statusForOffset(offsetUs, options.durationUs),
    );
  }

  public readonly getSnapshot = (): ReplaySnapshot => this.snapshot;

  public readonly getServerSnapshot = (): ReplaySnapshot => this.snapshot;

  public readonly subscribe = (listener: ReplayListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public readonly play = (): void => {
    if (this.snapshot.status === "playing" || this.snapshot.durationUs === 0) {
      return;
    }

    const nowMs = this.readNow();
    const offsetUs = this.snapshot.status === "ended" ? 0 : this.snapshot.offsetUs;
    this.anchorOffsetUs = offsetUs;
    this.anchorNowMs = nowMs;
    this.commit(offsetUs, this.snapshot.rate, "playing");
    this.ensureScheduledFrame();
  };

  public readonly pause = (): void => {
    if (this.snapshot.status !== "playing") {
      return;
    }

    this.cancelScheduledFrame();
    this.syncPlayingPosition(this.readNow(), "paused");
  };

  public readonly seek = (offsetUs: number): void => {
    const nextOffsetUs = normalizeOffset(offsetUs, this.snapshot.durationUs);
    const wasPlaying = this.snapshot.status === "playing";
    const nowMs = this.readNow();
    const status =
      nextOffsetUs >= this.snapshot.durationUs
        ? "ended"
        : wasPlaying
          ? "playing"
          : nextOffsetUs === 0 && this.snapshot.status === "ready"
            ? "ready"
            : "paused";

    this.anchorOffsetUs = nextOffsetUs;
    this.anchorNowMs = nowMs;
    this.commit(nextOffsetUs, this.snapshot.rate, status);

    if (status === "playing") {
      this.ensureScheduledFrame();
    } else {
      this.cancelScheduledFrame();
    }
  };

  public readonly setRate = (rate: number): void => {
    assertRate(rate);
    if (rate === this.snapshot.rate) {
      return;
    }

    const nowMs = this.readNow();
    let offsetUs = this.snapshot.offsetUs;
    let status = this.snapshot.status;

    if (status === "playing") {
      offsetUs = this.offsetAt(nowMs);
      if (offsetUs >= this.snapshot.durationUs) {
        status = "ended";
      }
    }

    this.anchorOffsetUs = offsetUs;
    this.anchorNowMs = nowMs;
    this.commit(offsetUs, rate, status);

    if (status === "ended") {
      this.cancelScheduledFrame();
    }
  };

  public readonly reset = (): void => {
    this.cancelScheduledFrame();
    const nowMs = this.readNow();
    this.anchorOffsetUs = 0;
    this.anchorNowMs = nowMs;
    this.commit(
      0,
      this.snapshot.rate,
      this.snapshot.durationUs === 0 ? "ended" : "ready",
    );
  };

  /** Cancels work and detaches listeners. The instance can still be reused. */
  public readonly destroy = (): void => {
    this.cancelScheduledFrame();
    if (this.snapshot.status === "playing") {
      this.syncPlayingPosition(this.readNow(), "paused");
    }
    this.listeners.clear();
  };

  private readonly onAnimationFrame = (): void => {
    this.frameHandle = null;
    if (this.snapshot.status !== "playing") {
      return;
    }

    this.syncPlayingPosition(this.readNow());
    if (this.snapshot.status === "playing") {
      this.ensureScheduledFrame();
    }
  };

  private readRawNow(): number {
    const value = this.now();
    if (!Number.isFinite(value)) {
      throw new RangeError("Replay time source must return a finite millisecond value.");
    }
    return value;
  }

  private readNow(): number {
    const value = this.readRawNow();
    this.lastNowMs = Math.max(this.lastNowMs, value);
    return this.lastNowMs;
  }

  private offsetAt(nowMs: number): number {
    const elapsedMs = Math.max(0, nowMs - this.anchorNowMs);
    const elapsedUs = Math.floor(elapsedMs * 1_000 * this.snapshot.rate);
    return Math.min(this.snapshot.durationUs, this.anchorOffsetUs + elapsedUs);
  }

  private syncPlayingPosition(nowMs: number, requestedStatus?: ReplayStatus): void {
    const offsetUs = this.offsetAt(nowMs);
    const status =
      offsetUs >= this.snapshot.durationUs ? "ended" : (requestedStatus ?? "playing");

    if (status !== "playing") {
      this.anchorOffsetUs = offsetUs;
      this.anchorNowMs = nowMs;
    }

    this.commit(offsetUs, this.snapshot.rate, status);
  }

  private ensureScheduledFrame(): void {
    if (this.frameHandle !== null || this.snapshot.status !== "playing") {
      return;
    }

    this.frameHandle = this.scheduleFrame(this.onAnimationFrame);
  }

  private cancelScheduledFrame(): void {
    if (this.frameHandle === null) {
      return;
    }

    this.cancelFrame(this.frameHandle);
    this.frameHandle = null;
  }

  private commit(offsetUs: number, rate: number, status: ReplayStatus): void {
    const current = this.snapshot;
    if (
      current.offsetUs === offsetUs &&
      current.rate === rate &&
      current.status === status
    ) {
      return;
    }

    this.snapshot = makeSnapshot(offsetUs, current.durationUs, rate, status);
    for (const listener of this.listeners) {
      listener();
    }
  }
}
