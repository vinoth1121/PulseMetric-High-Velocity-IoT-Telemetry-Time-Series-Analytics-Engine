import React from 'react';

export interface AlertItem {
  deviceId: string;
  metric: string;
  ts: string;
  value: number;
  mu: number;
  sigma: number;
  zScore: number;
  rule: string;
}

interface AlertTickerProps {
  alerts: AlertItem[];
}

export const AlertTicker: React.FC<AlertTickerProps> = ({ alerts }) => {
  return (
    <div className="paper-strip" style={{ marginBottom: '16px', overflow: 'hidden' }}>
      <div style={{
        padding: '8px 16px',
        backgroundColor: 'var(--alarm-bg)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <span className="stamp-badge stamp-danger" style={{ fontSize: '0.8rem' }}>
          🚨 REAL-TIME SSE ANOMALY TICKER
        </span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          (Trailing 30m window evaluated in-database via $densify + $fill + $setWindowFields)
        </span>
      </div>

      <div style={{ padding: '10px 16px', maxHeight: '120px', overflowY: 'auto' }}>
        {alerts.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No active anomalies detected across fleet. Stream listening on <code>/api/alerts/stream</code>...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {alerts.slice(0, 10).map((a, idx) => (
              <div
                key={`${a.deviceId}-${a.ts}-${idx}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  fontSize: '0.8rem',
                  padding: '4px 8px',
                  backgroundColor: 'var(--bg-elevated)',
                  borderLeft: '3px solid var(--alarm-red)'
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>
                  {new Date(a.ts).toLocaleTimeString()}
                </span>
                <strong>{a.deviceId}</strong>
                <span style={{ color: 'var(--text-muted)' }}>[{a.metric}]</span>
                <span style={{ color: 'var(--alarm-red)', fontWeight: 700 }}>
                  VAL: {Number(a.value).toFixed(2)}
                </span>
                <span>
                  μ={Number(a.mu).toFixed(1)} σ={Number(a.sigma).toFixed(2)}
                </span>
                <span className="stamp-badge stamp-danger" style={{ fontSize: '0.7rem' }}>
                  Z={Number(a.zScore).toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
