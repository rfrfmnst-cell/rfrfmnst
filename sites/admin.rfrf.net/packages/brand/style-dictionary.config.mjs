export default {
  source: ['tokens/**/*.json'],
  hooks: {
    formats: {
      'rafraf/typescript': ({ dictionary }) => {
        const rows = dictionary.allTokens.map(
          (token) => `  '${token.name}': ${JSON.stringify(token.value)},`,
        );
        return `export const rafrafTokens = {\n${rows.join('\n')}\n} as const;\n\nexport type RafrafToken = keyof typeof rafrafTokens;\n`;
      },
    },
  },
  platforms: {
    css: {
      transformGroup: 'css',
      prefix: 'rr',
      buildPath: 'src/generated/',
      files: [{ destination: 'tokens.css', format: 'css/variables' }],
    },
    typescript: {
      transformGroup: 'js',
      buildPath: 'src/generated/',
      files: [{ destination: 'tokens.ts', format: 'rafraf/typescript' }],
    },
  },
};
