import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInfo } from '../lib/build-info.mjs';

test('buildInfo exposes Railway revision metadata without mutable authority', () => {
  assert.deepEqual(buildInfo({
    RAILWAY_GIT_COMMIT_SHA: 'abc123',
    RAILWAY_GIT_BRANCH: 'main',
    RAILWAY_DEPLOYMENT_ID: 'dep-1',
    RAILWAY_ENVIRONMENT_NAME: 'production'
  }), {
    service: 'social-vegas',
    commit: 'abc123',
    branch: 'main',
    deploymentId: 'dep-1',
    environment: 'production',
    provenance: 'RUNTIME_ENV',
    mutable: false
  });
});

test('buildInfo fails closed when revision metadata is unavailable', () => {
  const info = buildInfo({ NODE_ENV: 'test' });
  assert.equal(info.commit, null);
  assert.equal(info.branch, null);
  assert.equal(info.deploymentId, null);
  assert.equal(info.environment, 'test');
  assert.equal(info.provenance, 'UNAVAILABLE');
  assert.equal(info.mutable, false);
});
