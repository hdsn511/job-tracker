/**
 * Thin meandering rule used where a flat 1px border would be too abrupt —
 * the vine/root motif the theme runs on. `preserveAspectRatio="none"` lets
 * it span any width; `vectorEffect` keeps the stroke a true hairline while
 * it stretches.
 */
export default function VineDivider({ className, tone = "var(--jt-border-strong)", buds = true }) {
  return (
    <svg
      className={className ? `jt-vine ${className}` : "jt-vine"}
      viewBox="0 0 1200 16"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M0 11C118 11 176 3 318 5c142 2 206 9 352 6 146-3 214-10 330-8 84 1 148 5 200 6"
        stroke={tone}
        strokeWidth="1"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {buds ? (
        <>
          <circle cx="318" cy="5" r="2" fill="var(--jt-sage)" opacity="0.55" />
          <circle cx="670" cy="11" r="2" fill="var(--jt-clay)" opacity="0.8" />
          <circle cx="1000" cy="3" r="2" fill="var(--jt-sage)" opacity="0.45" />
        </>
      ) : null}
    </svg>
  );
}
