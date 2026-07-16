import {
  useCallback,
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  BookmarkSimple,
  CaretRight,
  Check,
  Circle,
  ClockCounterClockwise,
  DownloadSimple,
  FunnelSimple,
  Gear,
  NotePencil,
  Package,
  Pause,
  Play,
  Plus,
  RadioButton,
  SpinnerGap,
  UploadSimple,
  WarningCircle,
  WifiHigh,
  X,
} from "@phosphor-icons/react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer } from "recharts";

import {
  buildEvidenceBundle,
  downloadEvidenceBundle,
  suggestEvidenceBundleFilename,
  type EvidenceBundleInclusions,
} from "./domain/bundle";
import { SUPPORTED_DECODER } from "./domain/decoder";
import { rowsInRange } from "./domain/session";
import type { DiagnosticEvent, IncidentProjection, Marker, ParsedSession } from "./domain/types";
import { loadBundledSession, loadSessionFile, SessionLoadError } from "./data/load-session";
import { downsampleBuckets, finiteOrDash, incidentViewRange, percentInRange, valueAtOffset } from "./lib/telemetry";
import { formatBytes, formatClockOffset, formatDurationUs, formatSessionDate, timeZoneAbbreviation } from "./lib/time";
import { useReplay } from "./replay/useReplay";
import { loadSessionWorkspace, saveSessionWorkspace } from "./storage/session-storage";

type ActiveTab = "narrative" | "details" | "stats";
const INCIDENT_TABS: ActiveTab[] = ["narrative", "details", "stats"];
type LoadState =
  | { status: "loading"; message: string }
  | { status: "ready"; session: ParsedSession }
  | { status: "error"; error: SessionLoadError };

type BundleItemId = "rawRecords" | "decodedPackets" | "schema" | "diagnostics" | "notes";

interface BundleItem {
  id: BundleItemId;
  name: string;
  description: string;
  source: string;
  estimatedBytes: number;
  selected: boolean;
}

const FAMILY_ROWS = [
  { id: "Position", label: "Position (0x31)", color: "#8bc879" },
  { id: "Power", label: "Power (0x17)", color: "#6398d6" },
  { id: "Thermal", label: "Thermal (0x44)", color: "#f2a900" },
  { id: "Attitude", label: "Attitude (0x19)", color: "#8a78d6" },
  { id: "Heartbeat", label: "Heartbeat (0x02)", color: "#53b8b7" },
] as const;

const DEFAULT_NOTE = "Likely multipath from ferry traffic. Antenna re-aimed 5° up. Recommend checking tower guy-wire clearance.";
const BUNDLED_DEMO_ID = "harbor-relay-2026-07-15-213812";
const BUNDLED_DEMO_STARTED_AT = "2026-07-16T04:38:12.000Z";
const BUNDLED_DEMO_SCHEMA_HASH = SUPPORTED_DECODER.schemaHash;
const BUNDLED_DEMO_CONTENT_FINGERPRINT = "3e6a2e1ab9712614978fb17a033ab6d0";
const SESSION_IDENTITY_CACHE = new WeakMap<ParsedSession, string>();

function isBundledDemoSession(session: ParsedSession): boolean {
  return session.document.id === BUNDLED_DEMO_ID
    && session.document.startedAt === BUNDLED_DEMO_STARTED_AT
    && session.document.decoder.schemaHash === BUNDLED_DEMO_SCHEMA_HASH
    && sessionWorkspaceIdentity(session).endsWith(`:${BUNDLED_DEMO_CONTENT_FINGERPRINT}`);
}

function mixFingerprint(value: string, hashes: [number, number, number, number]): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hashes[0] = Math.imul(hashes[0] ^ code, 16_777_619) >>> 0;
    hashes[1] = (Math.imul(hashes[1], 33) ^ code) >>> 0;
    hashes[2] = Math.imul(hashes[2] ^ code, 2_246_822_519) >>> 0;
    hashes[3] = Math.imul(hashes[3] + code, 3_266_489_917) >>> 0;
  }
}

export function sessionContentFingerprint(session: ParsedSession): string {
  const hashes: [number, number, number, number] = [2_166_136_261, 5_381, 2_654_435_769, 2_246_822_507];
  mixFingerprint(JSON.stringify(session.document), hashes);
  return hashes.map((hash) => hash.toString(16).padStart(8, "0")).join("");
}

function sessionWorkspaceIdentity(session: ParsedSession): string {
  const cached = SESSION_IDENTITY_CACHE.get(session);
  if (cached) return cached;
  const contentFingerprint = sessionContentFingerprint(session);
  const identity = [
    session.document.id,
    session.document.startedAt,
    session.document.durationUs,
    session.document.source.id,
    session.document.decoder.schemaHash,
    session.document.records.length,
    contentFingerprint,
  ].join(":");
  SESSION_IDENTITY_CACHE.set(session, identity);
  return identity;
}

function createSeedMarkers(session: ParsedSession): Marker[] {
  const incident = session.incidents.find((candidate) => candidate.id === "fade") ?? session.incidents[0];
  if (!incident) return [];
  const seeds = [
    { offsetUs: Math.max(0, incident.startUs - 72_000_000), title: "Tower check", note: "Field note before the fade.", category: "field-note" as const },
    { offsetUs: incident.startUs + 55_000_000, title: "Interference observed", note: "RF conditions degraded at the harbor relay.", category: "observation" as const },
    { offsetUs: Math.min(session.document.durationUs - 1, incident.endUs + 18_000_000), title: "Antenna re-aimed", note: "Antenna adjusted five degrees upward.", category: "maintenance" as const },
  ];
  return seeds.map((seed, index) => ({
    id: `demo-marker-${index + 1}`,
    ...seed,
    createdAt: new Date(new Date(session.document.startedAt).getTime() + seed.offsetUs / 1000).toISOString(),
  }));
}

function formatSource(session: ParsedSession): string {
  const { source } = session.document;
  return source.port ? `${source.kind.toUpperCase()} :${source.port}` : source.label;
}

function formatDecoderRevision(revision: string): string {
  return revision.toLowerCase().startsWith("v") ? revision : `v${revision}`;
}

function shortDiagnosticTitle(event: DiagnosticEvent): string {
  const titles: Record<DiagnosticEvent["type"], string> = {
    "link-degraded": "Link quality ↓",
    "loss-burst": "Loss burst",
    "decoder-resync": "Decoder resync",
    recovery: "Recovered",
    "decoder-locked": "Decoder locked",
    "crc-failure": "CRC failure",
    "partial-frame": "Partial frame",
  };
  return titles[event.type];
}

interface TimelineDiagnosticGroup {
  first: DiagnosticEvent;
  count: number;
  severity: DiagnosticEvent["severity"];
}

function groupTimelineDiagnostics(events: DiagnosticEvent[], startUs: number, endUs: number): TimelineDiagnosticGroup[] {
  const binWidthUs = Math.max(1, Math.ceil((endUs - startUs) / 20));
  const bins = new Map<number, DiagnosticEvent[]>();
  for (const event of events) {
    const bin = Math.floor((event.startUs - startUs) / binWidthUs);
    const grouped = bins.get(bin) ?? [];
    grouped.push(event);
    bins.set(bin, grouped);
  }
  const rank: Record<DiagnosticEvent["severity"], number> = { info: 0, warning: 1, critical: 2 };
  return [...bins.entries()].sort(([left], [right]) => left - right).flatMap(([, grouped]) => {
    const first = grouped[0];
    if (!first) return [];
    const severity = grouped.reduce<DiagnosticEvent["severity"]>((highest, event) => rank[event.severity] > rank[highest] ? event.severity : highest, first.severity);
    return [{ first, count: grouped.length, severity }];
  });
}

interface TimelineSegment {
  startUs: number;
  endUs: number;
}

interface DecoderSegment extends TimelineSegment {
  state: "locked" | "resync";
}

function familySegments(session: ParsedSession, familyName: string, startUs: number, endUs: number): TimelineSegment[] {
  const resolutionUs = Math.max(1_000_000, Math.ceil((endUs - startUs) / 600));
  const matching = session.buckets.filter(
    (bucket) => bucket.offsetUs < endUs
      && bucket.offsetUs + 1_000_000 > startUs
      && (bucket.familyCounts[familyName] ?? 0) > 0,
  );
  const occupiedBins = new Set(matching.map((bucket) => Math.floor((bucket.offsetUs - startUs) / resolutionUs)));
  const segments: TimelineSegment[] = [];
  for (const bin of [...occupiedBins].sort((left, right) => left - right)) {
    const start = Math.max(startUs, startUs + bin * resolutionUs);
    const end = Math.min(endUs, start + resolutionUs);
    const previous = segments.at(-1);
    if (previous && start <= previous.endUs) previous.endUs = Math.max(previous.endUs, end);
    else segments.push({ startUs: start, endUs: end });
  }
  return segments;
}

function decoderSegments(events: DiagnosticEvent[], startUs: number, endUs: number): DecoderSegment[] {
  const transitions = events
    .filter((event) => event.type === "decoder-resync" || event.type === "decoder-locked")
    .sort((left, right) => left.startUs - right.startUs || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  let state: DecoderSegment["state"] = "locked";
  for (const event of transitions) {
    if (event.startUs >= startUs) break;
    state = event.type === "decoder-resync" ? "resync" : "locked";
  }
  const segments: DecoderSegment[] = [];
  let cursor = startUs;
  for (const event of transitions) {
    if (event.startUs < startUs || event.startUs >= endUs) continue;
    const nextState: DecoderSegment["state"] = event.type === "decoder-resync" ? "resync" : "locked";
    if (nextState === state) continue;
    if (event.startUs > cursor) segments.push({ startUs: cursor, endUs: event.startUs, state });
    cursor = event.startUs;
    state = nextState;
  }
  if (cursor < endUs) segments.push({ startUs: cursor, endUs, state });
  return segments;
}

function incidentClock(session: ParsedSession, incident: IncidentProjection): { start: string; end: string; duration: string } {
  return {
    start: formatClockOffset(session.document.startedAt, incident.startUs, session.document.displayTimeZone),
    end: formatClockOffset(session.document.startedAt, incident.endUs, session.document.displayTimeZone),
    duration: formatDurationUs(incident.endUs - incident.startUs, true),
  };
}

function initialBundleItems(session: ParsedSession, incident: IncidentProjection): BundleItem[] {
  const records = rowsInRange(session.document.records, incident.startUs, incident.endUs);
  const frames = rowsInRange(session.frames, incident.startUs, incident.endUs);
  const diagnostics = session.diagnostics.filter((event) => event.startUs >= incident.startUs && event.startUs < incident.endUs);
  const rawEstimate = records.reduce((sum, record) => sum + record.dataHex.length + 250, 0);
  const decodedEstimate = Math.max(1, frames.length) * 260;
  return [
    { id: "rawRecords", name: "Raw source records (NDJSON)", description: "Lossless captured records in the selected range", source: "Local", estimatedBytes: rawEstimate, selected: true },
    { id: "decodedPackets", name: "Decoded packets (CSV)", description: "Fields, integrity, and source provenance", source: `${session.document.decoder.id} ${formatDecoderRevision(session.document.decoder.revision)}`, estimatedBytes: decodedEstimate, selected: true },
    { id: "schema", name: "Decoder schema", description: "Envelope, families, and timing semantics", source: `${session.document.decoder.id} ${formatDecoderRevision(session.document.decoder.revision)}`, estimatedBytes: 4_600, selected: true },
    { id: "diagnostics", name: "Diagnostics (JSON + CSV)", description: "Link, loss, CRC, and decoder events", source: "Derived locally", estimatedBytes: Math.max(1, diagnostics.length) * 620, selected: true },
    { id: "notes", name: "Operator context", description: "Session-wide note plus markers inside the range", source: "Local workspace", estimatedBytes: 3_200, selected: true },
  ];
}

function StatusBars({ rssi }: { rssi: number | null }) {
  const quality = rssi == null ? "muted" : rssi < -90 ? "warn" : "good";
  return <WifiHigh className={`status-bars ${quality}`} size={20} weight="bold" aria-label={`${quality} signal`} />;
}

interface LeftRailProps {
  session: ParsedSession;
  replayOffsetUs: number;
  onOpenReplay: () => void;
  onResetReplay: () => void;
}

function LeftRail({ session, replayOffsetUs, onOpenReplay, onResetReplay }: LeftRailProps) {
  const { document } = session;
  const current = valueAtOffset(session.buckets, replayOffsetUs);
  const replaySummary = useMemo(() => {
    const invalidFrames = session.frames.filter((frame) => frame.status !== "complete").length;
    const missingFrames = session.buckets.reduce((sum, bucket) => sum + bucket.missing, 0);
    const expectedFrames = document.records.length + missingFrames;
    return { invalidFrames, missingFrames, droppedPct: expectedFrames > 0 ? (missingFrames / expectedFrames) * 100 : 0 };
  }, [document.records.length, session.buckets, session.frames]);
  const endClock = formatClockOffset(document.startedAt, document.durationUs, document.displayTimeZone, false);

  return (
    <aside className="left-rail" aria-label="Session navigation">
      <div className="brand-lockup">
        <img src="/narrowslink-mark.svg" alt="NarrowsLink" />
        <div><strong>NarrowsLink</strong><span>Local-first telemetry</span></div>
      </div>
      <div className="rail-scroll">
        <section className="rail-section sessions-heading">
          <div className="section-kicker-row"><span>Sessions</span><button className="icon-button" onClick={onOpenReplay} aria-label="Open replay"><Plus size={15} /></button></div>
          <div className="session-filter">
            <button type="button" onClick={onOpenReplay}>Open local replay <UploadSimple size={13} /></button>
            <button type="button" className="filter-button" aria-label="Replay filters unavailable" disabled><FunnelSimple size={15} /></button>
          </div>
        </section>
        <section className="rail-section active-links">
          <div className="section-kicker-row"><span>Loaded source</span><b>1</b></div>
          <div className="link-list">
            <div className="link-row selected" aria-current="true">
              <RadioButton size={13} weight="fill" />
              <span className="link-copy">
                <strong>{document.title}</strong>
                <small>{formatSource(session)} <i>•</i> {document.decoder.id}</small>
                <small>Recorded <i>•</i> {finiteOrDash(current?.rssiDbm ?? null, 0, " dBm")}</small>
              </span>
              <StatusBars rssi={current?.rssiDbm ?? null} />
            </div>
          </div>
        </section>
        <section className="rail-section recent-sessions">
          <div className="section-kicker-row"><span>Current replay</span></div>
          <button className="recent-row" type="button" onClick={onResetReplay}>
            <span><strong>{document.title}</strong><small>{formatSessionDate(document.startedAt, document.displayTimeZone)} <i>•</i> {formatDurationUs(document.durationUs)}</small></span>
            <CaretRight size={13} />
          </button>
        </section>
        <section className="rail-section session-info">
          <div className="section-kicker-row"><span>Session info</span></div>
          <dl>
            <div><dt>Source</dt><dd>{formatSource(session)}</dd></div>
            <div><dt>Decoder</dt><dd>{document.decoder.id}</dd></div>
            <div><dt>Schema</dt><dd>{formatDecoderRevision(document.decoder.revision)}</dd></div>
            <div><dt>Frames</dt><dd>{document.records.length.toLocaleString()}</dd></div>
            <div><dt>Invalid</dt><dd>{replaySummary.invalidFrames}</dd></div>
            <div><dt>Missing</dt><dd>{replaySummary.missingFrames} ({replaySummary.droppedPct.toFixed(2)}%)</dd></div>
            <div><dt>Start</dt><dd>{formatClockOffset(document.startedAt, 0, document.displayTimeZone, false)}</dd></div>
            <div><dt>End</dt><dd>{endClock}</dd></div>
            <div><dt>Duration</dt><dd>{formatDurationUs(document.durationUs)}</dd></div>
            <div><dt>Saved</dt><dd className="saved"><Circle size={7} weight="fill" /> Local only</dd></div>
          </dl>
        </section>
      </div>
      <button className="settings-button" type="button" onClick={onOpenReplay}><Gear size={16} /> Replace session</button>
    </aside>
  );
}

interface TopBarProps {
  session: ParsedSession;
  replayOffsetUs: number;
  replayStatus: string;
  replayRate: number;
  onTogglePlayback: () => void;
  onReset: () => void;
  onRateChange: (rate: number) => void;
  onAddMarker: () => void;
  onCreateBundle: () => void;
  onOpenReplay: () => void;
  bundleDisabled: boolean;
}

function TopBar(props: TopBarProps) {
  const { document } = props.session;
  const end = formatClockOffset(document.startedAt, document.durationUs, document.displayTimeZone, false);
  return (
    <header className="topbar">
      <div className="session-title">
        <span>Session review <i>•</i> Recorded <i>•</i> {formatSessionDate(document.startedAt, document.displayTimeZone)}</span>
        <div><h1 className="workspace-heading" tabIndex={-1}>{document.title}</h1><NotePencil className="decorative-icon" size={15} aria-hidden="true" /></div>
      </div>
      <div className="session-meta">
        {formatSessionDate(document.startedAt, document.displayTimeZone)} <i>•</i> {formatClockOffset(document.startedAt, 0, document.displayTimeZone, false)} {timeZoneAbbreviation(document.startedAt, document.displayTimeZone, 0)} – {end} {timeZoneAbbreviation(document.startedAt, document.displayTimeZone, document.durationUs)} <i>•</i> {formatClockOffset(document.startedAt, props.replayOffsetUs, document.displayTimeZone)} {timeZoneAbbreviation(document.startedAt, document.displayTimeZone, props.replayOffsetUs)}
      </div>
      <div className="header-actions">
        <button className="secondary-action open-replay-mobile" type="button" onClick={props.onOpenReplay}><UploadSimple size={15} /> Open replay</button>
        <button className={`secondary-action replay-toggle ${props.replayStatus === "playing" ? "active" : ""}`} type="button" onClick={props.onTogglePlayback}>
          {props.replayStatus === "playing" ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
          {props.replayStatus === "playing" ? "Pause replay" : props.replayStatus === "ended" ? "Replay again" : "Play replay"}
        </button>
        <button className="icon-button replay-reset" type="button" onClick={props.onReset} aria-label="Reset replay"><ClockCounterClockwise size={16} /></button>
        <label className="speed-control"><span className="visually-hidden">Replay speed</span><select value={props.replayRate} onChange={(event) => props.onRateChange(Number(event.target.value))}>{[0.5, 1, 2, 4, 8, 16].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
        <button className="secondary-action" type="button" onClick={props.onAddMarker}><BookmarkSimple size={16} /> Add marker</button>
        <button className="primary-action" type="button" disabled={props.bundleDisabled} onClick={props.onCreateBundle}><DownloadSimple size={17} /> Create incident bundle</button>
      </div>
    </header>
  );
}

interface OverviewProps {
  session: ParsedSession;
  incident: IncidentProjection | null;
  markers: Marker[];
  replayOffsetUs: number;
  onSeek: (offsetUs: number) => void;
  onSelectIncident: (incident: IncidentProjection) => void;
}

const OverviewSignalChart = memo(function OverviewSignalChart({ data }: { data: ReturnType<typeof downsampleBuckets> }) {
  return <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 5, right: 2, bottom: 2, left: 2 }}><Bar dataKey="throughput" fill="#6398d6" opacity={0.78} isAnimationActive={false} /><Line type="linear" dataKey="rssi" stroke="#8bc879" strokeWidth={1.2} dot={false} connectNulls={false} isAnimationActive={false} /><Line type="linear" dataKey="loss" stroke="#ea6f66" strokeWidth={1} strokeDasharray="3 2" dot={false} isAnimationActive={false} /></ComposedChart></ResponsiveContainer>;
});

function SessionOverview({ session, incident, markers, replayOffsetUs, onSeek, onSelectIncident }: OverviewProps) {
  const data = useMemo(() => downsampleBuckets(session.buckets, 0, session.document.durationUs, 420), [session]);
  const durationUs = session.document.durationUs;
  const selectionLeft = incident ? percentInRange(incident.startUs, 0, durationUs) : 0;
  const selectionWidth = incident ? percentInRange(incident.endUs, 0, durationUs) - selectionLeft : 0;
  const ticks = useMemo(() => Array.from({ length: 6 }, (_, index) => (durationUs * index) / 5), [durationUs]);
  const summary = useMemo(() => {
    const measuredSignal = data.flatMap((point) => point.rssi == null ? [] : [point.rssi]);
    const totalMissing = session.buckets.reduce((sum, bucket) => sum + bucket.missing, 0);
    return measuredSignal.length > 0
      ? `Session overview. Link quality ranges from ${Math.min(...measuredSignal).toFixed(0)} to ${Math.max(...measuredSignal).toFixed(0)} dBm. ${totalMissing.toLocaleString()} frames are inferred missing. ${markers.length} operator markers are present.`
      : `Session overview. No signal measurements are present. ${totalMissing.toLocaleString()} frames are inferred missing. ${markers.length} operator markers are present.`;
  }, [data, markers.length, session.buckets]);
  return (
    <section className="overview" aria-label="Session overview" aria-describedby="session-overview-summary">
      <p id="session-overview-summary" className="visually-hidden">{summary}</p>
      <div className="overview-title"><span>Session overview</span><div><i className="legend green" /> Link quality <i className="legend blue" /> Throughput <i className="legend red" /> Dropped frames <i className="legend purple" /> Markers</div></div>
      <div className="overview-chart">
        <OverviewSignalChart data={data} />
        <div className="overview-marker-strip" aria-hidden="true">{markers.map((marker) => <span key={marker.id} style={{ left: `${percentInRange(marker.offsetUs, 0, durationUs)}%` }} />)}</div>
        {incident && <div className="overview-selection" style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }} />}
        {session.incidents.map((candidate) => <button key={candidate.id} className="overview-incident-hit" style={{ left: `${percentInRange(candidate.startUs, 0, durationUs)}%`, width: `${Math.max(1.2, percentInRange(candidate.endUs, 0, durationUs) - percentInRange(candidate.startUs, 0, durationUs))}%` }} onClick={() => onSelectIncident(candidate)} aria-label={`Select ${candidate.title}`} />)}
        <div className="replay-cursor" style={{ left: `${percentInRange(replayOffsetUs, 0, durationUs)}%` }} aria-hidden="true" />
        <input className="overview-scrubber" type="range" min={0} max={durationUs} step={1_000_000} value={replayOffsetUs} onChange={(event) => onSeek(Number(event.target.value))} aria-label="Replay position" aria-valuetext={`${formatClockOffset(session.document.startedAt, replayOffsetUs, session.document.displayTimeZone)} (${formatDurationUs(replayOffsetUs, true)} elapsed)`} aria-describedby="session-overview-summary" />
        <div className="overview-times">{ticks.map((offset) => <span key={offset}>{formatClockOffset(session.document.startedAt, offset, session.document.displayTimeZone, false).slice(0, 5)}</span>)}</div>
      </div>
    </section>
  );
}

function PlotLane({ label, unit, value, children, className = "" }: { label: string; unit?: string; value?: string; children: React.ReactNode; className?: string }) {
  return <div className={`plot-lane ${className}`} role="group" aria-label={unit ? `${label}, ${unit}` : label}><div className="lane-label"><span><strong>{label}</strong>{unit && <small>{unit}</small>}</span></div><div className="lane-plot">{children}</div>{value && <span className={`lane-value ${value === "Out of view" ? "out-of-view" : ""}`}>{value}</span>}</div>;
}

const SignalChart = memo(function SignalChart({ data, dataKey, color, label, bar = false }: { data: ReturnType<typeof downsampleBuckets>; dataKey: "rssi" | "throughput" | "loss" | "lat" | "lon" | "alt"; color: string; label: string; bar?: boolean }) {
  const values = data.flatMap((point) => typeof point[dataKey] === "number" ? [point[dataKey]] : []);
  const summary = values.length > 0
    ? `${label} chart, ${values.length} samples, minimum ${Math.min(...values).toFixed(2)}, maximum ${Math.max(...values).toFixed(2)}.`
    : `${label} chart, no measured samples in this view.`;
  return <div className="signal-chart" role="img" aria-label={summary}>{bar ? <ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 3, right: 0, bottom: 2, left: 0 }}><CartesianGrid vertical horizontal={false} stroke="#242824" /><Bar dataKey={dataKey} fill={color} isAnimationActive={false} /></BarChart></ResponsiveContainer> : <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 5, right: 0, bottom: 5, left: 0 }}><CartesianGrid vertical horizontal={false} stroke="#242824" /><Line type="linear" dataKey={dataKey} stroke={color} strokeWidth={1.3} dot={false} connectNulls={false} isAnimationActive={false} /></LineChart></ResponsiveContainer>}</div>;
});

interface FamilyTrackRow {
  id: string;
  label: string;
  color: string;
  segments: TimelineSegment[];
}

const PacketFamilyTrack = memo(function PacketFamilyTrack({ rows, startUs, endUs }: { rows: FamilyTrackRow[]; startUs: number; endUs: number }) {
  return <div className="family-list">{rows.map((family) => <div className="family-row" key={family.id}><span><i style={{ background: family.color }} />{family.label}</span><div className="family-segments" aria-label={`${family.label}: ${family.segments.length} observed chart interval${family.segments.length === 1 ? "" : "s"}`}>{family.segments.map((segment) => <b key={`${segment.startUs}-${segment.endUs}`} style={{ background: family.color, left: `${percentInRange(segment.startUs, startUs, endUs)}%`, width: `${percentInRange(segment.endUs, startUs, endUs) - percentInRange(segment.startUs, startUs, endUs)}%` }} />)}</div></div>)}</div>;
});

interface TimelineProps {
  session: ParsedSession;
  incident: IncidentProjection;
  markers: Marker[];
  replayOffsetUs: number;
  onSeek: (offsetUs: number) => void;
}

function MissionTimeline({ session, incident, markers, replayOffsetUs, onSeek }: TimelineProps) {
  const view = useMemo(() => incidentViewRange(session, incident), [session, incident]);
  const data = useMemo(() => downsampleBuckets(session.buckets, view.startUs, view.endUs, 300), [session, view.startUs, view.endUs]);
  const playheadInView = replayOffsetUs >= view.startUs && replayOffsetUs < view.endUs;
  const current = playheadInView ? valueAtOffset(session.buckets, replayOffsetUs) : null;
  const selectionLeft = percentInRange(incident.startUs, view.startUs, view.endUs);
  const selectionWidth = percentInRange(incident.endUs, view.startUs, view.endUs) - selectionLeft;
  const ticks = useMemo(() => Array.from({ length: 7 }, (_, index) => view.startUs + ((view.endUs - view.startUs) * index) / 6), [view.endUs, view.startUs]);
  const visibleDiagnostics = useMemo(() => session.diagnostics.filter((event) => event.startUs >= view.startUs && event.startUs < view.endUs), [session.diagnostics, view.endUs, view.startUs]);
  const diagnosticGroups = useMemo(() => groupTimelineDiagnostics(visibleDiagnostics, view.startUs, view.endUs), [visibleDiagnostics, view.endUs, view.startUs]);
  const visibleMarkers = useMemo(() => markers.filter((marker) => marker.offsetUs >= view.startUs && marker.offsetUs < view.endUs), [markers, view.endUs, view.startUs]);
  const decoderStateSegments = useMemo(() => decoderSegments(session.diagnostics, view.startUs, view.endUs), [session.diagnostics, view.endUs, view.startUs]);
  const familyRows = useMemo(() => FAMILY_ROWS.map((family) => ({ ...family, segments: familySegments(session, family.id, view.startUs, view.endUs) })), [session, view.endUs, view.startUs]);
  const clock = incidentClock(session, incident);
  const replayLeft = percentInRange(replayOffsetUs, view.startUs, view.endUs);
  const viewZoneStart = timeZoneAbbreviation(session.document.startedAt, session.document.displayTimeZone, view.startUs);
  const viewZoneEnd = timeZoneAbbreviation(session.document.startedAt, session.document.displayTimeZone, view.endUs);
  const viewZoneLabel = viewZoneStart === viewZoneEnd ? viewZoneStart : session.document.displayTimeZone;

  return (
    <section className="timeline-panel" aria-label="Mission telemetry timeline">
      <div className="time-ruler"><span className="time-zone" aria-label={`Time zone ${session.document.displayTimeZone}`}>Time ({viewZoneLabel})</span><div className="time-buttons">{ticks.map((offset) => { const active = replayOffsetUs >= offset && replayOffsetUs < offset + (view.endUs - view.startUs) / 6; return <button key={offset} type="button" className={active ? "active" : ""} aria-current={active ? "time" : undefined} onClick={() => onSeek(offset)}>{formatClockOffset(session.document.startedAt, offset, session.document.displayTimeZone, false).slice(0, 5)}</button>; })}</div></div>
      <div className="timeline-stack">
        <div className="shared-grid" aria-hidden="true" />
        <div className="selection-band" style={{ left: `calc(var(--label-gutter) + (100% - var(--label-gutter)) * ${selectionLeft / 100})`, width: `calc((100% - var(--label-gutter)) * ${selectionWidth / 100})` }}><button className="selection-chip" type="button" onClick={() => onSeek(incident.startUs)}><BookmarkSimple size={12} weight="fill" /> {clock.start} <span>–</span> {clock.end} <small>({clock.duration})</small></button></div>
        {replayOffsetUs >= view.startUs && replayOffsetUs <= view.endUs && <div className="timeline-cursor" style={{ left: `calc(var(--label-gutter) + (100% - var(--label-gutter)) * ${replayLeft / 100})` }} aria-hidden="true" />}
        <PlotLane label="Connection" unit="RSSI (dBm)" value={playheadInView ? finiteOrDash(current?.rssiDbm ?? null, 0) : "Out of view"}><SignalChart data={data} dataKey="rssi" color="#8bc879" label="Connection RSSI" /></PlotLane>
        <PlotLane label="Throughput" unit="pkt/s (1s avg)" value={playheadInView ? finiteOrDash(current?.throughput ?? null, 0) : "Out of view"}><SignalChart data={data} dataKey="throughput" color="#6398d6" label="Packet throughput" bar /></PlotLane>
        <PlotLane label="Packet loss" unit="drop % (1s avg)" value={playheadInView ? finiteOrDash(current?.lossPct ?? null, 2, "%") : "Out of view"}><SignalChart data={data} dataKey="loss" color="#ea6f66" label="Packet loss" bar /></PlotLane>
        <PlotLane label="Packet families" className="families-lane"><PacketFamilyTrack rows={familyRows} startUs={view.startUs} endUs={view.endUs} /></PlotLane>
        <PlotLane label="Decoder" unit={session.document.decoder.id} className="event-lane"><div className="decoder-track">{decoderStateSegments.map((segment) => { const left = percentInRange(segment.startUs, view.startUs, view.endUs); const width = percentInRange(segment.endUs, view.startUs, view.endUs) - left; const label = segment.state === "locked" ? `Locked ${formatDecoderRevision(session.document.decoder.revision)}` : "Resync search"; return <span key={`${segment.state}-${segment.startUs}`} className={`decoder-segment ${segment.state}`} style={{ left: `${left}%`, width: `${width}%` }} aria-label={`${label} from ${formatClockOffset(session.document.startedAt, segment.startUs, session.document.displayTimeZone)} to ${formatClockOffset(session.document.startedAt, segment.endUs, session.document.displayTimeZone)}`} title={label}>{width >= 9 ? label : <span className="visually-hidden">{label}</span>}{segment.state === "resync" && width >= 16 && <small>invalid frames retained</small>}</span>; })}</div></PlotLane>
        <PlotLane label="Diagnostics" className="event-lane"><div className="event-track diagnostics-track">{diagnosticGroups.map((group) => <button key={group.first.id} type="button" style={{ left: `${percentInRange(group.first.startUs, view.startUs, view.endUs)}%` }} onClick={() => onSeek(group.first.startUs)} aria-label={`${group.count} ${group.severity} diagnostic${group.count === 1 ? "" : "s"}; first: ${group.first.title}, ${formatClockOffset(session.document.startedAt, group.first.startUs, session.document.displayTimeZone)}`}>{shortDiagnosticTitle(group.first)}{group.count > 1 && ` +${group.count - 1}`}<small>{formatClockOffset(session.document.startedAt, group.first.startUs, session.document.displayTimeZone, false)}</small></button>)}</div></PlotLane>
        <PlotLane label="Markers" className="event-lane"><div className="event-track marker-track">{visibleMarkers.map((marker) => <button key={marker.id} type="button" style={{ left: `${percentInRange(marker.offsetUs, view.startUs, view.endUs)}%` }} onClick={() => onSeek(marker.offsetUs)}><BookmarkSimple size={12} weight="fill" /> {marker.title}<small>{formatClockOffset(session.document.startedAt, marker.offsetUs, session.document.displayTimeZone)}</small></button>)}</div></PlotLane>
        <PlotLane label="Latitude" unit="deg" value={playheadInView ? finiteOrDash(current?.latitude ?? null, 4) : "Out of view"}><SignalChart data={data} dataKey="lat" color="#8bc879" label="Latitude" /></PlotLane>
        <PlotLane label="Longitude" unit="deg" value={playheadInView ? finiteOrDash(current?.longitude ?? null, 4) : "Out of view"}><SignalChart data={data} dataKey="lon" color="#8bc879" label="Longitude" /></PlotLane>
        <PlotLane label="Altitude" unit="m" value={playheadInView ? finiteOrDash(current?.altitudeM ?? null, 0) : "Out of view"}><SignalChart data={data} dataKey="alt" color="#8bc879" label="Altitude" /></PlotLane>
      </div>
    </section>
  );
}

function diagnosticTone(event: DiagnosticEvent): "amber" | "red" | "green" {
  if (event.type === "recovery" || event.type === "decoder-locked") return "green";
  return event.severity === "critical" ? "red" : "amber";
}

interface IncidentPanelProps {
  session: ParsedSession;
  incident: IncidentProjection | null;
  activeTab: ActiveTab;
  note: string;
  workspacePersisted: boolean;
  onTabChange: (tab: ActiveTab) => void;
  onNoteChange: (note: string) => void;
  onSelectIncident: (id: string) => void;
  onClear: () => void;
}

function IncidentPanel(props: IncidentPanelProps) {
  const { incident, session } = props;
  const [narrativeLimit, setNarrativeLimit] = useState(50);
  useEffect(() => { setNarrativeLimit(50); }, [incident?.id]);
  if (!incident) {
    const firstIncident = session.incidents[0];
    return <aside className="incident-panel empty-incident" aria-label="Incident details"><div className="incident-heading"><div><BookmarkSimple size={14} /><span>Incident selection</span></div></div><div className="empty-state"><ClockCounterClockwise size={24} /><h2>{firstIncident ? "No incident selected" : "No incident ranges"}</h2><p>{firstIncident ? "Choose an incident from the session overview to inspect decoded evidence and prepare a handoff bundle." : "This replay does not declare any incident presets. Playback, decoded values, markers, and the session overview remain available."}</p>{firstIncident && <button className="secondary-action" type="button" onClick={() => props.onSelectIncident(firstIncident.id)}>Select first incident</button>}</div></aside>;
  }
  const clock = incidentClock(session, incident);
  const stats = incident.stats;
  const narrative = incident.diagnostics;
  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = INCIDENT_TABS.indexOf(props.activeTab);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? INCIDENT_TABS.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + INCIDENT_TABS.length) % INCIDENT_TABS.length;
    const nextTab = INCIDENT_TABS[nextIndex];
    if (!nextTab) return;
    props.onTabChange(nextTab);
    requestAnimationFrame(() => document.getElementById(`incident-tab-${nextTab}`)?.focus());
  };
  return (
    <aside className="incident-panel" aria-label="Incident details">
      <div className="incident-heading"><div><BookmarkSimple size={14} weight="fill" /><span>Incident selection</span></div><button className="icon-button" type="button" aria-label="Clear incident" onClick={props.onClear}><X size={15} /></button></div>
      <div className="incident-range"><select className="incident-switcher" value={incident.id} onChange={(event) => props.onSelectIncident(event.target.value)} aria-label="Selected incident">{session.incidents.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select><strong>{clock.start} – {clock.end}</strong><span>{clock.duration}</span></div>
      <div className="incident-tabs" role="tablist" aria-label="Incident information" onKeyDown={handleTabKeyDown}>{INCIDENT_TABS.map((tab) => <button id={`incident-tab-${tab}`} aria-controls={`incident-panel-${tab}`} aria-selected={props.activeTab === tab} role="tab" tabIndex={props.activeTab === tab ? 0 : -1} type="button" key={tab} className={props.activeTab === tab ? "active" : ""} onClick={() => props.onTabChange(tab)}>{tab}</button>)}</div>
      {props.activeTab === "narrative" && <div className="narrative-view" id="incident-panel-narrative" role="tabpanel" tabIndex={0} aria-labelledby="incident-tab-narrative"><h2>{incident.title}</h2>{narrative.length > 0 ? <><p>{narrative.length} evidence-backed event{narrative.length === 1 ? "" : "s"} in the selected half-open range.</p><ol className="event-narrative">{narrative.slice(0, narrativeLimit).map((event) => <li key={event.id} className={diagnosticTone(event)}><time>{formatClockOffset(session.document.startedAt, event.startUs, session.document.displayTimeZone, false)}</time><div><strong>{event.title}<span className="visually-hidden"> — {event.severity} severity</span></strong><p>{event.description}</p></div></li>)}</ol>{narrativeLimit < narrative.length && <button className="narrative-more" type="button" onClick={() => setNarrativeLimit((current) => Math.min(narrative.length, current + 50))}>Show next {Math.min(50, narrative.length - narrativeLimit)} events <small>{narrativeLimit} of {narrative.length} shown</small></button>}</> : <div className="incident-evidence-empty"><p>No derived diagnostic events intersect this operator-defined range.</p><small>The range remains available for replay, marker review, and exact-range export.</small></div>}</div>}
      {props.activeTab === "details" && <dl className="details-view" id="incident-panel-details" role="tabpanel" tabIndex={0} aria-labelledby="incident-tab-details"><div><dt>Source</dt><dd>{formatSource(session)}</dd></div><div><dt>Decoder</dt><dd>{session.document.decoder.id} {formatDecoderRevision(session.document.decoder.revision)}</dd></div><div><dt>Frames in range</dt><dd>{stats.receivedFrames.toLocaleString()}</dd></div><div><dt>Missing</dt><dd className="danger">{stats.missingFrames}</dd></div><div><dt>Loss</dt><dd className="danger">{finiteOrDash(stats.lossPct, 2, "%")}</dd></div><div><dt>Lowest RSSI</dt><dd>{finiteOrDash(stats.lowestRssiDbm, 1, " dBm")}</dd></div><div><dt>Peak jitter</dt><dd>{finiteOrDash(stats.peakJitterMs, 1, " ms")}</dd></div><div><dt>Complete packets</dt><dd>{stats.completePackets.toLocaleString()}</dd></div></dl>}
      {props.activeTab === "stats" && <div className="stats-view" id="incident-panel-stats" role="tabpanel" tabIndex={0} aria-labelledby="incident-tab-stats"><StatBar label="Link availability" value={stats.linkAvailabilityPct} /><StatBar label="Decode confidence" value={stats.decodeConfidencePct} /><StatBar label="Delivery" value={stats.lossPct == null ? null : 100 - stats.lossPct} /></div>}
      <div className="operator-notes"><div><span>Session-wide operator note</span><NotePencil size={14} aria-hidden="true" /></div><textarea maxLength={2000} value={props.note} onChange={(event) => props.onNoteChange(event.target.value)} aria-label="Session-wide operator note" /><small className={!props.workspacePersisted ? "storage-warning" : ""}>{props.workspacePersisted ? "Stored in this browser only; included with any range when selected for export" : "Browser storage is unavailable; edits remain in memory until this page closes"}</small></div>
    </aside>
  );
}

function StatBar({ label, value }: { label: string; value: number | null }) {
  const bounded = Math.max(0, Math.min(100, value ?? 0));
  return <div><span>{label}</span><strong>{finiteOrDash(value, 1, "%")}</strong><i><b style={{ width: `${bounded}%` }} /></i></div>;
}

interface BundlePanelProps {
  session: ParsedSession;
  incident: IncidentProjection | null;
  items: BundleItem[];
  note: string;
  workspacePersisted: boolean;
  onItemsChange: (items: BundleItem[]) => void;
  onNoteChange: (note: string) => void;
  onCreateBundle: () => void;
}

function BundlePanel(props: BundlePanelProps) {
  const selected = props.incident ? props.items.filter((item) => item.selected) : [];
  const estimatedBytes = selected.reduce((sum, item) => sum + item.estimatedBytes, 0);
  const clock = props.incident ? incidentClock(props.session, props.incident) : null;
  const toggle = (id: BundleItemId) => props.onItemsChange(props.items.map((item) => item.id === id ? { ...item, selected: !item.selected } : item));
  return (
    <section className="bundle-panel" aria-label="Incident bundle preview">
      <div className="bundle-summary"><div><span>Incident bundle preview</span><p>A local, verifiable archive for reproducing and investigating the selected incident.</p></div><dl><div><dt>Time range</dt><dd>{clock ? <>{clock.start} – {clock.end}<small>{clock.duration}</small></> : <span className="no-selection-copy">No incident selected</span>}</dd></div><div><dt>Size (est.)</dt><dd>{formatBytes(estimatedBytes)}</dd></div><div><dt>Groups</dt><dd>{selected.length}</dd></div></dl><button className="primary-action bundle-create" type="button" disabled={!props.incident || selected.length === 0} onClick={props.onCreateBundle}><DownloadSimple size={17} /> Create incident bundle</button></div>
      <div className="bundle-body"><div className="bundle-table-wrap" role="table" aria-label="Evidence bundle contents"><div className="bundle-table-head" role="row"><span role="columnheader">Include</span><span role="columnheader">Item</span><span role="columnheader">Description</span><span role="columnheader">Source</span><span role="columnheader">Size (est.)</span></div><div className="bundle-table" role="rowgroup">{props.items.map((item) => <label className={!item.selected ? "excluded" : ""} key={item.id} role="row"><span className="checkbox" role="cell"><input type="checkbox" checked={item.selected} disabled={!props.incident} onChange={() => toggle(item.id)} /></span><strong role="cell">{item.name}</strong><span role="cell">{item.description}</span><span role="cell">{item.source}</span><span role="cell">{formatBytes(item.estimatedBytes)}</span></label>)}</div></div><label className="bundle-notes"><span>Session-wide note for bundle</span><small className={!props.workspacePersisted ? "storage-warning" : ""}>{props.workspacePersisted ? "This note applies to the session and is included with the selected range." : "Browser storage is unavailable; this note remains in memory and can still be included now."}</small><textarea disabled={!props.incident} value={props.note} maxLength={2000} onChange={(event) => props.onNoteChange(event.target.value)} /><b>{props.note.length} / 2000</b></label></div>
    </section>
  );
}

interface MarkerDialogProps {
  session: ParsedSession;
  initialOffsetUs: number;
  onClose: () => void;
  onCreate: (marker: Marker) => void;
}

const FOCUSABLE_SELECTOR = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

function useModalFocus(dialogRef: RefObject<HTMLElement | null>, onClose: () => void, canClose = true): void {
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  onCloseRef.current = onClose;
  canCloseRef.current = canClose;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById("root");
    const previousAriaHidden = appRoot?.getAttribute("aria-hidden") ?? null;
    const previousInert = appRoot?.inert ?? false;
    if (appRoot) {
      appRoot.inert = true;
      appRoot.setAttribute("aria-hidden", "true");
    }

    const focusFrame = requestAnimationFrame(() => {
      const initial = dialog.querySelector<HTMLElement>("[data-dialog-focus]")
        ?? dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        ?? dialog;
      initial.focus({ preventScroll: true });
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && canCloseRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", keydown, true);
      if (appRoot) {
        appRoot.inert = previousInert;
        if (previousAriaHidden == null) appRoot.removeAttribute("aria-hidden");
        else appRoot.setAttribute("aria-hidden", previousAriaHidden);
      }
      opener?.focus({ preventScroll: true });
    };
  }, [dialogRef]);
}

function MarkerDialog({ session, initialOffsetUs, onClose, onCreate }: MarkerDialogProps) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const offsetRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const safeInitialOffsetUs = Math.floor(Math.min(initialOffsetUs, session.document.durationUs - 1) / 1000) * 1000;
  const [offsetSeconds, setOffsetSeconds] = useState((safeInitialOffsetUs / 1_000_000).toFixed(3));
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<Marker["category"]>("observation");
  const [error, setError] = useState<{ field: "offset" | "title"; message: string } | null>(null);
  useModalFocus(dialogRef, onClose);
  const seconds = offsetSeconds.trim() === "" ? Number.NaN : Number(offsetSeconds);
  const offsetUs = Number.isFinite(seconds) ? Math.round(seconds * 1_000_000) : null;
  const offsetIsValid = offsetUs != null && offsetUs >= 0 && offsetUs < session.document.durationUs;
  const displayedTimestamp = offsetIsValid
    ? formatClockOffset(session.document.startedAt, offsetUs, session.document.displayTimeZone)
    : "Outside this replay";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!offsetIsValid || offsetUs == null) {
      setError({ field: "offset", message: `Enter an offset from 0 up to ${formatDurationUs(session.document.durationUs - 1, true)}.` });
      requestAnimationFrame(() => offsetRef.current?.focus());
      return;
    }
    if (!title.trim()) {
      setError({ field: "title", message: "Give the marker a short title." });
      requestAnimationFrame(() => titleRef.current?.focus());
      return;
    }
    onCreate({ id: globalThis.crypto?.randomUUID?.() ?? `marker-${Date.now()}`, offsetUs, title: title.trim(), note: note.trim(), category, createdAt: new Date().toISOString() });
  };
  return createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form ref={dialogRef} className="bundle-dialog marker-dialog" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="marker-dialog-title" onSubmit={submit}><button className="dialog-close" type="button" aria-label="Close marker dialog" onClick={onClose}><X size={17} /></button><div className="dialog-icon"><BookmarkSimple size={24} /></div><span className="dialog-kicker">Session marker</span><h2 id="marker-dialog-title">Add an operator marker</h2><p>Anchor field context to the same microsecond replay timeline used by diagnostics and export.</p><div className="dialog-fields"><label><span>Offset from session start (seconds)</span><input ref={offsetRef} data-dialog-focus type="number" min={0} max={(session.document.durationUs - 1) / 1_000_000} step="0.001" inputMode="decimal" value={offsetSeconds} aria-invalid={error?.field === "offset"} aria-describedby={`marker-offset-help${error?.field === "offset" ? " marker-dialog-error" : ""}`} onChange={(event) => { setOffsetSeconds(event.target.value); if (error?.field === "offset") setError(null); }} /><small id="marker-offset-help" className="field-help">Session clock: <output>{displayedTimestamp}</output> {timeZoneAbbreviation(session.document.startedAt, session.document.displayTimeZone, offsetUs ?? 0)}</small></label><label><span>Title</span><input ref={titleRef} value={title} maxLength={80} aria-invalid={error?.field === "title"} aria-describedby={error?.field === "title" ? "marker-dialog-error" : undefined} onChange={(event) => { setTitle(event.target.value); if (error?.field === "title") setError(null); }} placeholder="What happened?" /></label><label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value as Marker["category"])}><option value="observation">Observation</option><option value="field-note">Field note</option><option value="maintenance">Maintenance</option></select></label><label><span>Note</span><textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label></div>{error && <p id="marker-dialog-error" className="dialog-error" role="alert">{error.message}</p>}<div className="dialog-actions"><button className="secondary-action" type="button" onClick={onClose}>Cancel</button><button className="primary-action" type="submit"><BookmarkSimple size={16} /> Add marker</button></div></form></div>, document.body);
}

interface BundleDialogProps {
  session: ParsedSession;
  incident: IncidentProjection;
  items: BundleItem[];
  markers: Marker[];
  note: string;
  onClose: () => void;
}

function BundleDialog({ session, incident, items, markers, note, onClose }: BundleDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<"confirm" | "building" | "success" | "error">("confirm");
  const [artifact, setArtifact] = useState<{ filename: string; bytes: number } | null>(null);
  const [error, setError] = useState("");
  const selected = items.filter((item) => item.selected);
  const clock = incidentClock(session, incident);
  useModalFocus(dialogRef, onClose, status !== "building");
  useEffect(() => {
    if (status === "confirm") return;
    const frame = requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("[data-status-focus]")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [status]);
  const createBundle = async () => {
    setStatus("building");
    try {
      const enabled = new Set(selected.map((item) => item.id));
      const include: Partial<EvidenceBundleInclusions> = { rawRecords: enabled.has("rawRecords"), decodedPackets: enabled.has("decodedPackets"), schema: enabled.has("schema"), diagnostics: enabled.has("diagnostics"), markers: enabled.has("notes"), notes: enabled.has("notes") };
      const bytes = await buildEvidenceBundle({ session, range: incident, markers, notes: note.trim() ? [{ id: "operator-note", body: note.trim(), title: "Operator note" }] : [], include });
      const filename = suggestEvidenceBundleFilename(session, incident);
      downloadEvidenceBundle(bytes, filename);
      setArtifact({ filename, bytes: bytes.byteLength });
      setStatus("success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The evidence archive could not be built.");
      setStatus("error");
    }
  };
  return createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && status !== "building" && onClose()}><section ref={dialogRef} className="bundle-dialog" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="bundle-dialog-title" aria-live="polite"><button className="dialog-close" type="button" aria-label="Close" onClick={onClose} disabled={status === "building"}><X size={17} /></button>{status === "confirm" && <><div className="dialog-icon"><Package size={24} /></div><span className="dialog-kicker">Incident bundle</span><h2 id="bundle-dialog-title">Package this incident for handoff?</h2><p>The archive is built and downloaded locally. The original replay is never modified or uploaded.</p><dl className="dialog-summary"><div><dt>Range</dt><dd>{clock.start} – {clock.end}</dd></div><div><dt>Contents</dt><dd>{selected.length} selected groups</dd></div><div><dt>Checksums</dt><dd>SHA-256 manifest</dd></div></dl><div className="dialog-actions"><button className="secondary-action" type="button" onClick={onClose}>Cancel</button><button className="primary-action" data-dialog-focus type="button" onClick={() => void createBundle()}><DownloadSimple size={17} /> Build and download</button></div></>}{status === "building" && <div className="dialog-success"><div className="dialog-icon"><SpinnerGap className="spin" size={24} /></div><span className="dialog-kicker">Building locally</span><h2 id="bundle-dialog-title" data-status-focus tabIndex={-1}>Hashing and compressing evidence</h2><p>Records are being filtered to the exact half-open incident range and packaged with a checksum manifest.</p></div>}{status === "success" && artifact && <div className="dialog-success"><div className="success-mark"><Check size={28} weight="bold" /></div><span className="dialog-kicker">Evidence bundle downloaded</span><h2 id="bundle-dialog-title">Handoff archive is ready</h2><p><strong>{artifact.filename}</strong> contains {formatBytes(artifact.bytes)} of locally generated, verifiable evidence.</p><button className="primary-action" data-status-focus type="button" onClick={onClose}>Return to session</button></div>}{status === "error" && <div className="dialog-success"><div className="dialog-icon error-icon"><WarningCircle size={26} /></div><span className="dialog-kicker">Bundle failed</span><h2 id="bundle-dialog-title" data-status-focus tabIndex={-1}>The archive was not created</h2><p>{error}</p><div className="dialog-actions"><button className="secondary-action" type="button" onClick={onClose}>Close</button><button className="primary-action" type="button" onClick={() => void createBundle()}>Try again</button></div></div>}</section></div>, document.body);
}

function Toast({ message }: { message: string }) {
  return message ? <div className="toast" role="status"><Check size={15} weight="bold" /> {message}</div> : null;
}

function Workspace({ session, onOpenReplay }: { session: ParsedSession; onOpenReplay: () => void }) {
  const firstIncident = session.incidents.find((candidate) => candidate.id === "fade") ?? session.incidents[0] ?? null;
  const replay = useReplay({ durationUs: session.document.durationUs, initialOffsetUs: firstIncident?.startUs ?? 0, initialRate: 1 });
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(firstIncident?.id ?? null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("narrative");
  const workspaceIdentity = useMemo(() => sessionWorkspaceIdentity(session), [session]);
  const stored = useMemo(() => loadSessionWorkspace(workspaceIdentity), [workspaceIdentity]);
  const isBundledDemo = isBundledDemoSession(session);
  const [markers, setMarkers] = useState<Marker[]>(() => stored.updatedAt == null && isBundledDemo ? createSeedMarkers(session) : stored.markers);
  const [note, setNote] = useState(() => stored.updatedAt == null && isBundledDemo ? DEFAULT_NOTE : stored.notes);
  const [markerDialogOpen, setMarkerDialogOpen] = useState(false);
  const [bundleDialogOpen, setBundleDialogOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [workspacePersisted, setWorkspacePersisted] = useState(true);
  const selectedIncident = session.incidents.find((candidate) => candidate.id === selectedIncidentId) ?? null;
  const [bundleItems, setBundleItems] = useState<BundleItem[]>(() => firstIncident ? initialBundleItems(session, firstIncident) : []);

  useEffect(() => { setWorkspacePersisted(saveSessionWorkspace(workspaceIdentity, { markers, notes: note })); }, [workspaceIdentity, markers, note]);
  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); }, []);
  const selectIncident = (id: string) => {
    const next = session.incidents.find((candidate) => candidate.id === id);
    if (!next) return;
    setSelectedIncidentId(next.id);
    setBundleItems(initialBundleItems(session, next));
    replay.pause();
    replay.seek(next.startUs);
    setActiveTab("narrative");
  };
  const togglePlayback = () => replay.snapshot.status === "playing" ? replay.pause() : replay.play();
  const addMarker = (marker: Marker) => { setMarkers((current) => [...current, marker].sort((left, right) => left.offsetUs - right.offsetUs)); setMarkerDialogOpen(false); replay.seek(marker.offsetUs); notify(`Marker added at ${formatClockOffset(session.document.startedAt, marker.offsetUs, session.document.displayTimeZone)}`); };

  return <main className="app-shell" aria-label="Telemetry review workspace"><LeftRail session={session} replayOffsetUs={replay.snapshot.offsetUs} onOpenReplay={onOpenReplay} onResetReplay={replay.reset} /><TopBar session={session} replayOffsetUs={replay.snapshot.offsetUs} replayStatus={replay.snapshot.status} replayRate={replay.snapshot.rate} onTogglePlayback={togglePlayback} onReset={replay.reset} onRateChange={replay.setRate} onAddMarker={() => setMarkerDialogOpen(true)} onCreateBundle={() => setBundleDialogOpen(true)} onOpenReplay={onOpenReplay} bundleDisabled={!selectedIncident || !bundleItems.some((item) => item.selected)} /><SessionOverview session={session} incident={selectedIncident} markers={markers} replayOffsetUs={replay.snapshot.offsetUs} onSeek={replay.seek} onSelectIncident={(incident) => selectIncident(incident.id)} />{selectedIncident ? <MissionTimeline session={session} incident={selectedIncident} markers={markers} replayOffsetUs={replay.snapshot.offsetUs} onSeek={replay.seek} /> : <section className="timeline-panel"><div className="empty-state"><BookmarkSimple size={24} /><h2>Select an incident</h2><p>The full replay remains available in the session overview.</p></div></section>}<IncidentPanel session={session} incident={selectedIncident} activeTab={activeTab} note={note} workspacePersisted={workspacePersisted} onTabChange={setActiveTab} onNoteChange={setNote} onSelectIncident={selectIncident} onClear={() => setSelectedIncidentId(null)} /><BundlePanel session={session} incident={selectedIncident} items={bundleItems} note={note} workspacePersisted={workspacePersisted} onItemsChange={setBundleItems} onNoteChange={setNote} onCreateBundle={() => setBundleDialogOpen(true)} />{markerDialogOpen && <MarkerDialog session={session} initialOffsetUs={replay.snapshot.offsetUs} onClose={() => setMarkerDialogOpen(false)} onCreate={addMarker} />}{bundleDialogOpen && selectedIncident && <BundleDialog session={session} incident={selectedIncident} items={bundleItems} markers={markers} note={note} onClose={() => setBundleDialogOpen(false)} />}<Toast message={toast} /></main>;
}

function LoadingScreen({ message }: { message: string }) {
  return <main className="load-screen" role="status" aria-live="polite" aria-busy="true"><img src="/narrowslink-mark.svg" alt="" /><SpinnerGap className="spin" size={24} /><h1 data-load-focus tabIndex={-1}>NarrowsLink</h1><p>{message}</p></main>;
}

function ErrorScreen({ error, onRetry, onOpenReplay }: { error: SessionLoadError; onRetry: () => void; onOpenReplay: () => void }) {
  return <main className="load-screen error-screen" role="alert"><img src="/narrowslink-mark.svg" alt="" /><WarningCircle size={28} /><h1 data-load-focus tabIndex={-1}>Replay could not be opened</h1><p>{error.message}</p>{error.details.length > 0 && <ul>{error.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}<div><button className="secondary-action" type="button" onClick={onOpenReplay}>Choose another file</button><button className="primary-action" type="button" onClick={onRetry}>Load bundled replay</button></div></main>;
}

export function App() {
  const [state, setState] = useState<LoadState>({ status: "loading", message: "Validating bundled telemetry…" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadDefault = useCallback(async () => {
    setState({ status: "loading", message: "Validating bundled telemetry…" });
    try { setState({ status: "ready", session: await loadBundledSession() }); }
    catch (cause) { setState({ status: "error", error: cause instanceof SessionLoadError ? cause : new SessionLoadError("The bundled replay could not be loaded.", [cause instanceof Error ? cause.message : "Unknown error"]) }); }
  }, []);
  useEffect(() => { void loadDefault(); }, [loadDefault]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(state.status === "ready" ? ".workspace-heading" : "[data-load-focus]")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [state.status]);
  const openReplay = () => fileInputRef.current?.click();
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setState({ status: "loading", message: `Decoding ${file.name}…` });
    try { setState({ status: "ready", session: await loadSessionFile(file) }); }
    catch (cause) { setState({ status: "error", error: cause instanceof SessionLoadError ? cause : new SessionLoadError("The selected replay could not be loaded.") }); }
  };
  return <><input ref={fileInputRef} className="visually-hidden" type="file" tabIndex={-1} aria-label="Choose a local NarrowsLink replay" accept=".json,.nlsession,application/json" onChange={(event) => void handleFile(event)} />{state.status === "loading" && <LoadingScreen message={state.message} />}{state.status === "error" && <ErrorScreen error={state.error} onRetry={() => void loadDefault()} onOpenReplay={openReplay} />}{state.status === "ready" && <Workspace key={sessionWorkspaceKey(state.session)} session={state.session} onOpenReplay={openReplay} />}</>;
}

function sessionWorkspaceKey(session: ParsedSession): string {
  return sessionWorkspaceIdentity(session);
}
