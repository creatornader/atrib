// @ts-check
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      // Allow unused vars prefixed with _ (including destructured)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      // The codebase uses explicit any sparingly and with eslint-disable comments
      '@typescript-eslint/no-explicit-any': 'warn',
      // Function type is used in adapter structural typing — acceptable
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      // Console is used intentionally in servers and demos (with eslint-disable)
      'no-console': 'warn',
    },
  },
  {
    ignores: ['**/dist/', '**/node_modules/', '**/coverage/', 'services/log-node/Dockerfile'],
  },
)
