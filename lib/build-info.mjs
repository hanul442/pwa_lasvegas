function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function buildInfo(env = process.env) {
  const commit = clean(env.RAILWAY_GIT_COMMIT_SHA) ?? clean(env.SOURCE_COMMIT) ?? null;
  const branch = clean(env.RAILWAY_GIT_BRANCH) ?? clean(env.SOURCE_BRANCH) ?? null;
  const deploymentId = clean(env.RAILWAY_DEPLOYMENT_ID) ?? null;
  const environment = clean(env.RAILWAY_ENVIRONMENT_NAME) ?? clean(env.NODE_ENV) ?? null;

  return {
    service: 'social-vegas',
    commit,
    branch,
    deploymentId,
    environment,
    provenance: commit ? 'RUNTIME_ENV' : 'UNAVAILABLE',
    mutable: false
  };
}
