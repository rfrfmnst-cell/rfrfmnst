import { PrismaClient } from '@prisma/client';
import { assertExactDatabaseEndpointIdentity } from './database-endpoint-identity.mjs';

const expectedProject = process.env.EXPECTED_NEON_PROJECT_ID?.trim() ?? '';
const expectedBranch = process.env.EXPECTED_NEON_BRANCH_ID?.trim() ?? '';

if (!/^[a-z0-9][a-z0-9-]{2,63}$/u.test(expectedProject)) {
  throw new Error('EXPECTED_NEON_PROJECT_ID is invalid');
}
if (!/^br-[a-z0-9][a-z0-9-]{2,63}$/u.test(expectedBranch)) {
  throw new Error('EXPECTED_NEON_BRANCH_ID is invalid');
}

const prisma = new PrismaClient();
try {
  const [identity] = await prisma.$queryRaw`
    SELECT
      current_setting('neon.project_id', true) AS project_id,
      current_setting('neon.branch_id', true) AS branch_id
  `;
  assertExactDatabaseEndpointIdentity(identity, {
    projectId: expectedProject,
    branchId: expectedBranch,
  });
  console.log('Neon database branch identity verified.');
} finally {
  await prisma.$disconnect();
}
