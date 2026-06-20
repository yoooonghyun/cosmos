# Bug Report: slack-replies-affordance-trim (v1)

- **Status:** Fixed
- **Reported:** 2026-06-20
- **Severity:** cosmetic (redundant UI on shared Slack message row)

## Symptom (Step 1)

1. Slack thread **side-panel** (right-docked thread view) 의 **시작(root) 메세지**에 "N replies"
   표시가 뜸 — 이미 그 쓰레드 안인데 root 메세지에 replies 라벨이 중복으로 보임.
2. Slack **본문** 메세지 목록의 replies affordance — "replies" 텍스트 **앞에 아이콘**
   (`MessageSquare`)이 붙어 있음.

## Expected vs Actual

- **Expected:** (1) 쓰레드 패널 root 메세지에 replies 표시 없음. (2) 본문 replies 컨트롤에
  아이콘 없이 텍스트만.
- **Actual:** (1) root 메세지에 "N replies" 라벨 렌더. (2) "replies" 앞에 말풍선 아이콘.

## Reproduction

1. 앱 실행, Slack 연결, 채널 진입.
2. 본문에서 replies 있는 메세지 → affordance 앞에 아이콘 보임.
3. replies 클릭 → 오른쪽 쓰레드 패널 열림 → header 아래 root 메세지에 "N replies" 또 보임.

## Scope gate (Step 1.5)

- **Decision:** bug cycle 유지 — renderer 단일 레이어, 새 contract 없음, JSX 2곳 제거.
  shared `SlackMessageRow` + `SlackThreadPanel` root 재구성만 손댐.

## Classification & Route (Step 2)

- **Class:** Design defect (중복/불필요 affordance 제거). underlying logic 정상, 표시만 과함.
- **Route:** 디자인 의도가 user 요청에 명시적(아이콘 제거, root replies 제거) + 변경이
  기계적 JSX 삭제 → 메인 세션에서 직접 처리. 토큰/컴포넌트 신설 없음.

## Root cause (Step 3)

- **본문 아이콘:** `src/renderer/slackCatalog/SlackMessageRow.tsx:152` —
  `RepliesAffordance` interactive 변형이 label 앞에 `<MessageSquare aria-hidden="true" />`를
  렌더. 라벨 자체가 의미 전달 → 아이콘은 장식, 요청대로 제거.
- **쓰레드 패널 root replies:** `src/renderer/SlackPanel.tsx` `SlackThreadPanel`가 `parent`
  `SlackMessage`를 재구성할 때 `replyCount`를 포함(`...(context.replyCount !== undefined ...)`)
  → header 아래 `<MessageRow message={parent} />`가 muted "N replies" 라벨을 렌더. 이미
  쓰레드 내부이므로 root의 replyCount는 불필요 → parent 재구성에서 `replyCount` 제외.

## Fix (Step 4, minimal)

1. `SlackMessageRow.tsx` — `RepliesAffordance` interactive 변형에서 `<MessageSquare/>` 줄 삭제,
   더 이상 쓰지 않는 `MessageSquare` import 제거(`Maximize2`만 남김).
2. `SlackPanel.tsx` `SlackThreadPanel` — `parent` 재구성에서 `replyCount` 스프레드 제거 →
   root 행이 `RepliesAffordance` §3.3 경로(null)로 떨어져 표시 안 됨.

## Test (Step 5, regression)

`slackThreadPanelLogic` 는 pure 하지만 두 수정 모두 JSX 표현이라 node-env 단위 테스트로
직접 못 잡음. `RepliesAffordance` 로직은 그대로(아이콘만 제거)라 새 로직 분기 없음. root
replyCount 제외는 데이터 형태 변경 — `threadPanelParentFields` 같은 순수 헬퍼로 빼서
node 테스트하기엔 과한 추상화(ponytail). 대신 `SlackThreadPanel` parent 재구성이
replyCount 를 빼는지 정적으로 보장 + 본문 affordance 변경은 시각 확인.

→ 채택: 변경을 순수 함수로 추출하지 않고, 기존 `RepliesAffordance` §3.3(replyCount 없으면
null) 계약에 의존. parent 에서 replyCount 만 빼면 그 계약이 보장. 회귀는 GUI 확인.

## Verify (Step 6)

- `npm run typecheck` clean (제거한 import 로 인한 unused 없음 확인).
- `npm test` green.
- GUI: 본문 replies 아이콘 없음 / 쓰레드 패널 root 메세지 replies 표시 없음 — 실행 확인 필요.
