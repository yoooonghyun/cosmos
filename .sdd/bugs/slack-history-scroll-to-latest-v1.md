# Bug Report: slack-history-scroll-to-latest (v1)

- **Status:** Fixed (logic + wiring; scroll behavior needs visual confirmation)
- **Reported:** 2026-06-27
- **Severity:** usability (lands on oldest message, user must scroll down every time)

## Symptom (Step 1)

Slack 메세지 목록이 처음 로드될 때 **맨 위(가장 오래된 메세지)** 에 포커싱돼서 열림.
사용자는 매번 아래로 스크롤해야 최신 메세지를 봄. 처음 로드 / 채널 전환 시 **맨 아래(최신
메세지)** 로 자동 스크롤돼야 함.

## Expected vs Actual

- **Expected:** 초기 히스토리 로드 + 채널 전환 시 목록이 BOTTOM(최신 메세지)으로 스크롤된 채로
  열림. 위쪽 load-more(older)로 옛 메세지를 불러올 때는 현재 위치 유지(점프 금지). 메세지 전송
  후에도 자연스럽게 bottom.
- **Actual:** 항상 TOP(가장 오래된 메세지)에서 시작.

## Scope gate (Step 1.5)

- bug cycle 유지 — renderer 단일 레이어, 새 IPC contract 없음. 순수 결정 로직 1개(node-tested)
  + 작은 layout-effect 훅 + 두 리스트에 ref 부착. 레이아웃/클래스 변경 없음.

## Root cause (Step 3)

- Slack 메세지 리스트는 **newest-at-bottom**(ascending `ts`; `orderBoundMessages` + `MessageList`).
  새로 렌더된 스크롤 컨테이너는 `scrollTop = 0` = **TOP = 가장 오래된 메세지**. 그동안 어떤
  코드도 컨테이너를 bottom으로 스크롤하지 않았음.
- 두 surface 모두 동일 패턴:
  1. **NATIVE** 채널 히스토리 — `src/renderer/SlackPanel.tsx` `MessageList`(shadcn `ScrollArea`,
     실제 스크롤 요소는 Radix `[data-slot="scroll-area-viewport"]`).
  2. **GENERATIVE** — `src/renderer/slackCatalog/components.tsx` `MessageList`(plain
     `overflow-y-auto` div = `SLACK_LIST_SCROLL_CLASS`).

## Initial/switch vs prepend-older 구분 (핵심)

- NATIVE 리스트는 채널 전환/전송 시 **REMOUNT** 됨(React `key` = `${channel.id}-${historyReloadKey}`).
  따라서 fresh load = 새 컴포넌트 인스턴스, `items` 가 `0 -> N` 으로 전이.
- 한 mount 안에서 **처음으로 non-empty가 되는 순간** == 초기 로드 → bottom 스크롤.
- TOP load-more(older)는 같은 mount를 유지하고 `prependOlderMessages`로 count만 더 키움 →
  이미 스크롤한 인스턴스 → **스크롤 안 함**(위치 보존).
- 즉 결정식: `itemCount > 0 && !alreadyScrolled` — mount당 정확히 한 번만 bottom 스크롤. 전송은
  remount(새 key)라 같은 초기-로드 경로를 타서 자연히 bottom.
- GENERATIVE 리스트는 단일 mount지만 동일 latch: refresh(in-place re-sort) / loadMore(prepend)는
  이미 `alreadyScrolled=true` 라 건드리지 않음.

## Fix (Step 4, minimal)

1. `src/renderer/slackScrollToLatest.ts` (신규) — 순수 결정식 `shouldScrollToLatest({itemCount,
   alreadyScrolled})`. **node-testable**.
2. `src/renderer/slackScrollToLatest.test.ts` (신규) — vitest 5케이스(초기 로드 true, empty false,
   prepend/refresh false, 한 번만 true).
3. `src/renderer/useSlackScrollToLatest.ts` (신규) — `useLayoutEffect` 훅. ref를 스크롤 컨테이너에
   부착, `kind='self'`(plain div) 또는 `'radix-viewport'`(ScrollArea root → viewport 자식 query).
   결정식이 true면 `scroller.scrollTop = scroller.scrollHeight`, latch. **DOM 호출은 node-testable
   아님 — 시각 확인 필요.** `useLayoutEffect`라 paint 전 적용 → top-anchored 깜빡임 없음.
4. `src/renderer/components/ui/scroll-area.tsx` — `ScrollArea` 래퍼가 `ref`를 Radix Root로 forward
   하도록 추가(기존엔 ref 미전달).
5. `src/renderer/SlackPanel.tsx` `MessageList` — 훅 호출(`'radix-viewport'`), ref를 `ScrollArea`에
   부착. thread-dock 변형(`scroll=false`)은 ref 미부착(부모 dock이 스크롤 소유).
6. `src/renderer/slackCatalog/components.tsx` `MessageList` — 훅 호출(`'self'`), ref를 기존 스크롤
   div에 부착. **`SLACK_LIST_SCROLL_CLASS`/`layout.tsx`/fill chain 무변경** — ref만 추가라
   per-list independent scroll + scrollbar-hover-only 그대로.

## HARD constraint 준수

- 레이아웃/클래스/fill chain 일절 미변경. 기존 스크롤 요소에 ref만 부착 → 멀티 리스트 side-by-side
  독립 스크롤 + scrollbar-hover-only 유지.

## Tests / verification (Step 5)

- `npm run typecheck` (node + web): PASS, 깨끗.
- `slackScrollToLatest.test.ts`: 5/5 PASS.
- 전체 `vitest run`: 회귀 확인.
- **DOM 스크롤 동작 자체는 headless 불가 — 실제 앱에서 시각 확인 필요**(채널 진입 시 bottom,
  위 load-more 시 위치 유지, 전송 후 bottom).
