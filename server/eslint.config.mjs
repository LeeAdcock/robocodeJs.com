import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/member-ordering': [
        'error',
        { default: ['signature', 'field', 'constructor', 'method'] },
      ],
    },
  },
  // Tests are linted too (CI runs `eslint src test`), but they build partial
  // mock shapes — a tank with three fields where the class has twenty — and
  // typing those fully adds noise without adding safety. `any` is the
  // deliberate idiom there, so the rule is off for tests rather than carried
  // as scattered disable comments. Every other rule still applies.
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
