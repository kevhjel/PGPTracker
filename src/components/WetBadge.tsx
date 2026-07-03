export default function WetBadge({ ratio }: { ratio?: number }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: "var(--series-1)", color: "var(--series-1)" }}
      title={ratio !== undefined ? `Median lap ~${ratio.toFixed(2)}x category dry baseline` : "Wet race"}
    >
      Wet
    </span>
  );
}
