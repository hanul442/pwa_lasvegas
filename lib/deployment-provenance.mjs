function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeCommit(value) {
  const commit = clean(value)?.toLowerCase() ?? null;
  if (!commit) return null;
  return /^[0-9a-f]{7,40}$/.test(commit) ? commit : null;
}

export function commitMatches(expected, actual) {
  const left = normalizeCommit(expected);
  const right = normalizeCommit(actual);
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

export function assessDeployment({ expectedCommit, version, health, state }) {
  const expected = normalizeCommit(expectedCommit);
  const actual = normalizeCommit(version?.commit);
  const checks = {
    expectedCommitValid: Boolean(expected),
    healthOk: health?.ok === true && health?.service === 'social-vegas',
    versionServiceOk: version?.service === 'social-vegas',
    provenanceAvailable: version?.provenance === 'RUNTIME_ENV' && Boolean(actual),
    revisionMatches: Boolean(expected && actual && commitMatches(expected, actual)),
    stateShapeOk: Boolean(
      state?.user?.account &&
      Number.isFinite(Number(state.user.account.available)) &&
      Number.isFinite(Number(state.user.account.locked)) &&
      Array.isArray(state.floors) &&
      Array.isArray(state.ledger)
    )
  };
  return {
    ok: Object.values(checks).every(Boolean),
    expectedCommit: expected,
    actualCommit: actual,
    deploymentId: clean(version?.deploymentId),
    environment: clean(version?.environment),
    checks
  };
}
