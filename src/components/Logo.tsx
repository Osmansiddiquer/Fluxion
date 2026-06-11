/**
 * Fluxion mark: Ḟ — Newton wrote a "fluxion" (his word for a derivative) as a
 * letter with a dot over it (ẋ, ẏ). So the logo *is* that notation: an ink F with
 * a single accent overdot. The dot is the brand element — it echoes the trace
 * point that rides the curves in the grapher. No badge, no gradient.
 */
export default function Logo({ size = 27 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* F — drawn as strokes so it stays crisp and font-independent */}
      <path
        d="M8.5 10 H20 M8.5 10 V23.5 M8.5 16 H17"
        style={{ stroke: 'var(--text)' }}
        strokeWidth="2.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* the fluxion — the overdot, centred over the letter */}
      <circle cx="11.8" cy="4.9" r="2.5" style={{ fill: 'var(--accent)' }} />
    </svg>
  );
}
