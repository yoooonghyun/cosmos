# Bug Report: terminal-panel-tone-mismatch (v1)

- **Status:** Fixed
- **Reported:** 2026-06-20
- **Severity:** cosmetic (visible tone inconsistency between panels)

## Symptom (Step 1)

Terminal 패널의 화면톤(배경 명도)이 다른 패널들(Slack, Jira, …)과 다르게 보임.

## Expected vs Actual

- **Expected:** 터미널 화면 배경이 다른 패널 표면과 동일한 톤.
- **Actual:** 터미널 screen이 미묘하게 다른(더 어두운) 톤.

## Reproduction

1. 앱 실행, dark 테마.
2. Terminal 패널과 Slack/Jira 패널을 나란히 비교.
3. 터미널 screen 배경이 다른 패널 본문 표면과 미묘하게 다른 톤.

## Root cause (Step 3)

`src/renderer/TerminalPanel.tsx:127` — xterm `Terminal`을 **하드코딩 hex**로 생성:

```ts
theme: { background: '#1e1e1e', foreground: '#e0e0e0' }
```

- 모든 패널 `<section>` wrapper = `bg-card` (`SlackPanel.tsx:859`, `JiraPanel.tsx:449`, `TerminalPanel.tsx:438`).
- dark 토큰 (`src/renderer/index.css:217-220`): `--background: #1e1e1e`, **`--card: #1b1b1c`**, `--card-foreground: #e0e0e0`.
- 터미널 xterm screen은 `#1e1e1e`(= `--background`)로 채워지지만, 그 컨테이너(패널 표면)는 `--card` = `#1b1b1c`. **#1e1e1e vs #1b1b1c 차이가 보이는 톤 불일치.**
- foreground(`#e0e0e0`)는 우연히 `--card-foreground`와 일치 → 글자색은 문제 없음, 배경만 어긋남.
- 추가 문제: raw hex라 **테마 토큰을 추종하지 못함** — light 테마(`index.css:152` `--background:#ffffff`)에서는 터미널만 어두운 `#1e1e1e`로 남아 더 크게 어긋남. awaiting empty-state도 같은 `#1e1e1e` 가정(`TerminalPanel.tsx:285` 주석)에 의존.

## Scope gate (Step 1.5)

- **Decision:** bug cycle 유지 — 단일 레이어(renderer `TerminalPanel.tsx`), 새 contract 없음. raw hex → 디자인 토큰 정렬.

## Classification & Route (Step 2)

- **Class:** Design defect (raw hex / 디자인 시스템 불일치) + 작은 impl 처리(xterm theme는 CSS var를 직접 못 받음 → 런타임 computed token 읽어 전달).
- **Route:** `designer`가 대상 토큰 확정(`--card`로 다른 패널 표면과 일치) → `developer`가 xterm theme를 해당 토큰 computed 값으로 배선하고 empty-state `#1e1e1e` 가정 제거.

## Proposed fix (minimal)

xterm theme를 하드코딩 대신 `getComputedStyle(document.documentElement)`로 `--card` / `--card-foreground`를 읽어 전달 (light/dark 모두 추종). awaiting empty-state도 `bg-card`로.

## Fix (Steps 3–5)

- **New pure helper** `src/renderer/terminalTheme.ts` — `terminalThemeFromTokens(read)` maps
  `--card` → `background` and `--card-foreground` → `foreground` (NOT `--background`), trims
  whitespace, and falls back to the dark defaults (`#1b1b1c` / `#e0e0e0`) on an empty/missing
  token. Token-reader arg keeps it DOM-free for the node-env vitest split.
- **`src/renderer/TerminalPanel.tsx`** — replaced the hardcoded
  `theme: { background: '#1e1e1e', foreground: '#e0e0e0' }` with
  `theme: terminalThemeFromTokens((name) => getComputedStyle(document.documentElement).getPropertyValue(name))`,
  read once at Terminal construction. Updated the awaiting empty-state comment (now sits on
  `bg-card`).
- **`src/renderer/TerminalPanel.css`** — `.terminal-panel` background `#1e1e1e` → `var(--card)`
  so the empty state + container share the xterm screen tone.
- **Runtime theme switching:** cosmos forces `.dark` at startup (`main.tsx:8`) and has NO
  runtime light/dark toggle, so reading the token ONCE at construct is correct + sufficient.
  Noted with a `ponytail:` comment in `terminalTheme.ts` naming the ceiling (re-read + re-set
  `term.options.theme` on switch if a toggle is ever added).

## Test (regression)

`src/renderer/terminalTheme.test.ts` (node env, no DOM): asserts `--card`→background /
`--card-foreground`→foreground (and explicitly NOT `#1e1e1e` = `--background`), whitespace
trimming, full + per-token safe fallback. Fails against the old hardcoded behavior; passes now.

## Verify

`npm run typecheck` clean; `npm test` green (1467 pass, incl. the 4 new cases). Visual tone
cannot be confirmed headlessly — **please run the app and confirm the terminal screen background
now matches the Slack/Jira panel body tone (no darker patch).**
