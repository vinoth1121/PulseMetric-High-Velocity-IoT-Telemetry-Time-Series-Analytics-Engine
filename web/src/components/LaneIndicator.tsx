import React from 'react';

interface LaneStatsData {
  counters: {
    totalIngested: number;
    hotCount: number;
    coldCount: number;
    rejectedCount: number;
    deadLetterCount: number;
  };
  collections: {
    readingsHotEstimatedCount: number;
    readingsLateEstimatedCount: number;
    deadLetterCount: number;
  };
}

interface LaneIndicatorProps {
  stats: LaneStatsData | null;
}

export const LaneIndicator: React.FC<LaneIndicatorProps> = ({ stats }) => {
  const hot = stats?.counters.hotCount ?? 0;
  const cold = stats?.counters.coldCount ?? 0;
  const rejected = stats?.counters.rejectedCount ?? 0;
  const total = hot + cold || 1;
  const hotPct = Math.round((hot / total) * 100);
  const coldPct = Math.round((cold / total) * 100);

  return (
    <div className="paper-strip" style={{ padding: '14px 18px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h4 style={{ margin: 0 }}>DUAL-LANE INGESTION CLASSIFIER STATUS</h4>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          TOTAL: {(stats?.counters.totalIngested ?? 0).toLocaleString()} READINGS
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }}>
        <div style={{ padding: '8px 12px', backgroundColor: 'var(--bg-elevated)', borderLeft: '4px solid #10B981' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>🔥 HOT LANE (DRIFT ≤ 5M)</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{hot.toLocaleString()}</div>
          <div style={{ fontSize: '0.75rem', color: '#10B981' }}>{hotPct}% of traffic • Direct insertMany</div>
        </div>

        <div style={{ padding: '8px 12px', backgroundColor: 'var(--bg-elevated)', borderLeft: '4px solid #3B82F6' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>❄️ COLD LANE (DRIFT &gt; 5M BACKLOG)</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{cold.toLocaleString()}</div>
          <div style={{ fontSize: '0.75rem', color: '#3B82F6' }}>{coldPct}% of traffic • Sorted day-aligned</div>
        </div>

        <div style={{ padding: '8px 12px', backgroundColor: 'var(--bg-elevated)', borderLeft: '4px solid var(--alarm-red)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>🚫 REJECTED (&gt;7D OR FUTURE)</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{rejected.toLocaleString()}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Past retention limit / clock drift</div>
        </div>
      </div>

      {/* Visual Lane Distribution Bar */}
      <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--border-color)', display: 'flex', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ width: `${hotPct}%`, backgroundColor: '#10B981' }} title={`HOT: ${hotPct}%`} />
        <div style={{ width: `${coldPct}%`, backgroundColor: '#3B82F6' }} title={`COLD: ${coldPct}%`} />
        <div style={{ width: `${Math.min(100, Math.round((rejected / (total + rejected || 1)) * 100))}%`, backgroundColor: 'var(--alarm-red)' }} title={`REJECTED`} />
      </div>
    </div>
  );
};
