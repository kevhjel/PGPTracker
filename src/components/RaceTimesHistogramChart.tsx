import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface RaceTimesHistogramDatum {
  key: string;
  weekday: number;
  dayLabel: string;
  timeLabel: string;
  avgEntries: number;
  heatCount: number;
}

interface RaceTimesHistogramChartProps {
  data: RaceTimesHistogramDatum[];
  dayOrder: number[];
  dayLabels?: Record<number, string>;
}

// A row in the flattened chart dataset. Real slots carry the histogram bar;
// spacer rows are synthetic zero-width entries inserted between day groups.
// Bar simply skips drawing a rect when `avgEntries` is null, which turns each
// spacer into a clean visual gap - a far more robust way to get an
// unambiguous "boundary between two categories" position than trying to
// coax a ReferenceLine to sit at the edge (rather than the center) of a
// real category tick on a Recharts category axis.
interface ChartRow {
  key: string;
  isSpacer: boolean;
  dayLabel?: string;
  timeLabel?: string;
  avgEntries: number | null;
  heatCount?: number;
  // True for the one slot nearest the middle of its day's slot range - the
  // anchor point for that day's name label, independent of whether it also
  // happens to be an hour-mark tick.
  isDayCenter: boolean;
  // True for slots that get a time-of-day tick label. Only every *other*
  // on-the-hour slot qualifies (9:00am, 11:00am, 1:00pm, ...) - with up to
  // ~40 fifteen-minute slots per day, even one label per hour packs text too
  // close together to read at typical container widths once combined with
  // angled text (see AxisTick below).
  isHourMark: boolean;
}

function isEvenHourMark(timeLabel: string): boolean {
  const m = /^(\d{1,2}):00(am|pm)$/i.exec(timeLabel);
  if (!m) return false;
  let hour = parseInt(m[1], 10) % 12;
  if (m[2].toLowerCase() === "pm") hour += 12;
  return hour % 2 === 0;
}

function buildRows(data: RaceTimesHistogramDatum[], dayOrder: number[]): ChartRow[] {
  const rows: ChartRow[] = [];
  dayOrder.forEach((weekday, dayIdx) => {
    if (dayIdx > 0) {
      rows.push({
        key: `spacer-${weekday}`,
        isSpacer: true,
        avgEntries: null,
        isDayCenter: false,
        isHourMark: false,
      });
    }
    // `data` arrives pre-sorted grouped by day in `dayOrder`, time ascending
    // within each day - filtering by weekday preserves that order rather
    // than re-sorting anything ourselves.
    const daySlots = data.filter((d) => d.weekday === weekday);
    const centerIdx = Math.floor((daySlots.length - 1) / 2);
    daySlots.forEach((d, i) => {
      rows.push({
        key: d.key,
        isSpacer: false,
        dayLabel: d.dayLabel,
        timeLabel: d.timeLabel,
        avgEntries: d.avgEntries,
        heatCount: d.heatCount,
        isDayCenter: i === centerIdx,
        isHourMark: isEvenHourMark(d.timeLabel),
      });
    });
  });
  return rows;
}

// Custom XAxis tick: renders an hour-mark time label (angled -45deg, the
// standard fix for a dense category axis - horizontal text at this bar
// density collides with its neighbors even at 2-hour spacing) and/or a
// day-name label further below, depending on what this row represents.
// Nothing renders at all for spacer rows or non-hour-mark slots. Recharts is
// given `interval={0}` on the XAxis so every row gets a tick call - that's
// what lets us decide, per row, whether to draw anything, rather than
// fighting Recharts' own tick-decimation heuristics to land on hour
// boundaries.
function AxisTick({
  x,
  y,
  payload,
  rowsByKey,
}: {
  x?: number | string;
  y?: number | string;
  payload?: { value: string };
  rowsByKey: Map<string, ChartRow>;
}) {
  const row = payload ? rowsByKey.get(payload.value) : undefined;
  if (!row || row.isSpacer || (!row.isHourMark && !row.isDayCenter)) {
    return <g />;
  }
  return (
    <g transform={`translate(${x},${y})`}>
      {row.isHourMark && (
        <text
          x={0}
          y={0}
          dy={10}
          textAnchor="end"
          transform="rotate(-45)"
          fontSize={10}
          fill="var(--chart-muted)"
        >
          {row.timeLabel}
        </text>
      )}
      {row.isDayCenter && (
        <text
          dy={58}
          textAnchor="middle"
          fontSize={12}
          fontWeight={600}
          fill="var(--chart-text-secondary)"
        >
          {row.dayLabel}
        </text>
      )}
    </g>
  );
}

interface TooltipPayloadEntry {
  payload?: ChartRow;
}

function HistogramTooltipContent({ active, payload }: { active?: boolean; payload?: TooltipPayloadEntry[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (!row || row.isSpacer) return null;
  const heatCount = row.heatCount ?? 0;
  return (
    <div
      style={{
        background: "var(--chart-surface)",
        border: "1px solid var(--chart-gridline)",
        fontSize: 12,
        padding: "8px 10px",
        borderRadius: 4,
      }}
    >
      <div className="mb-1">
        {row.dayLabel} · {row.timeLabel}
      </div>
      <div>{(row.avgEntries ?? 0).toFixed(1)} drivers/heat</div>
      <div style={{ color: "var(--chart-muted)" }}>
        {heatCount} heat{heatCount === 1 ? "" : "s"}
      </div>
    </div>
  );
}

export default function RaceTimesHistogramChart({ data, dayOrder }: RaceTimesHistogramChartProps) {
  if (data.length === 0) {
    return <p className="text-sm text-neutral-500">No race-time data available yet.</p>;
  }

  const rows = buildRows(data, dayOrder);
  const rowsByKey = new Map(rows.map((r) => [r.key, r]));
  const spacerKeys = rows.filter((r) => r.isSpacer).map((r) => r.key);

  // Recharts' "dataMax + 1" domain shorthand operates on the raw (unrounded)
  // average, which can produce an ugly top tick like "10.666666666..." -
  // compute a clean whole-number upper bound ourselves instead.
  const maxAvg = Math.max(0, ...data.map((d) => d.avgEntries));
  const yMax = Math.ceil(maxAvg) + 1;

  return (
    <ResponsiveContainer width="100%" height={460}>
      <BarChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }} barCategoryGap="15%">
        <CartesianGrid stroke="var(--chart-gridline)" vertical={false} />
        <XAxis
          dataKey="key"
          stroke="var(--chart-muted)"
          interval={0}
          height={100}
          tickLine={false}
          tick={(props) => <AxisTick {...props} rowsByKey={rowsByKey} />}
        />
        <YAxis
          stroke="var(--chart-muted)"
          tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
          domain={[0, yMax]}
          allowDecimals={false}
          tickFormatter={(v) => `${Math.round(Number(v))}`}
          label={{
            value: "Avg drivers / heat",
            angle: -90,
            position: "insideLeft",
            fill: "var(--chart-muted)",
          }}
        />
        <Tooltip content={<HistogramTooltipContent />} cursor={{ fill: "var(--chart-gridline)", opacity: 0.4 }} />
        {spacerKeys.map((key) => (
          <ReferenceLine key={key} x={key} stroke="var(--chart-baseline)" strokeDasharray="3 3" />
        ))}
        <Bar dataKey="avgEntries" fill="var(--series-1)" isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
