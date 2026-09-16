import { loadState, persistenceInfo } from '../lib/store.mjs';

try {
  const state = await loadState();
  const info = persistenceInfo();
  console.log(`SOCIAL VEGAS persistence ready: backend=${info.backend} users=${Object.keys(state.users || {}).length}`);
} catch (error) {
  console.error('SOCIAL VEGAS persistence bootstrap failed:', error?.message || error);
  process.exit(1);
}

await import('../server.mjs');
