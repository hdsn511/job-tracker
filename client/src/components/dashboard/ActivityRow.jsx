import { useMemo } from "react";
import { CAL_SHADES, WEEKDAY_INITIALS, buildCalendar, headlineStats } from "@/lib/applications";

/**
 * The month heat grid plus the four headline numbers — a reference band
 * above the application list, so it stays deliberately short.
 *
 * Days with at least one application are buttons: clicking one narrows the
 * list to that day, clicking it again clears it. Empty and future days stay
 * inert, since filtering to them could only ever produce an empty list.
 */
export default function ActivityRow({ apps, selectedDate, onSelectDate }) {
  const calendar = useMemo(() => buildCalendar(apps), [apps]);
  const stats = useMemo(() => headlineStats(apps), [apps]);

  return (
    <div className="jt-activity">
      <div className="jt-calendar">
        <div className="jt-calendar-head">
          <span className="jt-label">{calendar.monthLabel}</span>
          <div className="jt-calendar-legend">
            <span>less</span>
            {CAL_SHADES.map((shade) => (
              <span key={shade} data-swatch style={{ background: shade }} />
            ))}
            <span>more</span>
          </div>
        </div>

        <div className="jt-calendar-weekdays" aria-hidden="true">
          {WEEKDAY_INITIALS.map((initial, index) => (
            <span key={index}>{initial}</span>
          ))}
        </div>

        <div className="jt-calendar-grid">
          {/* Blanks push the 1st under its weekday. */}
          {Array.from({ length: calendar.leading }, (_, index) => (
            <span key={`pad-${index}`} className="jt-calendar-pad" />
          ))}

          {calendar.cells.map((cell) => {
            const selected = cell.iso === selectedDate;
            const className = [
              "jt-calendar-cell",
              cell.today ? "is-today" : "",
              selected ? "is-selected" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const style = { background: cell.background, boxShadow: cell.ring };

            if (!cell.n) {
              return (
                <span key={cell.iso} className={className} data-tip={cell.tip} style={style} />
              );
            }

            return (
              <button
                key={cell.iso}
                type="button"
                className={`${className} is-clickable`}
                data-tip={cell.tip}
                style={style}
                aria-pressed={selected}
                aria-label={`${cell.tip}. Filter the list to this day.`}
                onClick={() => onSelectDate(selected ? null : cell.iso)}
              />
            );
          })}
        </div>

        <div className="jt-calendar-foot">
          <span>
            <strong>{calendar.monthTotal}</strong> this month
          </span>
          <span>
            <strong>{calendar.activeDays}</strong> active days
          </span>
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
