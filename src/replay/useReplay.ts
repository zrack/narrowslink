import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  ReplayClock,
  type ReplayClockOptions,
  type ReplaySnapshot,
} from "./ReplayClock";

export interface UseReplayResult {
  clock: ReplayClock;
  snapshot: ReplaySnapshot;
  play: () => void;
  pause: () => void;
  seek: (offsetUs: number) => void;
  setRate: (rate: number) => void;
  reset: () => void;
}

/** Connects a ReplayClock to React through a referentially stable snapshot. */
export const useReplay = (options: ReplayClockOptions): UseReplayResult => {
  const {
    durationUs,
    initialOffsetUs,
    initialRate,
    now,
    scheduleFrame,
    cancelFrame,
  } = options;

  const clock = useMemo(
    () =>
      new ReplayClock({
        durationUs,
        initialOffsetUs,
        initialRate,
        now,
        scheduleFrame,
        cancelFrame,
      }),
    [durationUs, initialOffsetUs, initialRate, now, scheduleFrame, cancelFrame],
  );

  useEffect(
    () => () => {
      clock.destroy();
    },
    [clock],
  );

  const snapshot = useSyncExternalStore(
    clock.subscribe,
    clock.getSnapshot,
    clock.getServerSnapshot,
  );

  return useMemo(
    () => ({
      clock,
      snapshot,
      play: clock.play,
      pause: clock.pause,
      seek: clock.seek,
      setRate: clock.setRate,
      reset: clock.reset,
    }),
    [clock, snapshot],
  );
};
