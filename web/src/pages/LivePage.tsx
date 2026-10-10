import React, { useState } from 'react';
import { StripChart, ChartPoint } from '../components/StripChart.js';
import { LaneIndicator } from '../components/LaneIndicator.js';
import { AlertTicker, AlertItem } from '../components/AlertTicker.js';

interface DeviceItem {
  deviceId: string;
  facilityId: string;
  model: string;
  firmware: string;
  status: string;
  lastSeen: string;
  batteryPct: number;
}

interface LivePageProps {
  theme: 'light' | 'dark';
  devices: DeviceItem[];
  selectedDevice: string;
  onSelectDevice: (id: string) => void;
  seriesPoints: ChartPoint[];
  alerts: AlertItem[];
  laneStats: any;
}

export const LivePage: React.FC<LivePageProps> = ({
  theme,
  devices,
  selectedDevice,
  onSelectDevice,
  seriesPoints,
  alerts,
  laneStats
}) => {
  const [selectedMetric, setSelectedMetric] = useState('temperature_c');

  const selectedDevObj = devices.find(d => d.deviceId === selectedDevice) || devices[0];

  return (
    <div>
      {/* Alert Ticker */}
      <AlertTicker alerts={alerts} />

      {/* Lane Indicator */}
      <LaneIndicator stats={laneStats} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        {/* Device Selection & Fleet Status */}
        <div className="paper-strip" style={{ padding: '16px' }}>
          <div className="recorder-header" style={{ margin: '-16px -16px 16px -16px' }}>
            <h4 style={{ margin: 0 }}>ACTIVE FLEET SENSORS ({devices.length})</h4>
            <span className="stamp-badge stamp-active" style={{ fontSize: '0.75rem' }}>ONLINE</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto' }}>
            {devices.map((dev) => {
              const isSelected = dev.deviceId === selectedDevice;
              return (
                <button
                  key={dev.deviceId}
                  onClick={() => onSelectDevice(dev.deviceId)}
                  className="btn"
                  style={{
                    width: '100%',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    backgroundColor: isSelected ? 'var(--bg-elevated)' : 'transparent',
                    borderColor: isSelected ? 'var(--alarm-red)' : 'var(--border-color)',
                    borderLeftWidth: isSelected ? '4px' : '1px',
                    textAlign: 'left'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{dev.deviceId}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {dev.facilityId} • {dev.model} ({dev.firmware})
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>🔋 {dev.batteryPct}%</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {new Date(dev.lastSeen).toLocaleTimeString()}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Device Telemetry Info */}
        <div className="paper-strip" style={{ padding: '16px' }}>
          <div className="recorder-header" style={{ margin: '-16px -16px 16px -16px' }}>
            <h4 style={{ margin: 0 }}>CHANNEL CALIBRATION: {selectedDevObj?.deviceId}</h4>
            <span className="stamp-badge stamp-neutral">HW REVISION {selectedDevObj?.firmware}</span>
          </div>

          <table className="data-table" style={{ marginBottom: '16px' }}>
            <tbody>
              <tr><td>Hardware Model</td><td><code>{selectedDevObj?.model}</code></td></tr>
              <tr><td>Firmware Signature</td><td><code>{selectedDevObj?.firmware}</code></td></tr>
              <tr><td>Facility Node</td><td><code>{selectedDevObj?.facilityId}</code></td></tr>
              <tr><td>Battery Gauge</td><td><strong>{selectedDevObj?.batteryPct}%</strong></td></tr>
              <tr><td>Heartbeat Timestamp</td><td>{new Date(selectedDevObj?.lastSeen || Date.now()).toLocaleTimeString()}</td></tr>
            </tbody>
          </table>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>STREAM CHANNEL:</span>
            {['temperature_c', 'battery_v', 'humidity_pct', 'pressure_hpa'].map(metric => (
              <button
                key={metric}
                onClick={() => setSelectedMetric(metric)}
                className={`btn ${selectedMetric === metric ? 'btn-primary' : ''}`}
                style={{ fontSize: '0.75rem', padding: '4px 10px' }}
              >
                {metric}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live Thermal Strip Chart */}
      <StripChart
        title={`THERMAL STRIP RECORDER: ${selectedDevObj?.deviceId} [${selectedMetric}]`}
        unit={selectedMetric.includes('temp') ? '°C' : selectedMetric.includes('battery') ? 'V' : selectedMetric.includes('hum') ? '%' : 'hPa'}
        points={seriesPoints}
        theme={theme}
        height={300}
      />
    </div>
  );
};
