import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.js';
import { LivePage } from './pages/LivePage.js';
import { ExplorerPage } from './pages/ExplorerPage.js';
import { LateDataLabPage } from './pages/LateDataLabPage.js';
import { EngineRoomPage } from './pages/EngineRoomPage.js';
import { ChartPoint } from './components/StripChart.js';
import { AlertItem } from './components/AlertTicker.js';

export const App: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [currentRoute, setCurrentRoute] = useState('live');
  const [isConnected, setIsConnected] = useState(false);
  const [devices, setDevices] = useState<any[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('pm-device-001');
  const [seriesPoints, setSeriesPoints] = useState<ChartPoint[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [laneStats, setLaneStats] = useState<any | null>(null);

  // Hash router
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#/', '').replace('#', '');
      if (['live', 'explorer', 'lab', 'engine'].includes(hash)) {
        setCurrentRoute(hash);
      } else {
        setCurrentRoute('live');
      }
    };

    window.addEventListener('hashchange', handleHash);
    handleHash();
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
    setCurrentRoute(route);
  };

  // Theme management
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  // Fetch registered devices
  const fetchDevices = async () => {
    try {
      const res = await fetch('/api/devices');
      if (res.ok) {
        const data = await res.json();
        setDevices(data);
        if (data.length > 0 && !data.some((d: any) => d.deviceId === selectedDevice)) {
          setSelectedDevice(data[0].deviceId);
        }
      }
    } catch {}
  };

  // Fetch lane statistics
  const fetchLaneStats = async () => {
    try {
      const res = await fetch('/api/lanes/stats');
      if (res.ok) {
        const data = await res.json();
        setLaneStats(data);
      }
    } catch {}
  };

  // Fetch live series points for selected device
  const fetchLiveSeries = async () => {
    if (!selectedDevice) return;
    try {
      const now = new Date();
      const from = new Date(now.getTime() - 15 * 60 * 1000); // last 15 min
      const res = await fetch(`/api/series?deviceId=${encodeURIComponent(selectedDevice)}&metric=temperature_c&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(now.toISOString())}&maxPoints=100`);
      if (res.ok) {
        const data = await res.json();
        setSeriesPoints(data.points || []);
      }
    } catch {}
  };

  // Initial load and polling
  useEffect(() => {
    fetchDevices();
    fetchLaneStats();
    fetchLiveSeries();

    const interval = setInterval(() => {
      fetchLaneStats();
      fetchLiveSeries();
    }, 4000);

    return () => clearInterval(interval);
  }, [selectedDevice]);

  // Server-Sent Events (SSE) for alerts stream
  useEffect(() => {
    let evtSource: EventSource | null = null;
    try {
      evtSource = new EventSource('/api/alerts/stream');
      evtSource.onopen = () => setIsConnected(true);
      evtSource.onerror = () => setIsConnected(false);
      evtSource.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === 'alert' && payload.alert) {
            setAlerts(prev => [payload.alert, ...prev.slice(0, 49)]);
          } else if (payload.type === 'connected') {
            setIsConnected(true);
          }
        } catch {}
      };
    } catch {
      setIsConnected(false);
    }

    return () => {
      if (evtSource) evtSource.close();
    };
  }, []);

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '16px' }}>
      <Header
        currentRoute={currentRoute}
        onNavigate={navigate}
        theme={theme}
        onToggleTheme={toggleTheme}
        isConnected={isConnected}
      />

      <main>
        {currentRoute === 'live' && (
          <LivePage
            theme={theme}
            devices={devices}
            selectedDevice={selectedDevice}
            onSelectDevice={setSelectedDevice}
            seriesPoints={seriesPoints}
            alerts={alerts}
            laneStats={laneStats}
          />
        )}

        {currentRoute === 'explorer' && (
          <ExplorerPage
            theme={theme}
            devices={devices}
          />
        )}

        {currentRoute === 'lab' && (
          <LateDataLabPage
            laneStats={laneStats}
            onRefreshStats={fetchLaneStats}
          />
        )}

        {currentRoute === 'engine' && (
          <EngineRoomPage />
        )}
      </main>

      <footer style={{
        marginTop: '32px',
        padding: '16px 0',
        borderTop: '1px solid var(--border-color)',
        fontSize: '0.8rem',
        color: 'var(--text-muted)',
        display: 'flex',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px'
      }}>
        <div>
          PULSEMETRIC • High-Velocity IoT Telemetry & Time-Series Analytics Engine
        </div>
        <div>
          MongoDB 7.0+ • Node.js 20 • TypeScript • Vite • React • uPlot
        </div>
      </footer>
    </div>
  );
};
