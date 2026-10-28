import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nestJsConfig } from '@rafraf/eslint-config/nest-js';

export default [
  ...nestJsConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.eslint.json',
        tsconfigRootDir: dirname(fileURLToPath(import.meta.url)),
      },
    },
  },
];
