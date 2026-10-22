import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { Button } from "@/components/ui/button.tsx";
import type { TelemetrySample } from "@/stores/telemetry.ts";

interface TelemetryChartProps {
  samples: TelemetrySample[];
  labels: readonly string[];
  unit: string;
  factor: number;
  end: number;
  windowSeconds: number;
  visible: boolean;
  resetKey?: string | number;
}

interface MeasurementPoint {
  time: number;
  values: (number | null)[];
}

interface Measurements {
  a: MeasurementPoint | null;
  b: MeasurementPoint | null;
}

interface SeriesStats {
  count: number;
  min: number;
  max: number;
  mean: number;
}

interface FixedRange {
  min: number;
  max: number;
}

const formatValue = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : Number(value.toPrecision(8)).toString();
const formatTime = (time: number) => `${time.toFixed(6)} s`;

function pointAt(chart: uPlot, index: number | null | undefined): MeasurementPoint | null {
  if (index == null || index < 0 || index >= chart.data[0].length) return null;
  const time = chart.data[0][index];
  if (!Number.isFinite(time) || time < (chart.scales.x.min ?? -Infinity) || time > (chart.scales.x.max ?? Infinity)) return null;
  return {
    time,
    values: chart.data.slice(1).map((column) => {
      const value = column[index];
      return value != null && Number.isFinite(value) ? value : null;
    }),
  };
}

function updateMeasurementLines(chart: uPlot, lines: HTMLDivElement[], measurements: Measurements) {
  [measurements.a, measurements.b].forEach((point, index) => {
    const line = lines[index];
    if (!line) return;
    const inWindow = point != null && point.time >= (chart.scales.x.min ?? Infinity) && point.time <= (chart.scales.x.max ?? -Infinity);
    line.style.display = inWindow ? "block" : "none";
    if (inWindow) line.style.left = `${chart.valToPos(point.time, "x")}px`;
  });
}

export function TelemetryChart(props: TelemetryChartProps) {
  // Measurements and axis settings belong to one source/unit/session, never an array index.
  const identity = JSON.stringify([props.resetKey, props.labels, props.unit, props.factor]);
  return <TelemetryChartView key={identity} {...props} />;
}

function TelemetryChartView({ samples, labels, unit, factor, end, windowSeconds, visible }: TelemetryChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const linesRef = useRef<HTMLDivElement[]>([]);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [hover, setHover] = useState<MeasurementPoint | null>(null);
  const [measurements, setMeasurements] = useState<Measurements>({ a: null, b: null });
  const measurementsRef = useRef(measurements);
  const [shown, setShown] = useState(() => labels.map(() => true));
  const shownRef = useRef(shown);
  const [fixedRange, setFixedRange] = useState<FixedRange | null>(null);
  const fixedRangeRef = useRef(fixedRange);
  const [minInput, setMinInput] = useState("-1");
  const [maxInput, setMaxInput] = useState("1");
  const [rangeError, setRangeError] = useState<string | null>(null);
  measurementsRef.current = measurements;
  shownRef.current = shown;
  fixedRangeRef.current = fixedRange;
  const max = Math.max(windowSeconds, end);
  const min = max - windowSeconds;

  const { data, statistics } = useMemo(() => {
    const times: number[] = [];
    const values = labels.map((): (number | null)[] => []);
    const columns: [number[], ...(number | null)[][]] = [times, ...values];
    const stats: SeriesStats[] = labels.map(() => ({ count: 0, min: Infinity, max: -Infinity, mean: 0 }));
    // Persistent hidden pages must not transform their incoming history.
    if (!visible) return { data: columns, statistics: stats };
    for (const sample of samples) {
      if (!Number.isFinite(sample.time) || sample.time < min || sample.time > max) continue;
      times.push(sample.time);
      for (let index = 0; index < labels.length; index++) {
        const value = sample.values[index] * factor;
        const valid = Number.isFinite(value);
        values[index].push(valid ? value : null);
        if (!valid) continue;
        const stat = stats[index];
        stat.count++;
        stat.min = Math.min(stat.min, value);
        stat.max = Math.max(stat.max, value);
        stat.mean += (value - stat.mean) / stat.count;
      }
    }
    return { data: columns, statistics: stats };
  }, [samples, labels, factor, min, max, visible]);

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const styles = getComputedStyle(document.documentElement);
    const foreground = styles.getPropertyValue("--foreground").trim();
    const grid = dark ? "#383841" : "#e4e4e7";
    const colors = ["--chart-1", "--chart-2", "--chart-3"].map((name) => styles.getPropertyValue(name).trim());
    const chart = new uPlot({
      width: Math.max(240, element.clientWidth),
      height: 360,
      scales: {
        x: { time: false },
        y: {
          range: (_plot, low, high) => {
            const fixed = fixedRangeRef.current;
            if (fixed) return [fixed.min, fixed.max];
            return Number.isFinite(low) && Number.isFinite(high) ? uPlot.rangeNum(low, high, 0.1, true) : [-1, 1];
          },
        },
      },
      cursor: { drag: { x: false, y: false }, lock: false },
      series: [
        { label: "主机接收时间", value: (_plot, value) => value == null ? "—" : formatTime(value) },
        ...labels.map((label, index) => ({
          label,
          show: shownRef.current[index],
          stroke: colors[index % colors.length],
          width: 1.5,
          points: { show: false },
          value: (_plot: uPlot, value: number | null) => `${formatValue(value)} ${unit}`,
        })),
      ],
      axes: [
        { stroke: foreground, grid: { stroke: grid }, ticks: { stroke: grid }, values: (_plot, ticks) => ticks.map((value) => `${Number(value.toFixed(3))}`) },
        { label: unit, stroke: foreground, grid: { stroke: grid }, ticks: { stroke: grid }, size: 72 },
      ],
      legend: { show: false },
      hooks: {
        setCursor: [(plot) => {
          const next = (plot.cursor.left ?? -1) < 0 || (plot.cursor.top ?? -1) < 0 ? null : pointAt(plot, plot.cursor.idx);
          setHover((previous) => {
            if (previous === next) return previous;
            if (previous && next && previous.time === next.time && previous.values.every((value, index) => value === next.values[index])) return previous;
            return next;
          });
        }],
        draw: [(plot) => updateMeasurementLines(plot, linesRef.current, measurementsRef.current)],
      },
    }, [[], ...labels.map((): number[] => [])], element);
    plotRef.current = chart;
    linesRef.current = ["A", "B"].map((name, index) => {
      const line = document.createElement("div");
      line.dataset.testid = `telemetry-cursor-${name.toLowerCase()}`;
      line.setAttribute("aria-hidden", "true");
      Object.assign(line.style, {
        position: "absolute", top: "0", bottom: "0", width: "0", pointerEvents: "none", display: "none",
        borderLeft: `2px dashed ${index === 0 ? "#f59e0b" : "#a855f7"}`, zIndex: "5",
      });
      const label = document.createElement("span");
      label.textContent = name;
      Object.assign(label.style, { position: "absolute", top: index === 0 ? "0" : "18px", left: "3px", fontWeight: "bold", color: index === 0 ? "#b45309" : "#9333ea" });
      line.append(label);
      chart.over.append(line);
      return line;
    });
    chart.over.tabIndex = 0;
    chart.over.setAttribute("role", "button");
    chart.over.setAttribute("aria-label", "波形选点：单击依次选择 A、B，再次单击重选 A；左右键移动，回车选点");
    chart.over.dataset.testid = "telemetry-plot-area";
    const selectPoint = (point: MeasurementPoint | null) => {
      if (!point) return;
      setMeasurements((previous) => previous.a && !previous.b ? { a: previous.a, b: point } : { a: point, b: null });
    };
    const click = (event: MouseEvent) => {
      const rect = chart.over.getBoundingClientRect();
      const left = event.clientX - rect.left;
      if (left < 0 || left > rect.width) return;
      selectPoint(pointAt(chart, chart.posToIdx(left)));
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const current = chart.cursor.idx;
        const index = current == null ? 0 : Math.max(0, Math.min(chart.data[0].length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
        const point = pointAt(chart, index);
        if (point) chart.setCursor({ left: chart.valToPos(point.time, "x"), top: chart.over.clientHeight / 2 });
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectPoint(pointAt(chart, chart.cursor.idx ?? 0));
      }
    };
    chart.over.addEventListener("click", click);
    chart.over.addEventListener("keydown", keydown);
    const resize = new ResizeObserver(() => {
      // Persistent pages use display:none. Do not resize to zero while hidden.
      if (element.clientWidth > 0) chart.setSize({ width: Math.max(240, element.clientWidth), height: 360 });
    });
    resize.observe(element);
    return () => {
      resize.disconnect();
      chart.over.removeEventListener("click", click);
      chart.over.removeEventListener("keydown", keydown);
      plotRef.current = null;
      linesRef.current = [];
      chart.destroy();
    };
  }, [labels, unit, dark]);

  useEffect(() => {
    const chart = plotRef.current;
    if (!chart || !visible) return;
    chart.batch(() => {
      chart.setData(data);
      chart.setScale("x", { min, max });
      if (fixedRange) chart.setScale("y", fixedRange);
      shown.forEach((show, index) => chart.setSeries(index + 1, { show }));
    });
  }, [data, min, max, visible, labels, unit, dark, fixedRange, shown]);

  useEffect(() => {
    const chart = plotRef.current;
    if (chart) updateMeasurementLines(chart, linesRef.current, measurements);
  }, [measurements]);

  const pointDescription = (point: MeasurementPoint | null) => {
    if (!point) return "未选择";
    return `${formatTime(point.time)}${point.time < min || point.time > max ? "（已超出当前窗口）" : ""}`;
  };
  const a = measurements.a;
  const b = measurements.b;

  return (
    <section className="w-full min-w-0 space-y-3 text-xs" data-testid="telemetry-chart" aria-label={`波形：${labels.join("、")}，单位 ${unit}`}>
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <legend className="mb-1 font-medium">显示曲线（不影响统计或导出）</legend>
        {labels.map((label, index) => (
          <label key={label} className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={shown[index]} onChange={(event) => setShown((previous) => previous.map((value, item) => item === index ? event.target.checked : value))} aria-label={`显示曲线 ${label}`} />
            <span className="h-0.5 w-4" aria-hidden="true" style={{ backgroundColor: `var(--chart-${index % 3 + 1})` }} />
            {label}
          </label>
        ))}
      </fieldset>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
        event.preventDefault();
        const low = Number(minInput);
        const high = Number(maxInput);
        if (!minInput.trim() || !maxInput.trim() || !Number.isFinite(low) || !Number.isFinite(high) || low >= high) {
          setRangeError("Y 轴范围须为有限数，且最小值小于最大值；仍使用此前范围。");
          return;
        }
        setRangeError(null);
        setFixedRange({ min: low, max: high });
      }}>
        <label className="space-y-1">Y 最小值 ({unit})<input className="block h-8 w-28 rounded-md border bg-background px-2" aria-label="Y轴最小值" aria-invalid={rangeError ? true : undefined} inputMode="decimal" value={minInput} onChange={(event) => setMinInput(event.target.value)} /></label>
        <label className="space-y-1">Y 最大值 ({unit})<input className="block h-8 w-28 rounded-md border bg-background px-2" aria-label="Y轴最大值" aria-invalid={rangeError ? true : undefined} inputMode="decimal" value={maxInput} onChange={(event) => setMaxInput(event.target.value)} /></label>
        <Button size="sm" variant="outline" type="submit">应用固定 Y</Button>
        <Button size="sm" variant="outline" type="button" onClick={() => { setFixedRange(null); setRangeError(null); }}>自动 Y</Button>
        <span className="pb-2 text-muted-foreground" data-testid="telemetry-y-status">{fixedRange ? `固定：${formatValue(fixedRange.min)} ～ ${formatValue(fixedRange.max)} ${unit}` : "自动缩放"}</span>
        {rangeError && <p className="w-full text-destructive" role="alert">{rangeError}</p>}
      </form>
      <div ref={container} className="w-full min-w-0" />
      <div className="rounded-md border px-3 py-2 tabular-nums" data-testid="telemetry-hover">
        <span className="font-medium">悬停读数：</span>{hover ? <>t = {formatTime(hover.time)}{hover.time < min || hover.time > max ? "（已超出当前窗口）" : ""}；{labels.map((label, index) => <span key={label} className="mr-3 inline-block">{label} = {formatValue(hover.values[index])} {unit}</span>)}</> : "将鼠标移入波形，或聚焦图形后用左右键选择采样点"}
      </div>
      <div className="space-y-2 rounded-md border px-3 py-2 tabular-nums" data-testid="telemetry-measurements">
        <div className="flex flex-wrap items-center justify-between gap-2"><span>双游标：单击依次选 A、B，再次单击重新选 A（方向键移动 / 回车选点）。</span><Button size="sm" variant="outline" type="button" onClick={() => setMeasurements({ a: null, b: null })}>清除测量</Button></div>
        <div className="flex flex-wrap gap-x-5 gap-y-1"><span data-testid="telemetry-measurement-a">A：{pointDescription(a)}</span><span data-testid="telemetry-measurement-b">B：{pointDescription(b)}</span><span data-testid="telemetry-delta-time">Δt (B − A)：{a && b ? formatTime(b.time - a.time) : "—"}</span></div>
        <div className="flex flex-wrap gap-x-5 gap-y-1">{labels.map((label, index) => <span key={label}>Δ{label} (B − A)：{a?.values[index] != null && b?.values[index] != null ? formatValue(b.values[index]! - a.values[index]!) : "—"} {unit}</span>)}</div>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left tabular-nums" data-testid="telemetry-statistics">
          <caption className="px-3 py-2 text-left font-medium">当前可见窗口统计 · {formatTime(min)} ～ {formatTime(max)} · 包含隐藏曲线</caption>
          <thead><tr className="border-b"><th className="px-3 py-2">曲线 ({unit})</th><th className="px-3 py-2">最小值</th><th className="px-3 py-2">最大值</th><th className="px-3 py-2">均值</th><th className="px-3 py-2">峰峰值 (p-p)</th></tr></thead>
          <tbody>{labels.map((label, index) => {
            const stat = statistics[index];
            return <tr key={label} className="border-b last:border-0"><th className="px-3 py-2 font-medium" scope="row">{label}</th>{stat.count ? <><td className="px-3 py-2">{formatValue(stat.min)}</td><td className="px-3 py-2">{formatValue(stat.max)}</td><td className="px-3 py-2">{formatValue(stat.mean)}</td><td className="px-3 py-2">{formatValue(stat.max - stat.min)}</td></> : <td className="px-3 py-2 text-muted-foreground" colSpan={4}>无数据</td>}</tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  );
}
