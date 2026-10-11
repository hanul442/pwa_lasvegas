// Where the game API lives. Empty means the same origin, i.e. the local Node server.
// On GitHub Pages the API is the Cloudflare Worker deployed from worker/.
const PAGES_API = 'https://vegas-api.kimwriter222.workers.dev';

function override() {
  try { return localStorage.getItem('vegas:api'); } catch { return null; }
}

export const API_BASE = override() ?? (location.hostname.endsWith('github.io') ? PAGES_API : '');
