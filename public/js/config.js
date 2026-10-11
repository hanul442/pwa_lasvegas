// Where the game API lives. Empty means the same origin: the Cloudflare Worker serves both
// the pages and /api/*, and so does the local Node server. Set localStorage 'vegas:api'
// to point a local page at another API while testing.
function override() {
  try { return localStorage.getItem('vegas:api'); } catch { return null; }
}

export const API_BASE = override() ?? '';
