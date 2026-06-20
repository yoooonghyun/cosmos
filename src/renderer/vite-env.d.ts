/// <reference types="vite/client" />

// Ambient types for Vite's special import suffixes in the renderer build. `vite/client`
// declares `*?worker` (a default-exported Worker constructor), `*?url`, `*?raw`, etc., so
// `monaco-editor/...editor.worker?worker` (used by `fileExplorer/monacoSetup.ts`) typechecks
// under tsconfig.web. electron-vite bundles these for both dev and packaged builds.
