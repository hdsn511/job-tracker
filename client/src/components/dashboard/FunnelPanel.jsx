import { useMemo } from "react";
import { SANKEY_BOX, buildSankey } from "@/lib/applications";

/**
 * Sankey view of the pipeline. Ribbons and node bars are SVG; the labels
 * are HTML absolutely positioned over it, which renders noticeably crisper
 * than SVG <text> at this size.
 */
export default function FunnelPanel({ apps }) {
  const { nodes, links } = useMemo(() => buildSankey(apps), [apps]);
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
            {links.map((link) => (
              <path key={link.id} d={link.d} fill={link.fill} opacity="0.45" />
            ))}
            {nodes.map((node) => (
              <rect
                key={node.id}
                x={node.x}
                y={node.y}
                width="10"
                height={node.h}
                rx="3"
                fill={node.color}
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
