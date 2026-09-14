import { assessDeployment } from '../lib/deployment-provenance.mjs';

const base = (process.env.DEPLOY_URL || '').replace(/\/$/, '');
const expectedCommit = process.env.EXPECTED_COMMIT || process.env.GITHUB_SHA || '';
const playerId = process.env.SMOKE_PLAYER_ID || 'hanseo';

if (!base) {
  console.error('DEPLOY_URL is required');
  process.exit(2);
}
if (!expectedCommit) {
  console.error('EXPECTED_COMMIT (or GITHUB_SHA) is required');
  process.exit(2);
}

async function get(path, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${base}${path}`, {
      headers,
      signal: controller.signal,
      redirect: 'follow'
    });
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

try {
  const [health, version, state] = await Promise.all([
    get('/api/health'),
    get('/api/version'),
    get('/api/state', { 'x-player-id': playerId })
  ]);
  const result = assessDeployment({ expectedCommit, version, health, state });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exit(1);
}
