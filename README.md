# 피클 오피스 · Pixel Office

픽셀 캐릭터들이 사무실을 돌아다니는 **개인 할 일 현황판 + 오피스 지시함**입니다.
GitHub Pages에서 바로 열리는 정적 페이지이고, 실제 데이터는 이 저장소에 들어 있지 않습니다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | 화면 뼈대 (탭: 할 일 현황판 / 오피스 지시함) |
| `assets/style.css` | 레이아웃·반응형(모바일 세로 배치 / 데스크톱 2단) |
| `assets/app.js` | 픽셀 오피스 렌더러(Canvas), 멤버 캐릭터, 할 일 보드, 지시함, 동기화 |
| `db/Code.gs` | 구글 시트 + Apps Script 웹앱 API 코드 (tasks · requests · members) |
| `db/SETUP.md` | 동기화 연결 방법과 API 요약 |

## 화면

- **왼쪽(모바일은 위): 픽셀 오피스 맵** — 4개 존(휴식·커피 / 할 일 현황판 / 매장 업무 / 일상·위스키 라운지).
  멤버 수만큼 캐릭터가 생기고 각자 색·모양·이름표를 가집니다. 상태 말풍선은 실제 할 일·지시에서 만들어집니다.
- **오른쪽(모바일은 아래): 패널** — 상단 탭으로 두 화면을 오갑니다.
  - **할 일 현황판**: 진행/대기/완료 카운터, 추가(제목·존·담당), 완료 체크, 담당 배지(눌러서 변경), 결과 메모(`✎`), 삭제, 존 필터.
  - **오피스 지시함**: `@단무지`·`@전체`·합류한 멤버 중 받을 사람을 고르고 지시를 보냅니다.
    상태(대기중 / 진행중 / 완료)와 답변(`reply`)이 카드에 그대로 보이고, 완료 건수는 탭 배지로 표시됩니다.
- **⚙ 설정**: 동기화 주소·PIN, 그리고 **오피스 멤버 목록과 1-click 초대 문구 복사**.

## 동작 방식

- **동기화 없음**: 할 일·지시가 브라우저 `localStorage`에만 저장됩니다. 저장소에는 샘플 항목만 있습니다.
- **동기화 연결**: ⚙ 에서 Apps Script 웹앱 주소와 PIN을 넣으면 구글 시트에서 읽어 오고,
  추가·완료·담당 변경·결과 메모·지시·답변이 시트에 다시 기록됩니다.
  주소와 PIN은 그 브라우저에만 저장되며 저장소 파일에는 남지 않습니다.

## 동기화 연결

1. 페이지 오른쪽 위 **⚙** → Apps Script 웹앱 주소와 PIN을 넣고 저장합니다.
2. 한 번만 열면 연결되는 설정 링크를 쓰려면 주소 뒤에 `#sync=` 를 붙입니다.
   `#sync=` 값은 `{"u":"웹앱 주소","p":"PIN"}` 을 base64url로 인코딩한 것입니다.
   열리면 값은 브라우저에만 저장되고 주소창에서는 사라집니다.

주소와 PIN은 저장소 파일에 들어 있지 않습니다.

## 시트 구조

| 탭 | 열 |
| --- | --- |
| `tasks` | `id, title, zone, status, due, note, created, updated, assignee` |
| `requests` | `id, sender, target, message, status, reply, createdAt, updatedAt` |
| `members` | `id, name, role, color, shape, zone, statusText, updatedAt` |

- `zone`: store / board / life / break · `status`(tasks): active / pending / done
- `assignee`: 담당 멤버 이름(비어 있으면 미지정) · `note`: 처리 결과 한 줄
- `status`(requests): pending / in_progress / done · `target`: `단무지` / `전체` / 멤버 이름
- `role`: owner / ai · `shape`: `ㄷ` / `mgr` / `sq` / `ci`

## 새 피클 초대

같은 시트에 `members` 행을 하나 더 넣으면(`mem_upsert`) 그 피클이 오피스에 캐릭터로 합류합니다.
`color`(예: `#7fe0b0`), `shape`(`ㄷ`/`mgr`/`sq`/`ci`), `zone`, `statusText` 로 생김새를 정합니다.

## 로컬에서 보기

```bash
python3 -m http.server 8080
# http://localhost:8080
```
