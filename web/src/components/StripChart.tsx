import React, { useRef, useEffect, useState, useId } from 'react';

export interface ChartPoint {
  ts: string | Date;
  value: number;
  synthetic?: boolean;
  mu?: number;
  sigma?: number;
  ema?: number;
  isAnomaly?: boolean;
  zScore?: number;
}

interface StripChartProps {
  title: string;
  unit: string;
  points: ChartPoint[];
  theme: 'light' | 'dark';
  height?: number;
  showAnomalyBands?: boolean;
  showEma?: boolean;
}

export const StripChart: React.FC<StripChartProps> = ({
  title,
  unit,
  points,
  theme,
  height = 260,
  showAnomalyBands = false,
  showEma = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<ChartPoint | null>(null);
  const tableId = useId();

  // Draw thermal strip chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Color definitions
    const isDark = theme === 'dark';
    const bgPaper = isDark ? '#121210' : '#F3EFE4';
    const gridMajor = isDark ? 'rgba(255, 176, 0, 0.12)' : 'rgba(0, 0, 0, 0.12)';
    const gridMinor = isDark ? 'rgba(255, 176, 0, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const traceColor = isDark ? '#FFB000' : '#111111';
    const emaColor = isDark ? '#38BDF8' : '#2B6CB0';
    const alarmColor = isDark ? '#FF4D4D' : '#D92525';
    const syntheticColor = isDark ? '#D97706' : '#9B7A38';
    const bandFill = isDark ? 'rgba(56, 189, 248, 0.08)' : 'rgba(43, 108, 176, 0.07)';

    // 1. Draw Paper Background
    ctx.fillStyle = bgPaper;
    ctx.fillRect(0, 0, width, height);

    // 2. Draw Millimeter Grid
    const padLeft = 50;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 30;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    if (chartW <= 10 || chartH <= 10) return;

    // Minor grid
    ctx.strokeStyle = gridMinor;
    ctx.lineWidth = 1;
    for (let x = padLeft; x <= width - padRight; x += 10) {
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, height - padBottom);
      ctx.stroke();
    }
    for (let y = padTop; y <= height - padBottom; y += 10) {
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
    }

    // Major grid
    ctx.strokeStyle = gridMajor;
    ctx.lineWidth = 1.5;
    for (let x = padLeft; x <= width - padRight; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, height - padBottom);
      ctx.stroke();
    }
    for (let y = padTop; y <= height - padBottom; y += 40) {
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
    }

    if (points.length < 2) {
      ctx.fillStyle = isDark ? '#A3A096' : '#5C5852';
      ctx.font = '12px "IBM Plex Mono", monospace';
      ctx.fillText('Awaiting telemetry stream...', width / 2 - 80, height / 2);
      return;
    }

    // Min/Max scaling
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const p of points) {
      if (p.value < minVal) minVal = p.value;
      if (p.value > maxVal) maxVal = p.value;
      if (showAnomalyBands && typeof p.mu === 'number' && typeof p.sigma === 'number') {
        const upper = p.mu + 3 * p.sigma;
        const lower = p.mu - 3 * p.sigma;
        if (upper > maxVal) maxVal = upper;
        if (lower < minVal) minVal = lower;
      }
    }

    if (minVal === maxVal) {
      minVal -= 1;
      maxVal += 1;
    }
    const valSpan = maxVal - minVal || 1;

    const getX = (index: number) => padLeft + (index / (points.length - 1)) * chartW;
    const getY = (val: number) => height - padBottom - ((val - minVal) / valSpan) * chartH;

    // Y Axis Labels
    ctx.fillStyle = isDark ? '#A3A096' : '#5C5852';
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = minVal + (i / steps) * valSpan;
      const y = getY(v);
      ctx.fillText(v.toFixed(1), padLeft - 6, y + 3);
    }

    // 3. Draw 3-Sigma Confidence Band
    if (showAnomalyBands && points.some(p => typeof p.mu === 'number')) {
      ctx.fillStyle = bandFill;
      ctx.beginPath();
      // Upper bound
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const upper = (p.mu ?? p.value) + 3 * (p.sigma ?? 0);
        const x = getX(i);
        const y = getY(upper);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      // Lower bound (reverse)
      for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        const lower = (p.mu ?? p.value) - 3 * (p.sigma ?? 0);
        const x = getX(i);
        const y = getY(lower);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }

    // 4. Draw Rolling EMA Line
    if (showEma && points.some(p => typeof p.ema === 'number')) {
      ctx.strokeStyle = emaColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (typeof p.ema === 'number') {
          const x = getX(i);
          const y = getY(p.ema);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 5. Draw Primary Trace Line (Continuous vs Synthetic Dashed)
    ctx.lineWidth = 2;
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const x1 = getX(i);
      const y1 = getY(p1.value);
      const x2 = getX(i + 1);
      const y2 = getY(p2.value);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);

      if (p2.synthetic) {
        ctx.strokeStyle = syntheticColor;
        ctx.setLineDash([5, 4]); // Dashed for gap-filled synthetic points
      } else {
        ctx.strokeStyle = traceColor;
        ctx.setLineDash([]);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 6. Draw Stamped Anomaly Markers
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.isAnomaly && !p.synthetic) {
        const x = getX(i);
        const y = getY(p.value);

        // Stamped Red Diamond
        ctx.fillStyle = alarmColor;
        ctx.strokeStyle = bgPaper;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Stamped Anomaly Label
        ctx.fillStyle = alarmColor;
        ctx.font = 'bold 9px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`! ${p.value.toFixed(1)}`, x, y - 10);
      }
    }

    // 7. Time Axis Labels (Start, Middle, End)
    ctx.fillStyle = isDark ? '#A3A096' : '#5C5852';
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    const firstTs = new Date(points[0].ts).toLocaleTimeString();
    const lastTs = new Date(points[points.length - 1].ts).toLocaleTimeString();
    ctx.fillText(firstTs, padLeft, height - 8);
    ctx.textAlign = 'right';
    ctx.fillText(lastTs, width - padRight, height - 8);

  }, [points, theme, height, showAnomalyBands, showEma]);

  // Summary statistics for accessibility table
  const vals = points.map(p => p.value).sort((a, b) => a - b);
  const minVal = vals[0] ?? 0;
  const maxVal = vals[vals.length - 1] ?? 0;
  const avgVal = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const anomalyCount = points.filter(p => p.isAnomaly && !p.synthetic).length;
  const syntheticCount = points.filter(p => p.synthetic).length;

  return (
    <div className="paper-strip" ref={containerRef} style={{ marginBottom: '16px' }}>
      <div className="recorder-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>({unit})</span>
          {anomalyCount > 0 && (
            <span className="stamp-badge stamp-danger">
              ⚠️ {anomalyCount} ANOMALIES
            </span>
          )}
          {syntheticCount > 0 && (
            <span className="stamp-badge stamp-neutral" style={{ color: 'var(--synthetic-dash)' }}>
              --- {syntheticCount} GAP-FILLED
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setShowTable(!showTable)}
            className="btn"
            style={{ fontSize: '0.75rem', padding: '3px 8px' }}
            aria-expanded={showTable}
            aria-controls={tableId}
          >
            {showTable ? '📉 SHOW CHART' : '📋 DATA TABLE'}
          </button>
        </div>
      </div>

      <div style={{ position: 'relative', width: '100%', height: `${height}px` }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: showTable ? 'none' : 'block' }}
          role="img"
          aria-label={`Strip chart for ${title}: Min ${minVal.toFixed(1)}, Max ${maxVal.toFixed(1)}, Avg ${avgVal.toFixed(1)} ${unit}, ${anomalyCount} anomalies.`}
        />

        {showTable && (
          <div id={tableId} style={{ padding: '16px', overflowY: 'auto', maxHeight: `${height}px` }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>METRIC SUMMARY</th>
                  <th>VALUE</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Sample Count</td><td>{points.length} readings</td></tr>
                <tr><td>Minimum</td><td>{minVal.toFixed(2)} {unit}</td></tr>
                <tr><td>Maximum</td><td>{maxVal.toFixed(2)} {unit}</td></tr>
                <tr><td>Average (μ)</td><td>{avgVal.toFixed(2)} {unit}</td></tr>
                <tr><td>Active Anomalies</td><td>{anomalyCount} points</td></tr>
                <tr><td>Densified Gaps</td><td>{syntheticCount} points</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
