import { SANKEY_BOX } from "@/lib/applications";

/**
 * Sankey view of the pipeline. Ribbons and node bars are SVG; the labels
 * are HTML absolutely positioned over it, which renders noticeably crisper
 * than SVG <text> at this size.
 *
 * Purely presentational: `nodes`/`links` (from `buildSankey`) are computed
 * by the caller, which is what lets a click here filter the same `apps`
 * list the funnel was built from, and keeps that filter self-correcting --
 * if an edit moves an app off the selected path, the path's own appIds
 * recompute on the next render and the filter follows automatically.
 */
export default function FunnelPanel({ nodes, links, selectedLinkId, onSelectLink }) {
  const { width, height, marginLeft, marginTop } = SANKEY_BOX;

  if (!nodes.length) {
    return (
      <div className="jt-funnel-panel is-empty">
        <span className="jt-empty-note">
          The pipeline flow appears once there&apos;s an application to trace.
        </span>
      </div>
    );
  }

  return (
    <div className="jt-funnel-panel">
      <div className="jt-funnel-stage" style={{ width }}>
        {/* Fixed width, flexible height: `preserveAspectRatio="none"` lets
            the flow compress vertically on a short screen without moving
            the columns. */}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          style={{ display: "block", position: "absolute", inset: 0, width: "100%", height: "100%" }}
          role="img"
          aria-label="Application pipeline flow"
        >
          <g transform={`translate(${marginLeft},${marginTop})`}>
            {links.map((link) => {
              const selected = link.id === selectedLinkId;
              const dimmed = selectedLinkId && !selected;
              return (
                <path
                  key={link.id}
                  d={link.d}
                  fill={link.fill}
                  opacity={selected ? 0.85 : dimmed ? 0.18 : 0.45}
                  stroke={link.fill}
                  strokeWidth={selected ? 1.5 : 0}
                  className="jt-funnel-ribbon"
                  onClick={() => onSelectLink(link)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`${link.label}: ${link.value}. ${selected ? "Selected — activate to clear" : "Activate to filter the list to this path"}.`}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectLink(link);
                    }
                  }}
                >
                  <title>{`${link.label}: ${link.value}`}</title>
                </path>
              );
            })}
            {nodes.map((node) => (
              <rect
                key={node.id}
                x={node.x}
                y={node.y}
                width="10"
                height={node.h}
                rx="3"
                fill={node.color}
                opacity={selectedLinkId ? 0.55 : 1}
              />
            ))}
          </g>
        </svg>

        {nodes.map((node) => (
          <div key={node.id} className="jt-funnel-label" style={node.position}>
            <span className="jt-funnel-label-name">{node.label}</span>
            <span className="jt-funnel-label-value" style={{ color: node.ink }}>
              {node.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
