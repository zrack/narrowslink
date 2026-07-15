import { useMemo, useRef, useState } from "react";
import {
  BookmarkSimple,
  Broadcast,
  CaretDown,
  CaretRight,
  Check,
  CheckSquare,
  Circle,
  ClockCounterClockwise,
  DownloadSimple,
  FunnelSimple,
  Gear,
  NotePencil,
  Package,
  Pause,
  Plus,
  RadioButton,
  Square,
  WifiHigh,
  X,
} from "@phosphor-icons/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
} from "recharts";

const links = [
  {
    id: "harbor",
    name: "Harbor relay downlink",
    source: "UDP · 9104",
    decoder: "NSL-01",
    status: "Live",
    signal: "−72 dBm",
    quality: "good",
  },
  {
    id: "ridge",
    name: "Ridge rover uplink",
    source: "UDP · 9201",
    decoder: "NSL-02",
    status: "Idle",
    signal: "−98 dBm",
    quality: "warn",
  },
  {
    id: "buoy",
    name: "Buoy gateway",
    source: "UDP · 9300",
    decoder: "NSL-03",
    status: "Idle",
    signal: "−104 dBm",
    quality: "muted",
  },
];

const recentSessions = [
  ["Harbor relay downlink", "Jul 14, 2026", "3h 12m"],
  ["Ridge rover uplink", "Jul 14, 2026", "1h 08m"],
  ["Harbor relay downlink", "Jul 13, 2026", "2h 41m"],
  ["Buoy gateway", "Jul 13, 2026", "4h 05m"],
  ["Ridge rover uplink", "Jul 12, 2026", "2h 22m"],
];

const incidents = [
  {
    id: "fade",
    left: 23,
    width: 32,
    overviewLeft: 67,
    overviewWidth: 5,
    start: "23:40:01.502",
    end: "23:42:31.884",
    duration: "2m 30.382s",
    title: "Link fade and recovery with decoder resync",
    summary: "A short RF fade caused sustained frame loss. NSL-01 entered resync, recovered boundary lock, and returned to nominal decode.",
    events: [
      ["23:40:01", "Link quality degraded", "RSSI fell from −66 dBm to −96 dBm. Throughput dropped 72%.", "amber"],
      ["23:40:18", "Frame loss increase", "Dropped frames peaked at 9.3%. Thermal frame arrived late.", "red"],
      ["23:40:57", "Decoder resync", "NSL-01 entered resync search. Partial frames observed.", "amber"],
      ["23:41:38", "Loss burst", "Sustained loss burst for 21s. Jitter peaked at 95 ms.", "red"],
      ["23:42:07", "Recovery", "RSSI improved to −70 dBm. Loss < 1%, jitter 26 ms.", "green"],
      ["23:42:22", "Decoder locked", "NSL-01 locked to v1.3.7. All packet families nominal.", "green"],
    ],
  },
  {
    id: "interference",
    left: 9,
    width: 19,
    overviewLeft: 22,
    overviewWidth: 4,
    start: "22:17:44.090",
    end: "22:19:11.622",
    duration: "1m 27.532s",
    title: "Interference burst with partial packet recovery",
    summary: "A narrow interference burst raised jitter and damaged three frames. The decoder preserved valid payloads and isolated two incomplete boundaries.",
    events: [
      ["22:17:44", "Noise floor increased", "RSSI variance widened by 18 dB over four seconds.", "amber"],
      ["22:17:51", "Jitter threshold", "Network jitter crossed 80 ms for the first time.", "red"],
      ["22:18:03", "Partial frame", "Boundary marker missing from packet 0x31.", "red"],
      ["22:18:26", "Payload recovered", "Known-length rule recovered 28 payload bytes.", "green"],
      ["22:19:11", "Signal stabilized", "Noise floor returned to baseline; no packet loss.", "green"],
    ],
  },
  {
    id: "schema",
    left: 62,
    width: 18,
    overviewLeft: 52,
    overviewWidth: 4,
    start: "23:07:12.413",
    end: "23:08:28.041",
    duration: "1m 15.628s",
    title: "Decoder schema change with clean reprocessing",
    summary: "The operator moved NSL-01 from schema v1.3.6 to v1.3.7. Historical frames were reprocessed and field confidence returned to 100%.",
    events: [
      ["23:07:12", "Schema staged", "v1.3.7 loaded locally and passed validation.", "amber"],
      ["23:07:24", "Decoder paused", "Incoming frames buffered while rules changed.", "amber"],
      ["23:07:43", "Schema activated", "NSL-01 began decoding with v1.3.7.", "green"],
      ["23:08:01", "Replay complete", "1,284 buffered frames reprocessed without errors.", "green"],
      ["23:08:28", "Live follow resumed", "All packet families nominal.", "green"],
    ],
  },
];

const initialBundleItems = [
  { id: "raw", name: "Raw capture (PCAP)", description: "Lossless capture of UDP :9104", source: "Local", size: 18.2, displaySize: "18.2 MB", selected: true },
  { id: "csv", name: "Decoded packets (CSV)", description: "All decoded packets in time range", source: "NSL-01 v1.3.7", size: 3.1, displaySize: "3.1 MB", selected: true },
  { id: "schema", name: "Decoder schema", description: "Decoder definition and version", source: "NSL-01 v1.3.7", size: 0.21, displaySize: "210 KB", selected: true },
  { id: "diagnostics", name: "Diagnostics summary (JSON)", description: "Link quality, jitter, loss, events", source: "Local", size: 0.62, displaySize: "620 KB", selected: true },
  { id: "notes", name: "Operator notes (TXT)", description: "Notes and field observations", source: "Local", size: 0.003, displaySize: "3 KB", selected: true },
];

const familyRows = [
  ["Position (0x31)", "#8bc879", "0%", "61%"],
  ["Power (0x17)", "#6398d6", "0%", "100%"],
  ["Thermal (0x44)", "#f2a900", "0%", "100%"],
  ["Attitude (0x19)", "#8a78d6", "0%", "100%"],
  ["Heartbeat (0x02)", "#53b8b7", "0%", "100%"],
];

function makeTimelineData() {
  return Array.from({ length: 84 }, (_, i) => {
    const inFade = i >= 21 && i <= 48;
    const recovery = i > 48 && i < 61;
    const fadeDepth = inFade ? Math.sin(((i - 21) / 27) * Math.PI) : 0;
    const rssi = -67 - fadeDepth * 29 + Math.sin(i * 1.7) * 2.5;
    const throughput = inFade
      ? 12 + Math.abs(Math.sin(i * 0.8)) * 18
      : recovery
        ? 36 + (i - 48) * 2.4
        : 68 + Math.sin(i * 0.43) * 12 + Math.sin(i * 1.9) * 7;
    const loss = inFade ? 1.2 + fadeDepth * 8.1 + Math.abs(Math.sin(i * 0.7)) : recovery ? Math.max(0, 3.4 - (i - 48) * 0.3) : Math.max(0, Math.sin(i * 0.9) * 0.25);
    return {
      t: i,
      rssi,
      throughput: Math.max(2, throughput),
      loss,
      lat: 47.267 + Math.sin(i * 0.12) * 0.018 + Math.sin(i * 2.7) * 0.0016 - fadeDepth * 0.01,
      lon: -122.55 + Math.cos(i * 0.1) * 0.025 + Math.sin(i * 2.2) * 0.0019 - fadeDepth * 0.012,
      alt: 185 + Math.sin(i * 0.1) * 128 + Math.sin(i * 2.35) * 4.5 + fadeDepth * 32,
    };
  });
}

const timelineData = makeTimelineData();

function calculateBundleSize(items) {
  const selected = items.filter((item) => item.selected);
  if (!selected.length) return 0;
  const artifactSize = selected.reduce((sum, item) => sum + item.size, 0);
  return artifactSize + 2.567;
}

function StatusBars({ quality }) {
  return (
    <WifiHigh className={`status-bars ${quality}`} size={20} weight="bold" aria-label={`${quality} signal`} />
  );
}

function LeftRail({ activeLink, setActiveLink }) {
  const current = links.find((link) => link.id === activeLink) ?? links[0];

  return (
    <aside className="left-rail">
      <div className="brand-lockup">
        <img src="/narrowslink-mark.svg" alt="NarrowsLink" />
        <div>
          <strong>NarrowsLink</strong>
          <span>Local-first telemetry</span>
        </div>
      </div>

      <div className="rail-scroll">
        <section className="rail-section sessions-heading">
          <div className="section-kicker-row">
            <span>Sessions</span>
            <button className="icon-button" aria-label="New session"><Plus size={15} /></button>
          </div>
          <div className="session-filter">
            <button>All sessions <CaretDown size={13} /></button>
            <button className="filter-button" aria-label="Filter sessions"><FunnelSimple size={15} /></button>
          </div>
        </section>

        <section className="rail-section active-links">
          <div className="section-kicker-row">
            <span>Active links</span>
            <b>{links.length}</b>
          </div>
          <div className="link-list">
            {links.map((link) => (
              <button
                className={`link-row ${activeLink === link.id ? "selected" : ""}`}
                key={link.id}
                onClick={() => setActiveLink(link.id)}
              >
                <RadioButton size={13} weight="fill" />
                <span className="link-copy">
                  <strong>{link.name}</strong>
                  <small>{link.source} <i>•</i> {link.decoder}</small>
                  <small>{link.status} <i>•</i> {link.signal}</small>
                </span>
                <StatusBars quality={link.quality} />
              </button>
            ))}
          </div>
        </section>

        <section className="rail-section recent-sessions">
          <div className="section-kicker-row"><span>Recent sessions</span></div>
          {recentSessions.map(([name, date, duration]) => (
            <button className="recent-row" key={`${name}-${date}`}>
              <span><strong>{name}</strong><small>{date} <i>•</i> {duration}</small></span>
              <CaretRight size={13} />
            </button>
          ))}
        </section>

        <section className="rail-section session-info">
          <div className="section-kicker-row"><span>Session info</span></div>
          <dl>
            <div><dt>Source</dt><dd>{current.source.replace(" · ", " :")}</dd></div>
            <div><dt>Decoder</dt><dd>{current.decoder}</dd></div>
            <div><dt>Schema</dt><dd>v1.3.7</dd></div>
            <div><dt>Frames</dt><dd>18,402</dd></div>
            <div><dt>Dropped</dt><dd>7 (0.04%)</dd></div>
            <div><dt>Start</dt><dd>Jul 15, 21:38:12</dd></div>
            <div><dt>End</dt><dd>Jul 15, 23:58:47</dd></div>
            <div><dt>Duration</dt><dd>2h 20m 35s</dd></div>
            <div><dt>Saved</dt><dd className="saved"><Circle size={7} weight="fill" /> Local only</dd></div>
          </dl>
        </section>
      </div>

      <button className="settings-button"><Gear size={16} /> Session settings</button>
    </aside>
  );
}

function TopBar({ sessionName, isFollowing, setIsFollowing, onAddMarker, onCreateBundle, bundleDisabled }) {
  return (
    <header className="topbar">
      <div className="session-title">
        <span>Session review <i>•</i> Recorded</span>
        <div><h1>{sessionName}</h1><NotePencil size={15} /></div>
      </div>
      <div className="session-meta">Jul 15, 2026 <i>•</i> 21:38:12 – 23:58:47 PDT <i>•</i> 2h 20m 35s</div>
      <div className="header-actions">
        <button className={`secondary-action ${isFollowing ? "active" : ""}`} onClick={() => setIsFollowing((value) => !value)}>
          {isFollowing ? <Pause size={15} weight="fill" /> : <Broadcast size={16} />}
          {isFollowing ? "Following live" : "Live follow"}
        </button>
        <button className="secondary-action" onClick={onAddMarker}><BookmarkSimple size={16} /> Add marker</button>
        <button className="primary-action" disabled={bundleDisabled} onClick={onCreateBundle}><DownloadSimple size={17} /> Create incident bundle</button>
        <button className="primary-split" disabled={bundleDisabled} aria-label="Incident bundle options"><CaretDown size={14} /></button>
      </div>
    </header>
  );
}

function SessionOverview({ incident }) {
  return (
    <section className="overview" aria-label="Session overview">
      <div className="overview-title"><span>Session overview</span><div><i className="legend green" /> Link quality <i className="legend blue" /> Throughput <i className="legend red" /> Dropped frames <i className="legend purple" /> Markers</div></div>
      <div className="overview-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={timelineData} margin={{ top: 5, right: 2, bottom: 2, left: 2 }}>
            <Bar dataKey="throughput" fill="#6398d6" opacity={0.78} isAnimationActive={false} />
            <Line type="linear" dataKey="rssi" stroke="#8bc879" strokeWidth={1.2} dot={false} isAnimationActive={false} />
            <Line type="linear" dataKey="loss" stroke="#ea6f66" strokeWidth={1} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="overview-marker-strip"><span /><span /><span /><span /><span /></div>
        {incident && <div className="overview-selection" style={{ left: `${incident.overviewLeft}%`, width: `${incident.overviewWidth}%` }} />}
        <div className="overview-times"><span>21:30</span><span>22:00</span><span>22:30</span><span>23:00</span><span>23:40</span><span>00:00</span></div>
      </div>
    </section>
  );
}

function PlotLane({ label, unit, value, children, className = "" }) {
  return (
    <div className={`plot-lane ${className}`}>
      <div className="lane-label"><CaretDown size={10} weight="fill" /><span><strong>{label}</strong>{unit && <small>{unit}</small>}</span></div>
      <div className="lane-plot">{children}</div>
      {value && <span className="lane-value">{value}</span>}
    </div>
  );
}

function SignalChart({ dataKey, color, domain, bar = false }) {
  if (bar) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={timelineData} margin={{ top: 3, right: 0, bottom: 2, left: 0 }}>
          <CartesianGrid vertical horizontal={false} stroke="#242824" strokeDasharray="1 0" />
          <Bar dataKey={dataKey} fill={color} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={timelineData} margin={{ top: 5, right: 0, bottom: 5, left: 0 }}>
        <CartesianGrid vertical horizontal={false} stroke="#242824" strokeDasharray="1 0" />
        <Line type="linear" dataKey={dataKey} stroke={color} strokeWidth={1.3} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function MissionTimeline({ incident, setIncident, markerCount }) {
  const selectRange = (id) => setIncident(incidents.find((item) => item.id === id) ?? incidents[0]);

  return (
    <section className="timeline-panel" aria-label="Mission telemetry timeline">
      <div className="time-ruler">
        <span className="time-zone">Time (PDT)</span>
        <div className="time-buttons">
          <button onClick={() => selectRange("interference")}>23:38</button>
          <button>23:39</button>
          <button className={incident?.id === "fade" ? "active" : ""} onClick={() => selectRange("fade")}>23:40</button>
          <button onClick={() => selectRange("schema")}>23:41</button>
          <button>23:42</button>
          <button>23:43</button>
          <button>23:45</button>
        </div>
      </div>

      <div className="timeline-stack">
        <div className="shared-grid" aria-hidden="true" />
        {incident && (
          <div className="selection-band" style={{ left: `calc(var(--label-gutter) + (100% - var(--label-gutter)) * ${incident.left / 100})`, width: `calc((100% - var(--label-gutter)) * ${incident.width / 100})` }}>
            <button className="selection-chip" onClick={() => selectRange(incident.id)}>
              <BookmarkSimple size={12} weight="fill" /> {incident.start} <span>–</span> {incident.end} <small>({incident.duration})</small>
            </button>
          </div>
        )}

        <PlotLane label="Connection" unit="RSSI (dBm)" value="−72">
          <SignalChart dataKey="rssi" color="#8bc879" domain={[-110, -40]} />
        </PlotLane>
        <PlotLane label="Throughput" unit="pkt/s (1s avg)" value="48">
          <SignalChart dataKey="throughput" color="#6398d6" domain={[0, 100]} bar />
        </PlotLane>
        <PlotLane label="Packet loss" unit="drop % (1s avg)" value="0.04%">
          <SignalChart dataKey="loss" color="#ea6f66" domain={[0, 10]} bar />
        </PlotLane>

        <PlotLane label="Packet families" className="families-lane">
          <div className="family-list">
            {familyRows.map(([name, color, left, width]) => (
              <div className="family-row" key={name}>
                <span><i style={{ background: color }} />{name}</span>
                <b style={{ background: color, left, width }} />
              </div>
            ))}
          </div>
        </PlotLane>

        <PlotLane label="Decoder" unit="NSL-01" className="event-lane">
          <div className="decoder-track">
            <span className="decoder-locked">Locked v1.3.7</span>
            {incident && <span className="decoder-resync" style={{ left: `${incident.left}%`, width: `${incident.width}%` }}>Resync search <small>partial frames</small></span>}
            <span className="decoder-recovered">Locked v1.3.7</span>
          </div>
        </PlotLane>

        <PlotLane label="Diagnostics" className="event-lane">
          <div className="event-track diagnostics-track">
            <button style={{ left: "8%" }}>Jitter ↑ <small>41 ms</small></button>
            <button style={{ left: "25%" }}>Jitter ↑↑ <small>95 ms</small></button>
            <button style={{ left: "39%" }}>Loss burst</button>
            <button style={{ left: "52%" }}>Recovered <small>Jitter 26 ms</small></button>
          </div>
        </PlotLane>

        <PlotLane label="Markers" className="event-lane">
          <div className="event-track marker-track">
            <button style={{ left: "2%" }}><BookmarkSimple size={12} weight="fill" /> Field note <small>Tower check</small></button>
            <button style={{ left: "35%" }}><BookmarkSimple size={12} weight="fill" /> Interference <small>observed</small></button>
            <button style={{ left: "61%" }}><BookmarkSimple size={12} weight="fill" /> Antenna <small>re-aimed</small></button>
            {markerCount > 3 && <button className="new-marker" style={{ left: "76%" }}><BookmarkSimple size={12} weight="fill" /> New marker <small>23:45:00</small></button>}
          </div>
        </PlotLane>

        <PlotLane label="Latitude" unit="deg" value="47.2672">
          <SignalChart dataKey="lat" color="#8bc879" domain={[47.23, 47.30]} />
        </PlotLane>
        <PlotLane label="Longitude" unit="deg" value="−122.5514">
          <SignalChart dataKey="lon" color="#8bc879" domain={[-122.59, -122.50]} />
        </PlotLane>
        <PlotLane label="Altitude" unit="m" value="184">
          <SignalChart dataKey="alt" color="#8bc879" domain={[0, 400]} />
        </PlotLane>
      </div>
    </section>
  );
}

function IncidentPanel({ incident, activeTab, setActiveTab, note, setNote, onClear, isFollowing }) {
  if (!incident) {
    return (
      <aside className="incident-panel empty-incident">
        <div className="incident-heading"><div><BookmarkSimple size={14} /><span>Incident selection</span></div></div>
        <div className="empty-state"><ClockCounterClockwise size={24} /><h2>{isFollowing ? "Following live telemetry" : "No incident selected"}</h2><p>{isFollowing ? "Incident selection and export are paused while the workspace follows the live edge." : "Choose a time marker above to review a recorded incident and prepare a handoff bundle."}</p></div>
      </aside>
    );
  }

  return (
    <aside className="incident-panel">
      <div className="incident-heading">
        <div><BookmarkSimple size={14} weight="fill" /><span>Incident selection</span></div>
        <button className="icon-button" aria-label="Clear incident" onClick={onClear}><X size={15} /></button>
      </div>
      <div className="incident-range"><strong>{incident.start} – {incident.end}</strong><span>{incident.duration}</span></div>
      <div className="incident-tabs" role="tablist">
        {["Narrative", "Details", "Stats"].map((tab) => (
          <button key={tab} className={activeTab === tab.toLowerCase() ? "active" : ""} onClick={() => setActiveTab(tab.toLowerCase())}>{tab}</button>
        ))}
      </div>

      {activeTab === "narrative" && (
        <div className="narrative-view">
          <h2>{incident.title}</h2>
          <ol className="event-narrative">
            {incident.events.map(([time, title, description, tone]) => (
              <li key={`${time}-${title}`} className={tone}>
                <time>{time}</time>
                <div><strong>{title}</strong><p>{description}</p></div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {activeTab === "details" && (
        <dl className="details-view">
          <div><dt>Source</dt><dd>UDP :9104</dd></div>
          <div><dt>Decoder</dt><dd>NSL-01 v1.3.7</dd></div>
          <div><dt>Frames in range</dt><dd>1,284</dd></div>
          <div><dt>Dropped</dt><dd className="danger">119</dd></div>
          <div><dt>Peak loss</dt><dd className="danger">9.3%</dd></div>
          <div><dt>Lowest RSSI</dt><dd>−96 dBm</dd></div>
          <div><dt>Peak jitter</dt><dd>95 ms</dd></div>
          <div><dt>Schema</dt><dd>v1.3.7</dd></div>
        </dl>
      )}

      {activeTab === "stats" && (
        <div className="stats-view">
          <div><span>Link availability</span><strong>91.2%</strong><i><b style={{ width: "91.2%" }} /></i></div>
          <div><span>Decode confidence</span><strong>96.8%</strong><i><b style={{ width: "96.8%" }} /></i></div>
          <div><span>Frames recovered</span><strong>74</strong><i><b style={{ width: "74%" }} /></i></div>
          <div><span>Evidence completeness</span><strong>100%</strong><i><b style={{ width: "100%" }} /></i></div>
        </div>
      )}

      <div className="operator-notes">
        <div><span>Operator notes</span><button className="icon-button" aria-label="Edit notes"><NotePencil size={14} /></button></div>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} aria-label="Operator notes" />
        <small>— Field Op, Jul 15, 23:45 PDT</small>
      </div>
    </aside>
  );
}

function BundlePanel({ incident, items, setItems, note, setNote, onCreateBundle, bundleRef }) {
  const selectedItems = items.filter((item) => item.selected);
  const size = calculateBundleSize(items);

  const toggleItem = (id) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, selected: !item.selected } : item));
  };

  return (
    <section className="bundle-panel" ref={bundleRef} aria-label="Incident bundle preview">
      <div className="bundle-summary">
        <div><span>Incident bundle preview</span><p>Everything needed to reproduce and investigate this incident.</p></div>
        <dl>
          <div><dt>Time range</dt><dd>{incident ? <>{incident.start} – {incident.end}<small>{incident.duration}</small></> : <span className="no-selection-copy">No incident selected</span>}</dd></div>
          <div><dt>Size (est.)</dt><dd>{size.toFixed(1)} MB</dd></div>
          <div><dt>Files</dt><dd>{selectedItems.length}</dd></div>
        </dl>
        <button className="primary-action bundle-create" disabled={!incident || !selectedItems.length} onClick={onCreateBundle}><DownloadSimple size={17} /> Create incident bundle</button>
      </div>

      <div className="bundle-body">
        <div className="bundle-table-wrap">
          <div className="bundle-table-head"><span>Include</span><span>Item</span><span>Description</span><span>Source</span><span>Size (est.)</span></div>
          <div className="bundle-table">
            {items.map((item) => (
              <button disabled={!incident} className={!item.selected ? "excluded" : ""} key={item.id} onClick={() => toggleItem(item.id)}>
                <span className="checkbox">{item.selected ? <CheckSquare size={15} weight="fill" /> : <Square size={15} />}</span>
                <strong>{item.name}</strong>
                <span>{item.description}</span>
                <span>{item.source}</span>
                <span>{item.displaySize}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="bundle-notes">
          <span>Notes for bundle</span>
          <small>Include any additional context for the recipient.</small>
          <textarea disabled={!incident} value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
          <b>{note.length} / 2000</b>
        </label>
      </div>
    </section>
  );
}

function BundleDialog({ incident, items, note, onClose }) {
  const [created, setCreated] = useState(false);
  const selected = items.filter((item) => item.selected);
  const size = calculateBundleSize(items).toFixed(1);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="bundle-dialog" role="dialog" aria-modal="true" aria-labelledby="bundle-dialog-title">
        <button className="dialog-close" aria-label="Close" onClick={onClose}><X size={17} /></button>
        {!created ? (
          <>
            <div className="dialog-icon"><Package size={24} /></div>
            <span className="dialog-kicker">Incident bundle</span>
            <h2 id="bundle-dialog-title">Package this incident for handoff?</h2>
            <p>NarrowsLink will collect the selected evidence without changing the original session.</p>
            <dl className="dialog-summary">
              <div><dt>Range</dt><dd>{incident.start} – {incident.end}</dd></div>
              <div><dt>Contents</dt><dd>{selected.length} files · {size} MB</dd></div>
              <div><dt>Operator note</dt><dd>{note ? "Included" : "None"}</dd></div>
            </dl>
            <div className="dialog-actions"><button className="secondary-action" onClick={onClose}>Cancel</button><button className="primary-action" onClick={() => setCreated(true)}><DownloadSimple size={17} /> Create bundle</button></div>
          </>
        ) : (
          <div className="dialog-success">
            <div className="success-mark"><Check size={28} weight="bold" /></div>
            <span className="dialog-kicker">Prototype bundle ready</span>
            <h2 id="bundle-dialog-title">Mock incident bundle prepared</h2>
            <p><strong>harbor-relay_2026-07-15_234001.nlb</strong> previews the capture slice, decoded evidence, schema, diagnostics, and notes that a production export would contain.</p>
            <button className="primary-action" onClick={onClose}>Return to session</button>
          </div>
        )}
      </section>
    </div>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return <div className="toast"><Check size={15} weight="bold" /> {message}</div>;
}

export function App() {
  const [activeLink, setActiveLink] = useState("harbor");
  const [incident, setIncident] = useState(incidents[0]);
  const [activeTab, setActiveTab] = useState("narrative");
  const [isFollowing, setIsFollowing] = useState(false);
  const [markerCount, setMarkerCount] = useState(3);
  const [bundleItems, setBundleItems] = useState(initialBundleItems);
  const [bundleDialogOpen, setBundleDialogOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [note, setNote] = useState("Likely multipath from ferry. Antenna re-aimed 5° up. Recommend checking tower guy-wire clearance.");
  const bundleRef = useRef(null);

  const sessionName = useMemo(() => links.find((link) => link.id === activeLink)?.name ?? links[0].name, [activeLink]);
  const visibleIncident = isFollowing ? null : incident;

  const addMarker = () => {
    setMarkerCount((count) => count + 1);
    setToast("Marker added at 23:45:00.118");
    window.setTimeout(() => setToast(""), 2400);
  };

  const openBundle = () => {
    if (visibleIncident && bundleItems.some((item) => item.selected)) setBundleDialogOpen(true);
  };

  return (
    <main className="app-shell">
      <LeftRail activeLink={activeLink} setActiveLink={setActiveLink} />
      <TopBar sessionName={sessionName} isFollowing={isFollowing} setIsFollowing={setIsFollowing} onAddMarker={addMarker} onCreateBundle={openBundle} bundleDisabled={!visibleIncident || !bundleItems.some((item) => item.selected)} />
      <SessionOverview incident={visibleIncident} />
      <MissionTimeline incident={visibleIncident} setIncident={setIncident} markerCount={markerCount} />
      <IncidentPanel incident={visibleIncident} activeTab={activeTab} setActiveTab={setActiveTab} note={note} setNote={setNote} onClear={() => setIncident(null)} isFollowing={isFollowing} />
      <BundlePanel incident={visibleIncident} items={bundleItems} setItems={setBundleItems} note={note} setNote={setNote} onCreateBundle={openBundle} bundleRef={bundleRef} />
      {bundleDialogOpen && visibleIncident && <BundleDialog incident={visibleIncident} items={bundleItems} note={note} onClose={() => setBundleDialogOpen(false)} />}
      <Toast message={toast} />
    </main>
  );
}
