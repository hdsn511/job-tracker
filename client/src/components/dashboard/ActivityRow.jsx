import { useMemo } from "react";
import { CAL_SHADES, buildCalendar, headlineStats } from "@/lib/applications";

/**
 * Contribution calendar plus the four headline numbers. The calendar spans
 * 10 weeks — a quarter of a job search reads at a glance; the 24 weeks the
 * design started with was mostly empty grid.
 */
export default function ActivityRow({ apps }) {
  const calendar = useMemo(() => buildCalendar(apps), [apps]);
  const stats = useMemo(() => headlineStats(apps), [apps]);

  return (
    <div className="jt-activity">
      <div className="jt-calendar">
        <div className="jt-calendar-head">
          <span className="jt-label">Application activity</span>
          <span className="jt-calendar-weeks">{calendar.weeks} weeks</span>
        </div>

        <div className="jt-calendar-grid">
          {calendar.cells.map((cell) => (
            <div
              key={cell.iso}
              className="jt-calendar-cell"
              title={cell.tip}
              style={{ background: cell.background, boxShadow: cell.ring }}
            />
          ))}
        </div>

        <div className="jt-calendar-foot">
          <div className="jt-calendar-legend">
            <span>less</span>
            {CAL_SHADES.map((shade) => (
              <span key={shade} data-swatch style={{ background: shade }} />
            ))}
            <span>more</span>
          </div>
          <div className="jt-calendar-summary">
            <span>
              busiest week &mdash; <strong>{calendar.busiestWeek}</strong>
            </span>
            <span>
              active days &mdash; <strong>{calendar.activeDays}</strong>
            </span>
          </div>
        </div>
      </div>

      <div className="jt-stats">
        {stats.map((stat) => (
          <div key={stat.key} className="jt-stat">
            <span className="jt-stat-label">{stat.label}</span>
            <span className="jt-stat-value" style={{ color: stat.color }}>
              {stat.value}
            </span>
            <span className="jt-stat-note">{stat.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
