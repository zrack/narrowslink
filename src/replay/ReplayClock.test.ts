import { describe, expect, it, vi } from "vitest";

import { ReplayClock } from "./ReplayClock";

class ManualAnimationFrames {
  public nowMs = 0;

  private nextHandle = 1;
  private readonly callbacks = new Map<number, FrameRequestCallback>();

  public readonly now = (): number => this.nowMs;

  public readonly schedule = (callback: FrameRequestCallback): number => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  };

  public readonly cancel = (handle: number): void => {
    this.callbacks.delete(handle);
  };

  public advanceTo(nowMs: number): void {
    this.nowMs = nowMs;
    const next = this.callbacks.entries().next();
    if (next.done) {
      return;
    }

    const [handle, callback] = next.value;
    this.callbacks.delete(handle);
    callback(nowMs);
  }

  public get pendingCount(): number {
    return this.callbacks.size;
  }
}

const makeClock = (
  frames: ManualAnimationFrames,
  durationUs = 1_000_000,
): ReplayClock =>
  new ReplayClock({
    durationUs,
    now: frames.now,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
  });

describe("ReplayClock", () => {
  it("advances from its monotonic time source without accumulating frame drift", () => {
    const frames = new ManualAnimationFrames();
    const clock = makeClock(frames);

    clock.play();
    frames.advanceTo(125.5);
    expect(clock.getSnapshot()).toMatchObject({
      offsetUs: 125_500,
      status: "playing",
      progress: 0.1255,
    });

    frames.advanceTo(300);
    expect(clock.getSnapshot().offsetUs).toBe(300_000);
    expect(frames.pendingCount).toBe(1);
  });

  it("pauses at the current offset and cancels scheduled work", () => {
    const frames = new ManualAnimationFrames();
    const clock = makeClock(frames);

    clock.play();
    frames.nowMs = 240;
    clock.pause();

    expect(clock.getSnapshot()).toMatchObject({ offsetUs: 240_000, status: "paused" });
    expect(frames.pendingCount).toBe(0);
    frames.advanceTo(600);
    expect(clock.getSnapshot().offsetUs).toBe(240_000);
  });

  it("anchors rate changes at the exact current playhead", () => {
    const frames = new ManualAnimationFrames();
    const clock = makeClock(frames, 2_000_000);

    clock.play();
    frames.nowMs = 100;
    clock.setRate(2);
    expect(clock.getSnapshot()).toMatchObject({ offsetUs: 100_000, rate: 2 });

    frames.advanceTo(250);
    expect(clock.getSnapshot().offsetUs).toBe(400_000);
  });

  it("clamps seeks, ends at duration, and replays from zero", () => {
    const frames = new ManualAnimationFrames();
    const clock = makeClock(frames, 500_000);

    clock.seek(900_000);
    expect(clock.getSnapshot()).toMatchObject({ offsetUs: 500_000, status: "ended" });

    clock.play();
    expect(clock.getSnapshot()).toMatchObject({ offsetUs: 0, status: "playing" });
    frames.advanceTo(500);
    expect(clock.getSnapshot()).toMatchObject({ offsetUs: 500_000, status: "ended" });
    expect(frames.pendingCount).toBe(0);
  });

  it("publishes stable snapshots only when observable state changes", () => {
    const frames = new ManualAnimationFrames();
    const clock = makeClock(frames);
    const listener = vi.fn();
    clock.subscribe(listener);
    const initial = clock.getSnapshot();

    clock.seek(0);
    expect(clock.getSnapshot()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();

    clock.play();
    const playing = clock.getSnapshot();
    expect(playing).not.toBe(initial);
    expect(listener).toHaveBeenCalledTimes(1);

    frames.advanceTo(100);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("resets to a ready state while retaining the selected rate", () => {
    const frames = new ManualAnimationFrames();
    const clock = makeClock(frames);

    clock.setRate(4);
    clock.play();
    frames.advanceTo(100);
    clock.reset();

    expect(clock.getSnapshot()).toMatchObject({
      offsetUs: 0,
      rate: 4,
      status: "ready",
    });
    expect(frames.pendingCount).toBe(0);
  });
});
