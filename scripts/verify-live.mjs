#!/usr/bin/env node
// Live verification script (zero dependencies, Node >= 18 built-in fetch).
const BASE = process.argv[2] || process.env.LIVE_URL;
if (!BASE) {
  console.error('Usage: node scripts/verify-live.mjs <base-url>  (or set LIVE_URL)');
  process.exit(1);
}
const base = BASE.replace(/\/+$/, '');

let pass = 0;
let fail = 0;
const results = [];

async function check(name, method, url, { body = null, headers = {}, expected = 200 } = {}) {
  let status = -1;
  let note = '';
  try {
    const res = await fetch(url, {
      method,
      headers: { ...(body !== null ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== null ? JSON.stringify(body) : undefined
    });
    status = res.status;
    let data = null;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { /* non-JSON body */ }
    if (expected === 200 && Array.isArray(data)) note = `${data.length} item(s)`;
    else if (expected === 200 && data && typeof data === 'object') {
      if (data.error) note = `error: ${data.error}`;
      else if (data.status) note = `status=${data.status}`;
      else if (data.points) note = `${data.points.length} point(s)`;
      else if (data.totalGenerated !== undefined) note = `generated=${data.totalGenerated}`;
      else if (data.hotCount !== undefined) note = `hot=${data.hotCount} cold=${data.coldCount}`;
      else note = 'ok';
    } else if (expected === 401 && data && data.error) note = `error: ${data.error}`;
    else note = res.ok ? 'ok' : text.slice(0, 80);
  } catch (err) {
    note = `request failed: ${err.message}`;
  }
  const ok = status === expected;
  if (ok) pass++; else fail++;
  const line = `${ok ? 'PASS' : 'FAIL'}  ${status}  ${method} ${url.replace(base, '')} - ${name} (${note})`;
  console.log(line);
  results.push({ name, ok, status });
  return { ok, status, note };
}

console.log(`Verifying live PulseMetric deployment at ${base}\n`);

// 1. Health
await check('health check', 'GET', `${base}/api/health`, { expected: 200 });

// 2. Devices
let firstDevice = null;
let firstMetric = null;
try {
  const res = await fetch(`${base}/api/devices`);
  const devices = await res.json();
  if (res.ok && Array.isArray(devices) && devices.length > 0) {
    firstDevice = devices[0];
    firstMetric = firstDevice.metric || (Array.isArray(firstDevice.metrics) && firstDevice.metrics[0]) || 'temperature_c';
    console.log(`INFO  ${res.status}  GET /api/devices - first device: ${firstDevice.deviceId || firstDevice._id}, metric: ${firstMetric}`);
  }
} catch {}
await check('device registry', 'GET', `${base}/api/devices`, { expected: 200 });

// 3. Series (first device + metric, last 4 hours)
if (firstDevice) {
  const deviceId = firstDevice.deviceId || String(firstDevice._id);
  const to = new Date();
  const from = new Date(to.getTime() - 4 * 3600 * 1000);
  const q = `deviceId=${encodeURIComponent(deviceId)}&metric=${encodeURIComponent(firstMetric)}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  await check('time-series query', 'GET', `${base}/api/series?${q}`, { expected: 200 });
} else {
  fail++;
  console.log('FAIL  -    GET /api/series - no devices returned by /api/devices, cannot build series query');
  results.push({ name: 'time-series query', ok: false, status: -1 });
}

// 4-6. Lanes, alerts, benchmarks
await check('lane stats', 'GET', `${base}/api/lanes/stats`, { expected: 200 });
await check('recent alerts', 'GET', `${base}/api/alerts?limit=5`, { expected: 200 });
await check('engine benchmarks', 'GET', `${base}/api/engine/benchmarks`, { expected: 200 });

// 7. Demo outage (POST)
await check('demo outage generator', 'POST', `${base}/api/demo/outage`, {
  body: { deviceId: 'demo-ship-alpha', hoursOffline: 2, includeLiveBurst: true },
  expected: 200
});

// 8. Ingest without API key (expect 401)
await check('ingest without x-api-key rejected', 'POST', `${base}/api/ingest`, {
  body: { deviceId: 'demo-ship-alpha', ts: new Date().toISOString(), temp_c: 21.5 },
  expected: 401
});

console.log('\n=== SUMMARY ===');
console.log(`PASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  console.log('RESULT: FAIL');
  process.exit(1);
} else {
  console.log('RESULT: PASS');
}
