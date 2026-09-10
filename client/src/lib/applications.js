/**
 * Everything the dashboard derives from the raw `jobs` rows: the parsed
 * inbox timeline, the funnel model, the contribution calendar and the
 * headline stats. Kept out of the components so each one only renders.
 */

/**
 * Assessment sits between Applied and Interviewing: it is an online
 * assessment / coding challenge / take-home, i.e. a filter you pass alone.
 * "Interviewing" therefore means a real human conversation and nothing else,
 * which is the only way "3 interviewing" means anything.
 */
export const STAGES = ["Applied", "Assessment", "Interviewing", "Offer", "Rejected"];

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
  // Slate — the palette's one cool neutral, and the only hue left that reads
  // as its own stage at a glance: sage is Applied, moss is Offer, terracotta
  // is Rejected, and the clay/stone tones sit too close to Rejected's pink
  // to tell apart in a scanning list. Slate keeps the natural-materials
  // vocabulary (it is the stone family cooled down) while landing nowhere
  // near Interviewing's amber.
  //
  // The badge is never colour-only: the ring is dotted where Interviewing's
  // is dashed, and the inner mark is a terminal-prompt chevron for "a thing
  // you sit down and solve".
  //
  // fg on bg measures 4.82:1 (WCAG 2.1 relative luminance), inside the band
  // the other four stages already occupy (4.53:1 – 5.10:1).
  Assessment: {
    fg: "#4a6a80",
    bg: "#e7ecf1",
    bd: "#c8d5df",
    dash: "0.5 4.4",
    path: "m10.6 9.4 2.6 2.6-2.6 2.6",
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

/**
 * How deep into the pipeline each stage is. Only the four forward stages are
 * ranked: "Rejected" is an outcome, not a depth. An app auto-rejected the
 * morning after applying and one rejected after four onsites carry the same
 * status and tell completely different stories, and separating those is the
 * whole point of the funnel below.
 */
const STAGE_RANK = { Applied: 1, Assessment: 2, Interviewing: 3, Offer: 4 };

/** The ranked stages, in rank order, so `RANKED_STAGES[rank - 1]` is a name. */
const RANKED_STAGES = ["Applied", "Assessment", "Interviewing", "Offer"];

/**
 * The stage a single timeline line is evidence of, or null for lines that
 * say nothing about depth (a rejection, a hand-written note).
 */
function stageEvidence(text) {
  const line = text.toLowerCase();

  // LEGACY ROWS, and this check has to come first.
  //
  // Before Assessment was a stage of its own, the sync writer filed online
  // assessments under Interviewing with a qualifier:
  //
  //   [2026-08-29] Interviewing — Assessment/OA (ref: R-40218)
  //
  // That line names two stages, and the scan below deliberately takes the
  // highest one — which for this line would be Interviewing, crediting the
  // app with a human conversation that never happened and inflating every
  // interview-stage number in the funnel. The qualifier is the more specific
  // signal and so it wins: any line mentioning an assessment is capped at
  // Assessment-level evidence, whatever stage name it was filed under.
  if (line.includes("assessment")) return "Assessment";

  // Otherwise: the highest stage named on the line. Iterating in rank order
  // and keeping the last hit means "Applied — moving you to Offer" is read
  // as Offer rather than as whichever name happens to appear first.
  let found = null;
  RANKED_STAGES.forEach((stage) => {
    if (line.includes(stage.toLowerCase())) found = stage;
  });
  return found;
}

/**
 * The furthest stage an application ever reached, read off its timeline
 * rather than its current status — because the current status of anything
 * that ended badly is just "Rejected", which erases the history.
 */
export function furthestStageReached(app) {
  let rank = 0;

  (app.events || []).forEach((event) => {
    const stage = stageEvidence(event.text || "");
    if (stage) rank = Math.max(rank, STAGE_RANK[stage]);
  });

  // The current status is evidence too: an app sitting at "Interviewing" has
  // demonstrably reached it, and for rows added by hand it is the *only*
  // evidence there is — they have no sync lines to read. "Rejected" is
  // unranked and contributes nothing, which is exactly right; it says the
  // app is over, never how far it got.
  rank = Math.max(rank, STAGE_RANK[app.status] || 0);

  return RANKED_STAGES[rank - 1] || "Applied";
}

/**
 * The funnel, attributed by furthest stage reached.
 *
 * This used to read current status only, so every rejection — however late —
 * collapsed into one "Reviewed -> Rejected" ribbon, and an offer that fell
 * through looked identical to an instant auto-reject. Now each rejection
 * leaves the pipeline from the stage it actually died at, which is the one
 * thing you want to know when you look at a month of applications.
 */
export function sankeyModel(apps) {
  // Reduce each app to the only two facts the funnel needs, once, rather
  // than re-walking every timeline inside each of the counts below.
  const depth = apps.map((app) => ({
    rank: STAGE_RANK[furthestStageReached(app)],
    rejected: app.status === "Rejected",
  }));
  const count = (predicate) => depth.filter(predicate).length;
  const total = depth.length;

  // Stage bars are "reached this stage or better", so each one is the sum of
  // everything downstream and the ribbons balance by construction.
  const assessment = count((d) => d.rank >= 2);
  const interview = count((d) => d.rank >= 3);

  // Live offers only. An offer that ended in a rejection is counted where it
  // died, not where it peaked — counting it in both places would draw it
  // twice and break the flow.
  const offer = count((d) => d.rank >= 4 && !d.rejected);

  // Still moving, split by which bar the ribbon leaves from. Both land in
  // the same "Still in loop" node: from the reader's side, an app you are
  // mid-OA on and one you are mid-loop on are both simply still alive.
  const inAssessment = count((d) => d.rank === 2 && !d.rejected);
  const inInterview = count((d) => d.rank === 3 && !d.rejected);
  const inProgress = inAssessment + inInterview;

  // Where the rejections happened. Offer-level rejections (a pulled offer, a
  // backed-out headcount) fold into the after-interview bucket: the strip is
  // five columns wide with no room for a sixth terminal, and every one of
  // them ran the interview gauntlet to get there anyway.
  const rejectedAtApply = count((d) => d.rejected && d.rank === 1);
  const rejectedAtAssessment = count((d) => d.rejected && d.rank === 2);
  const rejectedAtInterview = count((d) => d.rejected && d.rank >= 3);

  // "Reviewed" is anything that drew a real outcome: it either moved past
  // the application or came back a no. Everything else is silence.
  const reviewed = assessment + rejectedAtApply;
  const noResponse = Math.max(total - reviewed, 0);

  // `color` fills the node bar and its ribbons; `ink` is the text-safe
  // version used for the value under the label. Hues run cool-to-warm left
  // to right so a column reads as a stage, not a rainbow — Assessment takes
  // the slate from its badge, which sits at the cool end where the stage
  // does. The three rejection terminals share one terracotta deepened left
  // to right, so a late rejection carries visibly more weight than an
  // instant no while still reading as the same kind of ending.
  const nodes = [
    { id: "apps", col: 0, label: "Applications", value: total, color: "#7e8f73", ink: "#4f6047" },
    { id: "rev", col: 1, label: "Reviewed", value: reviewed, color: "#8c9a84", ink: "#55694b" },
    { id: "nores", col: 1, label: "No response", value: noResponse, color: "#c6beb1", ink: "#6b6255" },
    { id: "asmt", col: 2, label: "Assessment", value: assessment, color: "#8fa2ae", ink: "#4a6a80" },
    {
      id: "rejApply",
      col: 2,
      label: "Rejected at apply",
      value: rejectedAtApply,
      color: "#d3ab9f",
      ink: "#9e5540",
    },
    { id: "int", col: 3, label: "Interview", value: interview, color: "#6f8f7a", ink: "#3f6b57" },
    {
      id: "rejAsmt",
      col: 3,
      label: "Rejected after OA",
      value: rejectedAtAssessment,
      color: "#cb9383",
      ink: "#9e5540",
    },
    { id: "prog", col: 4, label: "Still in loop", value: inProgress, color: "#c9a25c", ink: "#8a6224" },
    { id: "off", col: 4, label: "Offer", value: offer, color: "#5c8a66", ink: "#3f6b4f" },
    {
      id: "rejInt",
      col: 4,
      label: "Rejected after interview",
      value: rejectedAtInterview,
      color: "#c27b66",
      ink: "#9e5540",
    },
  ];

  // Ordered to match the node stacks above: ribbons leave a bar in the same
  // order the targets are stacked, so nothing crosses that does not have to.
  const links = [
    ["apps", "rev", reviewed],
    ["apps", "nores", noResponse],
    ["rev", "asmt", assessment],
    ["rev", "rejApply", rejectedAtApply],
    ["asmt", "int", interview],
    ["asmt", "prog", inAssessment],
    ["asmt", "rejAsmt", rejectedAtAssessment],
    ["int", "prog", inInterview],
    ["int", "off", offer],
    ["int", "rejInt", rejectedAtInterview],
  ];

  return {
    nodes: nodes.filter((n) => n.value > 0),
    links: links.filter(([, , value]) => value > 0),
    total,
  };
}

/* Shorter than it is wide by design: the funnel is a header band above the
   application list, not the main event, so it gets a strip of height. */
export const SANKEY_BOX = { width: 944, height: 216, marginLeft: 116, marginTop: 22 };

/**
 * Lays the funnel out: one 10px bar per node, columns evenly spaced across
 * a 690x172 drawing area, ribbons as cubic Beziers whose control points sit
 * at the horizontal midpoint. Labels are positioned in CSS pixels on top of
 * the SVG (HTML type renders crisper than SVG <text>).
 */
export function buildSankey(apps) {
  const model = sankeyModel(apps);
  const { width: BOXW, marginLeft: ML, marginTop: MT } = SANKEY_BOX;
  const W = 690;
  const H = 172;
  const NW = 10;
  const GAP = 14;
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
      //
      // Labels are one line (name and value side by side) and carry a halo
      // in CSS: at this height there is no room for a two-line stack, and
      // the middle columns sit directly over the ribbons. HALO is the 7px
      // of horizontal padding, backed out so the text still lines up with
      // the node bar it belongs to.
      const pct = (value) => `${(value / SANKEY_BOX.height) * 100}%`;
      const HALO = 7;
      const position = isFirst
        ? {
            right: BOXW - (ML + x - 14) + HALO,
            top: `calc(${pct(MT + y + h / 2)} - 13px)`,
          }
        : isLast
          ? {
              left: ML + x + NW + 14 - HALO,
              top: `calc(${pct(MT + y + h / 2)} - 13px)`,
            }
          : // The label box is ~26px tall (baseline-aligned type at two
            // sizes, plus the halo padding), so 33px leaves a clear 7px
            // between the text and the top of the node bar.
            { left: ML + x - HALO, top: `calc(${pct(MT + y)} - 33px)` };

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

export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * One calendar month as a heat grid: seven columns (Sunday first), one cell
 * per day, `leading` empty cells before the 1st so the weekdays line up.
 *
 * A month rather than a rolling quarter — the grid is a compact reference
 * for "how much have I sent lately", and the rolling version was mostly
 * empty scroll-back.
 */
export function buildCalendar(apps, reference = startOfToday()) {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = new Date(year, month, 1).getDay();

  const perDay = {};
  apps.forEach((app) => {
    if (!app.date) return;
    perDay[app.date] = (perDay[app.date] || 0) + 1;
  });

  const cells = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const iso = toISODate(date);
    const future = date > reference;
    const raw = perDay[iso] || 0;

    cells.push({
      iso,
      day,
      n: raw,
      future,
      today: iso === toISODate(reference),
      background: future ? "#f4f2ed" : CAL_SHADES[Math.min(raw, 4)],
      ring: "inset 0 0 0 1px rgba(45, 58, 49, 0.05)",
      tip: `${MONTHS[month]} ${day} · ${
        raw === 0 ? "no applications" : `${raw} application${raw === 1 ? "" : "s"}`
      }`,
    });
  }

  return {
    cells,
    leading,
    monthLabel: MONTHS_LONG[month],
    monthTotal: cells.reduce((sum, cell) => sum + cell.n, 0),
    activeDays: cells.filter((cell) => cell.n > 0).length,
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
      // Every stage that has not ended: Assessment belongs here as much as
      // the other three, and leaving it out would quietly shrink the number
      // the moment the sync started filing OAs under their own stage.
      //
      // The note names both stages rather than summing them. "N interviewing"
      // alone now means strictly human conversations, so on its own it would
      // read as a drop rather than as a split — and the two are worth very
      // different amounts of hope.
      label: "Still live",
      value: counts.Applied + counts.Assessment + counts.Interviewing + counts.Offer,
      note: `${counts.Assessment} in assessment · ${counts.Interviewing} interviewing`,
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
