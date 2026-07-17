export default function VideoBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: "var(--series-2)", color: "var(--series-2)" }}
      title="Video available"
    >
      <span aria-hidden="true">▶</span>
      Video
    </span>
  );
}
