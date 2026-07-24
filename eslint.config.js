// @ts-check
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/dist/',
      '**/node_modules/',
      '**/coverage/',
      '**/.wrangler/',
      '.claude/worktrees/**',
      '.remember/**',
      '.changeset/changelog-atrib.cjs',
      'packages/directory/wasm/**',
      'services/log-node/Dockerfile',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
        URLPattern: 'readonly',
        WebSocketPair: 'readonly',
      },
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Keep existing ESLint 10 findings visible while the repository pays down
      // the migration backlog. Parser failures and configuration errors still fail.
      '@typescript-eslint/no-unused-expressions': 'warn',
      // Allow unused vars prefixed with _ (including destructured)
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      // The codebase uses explicit any sparingly and with eslint-disable comments
      '@typescript-eslint/no-explicit-any': 'warn',
      // Function type is used in adapter structural typing, acceptable
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      // Console is used intentionally in servers and demos (with eslint-disable)
      'no-console': 'warn',
      'no-cond-assign': 'warn',
      'no-control-regex': 'warn',
      'no-empty': 'warn',
      'no-redeclare': 'warn',
      'no-unsafe-finally': 'warn',
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      'preserve-caught-error': 'warn',
      'require-yield': 'warn',
    },
  },
)
