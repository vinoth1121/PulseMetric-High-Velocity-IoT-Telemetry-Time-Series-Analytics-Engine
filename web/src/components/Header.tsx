import React from 'react';

interface HeaderProps {
  currentRoute: string;
  onNavigate: (route: string) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  isConnected: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentRoute,
  onNavigate,
  theme,
  onToggleTheme,
  isConnected
}) => {
  const navItems = [
    { id: 'live', label: '1. LIVE RECORDER', icon: '⚡' },
    { id: 'explorer', label: '2. EXPLORER (ROUTER)', icon: '🔍' },
    { id: 'lab', label: '3. LATE-DATA LAB', icon: '🚢' },
    { id: 'engine', label: '4. ENGINE ROOM', icon: '⚙️' }
  ];

  return (
    <header className="paper-strip" style={{ marginBottom: '16px' }}>
      <div style={{
        padding: '12px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: isConnected ? '#10B981' : '#EF4444',
              display: 'inline-block',
              boxShadow: isConnected ? '0 0 8px #10B981' : 'none'
            }} />
            <h1 style={{ margin: 0, fontSize: '1.8rem', letterSpacing: '1px' }}>
              PULSEMETRIC
            </h1>
            <span className="stamp-badge stamp-neutral" style={{ fontSize: '0.75rem' }}>
              MONGODB 7.0 ENGINE
            </span>
          </div>
          <p style={{ margin: '2px 0 0 22px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Dual-Lane Time-Series Ingestion • In-Database Anomaly Pipeline • 3-Tier Downsampling Router
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={onToggleTheme}
            className="btn"
            title="Toggle Paper / Night Recorder Theme"
            aria-label={`Switch to ${theme === 'light' ? 'Night Recorder' : 'Thermal Paper'} theme`}
          >
            {theme === 'light' ? '🌙 NIGHT RECORDER' : '☀️ THERMAL PAPER'}
          </button>
        </div>
      </div>

      <nav style={{
        display: 'flex',
        borderTop: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-elevated)',
        overflowX: 'auto'
      }}>
        {navItems.map((item) => {
          const isActive = currentRoute === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: '1.05rem',
                fontWeight: 700,
                padding: '10px 20px',
                border: 'none',
                borderRight: '1px solid var(--border-color)',
                borderBottom: isActive ? '3px solid var(--alarm-red)' : '3px solid transparent',
                backgroundColor: isActive ? 'var(--bg-card)' : 'transparent',
                color: isActive ? 'var(--text-main)' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                whiteSpace: 'nowrap'
              }}
              aria-current={isActive ? 'page' : undefined}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </header>
  );
};
