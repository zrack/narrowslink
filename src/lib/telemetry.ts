import { lowerBoundByOffset, rowsInRange } from "../domain/session";
import type { IncidentProjection, MetricBucket, ParsedSession } from "../domain/types";

export interface ChartPoint {
  offsetUs: number;
  rssi: number | null;
  throughput: number;
  loss: number;
  jitter: number | null;
  lat: number | null;
  lon: number | null;
  alt: number | null;
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null && Number.isFinite(value));
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

export function downsampleBuckets(
  buckets: MetricBucket[],
  startUs: number,
  endUs: number,
  maximumPoints = 240,
): ChartPoint[] {
  const visible = rowsInRange(buckets, startUs, endUs);
  if (visible.length === 0) return [];
  const stride = Math.max(1, Math.ceil(visible.length / maximumPoints));
  const points: ChartPoint[] = [];

  for (let index = 0; index < visible.length; index += stride) {
    const group = visible.slice(index, index + stride);
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last) continue;
    const received = group.reduce((sum, bucket) => sum + bucket.received, 0);
    const missing = group.reduce((sum, bucket) => sum + bucket.missing, 0);
    const expected = received + missing;
    points.push({
      offsetUs: first.offsetUs + (last.offsetUs - first.offsetUs) / 2,
      rssi: average(group.map((bucket) => bucket.rssiDbm)),
      throughput: average(group.map((bucket) => bucket.throughput)) ?? 0,
      loss: expected > 0 ? (missing / expected) * 100 : 0,
      jitter: average(group.map((bucket) => bucket.jitterMs)),
      lat: last.latitude,
      lon: last.longitude,
      alt: last.altitudeM,
    });
  }

  return points;
}

export function incidentViewRange(session: ParsedSession, incident: IncidentProjection): { startUs: number; endUs: number } {
  const incidentDuration = incident.endUs - incident.startUs;
  const minimumWindow = 7 * 60 * 1_000_000;
  const targetDuration = Math.max(minimumWindow, incidentDuration * 2.8);
  const center = incident.startUs + incidentDuration / 2;
  let startUs = Math.max(0, center - targetDuration / 2);
  let endUs = Math.min(session.document.durationUs, startUs + targetDuration);
  startUs = Math.max(0, endUs - targetDuration);
  return { startUs, endUs };
}

export function valueAtOffset(buckets: MetricBucket[], offsetUs: number): MetricBucket | null {
  if (buckets.length === 0) return null;
  const index = Math.min(buckets.length - 1, Math.max(0, lowerBoundByOffset(buckets, offsetUs + 1) - 1));
  return buckets[index] ?? null;
}

export function percentInRange(offsetUs: number, startUs: number, endUs: number): number {
  if (endUs <= startUs) return 0;
  return Math.min(100, Math.max(0, ((offsetUs - startUs) / (endUs - startUs)) * 100));
}

export function finiteOrDash(value: number | null, digits = 0, suffix = ""): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}${suffix}`;
}
