import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/migrations/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Boundary rule (docs/02 §4, docs/09 §4): provider SDKs are only imported
    // inside the Model Gateway's adapters. Everything else goes through the
    // gateway facade.
    files: ['**/*.ts'],
    ignores: ['packages/contexts/model-gateway/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@anthropic-ai/sdk',
              message: 'Provider SDKs may only be used inside @ai-system/model-gateway adapters.',
            },
            {
              name: 'openai',
              message: 'Provider SDKs may only be used inside @ai-system/model-gateway adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    // Context isolation: apps and other contexts must use the orchestration
    // facade (@ai-system/orchestration), never reach into its internals.
    files: ['apps/**/*.ts', 'packages/contexts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@ai-system/*/src/*', '@ai-system/*/dist/*'],
              message: 'Import context packages via their public facade only.',
            },
          ],
          paths: [
            {
              name: '@anthropic-ai/sdk',
              message: 'Provider SDKs may only be used inside @ai-system/model-gateway adapters.',
            },
            {
              name: 'openai',
              message: 'Provider SDKs may only be used inside @ai-system/model-gateway adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/contexts/model-gateway/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
);
