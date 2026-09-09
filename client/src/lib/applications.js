/**
 * Everything the dashboard derives from the raw `jobs` rows: the parsed
 * inbox timeline, the funnel model, the contribution calendar and the
 * headline stats. Kept out of the components so each one only renders.
 */

export const STAGES = ["Applied", "Interviewing", "Offer", "Rejected"];

/** Per-stage badge palette (text / fill / border / icon) from the handoff. */
export const BADGE = {
  Applied: {
    fg: "oklch(0.82 0.13 300)",
    bg: "oklch(0.34 0.10 300 / 0.55)",
    bd: "oklch(0.46 0.13 300)",
    dash: "",
    path: "M12 6.5v6l2.6 3.4",
  },
  Interviewing: {
    fg: "oklch(0.86 0.14 88)",
    bg: "oklch(0.34 0.08 88 / 0.42)",
    bd: "oklch(0.48 0.11 88)",
    dash: "3.6 3.6",
    path: "",
  },
  Offer: {
    fg: "oklch(0.84 0.15 150)",
    bg: "oklch(0.32 0.09 150 / 0.45)",
    bd: "oklch(0.46 0.12 150)",
    dash: "",
    path: "m8.6 12.2 2.3 2.3 4.5-4.7",
  },
  Rejected: {
    fg: "oklch(0.78 0.11 25)",
    bg: "oklch(0.32 0.07 25 / 0.45)",
    bd: "oklch(0.45 0.10 25)",
    dash: "",
    path: "m15 9-6 6M9 9l6 6",
  },
};

export const CAL_SHADES = [
  "oklch(0.245 0.022 300)",
  "oklch(0.38 0.10 300)",
  "oklch(0.50 0.155 300)",
  "oklch(0.61 0.195 300)",
  "oklch(0.73 0.20 300)",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_MS = 86400000;

/** Local-date ISO (YYYY-MM-DD). `toISOString` would shift by the tz offset. */
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parses YYYY-MM-DD as local midnight rather than UTC midnight. */
export function fromISODate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function formatShort(iso) {
  const date = fromISODate(iso);
  if (!date) return "";
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function formatLong(iso) {
  const date = fromISODate(iso);
  if (!date) return "";
  return `${MONTHS_LONG[date.getMonth()]} ${date.getDate()}`;
}

export function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

const NOTE_LINE = /^\[([^\]]+)\]\s*(.*)$/;

/**
 * The sync writer appends one line per parsed email, e.g.
 *   [2026-08-29] Interviewing — Assessment/OA (ref: R-40218) [via third-party screener]
 * Older lines use a short "[Aug 29]" date. Anything without a bracketed
 * date is a hand-written note and is dated to the application itself.
 */
export function parseEvents(notes, fallbackISO) {
  if (!notes) return [];

  return String(notes)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(NOTE_LINE);
      if (!match) {
        return { key: index, iso: fallbackISO || null, date: formatShort(fallbackISO), text: line };
      }
      const [, rawDate, text] = match;
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
      return {
        key: index,
        iso,
        date: iso ? formatShort(iso) : rawDate,
        text: text || "Update",
      };
    });
}

/** Strips the machine-readable fragments for the one-line summary. */
export function cleanEventText(text) {
  return text
    .replace(/\s*\(ref:[^)]*\)/gi, "")
    .replace(/\s*\[via[^\]]*\]/gi, "")
    .trim();
}

/** Normalizes a `jobs` row into the shape every view below expects. */
export function toApplication(job) {
  const date = job.application_date ? String(job.application_date).slice(0, 10) : null;
  const events = parseEvents(job.notes, date);
  return {
    id: job.id,
    company: job.company_name || "Unknown company",
    title: job.job_title || "Unknown title",
    status: STAGES.includes(job.status) ? job.status : "Applied",
    date,
    notes: job.notes || "",
    archived: Boolean(job.archived),
    events,
  };
}

export function sortByDateDesc(apps) {
  return [...apps].sort((a, b) => {
    if (a.date === b.date) return b.id - a.id;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? 1 : -1;
  });
}

export function stageCounts(apps) {
  const counts = { All: apps.length };
  STAGES.forEach((stage) => {
    counts[stage] = apps.filter((a) => a.status === stage).length;
  });
  return counts;
}

/* ---------------------------------------------------------------- funnel */

export function sankeyModel(apps) {
  const count = (predicate) => apps.filter(predicate).length;
  const total = apps.length;
  const rejected = count((a) => a.status === "Rejected");
  const offer = count((a) => a.status === "Offer");
  const inProgress = count((a) => a.status === "Interviewing");
  const interview = offer + inProgress;
  const reviewed = rejected + interview;
  const noResponse = Math.max(total - reviewed, 0);

  const nodes = [
    { id: "apps", col: 0, label: "Applications", value: total, color: "oklch(0.62 0.19 300)" },
    { id: "rev", col: 1, label: "Reviewed", value: reviewed, color: "oklch(0.68 0.16 300)" },
    { id: "nores", col: 1, label: "No response", value: noResponse, color: "oklch(0.54 0.025 300)" },
    { id: "int", col: 2, label: "Interview", value: interview, color: "oklch(0.74 0.14 300)" },
    { id: "rej", col: 2, label: "Rejected", value: rejected, color: "oklch(0.66 0.13 25)" },
    { id: "prog", col: 3, label: "Still in loop", value: inProgress, color: "oklch(0.82 0.15 88)" },
    { id: "off", col: 3, label: "Offer", value: offer, color: "oklch(0.80 0.15 150)" },
    { id: "pend", col: 4, label: "Pending decision", value: offer, color: "oklch(0.84 0.16 150)" },
  ];

  const links = [
    ["apps", "rev", reviewed],
    ["apps", "nores", noResponse],
    ["rev", "int", interview],
    ["rev", "rej", rejected],
    ["int", "prog", inProgress],
    ["int", "off", offer],
    ["off", "pend", offer],
  ];

  return {
    nodes: nodes.filter((n) => n.value > 0),
    links: links.filter(([, , value]) => value > 0),
    total,
  };
}

export const SANKEY_BOX = { width: 944, height: 372, marginLeft: 116, marginTop: 34 };

/**
 * Lays the funnel out: one 10px bar per node, columns evenly spaced across
 * a 690x292 drawing area, ribbons as cubic Beziers whose control points sit
 * at the horizontal midpoint. Labels are positioned in CSS pixels on top of
 * the SVG (HTML type renders crisper than SVG <text>).
 */
export function buildSankey(apps) {
  const model = sankeyModel(apps);
  const { width: BOXW, marginLeft: ML, marginTop: MT } = SANKEY_BOX;
  const W = 690;
  const H = 292;
  const NW = 10;
  const GAP = 22;
  const COLS = 5;

  const k = (H - GAP * 2) / Math.max(model.total, 1);
  const placed = {};

  for (let col = 0; col < COLS; col++) {
    const inColumn = model.nodes.filter((n) => n.col === col);
    if (!inColumn.length) continue;

    const stackHeight =
      inColumn.reduce((sum, n) => sum + Math.max(n.value * k, 5), 0) + GAP * (inColumn.length - 1);
    let y = (H - stackHeight) / 2;

    inColumn.forEach((node) => {
      const h = Math.max(node.value * k, 5);
      const x = col * ((W - NW) / (COLS - 1));
      const isFirst = col === 0;
      const isLast = col === COLS - 1;

      // Horizontal offsets stay in px (the shell is a fixed 1240 wide), but
      // the box can lose height on a short viewport — so anchor labels to a
      // percentage of the box and keep the px nudge outside the scaling.
      const pct = (value) => `${(value / SANKEY_BOX.height) * 100}%`;
      const position = isFirst
        ? {
            right: BOXW - (ML + x - 14),
            top: `calc(${pct(MT + y + h / 2)} - 20px)`,
            alignItems: "flex-end",
          }
        : isLast
          ? {
              left: ML + x + NW + 14,
              top: `calc(${pct(MT + y + h / 2)} - 20px)`,
              alignItems: "flex-start",
            }
          : // 36px clears the full two-line stack, so the value doesn't sit
            // behind the top of the node bar.
            { left: ML + x, top: `calc(${pct(MT + y)} - 36px)`, alignItems: "flex-start" };

      placed[node.id] = { ...node, x, y, h, outY: y, inY: y, position };
      y += h + GAP;
    });
  }

  const links = model.links.map(([sourceId, targetId, value]) => {
    const source = placed[sourceId];
    const target = placed[targetId];
    const h = Math.max(value * k, 3);
    const x0 = source.x + NW;
    const x1 = target.x;
    const y0 = source.outY;
    const y1 = target.inY;
    source.outY += h;
    target.inY += h;
    const xm = (x0 + x1) / 2;
    return {
      id: `${sourceId}-${targetId}`,
      fill: target.color,
      d: `M${x0} ${y0} C${xm} ${y0}, ${xm} ${y1}, ${x1} ${y1} L${x1} ${y1 + h} C${xm} ${y1 + h}, ${xm} ${y0 + h}, ${x0} ${y0 + h} Z`,
    };
  });

  return { nodes: model.nodes.map((n) => placed[n.id]), links };
}

/* -------------------------------------------------------------- calendar */

export const CALENDAR_WEEKS = 10;

/**
 * GitHub-style contribution grid: one column per week, row index = weekday,
 * last column is the current week.
 */
export function buildCalendar(apps, weeks = CALENDAR_WEEKS) {
  const today = startOfToday();
  const perDay = {};
  apps.forEach((app) => {
    if (!app.date) return;
    perDay[app.date] = (perDay[app.date] || 0) + 1;
  });

  const start = new Date(today);
  start.setDate(start.getDate() - today.getDay() - (weeks - 1) * 7);

  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    const iso = toISODate(day);
    const future = day > today;
    const raw = perDay[iso] || 0;
    const n = Math.min(raw, 4);

    cells.push({
      iso,
      n: raw,
      future,
      background: future ? "oklch(0.20 0.018 300)" : CAL_SHADES[n],
      glow:
        n >= 2
          ? "0 0 10px oklch(0.62 0.20 300 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.12)"
          : "inset 0 1px 0 oklch(1 0 0 / 0.05)",
      tip: `${MONTHS[day.getMonth()]} ${day.getDate()} · ${
        raw === 0 ? "no applications" : `${raw} application${raw === 1 ? "" : "s"}`
      }`,
    });
  }

  const weekTotals = [];
  for (let w = 0; w * 7 < cells.length; w++) {
    weekTotals.push(cells.slice(w * 7, w * 7 + 7).reduce((sum, c) => sum + c.n, 0));
  }

  return {
    cells,
    weeks,
    busiestWeek: weekTotals.length ? Math.max(...weekTotals) : 0,
    activeDays: cells.filter((c) => c.n > 0).length,
  };
}

/* ----------------------------------------------------------------- stats */

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Days from applying to the first inbox event that lands after the applied
 * date. Approximate by design — the handoff flags a real
 * `first_response_at` column as the exact version of this.
 */
function daysToFirstReply(app) {
  if (!app.date) return null;
  const applied = fromISODate(app.date);
  const replies = app.events
    .map((event) => fromISODate(event.iso))
    .filter((date) => date && date > applied);
  if (!replies.length) return null;
  const first = replies.reduce((min, date) => (date < min ? date : min));
  return Math.round((first - applied) / DAY_MS);
}

export function headlineStats(apps) {
  const counts = stageCounts(apps);
  const total = apps.length;
  const heardBack = apps.filter((a) => a.events.length > 1).length;
  const replyRate = total ? Math.round((heardBack / total) * 100) : 0;
  const medianReply = median(apps.map(daysToFirstReply).filter((d) => d !== null));

  return [
    {
      key: "applications",
      label: "Applications",
      value: total,
      note: "all time",
      color: "oklch(0.94 0.01 300)",
    },
    {
      key: "live",
      label: "Still live",
      value: counts.Applied + counts.Interviewing + counts.Offer,
      note: `${counts.Interviewing} interviewing`,
      color: "oklch(0.84 0.11 300)",
    },
    {
      key: "reply-rate",
      label: "Reply rate",
      value: `${replyRate}%`,
      note: "heard back at least once",
      color: "oklch(0.84 0.12 88)",
    },
    {
      key: "median-reply",
      label: "Median reply",
      value: medianReply === null ? "—" : `${medianReply} day${medianReply === 1 ? "" : "s"}`,
      note: "send to first response",
      color: "oklch(0.82 0.12 150)",
    },
  ];
}

export function parsedEventCount(apps) {
  return apps.reduce((sum, app) => sum + app.events.length, 0);
}

/** "just now" / "12 min ago" / "3 days ago" for the rail's sync card. */
export function relativeTime(epochSeconds) {
  if (!epochSeconds) return "never synced";
  const seconds = Math.floor(Date.now() / 1000) - epochSeconds;
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Whole days since the application was sent, 1-based like the design. */
export function daysSince(iso) {
  const date = fromISODate(iso);
  if (!date) return null;
  return Math.max(1, Math.round((startOfToday() - date) / DAY_MS));
}
