/**
 * 피클 오피스 · 동기화 API (Google Apps Script)
 *
 * 시트 탭 구조
 *   tasks    A id | B title | C zone | D status | E due | F note | G created | H updated | I assignee
 *            zone: store | board | life | break
 *            status: active | pending | done
 *            assignee: 담당 멤버 이름 (비어 있으면 미지정, 예: 단무지)
 *   requests A id | B sender | C target | D message | E status | F reply | G createdAt | H updatedAt
 *            status: pending | in_progress | done
 *            target: 단무지 | 전체 | 멤버 이름
 *   members  A id | B name | C role | D color | E shape | F zone | G statusText | H updatedAt
 *            role: owner | ai
 *            shape: ㄷ | mgr | sq | ci | st
 *
 * 준비
 *  1) 구글 시트를 새로 만들고 확장 프로그램 > Apps Script 에 이 파일을 붙여 넣습니다.
 *  2) 아래 SHEET_ID 를 채웁니다. (시트 주소의 /d/{여기}/edit)
 *     시트에 붙인(컨테이너 바인딩) 스크립트라면 비워 두면 현재 시트를 씁니다.
 *  3) PIN 을 원하는 숫자로 바꿉니다. (웹페이지 ⚙ 설정에 넣는 열쇠)
 *  4) 배포 > 배포 관리 > 수정 > 버전: 새 버전 / 다음 사용자로 실행: 나 / 액세스: 모든 사용자
 *     기존 /exec 주소는 그대로 유지됩니다.
 *
 * API
 *   GET  {url}?pin=1234&action=list          -> { ok:true, tasks, requests, members }
 *        action 생략 시에도 목록 전체를 돌려줍니다.
 *   POST {url}  { pin, action, ... }
 *        tasks    : add | update | toggle | delete
 *        requests : req_add | req_update | req_delete
 *        members  : mem_upsert | mem_delete
 *   응답은 항상 최신 목록 전체(tasks · requests · members)를 함께 돌려줍니다.
 */

var SHEET_ID = '';        // 예: '1AbCdEf...'
var PIN = '0000';         // 원하는 PIN 으로 바꾸세요
var SEED_OWNER = '오너';   // members 탭을 처음 만들 때 넣을 주인 이름(공개 저장소에는 실제 이름을 두지 않습니다)

var HEAD_T = ['id', 'title', 'zone', 'status', 'due', 'note', 'created', 'updated', 'assignee'];
var HEAD_R = ['id', 'sender', 'target', 'message', 'status', 'reply', 'createdAt', 'updatedAt'];
var HEAD_M = ['id', 'name', 'role', 'color', 'shape', 'zone', 'statusText', 'updatedAt'];

var TZ = 'Asia/Seoul';

/* ───────────────────────── 시트 준비 ───────────────────────── */

function ss_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

// 탭을 가져오고, 없으면 만들며, 헤더가 다르면 헤더만 맞춘다(데이터는 건드리지 않는다).
function sheet_(name, head) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    return sh;
  }
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var hdr = sh.getRange(1, 1, 1, Math.max(lastCol, head.length)).getValues()[0];
  for (var i = 0; i < head.length; i++) {
    if (String(hdr[i] || '') !== head[i]) {
      sh.getRange(1, i + 1).setValue(head[i]);
    }
  }
  return sh;
}

function tasksSheet_() {
  var sh = sheet_('tasks', HEAD_T);
  sh.getRange('E:E').setNumberFormat('@');   // 마감일은 날짜가 아니라 글자로 보관
  return sh;
}

function requestsSheet_() {
  var sh = sheet_('requests', HEAD_R);
  sh.getRange('G:H').setNumberFormat('@');   // 만든 시각·수정 시각은 글자로 보관
  return sh;
}

function membersSheet_() {
  var sh = sheet_('members', HEAD_M);
  sh.getRange('H:H').setNumberFormat('@');
  return sh;
}

function rows_(sh, width) {
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, width).getValues();
}

function stamp_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function text_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
  return String(v);
}

function due_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'M/d HH:mm');
  return String(v);
}

function rowOf_(sh, id) {
  var n = sh.getLastRow();
  if (n < 2) return -1;
  var ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

/* ───────────────────────── 목록 ───────────────────────── */

function listTasks_() {
  return rows_(tasksSheet_(), HEAD_T.length).filter(function (r) { return r[1]; }).map(function (r) {
    return {
      id: String(r[0]),
      title: String(r[1]),
      zone: String(r[2]),
      status: String(r[3]),
      due: due_(r[4]),
      note: String(r[5] || ''),
      assignee: String(r[8] || '')
    };
  });
}

function listRequests_() {
  return rows_(requestsSheet_(), HEAD_R.length).filter(function (r) { return r[3] || r[0]; }).map(function (r) {
    return {
      id: String(r[0]),
      sender: String(r[1] || ''),
      target: String(r[2] || ''),
      message: String(r[3] || ''),
      status: String(r[4] || 'pending'),
      reply: String(r[5] || ''),
      createdAt: text_(r[6]),
      updatedAt: text_(r[7])
    };
  });
}

function listMembers_() {
  var sh = membersSheet_();
  var rs = rows_(sh, HEAD_M.length).filter(function (r) { return r[1]; });
  if (!rs.length) {          // 처음 한 번은 기본 멤버를 심는다
    var now = stamp_();
    rs = [
      [Utilities.getUuid().slice(0, 8), SEED_OWNER, 'owner', '#7fb3ff', 'mgr', 'board', '확인 중', now],
      ['danmuji', '단무지', 'ai', '#facc15', 'ㄷ', 'board', '대기 중', now]
    ];
    sh.getRange(2, 1, rs.length, HEAD_M.length).setValues(rs);
  }
  return rs.map(function (r) {
    return {
      id: String(r[0]),
      name: String(r[1]),
      role: String(r[2] || 'ai'),
      color: String(r[3] || '#facc15'),
      shape: String(r[4] || 'sq'),
      zone: String(r[5] || 'board'),
      statusText: String(r[6] || ''),
      updatedAt: text_(r[7])
    };
  });
}

function snap_() {
  return { ok: true, tasks: listTasks_(), requests: listRequests_(), members: listMembers_() };
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ───────────────────────── 쓰기 ───────────────────────── */

function taskRow_(t) {
  return [
    String(t.id || Utilities.getUuid().slice(0, 8)),
    String(t.title || ''),
    String(t.zone || 'board'),
    String(t.status || 'active'),
    String(t.due || ''),
    String(t.note || ''),
    new Date(),
    new Date(),
    String(t.assignee || '')
  ];
}

function writeTask_(b) {
  var sh = tasksSheet_();
  var rs = rows_(sh, HEAD_T.length);

  if (b.action === 'add' && b.task && b.task.title) {
    var row = taskRow_(b.task);
    // assignee 는 항상 글자로 보관
    sh.appendRow(row);
  }

  if (b.action === 'update' && b.task && b.task.id) {
    var r = rowOf_(sh, b.task.id);
    if (r > 0) {
      var cur = sh.getRange(r, 1, 1, HEAD_T.length).getValues()[0];
      var d = b.task;
      sh.getRange(r, 1, 1, HEAD_T.length).setValues([[
        String(cur[0]),
        d.title != null ? String(d.title) : String(cur[1]),
        d.zone != null ? String(d.zone) : String(cur[2]),
        d.status != null ? String(d.status) : String(cur[3]),
        d.due != null ? String(d.due) : due_(cur[4]),
        d.note != null ? String(d.note) : String(cur[5]),
        cur[6],
        new Date(),
        d.assignee != null ? String(d.assignee) : String(cur[8] || '')
      ]]);
    }
  }

  if (b.action === 'toggle' && b.id) {
    var t = rowOf_(sh, b.id);
    if (t > 0) {
      var st = String(sh.getRange(t, 4).getValue());
      sh.getRange(t, 4).setValue(st === 'done' ? 'active' : 'done');
      sh.getRange(t, 8).setValue(new Date());
    }
  }

  if (b.action === 'delete' && b.id) {
    var del = rowOf_(sh, b.id);
    if (del > 0) sh.deleteRow(del);
  }
}

function writeRequest_(b) {
  var sh = requestsSheet_();
  var now = stamp_();

  if (b.action === 'req_add' && b.request && String(b.request.message || '').trim()) {
    var q = b.request;
    sh.appendRow([
      String(q.id || Utilities.getUuid().slice(0, 8)),
      String(q.sender || ''),
      String(q.target || '단무지'),
      String(q.message).slice(0, 500),
      String(q.status || 'pending'),
      '',
      now,
      now
    ]);
  }

  if (b.action === 'req_update' && b.request && b.request.id) {
    var r = rowOf_(sh, b.request.id);
    if (r > 0) {
      var cur = sh.getRange(r, 1, 1, HEAD_R.length).getValues()[0];
      var d = b.request;
      sh.getRange(r, 1, 1, HEAD_R.length).setValues([[
        String(cur[0]),
        String(cur[1] || ''),
        d.target != null ? String(d.target) : String(cur[2] || ''),
        d.message != null ? String(d.message) : String(cur[3] || ''),
        d.status != null ? String(d.status) : String(cur[4] || 'pending'),
        d.reply != null ? String(d.reply) : String(cur[5] || ''),
        text_(cur[6]),
        now
      ]]);
    }
  }

  if (b.action === 'req_delete' && b.id) {
    var del = rowOf_(sh, b.id);
    if (del > 0) sh.deleteRow(del);
  }
}

function writeMember_(b) {
  var sh = membersSheet_();
  var now = stamp_();

  if (b.action === 'mem_upsert' && b.member && b.member.name) {
    var m = b.member;
    var r = m.id ? rowOf_(sh, m.id) : -1;
    if (r < 0) {
      var rs = rows_(sh, HEAD_M.length);
      for (var i = 0; i < rs.length; i++) {
        if (String(rs[i][1]) === String(m.name)) { r = i + 2; break; }
      }
    }
    if (r > 0) {
      var cur = sh.getRange(r, 1, 1, HEAD_M.length).getValues()[0];
      sh.getRange(r, 1, 1, HEAD_M.length).setValues([[
        String(cur[0]),
        String(m.name),
        m.role != null ? String(m.role) : String(cur[2] || 'ai'),
        m.color != null ? String(m.color) : String(cur[3] || '#facc15'),
        m.shape != null ? String(m.shape) : String(cur[4] || 'sq'),
        m.zone != null ? String(m.zone) : String(cur[5] || 'board'),
        m.statusText != null ? String(m.statusText) : String(cur[6] || ''),
        now
      ]]);
    } else {
      sh.appendRow([
        String(m.id || Utilities.getUuid().slice(0, 8)),
        String(m.name),
        String(m.role || 'ai'),
        String(m.color || '#facc15'),
        String(m.shape || 'sq'),
        String(m.zone || 'board'),
        String(m.statusText || '대기 중'),
        now
      ]);
    }
  }

  if (b.action === 'mem_delete' && b.id) {
    var del = rowOf_(sh, b.id);
    if (del > 0) sh.deleteRow(del);
  }
}

/* ───────────────────────── 입구 ───────────────────────── */

function doGet(e) {
  if (String(e.parameter.pin) !== PIN) return out_({ ok: false, error: 'PIN' });
  return out_(snap_());
}

function doPost(e) {
  var b = {};
  try {
    b = JSON.parse((e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return out_({ ok: false, error: 'BODY' });
  }
  if (String(b.pin) !== PIN) return out_({ ok: false, error: 'PIN' });

  var a = String(b.action || '');
  if (a === 'add' || a === 'update' || a === 'toggle' || a === 'delete') writeTask_(b);
  else if (a === 'req_add' || a === 'req_update' || a === 'req_delete') writeRequest_(b);
  else if (a === 'mem_upsert' || a === 'mem_delete') writeMember_(b);

  return out_(snap_());
}
