import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

export default defineConfig(
  // .workbuddy-ai 是 AI 助手的本地临时脚本目录（已在 .gitignore），不参与检查
  // `scripts/` 是**独立工具脚本**（用 `npx electron scripts/xxx.js` 直接跑，不参与打包），
  // 不在 tsconfig 的 include 里，套 TS 规则只会得到一堆 "require 被禁止" 的噪音
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/.workbuddy-ai', 'scripts/**'] },
  tseslint.configs.recommended,
  eslintPluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        },
        extraFileExtensions: ['.vue'],
        parser: tseslint.parser
      }
    }
  },
  {
    files: ['**/*.{ts,mts,tsx,vue}'],
    rules: {
      'vue/require-default-prop': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/block-lang': [
        'error',
        {
          script: {
            lang: 'ts'
          }
        }
      ]
    }
  },
  eslintConfigPrettier
)
