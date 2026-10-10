import React from 'react';

interface RouterBadgeProps {
  tier: string;
  docsScanned: number;
  serverMs: number;
  pointsReturned: number;
}

export const RouterBadge: React.FC<RouterBadgeProps> = ({
  tier,
  docsScanned,
  serverMs,
  pointsReturned
}) => {
  const getTierColor = (t: string) => {
    if (t.includes('T1')) return '#10B981'; // Green
    if (t.includes('T2')) return '#3B82F6'; // Blue
    if (t.includes('T3')) return '#8B5CF6'; // Purple
    return '#F59E0B'; // Amber for stitched
  };

  const getTierLabel = (t: string) => {
    switch (t) {
      case 'T1_RAW': return 'TIER 1 (RAW HIGH-RES)';
      case 'T2_ROLLUP_5M': return 'TIER 2 (5-MIN ROLLUP)';
      case 'T3_ROLLUP_1H': return 'TIER 3 (1-HOUR ROLLUP)';
      case 'STITCHED_T1_T2': return 'SEAM-STITCHED (T1 + T2)';
      case 'STITCHED_T2_T3': return 'SEAM-STITCHED (T2 + T3)';
      default: return t;
    }
  };

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '12px',
      padding: '8px 14px',
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-color)',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.85rem'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          width: '10px',
          height: '10px',
          borderRadius: '2px',
          backgroundColor: getTierColor(tier)
        }} />
        <span style={{ fontWeight: 600 }}>ROUTER:</span>
        <span style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 700,
          color: getTierColor(tier),
          fontSize: '0.95rem'
        }}>
          {getTierLabel(tier)}
        </span>
      </div>

      <span style={{ color: 'var(--border-strong)' }}>|</span>

      <div>
        <span style={{ color: 'var(--text-muted)' }}>DOCS SCANNED: </span>
        <strong style={{ color: 'var(--text-main)' }}>{docsScanned.toLocaleString()}</strong>
      </div>

      <span style={{ color: 'var(--border-strong)' }}>|</span>

      <div>
        <span style={{ color: 'var(--text-muted)' }}>SERVER TIMING: </span>
        <strong style={{ color: 'var(--text-main)' }}>{serverMs} ms</strong>
      </div>

      <span style={{ color: 'var(--border-strong)' }}>|</span>

      <div>
        <span style={{ color: 'var(--text-muted)' }}>POINTS: </span>
        <strong style={{ color: 'var(--text-main)' }}>{pointsReturned.toLocaleString()}</strong>
      </div>
    </div>
  );
};
