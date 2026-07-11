import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/generated/**',
      'playwright-report/**',
      'test-results/**'
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx']
  })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error'
    }
  },
  {
    files: ['**/*.config.ts', '**/*.config.mts', '**/*.config.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node
    },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off'
    }
  }
);
