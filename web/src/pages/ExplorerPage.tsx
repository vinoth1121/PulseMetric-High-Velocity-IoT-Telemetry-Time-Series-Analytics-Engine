import React, { useState, useEffect } from 'react';
import { StripChart, ChartPoint } from '../components/StripChart.js';
import { RouterBadge } from '../components/RouterBadge.js';

interface ExplorerPageProps {
  theme: 'light' | 'dark';
  devices: { deviceId: string }[];
}

export const ExplorerPage: React.FC<ExplorerPageProps> = ({ theme, devices }) => {
  const [deviceId, setDeviceId] = useState('pm-device-001');
  const [metric, setMetric] = useState('temperature_c');
  const [rangePreset, setRangePreset] = useState('4h');
  const [fillMethod, setFillMethod] = useState<'locf' | 'linear'>('locf');
  const [showAnomalyBands, setShowAnomalyBands] = useState(true);
  const [showEma, setShowEma] = useState(true);

  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [tierInfo, setTierInfo] = useState({
    tier: 'T1_RAW',
    docsScanned: 0,
    serverMs: 0,
    pointsCount: 0
  });
  const [summary, setSummary] = useState({
    min: 0,
    max: 0,
    avg: 0,
    p95: 0,
    count: 0
  });
  const [anomalyCount, setAnomalyCount] = useState(0);

  const presets = [
    { id: '1h', label: '1 HOUR (T1)', durationMs: 3600 * 1000 },
    { id: '4h', label: '4 HOURS (T1)', durationMs: 4 * 3600 * 1000 },
    { id: '24h', label: '24 HOURS (T1/T2)', durationMs: 24 * 3600 * 1000 },
    { id: '7d', label: '7 DAYS (T2)', durationMs: 7 * 24 * 3600 * 1000 },
    { id: '30d', label: '30 DAYS (T2)', durationMs: 30 * 24 * 3600 * 1000 },
    { id: '6mo', label: '6 MONTHS (T3)', durationMs: 180 * 24 * 3600 * 1000 },
    { id: '1y', label: '1 YEAR (T3)', durationMs: 365 * 24 * 3600 * 1000 }
  ];

  const fetchData = async () => {
    setLoading(true);
    const selectedPreset = presets.find(p => p.id === rangePreset) || presets[1];
    const now = new Date();
    const from = new Date(now.getTime() - selectedPreset.durationMs);

    try {
      const url = `/api/series?deviceId=${encodeURIComponent(deviceId)}&metric=${encodeURIComponent(metric)}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(now.toISOString())}&fillMethod=${fillMethod}&withAnomalyData=${showAnomalyBands}&maxPoints=1000`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        setChartData(json.points || []);
        setTierInfo({
          tier: json.tier || 'T1_RAW',
          docsScanned: json.docsScanned || 0,
          serverMs: json.serverMs || 0,
          pointsCount: json.points?.length || 0
        });
        if (json.summary) setSummary(json.summary);
        setAnomalyCount(json.anomalyCount || 0);
      }
    } catch (err) {
      console.error('Failed to load explorer series:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [deviceId, metric, rangePreset, fillMethod, showAnomalyBands]);

  return (
    <div>
      {/* Controls Bar */}
      <div className="paper-strip" style={{ padding: '16px', marginBottom: '16px' }}>
        <div className="recorder-header" style={{ margin: '-16px -16px 16px -16px' }}>
          <h4 style={{ margin: 0 }}>SMART QUERY ROUTER & IN-DATABASE ANOMALY EXPLORER</h4>
          <span className="stamp-badge stamp-neutral">MONGODB $FACET EXECUTION</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
              TARGET DEVICE
            </label>
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px',
                fontFamily: 'var(--font-mono)',
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-main)'
              }}
            >
              {devices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>{d.deviceId}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
              TELEMETRY METRIC
            </label>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px',
                fontFamily: 'var(--font-mono)',
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-main)'
              }}
            >
              <option value="temperature_c">temperature_c (°C)</option>
              <option value="battery_v">battery_v (V)</option>
              <option value="humidity_pct">humidity_pct (%)</option>
              <option value="pressure_hpa">pressure_hpa (hPa)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
              GAP-FILL ALGORITHM ($fill)
            </label>
            <select
              value={fillMethod}
              onChange={(e) => setFillMethod(e.target.value as any)}
              style={{
                width: '100%',
                padding: '6px 10px',
                fontFamily: 'var(--font-mono)',
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-main)'
              }}
            >
              <option value="locf">LOCF (Last Observation Carried Forward)</option>
              <option value="linear">Linear Interpolation</option>
            </select>
          </div>
        </div>

        {/* Range Buttons */}
        <div style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
            HISTORICAL WINDOW (ROUTER RESOLUTION TIER):
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {presets.map(p => (
              <button
                key={p.id}
                onClick={() => setRangePreset(p.id)}
                className={`btn ${rangePreset === p.id ? 'btn-primary' : ''}`}
                style={{ fontSize: '0.8rem', padding: '5px 12px' }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Feature Toggles */}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showAnomalyBands}
              onChange={(e) => setShowAnomalyBands(e.target.checked)}
            />
            Show μ ± 3σ Envelope ($setWindowFields)
          </label>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showEma}
              onChange={(e) => setShowEma(e.target.checked)}
            />
            Show Rolling EMA Trace ($expMovingAvg alpha=0.2)
          </label>

          <button
            onClick={fetchData}
            className="btn"
            style={{ marginLeft: 'auto', fontSize: '0.8rem' }}
          >
            🔄 RE-EVALUATE PIPELINE
          </button>
        </div>
      </div>

      {/* Router Badge */}
      <div style={{ marginBottom: '16px' }}>
        <RouterBadge
          tier={tierInfo.tier}
          docsScanned={tierInfo.docsScanned}
          serverMs={tierInfo.serverMs}
          pointsReturned={tierInfo.pointsCount}
        />
      </div>

      {/* Summary Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div className="paper-strip" style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>MINIMUM</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{summary.min}</div>
        </div>
        <div className="paper-strip" style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>MAXIMUM</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{summary.max}</div>
        </div>
        <div className="paper-strip" style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>MEAN (μ)</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{summary.avg}</div>
        </div>
        <div className="paper-strip" style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>P95 PERCENTILE</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{summary.p95}</div>
        </div>
        <div className="paper-strip" style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>DETECTED ANOMALIES</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: anomalyCount > 0 ? 'var(--alarm-red)' : 'inherit' }}>
            {anomalyCount}
          </div>
        </div>
      </div>

      {/* Explorer Strip Chart */}
      <StripChart
        title={`HISTORICAL EXPLORATION: ${deviceId} [${metric}] (${rangePreset})`}
        unit={metric.includes('temp') ? '°C' : metric.includes('battery') ? 'V' : metric.includes('hum') ? '%' : 'hPa'}
        points={chartData}
        theme={theme}
        height={340}
        showAnomalyBands={showAnomalyBands}
        showEma={showEma}
      />
    </div>
  );
};
