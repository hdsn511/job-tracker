/**
 * Fixed, full-screen fractal-noise wash that gives every surface in the app
 * a faint paper tooth. Mounted once at the root; it sits above the modal
 * layer (z 60) so nothing in the UI ever renders as flat, untextured color,
 * and it never takes a pointer event.
 */
export default function PaperGrainOverlay() {
  return (
    <div
      aria-hidden="true"
      className="jt-grain"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        backgroundRepeat: "repeat",
      }}
    />
  );
}
