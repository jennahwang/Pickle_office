/**
 * 피클 오피스 · 할 일 동기화 API (Google Apps Script)
 *
 * 준비:
 *  1) 구글 시트를 새로 만들고 확장 프로그램 > Apps Script 에 이 파일을 붙여 넣습니다.
 *  2) 프로젝트 설정 > 스크립트 속성에  PIN  = 원하는 숫자 PIN  을 추가합니다.
 *  3) 함수 목록에서 setup 을 한 번 실행합니다(시트 탭과 머리글이 만들어집니다).
 *  4) 배포 > 새 배포 > 유형: 웹 앱
 *       - 다음 사용자로 실행: 나
 *       - 액세스 권한: 모든 사용자
 *     배포 후 나오는 /exec 주소를 앱의 ⚙ 설정에 넣습니다.
 *
 * API
 *   GET  {url}?pin=1234&action=list        -> { ok:true, tasks:[...] }
 *   POST {url}  body { "pin":"1234", "action":"add"|"update"|"delete", ... }
 *        add    : { action:"add", task:{ id, title, zone, status, due, note } }
 *        update : { action:"update", task:{ id, ... } }
 *        delete : { action:"delete", id:"..." }
 *   모든 응답은 최신 목록 전체를 함께 돌려줍니다.
 */

var SHEET_NAME = 'tasks';
var HEADERS = ['id', 'title', 'zone', 'status', 'due', 'note', 'created', 'updated'];
var ZONES = ['store', 'board', 'life', 'break'];
var STATUS = ['active', 'pending', 'done'];

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  var pin = PropertiesService.getScriptProperties().getProperty('PIN');
  if (!pin) {
    throw new Error('스크립트 속성에 PIN 을 먼저 넣어 주세요. (프로젝트 설정 > 스크립트 속성)');
  }
  return '준비 완료 · PIN 길이 ' + pin.length;
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readTasks_() {
  var sh = getSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (!row[1]) continue;
    out.push({
      id: String(row[0] || ''),
      title: String(row[1]),
      zone: String(row[2] || 'board'),
      status: String(row[3] || 'active'),
      due: row[4] ? String(row[4]) : '',
      note: row[5] ? String(row[5]) : ''
    });
  }
  return out;
}

function findRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkPin_(pin) {
  var real = PropertiesService.getScriptProperties().getProperty('PIN');
  return !!real && String(pin) === String(real);
}

function clean_(task) {
  task = task || {};
  return [
    String(task.id || Utilities.getUuid().slice(0, 8)),
    String(task.title || '').slice(0, 120),
    ZONES.indexOf(task.zone) >= 0 ? task.zone : 'board',
    STATUS.indexOf(task.status) >= 0 ? task.status : 'active',
    task.due ? String(task.due).slice(0, 20) : '',
    task.note ? String(task.note).slice(0, 200) : '',
    new Date(),
    new Date()
  ];
}

function doGet(e) {
  try {
    var p = e.parameter || {};
    if (!checkPin_(p.pin)) return json_({ ok: false, error: 'PIN 이 맞지 않습니다.' });
    if (p.action === 'ping') return json_({ ok: true, tasks: readTasks_() });
    return json_({ ok: true, tasks: readTasks_() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (!checkPin_(body.pin)) return json_({ ok: false, error: 'PIN 이 맞지 않습니다.' });
    var sh = getSheet_();
    var action = body.action || '';

    if (action === 'add' && body.task && body.task.title) {
      sh.appendRow(clean_(body.task));
    } else if (action === 'update' && body.task && body.task.id) {
      var r = findRow_(sh, body.task.id);
      if (r > 0) {
        var cur = sh.getRange(r, 1, 1, HEADERS.length).getValues()[0];
        var merged = {
          id: body.task.id,
          title: body.task.title != null ? body.task.title : cur[1],
          zone: body.task.zone != null ? body.task.zone : cur[2],
          status: body.task.status != null ? body.task.status : cur[3],
          due: body.task.due != null ? body.task.due : cur[4],
          note: body.task.note != null ? body.task.note : cur[5]
        };
        var rowArr = clean_(merged);
        rowArr[6] = cur[6] || new Date();   // created 유지
        sh.getRange(r, 1, 1, HEADERS.length).setValues([rowArr]);
      }
    } else if (action === 'delete' && body.id) {
      var dr = findRow_(sh, body.id);
      if (dr > 0) sh.deleteRow(dr);
    } else {
      return json_({ ok: false, error: '알 수 없는 요청입니다.' });
    }

    return json_({ ok: true, tasks: readTasks_() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
