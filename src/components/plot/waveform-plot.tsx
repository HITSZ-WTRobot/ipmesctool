import { MotorFeedbackType, Timestamped } from "@/stores/feedback.ts"; // 假设这两个 atom 已存在
import { useCallback, useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { rad2deg, rps2rpm } from "@/lib/utils.ts";
import { useDegAtom, useRpmAtom } from "@/stores/angle.ts"; // 你的转换函数

interface WaveformPlotProps {
  type: MotorFeedbackType;
  paused: boolean;
  width: number;
  height: number;
  data: Timestamped<number[]>[];
}

export function WaveformPlot({
  type,
  paused,
  width,
  height,
  data,
}: WaveformPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const useDeg = useAtomValue(useDegAtom);
  const useRpm = useAtomValue(useRpmAtom);

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    if (!data || data.length === 0) return;

    const padding = 50;
    const plotWidth = width - 2 * padding;
    const plotHeight = height - 2 * padding;

    // 当前窗口时间范围
    const leftTime = data[0].timestamp;
    const rightTime = data[data.length - 1].timestamp;

    // X轴映射
    const mapX = (ts: number) => {
      const totalSec = (rightTime - leftTime) / 1000;
      const t = (ts - rightTime) / 1000; // 0 表示最新
      return padding + ((t + totalSec) / totalSec) * plotWidth;
    };

    // Y轴动态缩放（先做单位转换）
    let yMin = Infinity,
      yMax = -Infinity;
    data.forEach((d) =>
      d.value.forEach((v) => {
        let val = v;
        if (type === "speed") val = useRpm ? rps2rpm(v) : v;
        if (type === "position") val = useDeg ? rad2deg(v) : v;
        if (val < yMin) yMin = val;
        if (val > yMax) yMax = val;
      }),
    );
    if (yMin === yMax) {
      yMax += 0.5;
      yMin -= 0.5;
    }

    const yRange = yMax - yMin;
    const yPaddingRatio = 0.1;
    yMin -= yRange * yPaddingRatio;
    yMax += yRange * yPaddingRatio;

    const mapY = (v: number) => {
      let val = v;
      if (type === "speed") val = useRpm ? rps2rpm(v) : v;
      if (type === "position") val = useDeg ? rad2deg(v) : v;
      return height - padding - ((val - yMin) / (yMax - yMin)) * plotHeight;
    };

    // 绘制网格线
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#fff";

    const yGridCount = 5;
    for (let i = 0; i <= yGridCount; i++) {
      const y = padding + (plotHeight * i) / yGridCount;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();

      const yVal = yMax - ((yMax - yMin) * i) / yGridCount;
      ctx.fillText(yVal.toFixed(2), 5, y + 4);
    }

    const now = Date.now();
    const debouncedNow = now - rightTime < 200 ? rightTime : now;
    const xGridCount = 10;
    for (let i = 0; i <= xGridCount; i++) {
      const ts = leftTime + ((rightTime - leftTime) * i) / xGridCount;
      const x = mapX(ts);
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, height - padding);
      ctx.stroke();

      const t = (ts - debouncedNow) / 1000;
      ctx.fillStyle = "#fff";
      ctx.fillText(t.toFixed(1) + "s", x - 10, height - padding + 15);
    }

    // 绘制曲线
    const colors = type === "iabc" ? ["red", "green", "blue"] : ["cyan"];
    for (let c = 0; c < data[0].value.length; c++) {
      ctx.strokeStyle = colors[c] || "cyan";
      ctx.lineWidth = 2;
      ctx.beginPath();
      data.forEach((d, i) => {
        const x = mapX(d.timestamp);
        const y = mapY(d.value[c]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // 坐标轴
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    // Y轴顶部显示 Type + Unit
    ctx.fillStyle = "#fff";
    let unit = " ";
    if (type === "iabc") unit = "A";
    else if (type === "udc") unit = "V";
    else if (type === "speed") unit = useRpm ? "rpm" : "rad/s";
    else if (type === "position") unit = useDeg ? "deg" : "rad";
    ctx.fillText(`${type} (${unit})`, padding + 5, padding - 10);

    // X轴最右边显示 t/s
    ctx.fillText("t/s", width - padding + 5, height - padding + 5);
  }, [data, width, height, type, useDeg, useRpm]);

  useEffect(() => {
    function loop() {
      if (!paused) draw();
      rafRef.current = requestAnimationFrame(loop);
    }
    loop();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [draw, paused]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ background: "#000" }}
    />
  );
}
