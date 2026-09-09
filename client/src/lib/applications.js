/**
 * Everything the dashboard derives from the raw `jobs` rows: the parsed
 * inbox timeline, the funnel model, the contribution calendar and the
 * headline stats. Kept out of the components so each one only renders.
 */

export const STAGES = ["Applied", "Interviewing", "Offer", "Rejected"];

/**
 * Per-stage badge palette (text / fill / border / icon).
 *
 * `fg` is always a text-safe ink — the earthy palette's mid tones (sage,
 * clay, terracotta) are graphic values and would fall under 4.5:1 as type.
 */
export const BADGE = {
  Applied: {
    fg: "#55694b",
    bg: "#e9ede2",
    bd: "#cdd7c2",
    dash: "",
    path: "M12 6.5v6l2.6 3.4",
  },
  Interviewing: {
    fg: "#8a6224",
    bg: "#f6ecda",
    bd: "#e5d1a9",
    dash: "3.6 3.6",
    path: "",
  },
  Offer: {
    fg: "#3f6b4f",
    bg: "#e2ede4",
    bd: "#bdd6c2",
    dash: "",
    path: "m8.6 12.2 2.3 2.3 4.5-4.7",
  },
  Rejected: {
    fg: "#9e5540",
    bg: "#f7e6df",
    bd: "#e9c6b8",
    dash: "",
    path: "m15 9-6 6M9 9l6 6",
  },
};

/* Empty -> busiest, on a single sage ramp so the grid reads as one plant
   rather than five colors. */
export const CAL_SHADES = ["#ebe8e0", "#d8dfcd", "#b7c4a7", "#93a487", "#64775a"];

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

  // `color` fills the node bar and its ribbons; `ink` is the text-safe
  // version used for the value under the label. Hues run cool-to-warm
  // left to right so a column reads as a stage, not a rainbow.
  const nodes = [
    { id: "apps", col: 0, label: "Applications", value: total, color: "#7e8f73", ink: "#4f6047" },
    { id: "rev", col: 1, label: "Reviewed", value: reviewed, color: "#8c9a84", ink: "#55694b" },
    { id: "nores", col: 1, label: "No response", value: noResponse, color: "#c6beb1", ink: "#6b6255" },
    { id: "int", col: 2, label: "Interview", value: interview, color: "#6f8f7a", ink: "#3f6b57" },
    { id: "rej", col: 2, label: "Rejected", value: rejected, color: "#c27b66", ink: "#9e5540" },
    { id: "prog", col: 3, label: "Still in loop", value: inProgress, color: "#c9a25c", ink: "#8a6224" },
    { id: "off", col: 3, label: "Offer", value: offer, color: "#5c8a66", ink: "#3f6b4f" },
    { id: "pend", col: 4, label: "Pending decision", value: offer, color: "#7fa98a", ink: "#47755a" },
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
      background: future ? "#f4f2ed" : CAL_SHADES[n],
      ring: "inset 0 0 0 1px rgba(45, 58, 49, 0.05)",
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
      color: "var(--jt-ink)",
    },
    {
      key: "live",
      label: "Still live",
      value: counts.Applied + counts.Interviewing + counts.Offer,
      note: `${counts.Interviewing} interviewing`,
      color: "var(--jt-ink-sage)",
    },
    {
      key: "reply-rate",
      label: "Reply rate",
      value: `${replyRate}%`,
      note: "heard back at least once",
      color: "var(--jt-ink-ochre)",
    },
    {
      key: "median-reply",
      label: "Median reply",
      value: medianReply === null ? "—" : `${medianReply} day${medianReply === 1 ? "" : "s"}`,
      note: "send to first response",
      color: "var(--jt-ink-moss)",
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
