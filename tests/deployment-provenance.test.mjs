import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDeployment, commitMatches, normalizeCommit } from '../lib/deployment-provenance.mjs';

test('normalizeCommit accepts git sha forms only', () => {
  assert.equal(normalizeCommit(' ABCDEF1 '), 'abcdef1');
  assert.equal(normalizeCommit('not-a-sha'), null);
  assert.equal(normalizeCommit(''), null);
});

test('commitMatches accepts exact or unambiguous prefix forms', () => {
  assert.equal(commitMatches('8e5e48f5f10d69122ca3e92fa924841236368c3a', '8e5e48f'), true);
  assert.equal(commitMatches('8e5e48f', '8e5e48f5f10d69122ca3e92fa924841236368c3a'), true);
  assert.equal(commitMatches('8e5e48f', 'fa648f0'), false);
});

test('assessment fails closed on stale Railway provenance', () => {
  const result = assessDeployment({
    expectedCommit: '8e5e48f5f10d69122ca3e92fa924841236368c3a',
    health: { ok: true, service: 'social-vegas' },
    version: { service: 'social-vegas', commit: 'fa648f0b8abd29200fda6ec5cb2ecfc8af64b5e0', provenance: 'RUNTIME_ENV' },
    state: { user: { account: { available: 100000000, locked: 0 } }, floors: [], ledger: [] }
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.revisionMatches, false);
});

test('assessment passes only with health, state and exact runtime provenance', () => {
  const sha = '8e5e48f5f10d69122ca3e92fa924841236368c3a';
  const result = assessDeployment({
    expectedCommit: sha,
    health: { ok: true, service: 'social-vegas' },
    version: { service: 'social-vegas', commit: sha, provenance: 'RUNTIME_ENV', deploymentId: 'dep-1', environment: 'production' },
    state: { user: { account: { available: 100000000, locked: 0 } }, floors: [{ slug: 'strip' }], ledger: [] }
  });
  assert.equal(result.ok, true);
  assert.equal(result.actualCommit, sha);
});
