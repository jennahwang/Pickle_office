# 동기화 연결하기 (구글 시트 + Apps Script)

앱은 주소와 PIN 없이도 동작합니다(브라우저에만 저장). 여러 기기에서 같은 할 일·지시를 보려면 아래를 한 번만 준비하세요.

## 1. 시트 만들기
1. <https://sheets.new> 로 새 스프레드시트를 만듭니다.
2. 메뉴 **확장 프로그램 → Apps Script** 를 엽니다.
3. 편집기의 기본 코드를 지우고 이 폴더의 `Code.gs` 내용을 붙여 넣습니다.

## 2. 값 채우기 (이 저장소의 파일에는 비워 두세요)
`Code.gs` 맨 위 세 줄을 채운 뒤 저장(💾)합니다.

```js
var SHEET_ID = '1AbCdEf...';   // 시트 주소의 /d/{여기}/edit
var PIN = '4821';              // 웹페이지 ⚙ 에 넣는 열쇠 (숫자 4~8자리)
var SEED_OWNER = '이름';        // members 탭을 처음 만들 때 들어갈 주인 이름
```

> 공개 저장소 파일에는 실제 `SHEET_ID`·`PIN`·이름을 넣지 마세요. 배포용 사본에서만 채웁니다.

## 3. 시트 탭
따로 만들 필요가 없습니다. 첫 요청이 들어오면 스크립트가 아래 탭과 머리글을 자동으로 만듭니다.

| 탭 | 열 |
| --- | --- |
| `tasks` | id, title, zone, status, due, note, created, updated, assignee |
| `requests` | id, sender, target, message, status, reply, createdAt, updatedAt |
| `members` | id, name, role, color, shape, zone, statusText, updatedAt |

`members` 가 비어 있으면 주인(owner)과 단무지(ai) 두 명을 자동으로 넣습니다.

## 4. 웹앱으로 배포
1. 오른쪽 위 **배포 → 새 배포** → 유형 선택(⚙) → **웹 앱**.
2. 설명: `pickle office api`
3. **다음 사용자로 실행: 나**
4. **액세스 권한: 모든 사용자**
5. **배포** → 나오는 **웹 앱 URL**(`https://script.google.com/macros/s/.../exec`)을 복사합니다.

## 5. 앱에 연결
1. 페이지 오른쪽 위 **⚙** 를 누릅니다.
2. **동기화 주소** 에 4에서 복사한 URL, **접속 PIN** 에 2의 PIN 을 넣고 **저장 후 확인**.
3. "연결됐어요" 가 뜨면 끝입니다. 같은 화면 아래 **오피스 멤버 / 초대 문구** 에서 초대 링크를 복사해 다른 피클에게 보낼 수 있습니다.

## 확인
- 브라우저에서 `{웹앱 URL}?pin=4821&action=list` 을 열면 `{"ok":true,"tasks":[...],"requests":[...],"members":[...]}` 가 보입니다.
- `{"ok":false,"error":"PIN"}` 이 보이면 PIN 을 다시 확인하세요.

## API 요약

```
GET  {URL}?pin=PIN&action=list        → { ok, tasks, requests, members }
POST {URL}  { pin, action, ... }
```

| action | 본문 | 하는 일 |
| --- | --- | --- |
| `add` | `task:{title, zone, status, due, note, assignee}` | 할 일 추가 |
| `update` | `task:{id, note?, assignee?, status?, ...}` | 할 일 수정(결과 메모 포함) |
| `toggle` | `id` | 완료 ↔ 진행 전환 |
| `delete` | `id` | 할 일 삭제 |
| `req_add` | `request:{sender, target, message}` | 지시 보내기 |
| `req_update` | `request:{id, status?, reply?}` | 진행 상태·답변 기록 |
| `req_delete` | `id` | 지시 삭제 |
| `mem_upsert` | `member:{id?, name, role, color, shape, zone, statusText}` | 멤버 추가/수정 |
| `mem_delete` | `id` | 멤버 삭제 |

## 참고
- 웹앱을 수정한 뒤에는 **배포 → 배포 관리 → 수정 → 버전: 새 버전** 으로 다시 배포해야 반영됩니다. 이때 기존 /exec 주소는 그대로 유지됩니다.
- 시트의 `due`, `createdAt`, `updatedAt` 열은 텍스트 서식(`@`)으로 고정됩니다. 날짜로 바꾸면 시간대가 밉니다.
- 시트를 직접 편집해도 됩니다. 앱은 20초마다, 그리고 창으로 돌아올 때 다시 읽습니다.
