const PROJECT = /^[a-z0-9][a-z0-9-]{2,63}$/u;
const BRANCH = /^br-[a-z0-9][a-z0-9-]{2,63}$/u;

export function assertExactDatabaseEndpointIdentity(actual, expected) {
  if (
    !PROJECT.test(expected?.projectId ?? '') ||
    !BRANCH.test(expected?.branchId ?? '') ||
    actual?.project_id !== expected.projectId ||
    actual?.branch_id !== expected.branchId
  ) {
    throw new Error(
      'Database connection is not bound to the exact expected Neon branch',
    );
  }
  return { projectId: actual.project_id, branchId: actual.branch_id };
}
