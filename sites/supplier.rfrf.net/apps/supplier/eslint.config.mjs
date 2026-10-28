import { nextJsConfig } from "@rafraf/eslint-config/next-js";

/** @type {import("eslint").Linter.Config} */
export default [
  ...nextJsConfig,
  {
    files: ['**/*.test.mjs'],
    languageOptions: { globals: { process: 'readonly' } },
  },
];
