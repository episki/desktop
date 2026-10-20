// Mirrors episki/core's lint setup. core gets these rules through @nuxt/eslint
// (`stylistic: true`); desktop isn't a Nuxt app, so the same presets are
// composed directly.
import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/', 'dist-electron/', 'node_modules/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  stylistic.configs.customize(),
  {
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
    },
  },
)
