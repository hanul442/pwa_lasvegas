import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRuntimeVersion, runtimeStatus } from '../public/runtime-provenance.js';

test('normalizes Railway-style build metadata',()=>{
  assert.deepEqual(normalizeRuntimeVersion({gitCommit:'abc123',gitBranch:'main',deployment_id:'dep-1',environment:'production'}),{
    commit:'abc123',branch:'main',deploymentId:'dep-1',environment:'production',provenanceAvailable:true
  });
});

test('fails visibly when provenance is unavailable',()=>{
  const s=runtimeStatus({provenanceAvailable:false});
  assert.equal(s.kind,'warn');
  assert.match(s.label,/UNAVAILABLE/);
});

test('identifies known runtime revision',()=>{
  const s=runtimeStatus({commit:'4e6e9499ba90e3789df492727c9c5267aa68c680',branch:'main',provenanceAvailable:true});
  assert.equal(s.kind,'ok');
  assert.match(s.detail,/4e6e9499ba90/);
  assert.match(s.detail,/main/);
});
