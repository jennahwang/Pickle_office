/**
 * 피클 오피스 · 할 일 동기화 API (Google Apps Script)
 *
 * 시트 구조 (탭 이름: tasks)
 *   A id | B title | C zone | D status | E due | F note | G created | H updated
 *   zone: store | board | life | break      status: active | pending | done
 *
 * 준비
 *  1) 구글 시트를 새로 만들고 확장 프로그램 > Apps Script 에 이 파일을 붙여 넣습니다.
 *  2) 아래 SHEET_ID 를 채웁니다. (시트 주소의 /d/{여기}/edit)
 *     시트에 붙인(컨테이너 바인딩) 스크립트라면 비워 두면 현재 시트를 씁니다.
 *  3) PIN 을 원하는 숫자로 바꿉니다. (웹페이지 ⚙ 설정에 넣는 열쇠)
 *  4) 배포 > 새 배포 > 유형: 웹 앱 / 다음 사용자로 실행: 나 / 액세스 권한: 모든 사용자
 *     배포 후 나오는 /exec 주소를 앱의 ⚙ 설정에 넣습니다.
 *
 * API
 *   GET  {url}?pin=1234&action=list   -> { ok:true, tasks:[...] }
 *   POST {url}  { pin, action:"add"|"update"|"delete", task?, id? }
 *   응답은 항상 최신 목록 전체를 함께 돌려줍니다.
 */

var SHEET_ID = '';        // 예: '1AbCdEf...'
var PIN = '0000';         // 원하는 PIN 으로 바꾸세요
var HEAD = ['id', 'title', 'zone', 'status', 'due', 'note', 'created', 'updated'];

function book_() {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('tasks');
  if (!sh) { sh = ss.insertSheet('tasks'); sh.appendRow(HEAD); }
  sh.getRange('E:E').setNumberFormat('@');   // 마감일은 날짜가 아니라 글자로 보관
  return sh;
}

function rows_() {
  var sh = book_();
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 8).getValues();
}

function due_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Seoul', 'M/d HH:mm');
  return String(v);
}

function list_() {
  return rows_().filter(function (r) { return r[1]; }).map(function (r) {
    return {
      id: String(r[0]),
      title: String(r[1]),
      zone: String(r[2]),
      status: String(r[3]),
      due: due_(r[4]),
      note: String(r[5] || '')
    };
  });
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function pack_(t) {
  return [
    String(t.id || Utilities.getUuid().slice(0, 8)),
    String(t.title || ''),
    String(t.zone || 'board'),
    String(t.status || 'active'),
    String(t.due || ''),
    String(t.note || ''),
    new Date(),
    new Date()
  ];
}

function doGet(e) {
  if (String(e.parameter.pin) !== PIN) return out_({ ok: false, error: 'PIN' });
  return out_({ ok: true, tasks: list_() });
}

function doPost(e) {
  var b = JSON.parse((e.postData && e.postData.contents) || '{}');
  if (String(b.pin) !== PIN) return out_({ ok: false, error: 'PIN' });
  var sh = book_();
  var rs = rows_();

  if (b.action === 'add' && b.task && b.task.title) {
    sh.appendRow(pack_(b.task));
  }
  if (b.action === 'update' && b.task && b.task.id) {
    for (var i = 0; i < rs.length; i++) {
      if (String(rs[i][0]) === String(b.task.id)) {
        var r = rs[i];
        var d = b.task;
        var a = pack_({
          id: r[0],
          title: d.title != null ? d.title : r[1],
          zone: d.zone != null ? d.zone : r[2],
          status: d.status != null ? d.status : r[3],
          due: d.due != null ? d.due : due_(r[4]),
          note: d.note != null ? d.note : r[5]
        });
        a[6] = r[6];
        sh.getRange(i + 2, 1, 1, 8).setValues([a]);
        break;
      }
    }
  }
  if (b.action === 'delete' && b.id) {
    for (var j = 0; j < rs.length; j++) {
      if (String(rs[j][0]) === String(b.id)) { sh.deleteRow(j + 2); break; }
    }
  }
  return out_({ ok: true, tasks: list_() });
}
