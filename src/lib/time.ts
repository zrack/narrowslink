const SECOND_US = 1_000_000;

export function formatDurationUs(durationUs: number, precise = false): string {
  const totalSeconds = Math.max(0, durationUs / SECOND_US);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const secondCopy = precise ? seconds.toFixed(3).replace(/\.000$/, "") : Math.floor(seconds).toString();
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${secondCopy}s`);
  return parts.join(" ");
}

export function formatClockOffset(startedAt: string, offsetUs: number, timeZone: string, milliseconds = true): string {
  const value = new Date(new Date(startedAt).getTime() + offsetUs / 1000);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: milliseconds ? 3 : undefined,
    hour12: false,
  }).format(value);
}

export function formatSessionDate(startedAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(startedAt));
}

export function timeZoneAbbreviation(startedAt: string, timeZone: string, offsetUs = 0): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(new Date(new Date(startedAt).getTime() + offsetUs / 1000))
    .find((candidate) => candidate.type === "timeZoneName");
  return part?.value ?? timeZone;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes >= 1024 * 100 ? 0 : 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
