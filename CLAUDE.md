# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # start dev server with HMR (http://localhost:5173)
npm run build     # tsc type-check then vite build to dist/
npm run lint      # eslint across all .ts/.tsx files
npm run preview   # serve the production build locally
```

There is no test runner configured yet.

## Stack

- **React 19** + **TypeScript 6** + **Vite 8**
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin (no `tailwind.config.*` file needed — Tailwind 4 is configured in CSS)
- ESLint with `typescript-eslint`, `eslint-plugin-react-hooks`, and `eslint-plugin-react-refresh`

## Project status

This repo was scaffolded from the official Vite React-TS template. `src/App.tsx` still contains the default template content. The actual LeetCode scoreboard UI has not been built yet — the entry point to start building is `src/App.tsx`.

## Architecture notes

- Entry: `index.html` → `src/main.tsx` → `src/App.tsx`
- Global styles live in `src/index.css`; component-scoped styles in `src/App.css`
- Two tsconfig files: `tsconfig.app.json` (browser code) and `tsconfig.node.json` (vite config); `tsconfig.json` references both
- To enable type-aware lint rules, update `eslint.config.js` per the README instructions (adds `parserOptions.project`)
