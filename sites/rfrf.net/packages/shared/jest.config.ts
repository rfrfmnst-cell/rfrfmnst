import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { nestConfig } from '@rafraf/jest-config';

const resolveFromConfig = createRequire(import.meta.url);

export default {
  ...nestConfig,
  transform: {
    '^.+\\.(t|j)s$': [
      resolveFromConfig.resolve('ts-jest'),
      { tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url)) },
    ],
  },
};
