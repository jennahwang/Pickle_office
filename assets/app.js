/* 피클 오피스 — 픽셀 오피스 맵 + 할 일 현황판 + 오피스 지시함
 * 공개 저장소에는 개인정보를 두지 않는다. 실제 데이터는 동기화 주소(Apps Script)에서
 * PIN으로 받아오고, 없으면 이 브라우저(localStorage)에만 저장한다.
 */
(function () {
  'use strict';

  /* ─────────────────────────── 상수 ─────────────────────────── */
  const W = 320, H = 192;

  const ZONES = {
    store: { x: 12, y: 100, w: 92, h: 86, label: '매장 업무', name: '매장 업무 존', spot: { x: 84, y: 136 }, labelY: 186 },
    board: { x: 110, y: 26, w: 98, h: 66, label: '할 일 현황판', name: '현황판 존', spot: { x: 150, y: 88 } },
    life: { x: 110, y: 100, w: 198, h: 86, label: '일상·위스키 라운지', name: '일상·위스키 라운지', spot: { x: 236, y: 150 } },
    brk: { x: 12, y: 26, w: 92, h: 66, label: '휴식·커피', name: '휴식·커피 코너', spot: { x: 86, y: 80 } }
  };
  // 저장 값은 'break'를 쓴다(예약어 회피)
  const ZONE_OF = { store: 'store', board: 'board', life: 'life', break: 'brk' };
  const ZONE_KEY = { store: 'store', board: 'board', life: 'life', brk: 'break' };

  const OBSTACLES = [
    // 휴식 코너
    { x: 14, y: 26, w: 62, h: 22 },
    { x: 84, y: 24, w: 15, h: 20 },
    // 현황판
    { x: 114, y: 26, w: 90, h: 52 },
    // 매장 업무 존
    { x: 12, y: 102, w: 62, h: 26 },
    { x: 12, y: 138, w: 62, h: 26 },
    { x: 84, y: 102, w: 18, h: 22 },
    // 라운지
    { x: 204, y: 100, w: 52, h: 28 },
    { x: 116, y: 156, w: 64, h: 30 },
    { x: 130, y: 130, w: 30, h: 18 },
    { x: 194, y: 144, w: 10, h: 12 },
    { x: 258, y: 164, w: 16, h: 12 }
  ];

  const C = {
    wallTop: '#242a44', wallEdge: '#2d3452', wallLine: '#1b2035',
    window: '#152238', windowGlow: '#26507a', windowLit: '#7fd4ff',
    floorA: '#3d4464', floorB: '#39405e', floorLine: '#333a56',
    woodA: '#6d4b36', woodB: '#65452f', woodLine: '#54382a',
    deskTop: '#c09364', deskFront: '#7d5638', deskEdge: '#9a7349',
    metal: '#4a5478', metalDark: '#333b57',
    screen: '#0d1826', screenGlow: '#4fd3ff',
    white: '#f4f1e6', paper: '#e8e3d2',
    plant: '#4f9a63', plantDark: '#3b7a4d', pot: '#b5643f',
    sofa: '#c0554f', sofaDark: '#9c4340',
    whisky: '#d99a3c', whiskyDark: '#a76f22',
    rug: '#5a4a74', rugEdge: '#4a3c62',
    yellow: '#f2d21f', yellowDark: '#bf9f00', yellowLight: '#ffe45c'
  };

  /* ─────────────────────────── 상태 ─────────────────────────── */
  const STORE_KEY = 'pickle-office-v1';
  const CFG_KEY = 'pickle-office-cfg-v1';

  const state = {
    tasks: [],
    requests: [],
    members: [],
    filter: null,
    tab: 'tasks',
    cfg: { url: '', pin: '' },
    remote: false,
    online: null,   // null=미확인, true=동기화됨, false=오프라인
    demo: false,
    reqTarget: '',
    editingNote: null,
    sending: false,
    lastFilter: undefined
  };

  const DEMO_TASKS = [
    { id: 'demo1', zone: 'store', title: '샘플 · 매장 리뷰 확인', status: 'active', due: '', assignee: '' },
    { id: 'demo2', zone: 'store', title: '샘플 · 재고 정리', status: 'pending', due: '', assignee: '' },
    { id: 'demo3', zone: 'board', title: '샘플 · 주간 할 일 정리', status: 'active', due: '', assignee: '' },
    { id: 'demo4', zone: 'life', title: '샘플 · 라운지 병 정리', status: 'active', due: '', assignee: '' },
    { id: 'demo5', zone: 'break', title: '샘플 · 커피 사 오기', status: 'done', due: '', assignee: '' }
  ];

  // 동기화 전(로컬)에 쓰는 기본 멤버. 실제 이름은 시트의 members 탭에서 온다.
  const DEFAULT_MEMBERS = [
    { id: 'danmuji', name: '단무지', role: 'ai', color: '#facc15', shape: 'ㄷ', zone: 'board', statusText: '대기 중' },
    { id: 'owner', name: '람사장', role: 'owner', color: '#7fb3ff', shape: 'fm', zone: 'board', statusText: '확인 중' }
  ];

  /* ─────────────────────── 저장소 / API ─────────────────────── */
  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.tasks)) return null;
      return obj;
    } catch (e) { return null; }
  }
  function saveLocal() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        tasks: state.tasks,
        requests: state.requests,
        members: state.members,
        updated: Date.now()
      }));
    } catch (e) { /* 저장 공간 없음 — 무시 */ }
  }
  function loadCfg() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      if (c && typeof c.url === 'string') { state.cfg.url = c.url; state.cfg.pin = String(c.pin || ''); }
    } catch (e) { /* ignore */ }
  }
  function saveCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(state.cfg)); } catch (e) {}
  }

  // 설정 링크(#sync=...)로 한 번에 연결: 주소와 PIN이 저장소에는 남지 않는다
  function readHashSync() {
    const m = location.hash.match(/sync=([A-Za-z0-9_\-+/=]+)/);
    if (!m) return false;
    try {
      let b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      const o = JSON.parse(decodeURIComponent(escape(atob(b))));
      if (o && o.u && o.p) {
        state.cfg = { url: String(o.u), pin: String(o.p) };
        saveCfg();
        history.replaceState(null, '', location.pathname + location.search);
        return true;
      }
    } catch (e) { /* 잘못된 링크는 무시 */ }
    return false;
  }

  const hasRemote = () => !!(state.cfg.url && state.cfg.pin);

  async function remoteList() {
    const u = new URL(state.cfg.url);
    u.searchParams.set('pin', state.cfg.pin);
    u.searchParams.set('action', 'list');
    u.searchParams.set('t', String(Date.now()));
    const res = await fetch(u.toString(), { method: 'GET', cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || data.ok !== true) throw new Error((data && data.error) || '연결 실패');
    return data;
  }

  async function remoteSend(payload) {
    const res = await fetch(state.cfg.url, {
      method: 'POST',
      // text/plain 으로 보내면 CORS 프리플라이트를 피할 수 있다(Apps Script 대응)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ pin: state.cfg.pin }, payload))
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || data.ok !== true) throw new Error((data && data.error) || '저장 실패');
    return data;
  }

  /* ───────────────────────── 정규화 ───────────────────────── */
  function normalizeTasks(list) {
    return (list || []).filter(function (t) { return t && t.title; }).map(function (t) {
      return {
        id: String(t.id || Math.random().toString(36).slice(2, 10)),
        title: String(t.title).slice(0, 120),
        zone: ZONE_OF[t.zone] ? t.zone : 'board',
        status: (t.status === 'done' || t.status === 'pending') ? t.status : 'active',
        due: t.due ? String(t.due).slice(0, 20) : '',
        note: t.note ? String(t.note).slice(0, 400) : '',
        assignee: t.assignee ? String(t.assignee).replace(/^@/, '').slice(0, 24) : ''
      };
    });
  }

  function normalizeRequests(list) {
    return (list || []).filter(function (r) { return r && (r.message || r.id); }).map(function (r) {
      const st = String(r.status || 'pending');
      return {
        id: String(r.id || Math.random().toString(36).slice(2, 10)),
        sender: r.sender ? String(r.sender).replace(/^@/, '').slice(0, 24) : '',
        target: r.target ? String(r.target).replace(/^@/, '').slice(0, 24) : '단무지',
        message: String(r.message || '').slice(0, 500),
        status: (st === 'done' || st === 'in_progress') ? st : 'pending',
        reply: r.reply ? String(r.reply).slice(0, 800) : '',
        createdAt: r.createdAt ? String(r.createdAt) : '',
        updatedAt: r.updatedAt ? String(r.updatedAt) : ''
      };
    }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  }

  const SHAPES = { 'ㄷ': 1, mgr: 1, fm: 1, female: 1, sq: 1, ci: 1 };
  function normalizeMembers(list) {
    const out = (list || []).filter(function (m) { return m && m.name; }).map(function (m, i) {
      const color = /^#[0-9a-fA-F]{6}$/.test(String(m.color || '')) ? String(m.color) : '#8fb8ff';
      return {
        id: String(m.id || ('m' + i)),
        name: String(m.name).replace(/^@/, '').slice(0, 24),
        role: (m.role === 'owner') ? 'owner' : 'ai',
        color: color,
        shape: SHAPES[String(m.shape)] ? String(m.shape) : 'sq',
        zone: ZONE_KEY[ZONE_OF[m.zone]] ? String(m.zone) : 'board',
        statusText: m.statusText ? String(m.statusText).slice(0, 60) : ''
      };
    });
    return out.length ? out : DEFAULT_MEMBERS.slice();
  }

  function applySnapshot(data) {
    if (!data) return;
    if (Array.isArray(data.tasks)) state.tasks = normalizeTasks(data.tasks);
    if (Array.isArray(data.requests)) state.requests = normalizeRequests(data.requests);
    if (Array.isArray(data.members) && data.members.length) state.members = normalizeMembers(data.members);
    saveLocal();
  }

  function setSync(status, text) {
    state.online = status;
    const dot = document.getElementById('syncDot');
    const label = document.getElementById('syncText');
    dot.classList.remove('on', 'off', 'err');
    if (status === true) dot.classList.add('on');
    else if (status === false) dot.classList.add('off');
    else dot.classList.add('err');
    label.textContent = text;
  }

  /* ───────────────────────── 멤버 도우미 ───────────────────────── */
  const mid = function (m) { return m.id || m.name; };

  function memberList() { return state.members.length ? state.members : DEFAULT_MEMBERS; }

  function memberByName(name) {
    const n = String(name || '').replace(/^@/, '');
    return memberList().filter(function (m) { return m.name === n; })[0] || null;
  }

  function firstAi() {
    const l = memberList();
    return l.filter(function (m) { return m.role === 'ai' && m.name === '단무지'; })[0]
      || l.filter(function (m) { return m.role === 'ai'; })[0]
      || l[0];
  }

  function ownerMember() {
    return memberList().filter(function (m) { return m.role === 'owner'; })[0] || null;
  }

  function assigneeColor(name) {
    const m = memberByName(name);
    return m ? m.color : '#9aa3c0';
  }

  /* ─────────────────────────── 렌더 DOM ─────────────────────────── */
  const $ = function (id) { return document.getElementById(id); };

  function zoneTag(zone) {
    const span = document.createElement('span');
    span.className = 'tag zone-' + zone;
    const z = ZONES[ZONE_OF[zone] || 'board'];
    span.textContent = z ? z.label : zone;
    return span;
  }

  function renderTabs() {
    const tasksOn = state.tab === 'tasks';
    $('tabTasks').classList.toggle('sel', tasksOn);
    $('tabInbox').classList.toggle('sel', !tasksOn);
    $('tabTasks').setAttribute('aria-selected', tasksOn ? 'true' : 'false');
    $('tabInbox').setAttribute('aria-selected', tasksOn ? 'false' : 'true');
    $('paneTasks').hidden = !tasksOn;
    $('paneInbox').hidden = tasksOn;

    const open = state.requests.filter(function (r) { return r.status !== 'done'; }).length;
    const badge = $('reqBadge');
    badge.hidden = open === 0;
    badge.textContent = open > 9 ? '9+' : String(open);
  }

  function renderTasks() {
    const list = $('taskList');
    list.textContent = '';

    const order = { active: 0, pending: 1, done: 2 };
    const shown = state.tasks
      .filter(function (t) { return !state.filter || t.zone === state.filter; })
      .slice()
      .sort(function (a, b) { return (order[a.status] - order[b.status]) || a.title.localeCompare(b.title, 'ko'); });

    shown.forEach(function (t) {
      const row = document.createElement('div');
      row.className = 'task' + (t.status === 'done' ? ' done' : '');

      const check = document.createElement('button');
      check.className = 'check';
      check.type = 'button';
      check.setAttribute('aria-label', t.status === 'done' ? '완료 취소' : '완료 표시');
      check.textContent = t.status === 'done' ? '✓' : '';
      check.addEventListener('click', function () { toggleDone(t); });

      const body = document.createElement('div');
      body.className = 'task-body';
      const title = document.createElement('p');
      title.className = 'task-title';
      title.textContent = t.title;

      const meta = document.createElement('div');
      meta.className = 'task-meta';
      meta.appendChild(zoneTag(t.zone));

      // 담당 배지 — 누르면 담당이 바뀐다
      const asg = document.createElement('button');
      asg.type = 'button';
      asg.className = 'assignee' + (t.assignee ? '' : ' none');
      asg.style.color = assigneeColor(t.assignee);
      asg.textContent = t.assignee ? '@' + t.assignee : '@미지정';
      asg.title = '눌러서 담당 바꾸기';
      asg.addEventListener('click', function () { cycleAssignee(t); });
      meta.appendChild(asg);

      if (t.status === 'pending') {
        const p = document.createElement('span');
        p.className = 'tag pending';
        p.textContent = '대기';
        meta.appendChild(p);
      }
      if (t.due) {
        const d = document.createElement('span');
        d.className = 'tag due';
        d.textContent = t.due;
        meta.appendChild(d);
      }

      body.appendChild(title);
      body.appendChild(meta);

      // 결과 메모 (단무지·초대된 피클이 남긴 처리 결과)
      if (state.editingNote === t.id) {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'note-edit';
        inp.maxLength = 200;
        inp.placeholder = '처리 결과를 한 줄로 남겨 주세요';
        inp.value = t.note || '';
        const commit = function () {
          if (state.editingNote !== t.id) return;
          const v = inp.value.trim().slice(0, 200);
          state.editingNote = null;
          if (v !== t.note) { t.note = v; saveLocal(); pushRemote({ action: 'update', task: t }); }
          renderTasks();
        };
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { state.editingNote = null; renderTasks(); }
        });
        inp.addEventListener('blur', commit);
        body.appendChild(inp);
        setTimeout(function () { inp.focus(); }, 0);
      } else if (t.note) {
        const note = document.createElement('p');
        note.className = 'task-note';
        note.textContent = '↳ ' + t.note;
        body.appendChild(note);
      }

      const tools = document.createElement('div');
      tools.className = 'task-tools';

      const noteBtn = document.createElement('button');
      noteBtn.className = 'note-btn';
      noteBtn.type = 'button';
      noteBtn.setAttribute('aria-label', '결과 메모');
      noteBtn.title = '결과 메모';
      noteBtn.textContent = '✎';
      noteBtn.addEventListener('click', function () {
        state.editingNote = t.id;
        renderTasks();
      });

      const del = document.createElement('button');
      del.className = 'del';
      del.type = 'button';
      del.setAttribute('aria-label', '삭제');
      del.textContent = '✕';
      del.addEventListener('click', function () { removeTask(t); });

      tools.appendChild(noteBtn);
      tools.appendChild(del);

      row.appendChild(check);
      row.appendChild(body);
      row.appendChild(tools);
      list.appendChild(row);
    });

    $('emptyState').hidden = shown.length > 0;

    // 통계 + 존 카운트
    const counts = { active: 0, pending: 0, done: 0 };
    const zoneCount = { store: 0, board: 0, life: 0, break: 0 };
    state.tasks.forEach(function (t) {
      counts[t.status] = (counts[t.status] || 0) + 1;
      if (t.status !== 'done') zoneCount[t.zone] = (zoneCount[t.zone] || 0) + 1;
    });
    $('stActive').textContent = counts.active;
    $('stPending').textContent = counts.pending;
    $('stDone').textContent = counts.done;
    Object.keys(zoneCount).forEach(function (z) { $('cnt-' + z).textContent = zoneCount[z]; });

    const z = state.filter;
    $('panelTitle').textContent = z ? ZONES[ZONE_OF[z]].name : '전체 할 일';
    $('panelSub').textContent = z ? '이 존의 할 일만 보고 있어요' : '오늘의 진행 상황';
    $('clearFilter').hidden = !z;
    document.querySelectorAll('.legend-chip').forEach(function (b) {
      b.classList.toggle('sel', b.dataset.zone === z);
    });
    document.querySelectorAll('.zone-hit').forEach(function (h) {
      h.classList.toggle('active', h.dataset.zone === z);
    });
    // 존 선택은 필터가 바뀔 때만 따라간다(입력 중인 선택을 주기 갱신이 지우지 않게)
    if (state.lastFilter !== z) {
      state.lastFilter = z;
      $('newZone').value = z || 'store';
    }

    refreshBubblePool();
  }

  const STATUS_LABEL = { pending: '대기중', in_progress: '진행중', done: '완료' };

  function renderInbox() {
    // 받을 사람 칩
    const row = $('targetRow');
    const names = [];
    memberList().forEach(function (m) { if (names.indexOf(m.name) < 0) names.push(m.name); });
    if (names.indexOf('전체') < 0) names.push('전체');

    if (!state.reqTarget || names.indexOf(state.reqTarget) < 0) {
      const ai = firstAi();
      state.reqTarget = ai ? ai.name : names[0];
    }

    row.textContent = '';
    names.forEach(function (n) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'target-chip' + (state.reqTarget === n ? ' sel' : '');
      if (n !== '전체') {
        const i = document.createElement('i');
        i.style.background = assigneeColor(n);
        b.appendChild(i);
      }
      b.appendChild(document.createTextNode('@' + n));
      b.addEventListener('click', function () { state.reqTarget = n; renderInbox(); });
      row.appendChild(b);
    });

    $('reqInput').placeholder = '@' + state.reqTarget + '에게 시킬 일을 적어 주세요';

    // 지시 목록
    const list = $('reqList');
    list.textContent = '';
    const shown = state.requests.slice();

    shown.forEach(function (r) {
      const card = document.createElement('div');
      card.className = 'req' + (r.status === 'done' ? ' is-done' : '');

      const top = document.createElement('div');
      top.className = 'req-top';

      const tg = document.createElement('span');
      tg.className = 'req-target';
      tg.style.color = r.target === '전체' ? '#6be0ff' : assigneeColor(r.target);
      tg.textContent = '@' + r.target;
      top.appendChild(tg);

      const st = document.createElement('span');
      st.className = 'st ' + r.status;
      st.textContent = STATUS_LABEL[r.status] || r.status;
      top.appendChild(st);

      const time = document.createElement('span');
      time.className = 'req-time';
      time.textContent = shortTime(r.createdAt);
      top.appendChild(time);

      const del = document.createElement('button');
      del.className = 'del';
      del.type = 'button';
      del.setAttribute('aria-label', '지시 삭제');
      del.textContent = '✕';
      del.addEventListener('click', function () { removeRequest(r); });
      top.appendChild(del);

      const msg = document.createElement('p');
      msg.className = 'req-msg';
      msg.textContent = r.message;

      card.appendChild(top);
      card.appendChild(msg);

      if (r.reply) {
        const rep = document.createElement('p');
        rep.className = 'req-reply';
        rep.textContent = '💬 ' + r.reply;
        card.appendChild(rep);
      }
      list.appendChild(card);
    });

    $('reqEmpty').hidden = shown.length > 0;
    renderTabs();
  }

  function renderMembers() {
    const ul = $('memberList');
    ul.textContent = '';
    memberList().forEach(function (m) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = m.color;
      const nm = document.createElement('span');
      nm.textContent = m.name;
      const role = document.createElement('span');
      role.className = 'role';
      role.textContent = m.role === 'owner' ? '주인' : 'AI 피클';
      li.appendChild(dot);
      li.appendChild(nm);
      li.appendChild(role);
      ul.appendChild(li);
    });
    $('memberCount').textContent = memberList().length + '명';
    $('inviteNote').value = inviteNote();
  }

  function syncAssigneeOptions() {
    const sel = $('newAssignee');
    const want = [''].concat(memberList().map(function (m) { return m.name; }));
    const have = Array.prototype.map.call(sel.options, function (o) { return o.value; });
    if (have.length === want.length && want.every(function (v, i) { return have[i] === v; })) return;
    fillAssigneeOptions();
  }

  function render() {
    renderTabs();
    renderTasks();
    renderInbox();
    renderMembers();
    syncAssigneeOptions();
  }

  function shortTime(s) {
    if (!s) return '';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (m) return m[2] + '/' + m[3] + ' ' + m[4] + ':' + m[5];
    return String(s).slice(0, 16);
  }

  /* ─────────────────────────── 동작 ─────────────────────────── */
  function uid() { return Math.random().toString(36).slice(2, 10); }

  async function pushRemote(payload, okText) {
    if (!hasRemote()) { saveLocal(); if (okText) toast(okText + ' · 이 기기에만 저장'); return; }
    try {
      const data = await remoteSend(payload);
      applySnapshot(data);
      setSync(true, '동기화됨');
      render();
      if (okText) toast(okText);
    } catch (e) {
      setSync(false, '오프라인');
      toast('서버에 저장하지 못했어요. 이 기기에만 남겨 뒀습니다.');
    }
  }

  function aiActor() {
    const ai = firstAi();
    return ai ? actors[mid(ai)] : null;
  }

  function toggleDone(t) {
    t.status = t.status === 'done' ? 'active' : 'done';
    saveLocal();
    render();
    if (state.remote) pushRemote({ action: 'toggle', id: t.id, task: t });
    const a = aiActor();
    if (a) bubbleSay(a, t.status === 'done' ? '하나 끝! 🎉' : '다시 할 일로 돌렸어요');
  }

  function cycleAssignee(t) {
    const names = [''].concat(memberList().map(function (m) { return m.name; }));
    const i = names.indexOf(t.assignee || '');
    t.assignee = names[(i + 1) % names.length];
    saveLocal();
    render();
    if (state.remote) pushRemote({ action: 'update', task: t });
    const a = aiActor();
    if (a) bubbleSay(a, t.assignee ? t.assignee + ' 담당으로 바꿨어요' : '담당을 비웠어요');
  }

  function removeTask(t) {
    state.tasks = state.tasks.filter(function (x) { return x.id !== t.id; });
    saveLocal();
    render();
    if (state.remote) pushRemote({ action: 'delete', id: t.id });
  }

  function addTask(title, zone, assignee) {
    const t = { id: uid(), title: title, zone: zone, status: 'active', due: '', note: '', assignee: assignee || '' };
    state.tasks.unshift(t);
    saveLocal();
    render();
    if (state.remote) pushRemote({ action: 'add', task: t });
    focusActors(zone);
    const a = aiActor();
    if (a) bubbleSay(a, '새 할 일 접수! 「' + title.slice(0, 16) + '」');
  }

  async function sendRequest() {
    const input = $('reqInput');
    const msg = input.value.trim();
    if (!msg || state.sending) return;
    const target = state.reqTarget || (firstAi() ? firstAi().name : '단무지');
    const owner = ownerMember();
    const r = {
      id: uid(),
      sender: owner ? owner.name : '람사장',
      target: target,
      message: msg.slice(0, 300),
      status: 'pending',
      reply: '',
      createdAt: stampNow(),
      updatedAt: stampNow()
    };
    state.requests.unshift(r);
    state.sending = true;
    $('reqSend').disabled = true;
    input.value = '';
    saveLocal();
    render();
    const targetMember = memberByName(target) || firstAi();
    const a = (targetMember && actors[mid(targetMember)]) || aiActor();
    if (a) bubbleSay(a, '@' + target + ' 지시 접수!');
    try {
      await pushRemote({ action: 'req_add', request: r }, '지시를 보냈어요');
    } finally {
      state.sending = false;
      $('reqSend').disabled = false;
      input.focus();
    }
  }

  function removeRequest(r) {
    state.requests = state.requests.filter(function (x) { return x.id !== r.id; });
    saveLocal();
    render();
    if (state.remote) pushRemote({ action: 'req_delete', id: r.id });
  }

  function stampNow() {
    const d = new Date();
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function setFilter(zone) {
    state.filter = state.filter === zone ? null : zone;
    if (state.tab !== 'tasks') { state.tab = 'tasks'; }
    render();
    if (zone) {
      focusActors(zone);
      const a = aiActor();
      if (a) bubbleSay(a, ZONES[zone].name + ' 확인하러 갈게요');
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  /* ─────────────────────── 픽셀 오피스 렌더링 ─────────────────────── */
  const canvas = document.getElementById('office');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const bg = document.createElement('canvas');
  bg.width = W; bg.height = H;
  const bx = bg.getContext('2d');

  function r(x, y, w, h, c) { bx.fillStyle = c; bx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

  function buildBackground() {
    // 벽
    r(0, 0, W, 24, C.wallTop);
    r(0, 0, W, 2, C.wallEdge);
    r(0, 22, W, 3, C.wallLine);
    r(0, 22, W, 1, C.wallEdge);
    // 창문
    [46, 138, 232].forEach(function (wx) {
      r(wx, 5, 40, 13, C.window);
      r(wx, 5, 40, 1, C.windowGlow);
      r(wx + 19, 5, 2, 13, C.wallLine);
      r(wx, 11, 40, 1, C.wallLine);
      r(wx + 4, 8, 1, 1, C.windowLit);
      r(wx + 12, 13, 1, 1, C.windowLit);
      r(wx + 27, 7, 1, 1, '#9fd8ff');
      r(wx + 33, 14, 1, 1, C.windowLit);
    });
    // 바닥 (카펫)
    r(6, 25, W - 12, H - 25, C.floorA);
    for (let ty = 26; ty < H; ty += 8) {
      for (let tx = 6; tx < W - 6; tx += 8) {
        if (((tx / 8) + (ty / 8)) % 2 === 0) r(tx, ty, 8, 8, C.floorB);
      }
    }
    // 라운지 나무 바닥
    r(110, 100, 198, 88, C.woodA);
    r(110, 100, 198, 2, '#4b3327');
    for (let y = 102; y < 188; y += 7) {
      r(110, y, 198, 1, C.woodB);
      r(110 + (y % 14 === 0 ? 24 : 60), y, 1, 7, C.woodLine);
      r(110 + (y % 14 === 0 ? 130 : 96), y, 1, 7, C.woodLine);
    }
    // 좌우 벽
    r(0, 25, 6, H - 25, C.wallLine);
    r(314, 25, 6, H - 25, C.wallLine);
    r(6, 25, 1, H - 25, C.wallEdge);

    /* ── 휴식·커피 코너 (좌상) ── */
    r(14, 28, 62, 20, C.deskFront);
    r(14, 28, 62, 12, C.deskTop);
    r(14, 40, 62, 2, C.deskEdge);
    r(20, 42, 50, 1, '#5c3f29');
    r(20, 30, 16, 10, '#2b3150');
    r(22, 31, 12, 5, '#3d466b');
    r(24, 36, 3, 3, '#d9d3c4');
    r(30, 30, 2, 2, '#ef6b6b');
    r(31, 33, 1, 1, '#5fd08a');
    r(42, 33, 4, 4, C.white);
    r(48, 34, 3, 3, '#d5cfbe');
    r(86, 36, 12, 4, C.pot);
    r(88, 30, 8, 6, C.plant);
    r(86, 26, 12, 5, C.plantDark);
    r(90, 24, 4, 3, C.plant);
    r(62, 33, 8, 6, '#8a6a4a');
    r(62, 33, 8, 1, '#a1835f');
    r(16, 74, 12, 3, '#8a6a4a');
    r(16, 77, 12, 1, '#6b4f35');
    r(18, 78, 2, 5, C.metalDark);
    r(24, 78, 2, 5, C.metalDark);

    /* ── 할 일 현황판 (중앙) ── */
    r(116, 26, 86, 48, '#2b3150');
    r(118, 28, 82, 44, C.screen);
    r(118, 28, 82, 3, '#132a3d');
    for (let i = 0; i < 5; i++) {
      const y = 34 + i * 7;
      r(122, y, 3, 3, i < 3 ? '#f2d21f' : '#5fd08a');
      r(128, y, 40 + ((i * 13) % 34), 3, i < 3 ? '#4fd3ff' : '#3f8f6a');
      r(128, y + 3, 60, 1, '#1b2b3d');
    }
    r(118, 66, 82, 1, '#101d2b');
    r(150, 74, 18, 2, C.metalDark);
    r(156, 76, 6, 4, C.metalDark);
    r(196, 60, 26, 12, C.deskFront);
    r(196, 60, 26, 4, C.deskTop);
    r(200, 52, 14, 9, '#1b2035');
    r(201, 53, 12, 7, '#2e6d8f');
    r(205, 62, 4, 2, C.metalDark);
    r(78, 30, 10, 8, '#3a3350');
    r(79, 31, 8, 6, '#7f6fb8');

    /* ── 매장 업무 존 (좌하) ── */
    r(6, 96, 104, 92, '#3a4160');
    for (let y = 100; y < 186; y += 6) r(6, y, 104, 1, '#414866');

    function desk(dx, dy) {
      r(dx, dy, 60, 24, C.deskFront);
      r(dx, dy, 60, 16, C.deskTop);
      r(dx, dy + 16, 60, 1, C.deskEdge);
      r(dx + 4, dy + 18, 52, 1, '#5c3f29');
      r(dx + 6, dy - 10, 20, 12, '#1b2035');
      r(dx + 7, dy - 9, 18, 10, '#2c4a6b');
      r(dx + 11, dy - 6, 10, 1, '#7fd4ff');
      r(dx + 11, dy - 3, 6, 1, '#4a8fb8');
      r(dx + 14, dy + 2, 4, 2, C.metalDark);
      r(dx + 32, dy - 4, 10, 7, C.paper);
      r(dx + 33, dy - 3, 8, 1, '#c9c3b0');
      r(dx + 33, dy - 1, 6, 1, '#c9c3b0');
      r(dx + 48, dy - 3, 4, 4, C.white);
      r(dx + 2, dy + 18, 20, 4, '#6b4a30');
      r(dx + 2, dy + 19, 20, 1, C.deskEdge);
    }
    desk(14, 106);
    desk(14, 142);
    r(84, 102, 18, 22, '#8f8a7a');
    r(84, 102, 18, 2, '#a8a291');
    r(86, 108, 14, 1, '#6e695c');
    r(86, 116, 14, 1, '#6e695c');
    r(91, 111, 4, 2, '#4a463c');
    r(86, 128, 10, 8, '#c9a06a');
    r(86, 128, 10, 1, '#e0bb85');
    r(88, 136, 8, 6, '#b98f5c');

    /* ── 라운지 (우하) ── */
    r(122, 126, 60, 26, C.rug);
    r(124, 128, 56, 22, '#67568a');
    r(126, 130, 52, 18, C.rug);
    r(116, 158, 66, 26, C.sofaDark);
    r(118, 160, 62, 20, C.sofa);
    r(118, 160, 62, 4, '#d06a63');
    r(120, 166, 26, 6, '#b34c47');
    r(150, 166, 26, 6, '#b34c47');
    r(128, 152, 16, 8, '#e08883');
    r(148, 152, 16, 8, '#e08883');
    r(132, 132, 30, 16, C.deskTop);
    r(132, 132, 30, 3, '#d0a473');
    r(134, 148, 2, 4, C.deskFront);
    r(158, 148, 2, 4, C.deskFront);
    r(204, 102, 52, 26, '#6b4a30');
    r(204, 102, 52, 2, '#8a6340');
    r(206, 108, 48, 1, '#4d3323');
    r(206, 118, 48, 1, '#4d3323');
    for (let i = 0; i < 7; i++) {
      const bxp = 208 + i * 6;
      const hgt = 6 + ((i * 5) % 4);
      r(bxp, 108 - hgt, 3, hgt, i % 3 === 0 ? '#4f8f5a' : (i % 3 === 1 ? C.whisky : '#b86b3a'));
      r(bxp, 107 - hgt, 1, 2, '#2b1f14');
    }
    for (let i = 0; i < 5; i++) {
      const bxp = 210 + i * 8;
      const hgt = 5 + ((i * 3) % 4);
      r(bxp, 119 - hgt, 4, hgt, i % 2 ? '#c9a26a' : '#8a4a56');
      r(bxp, 118 - hgt, 1, 2, '#2b1f14');
    }
    r(196, 144, 8, 3, '#d9c9a0');
    r(198, 147, 2, 9, C.metalDark);
    r(195, 156, 8, 2, C.metalDark);
    r(260, 168, 14, 8, '#8d8b9c');
    r(262, 165, 8, 4, '#9d9bad');
    r(261, 163, 2, 2, '#8d8b9c');
    r(268, 163, 2, 2, '#8d8b9c');
    r(259, 174, 6, 2, '#7d7b8c');
    r(263, 168, 1, 1, '#2a2a35');
    r(269, 168, 1, 1, '#2a2a35');
    r(296, 172, 12, 5, C.pot);
    r(298, 162, 8, 10, C.plant);
    r(294, 156, 16, 7, C.plantDark);
    r(300, 152, 6, 5, C.plant);
    r(281, 29, 12, 12, '#3a3350');
    r(282, 30, 10, 10, '#e8e3d2');
    r(286, 32, 1, 4, '#3a3350');
    r(287, 35, 3, 1, '#3a3350');
    r(286, 30, 1, 1, '#b9b2a0');
    r(176, 28, 8, 10, '#3a3350');
    r(177, 29, 6, 8, '#6b8fb8');
    r(288, 46, 12, 8, '#3a3350');
    r(289, 47, 10, 6, '#c9a06a');
  }

  /* ── 색 도우미 ── */
  function shade(hex, f) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    let rr = (n >> 16) & 255, gg = (n >> 8) & 255, bb = n & 255;
    const t = f < 1 ? 0 : 255, p = Math.abs(f - 1);
    rr = Math.round(rr + (t - rr) * p);
    gg = Math.round(gg + (t - gg) * p);
    bb = Math.round(bb + (t - bb) * p);
    return '#' + [rr, gg, bb].map(function (v) {
      v = Math.max(0, Math.min(255, v));
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('');
  }

  /* ── 캐릭터 ── */
  const actors = {};        // id → actor
  let actorList = [];

  function drawD(a, color, time) {
    const x = Math.round(a.x), y = Math.round(a.y);
    const walking = a.state === 'walk';
    const step = walking ? Math.floor(time * 8) % 2 : 0;
    const bob = walking ? (step ? 1 : 0) : (Math.sin(time * 2) > 0.6 ? 1 : 0);
    const yy = y - bob;

    ctx.save();
    ctx.translate(x, yy);
    if (a.dir < 0) ctx.scale(-1, 1);

    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(-6, 0, 12, 2);
    ctx.fillStyle = shade(color, 0.72);
    ctx.fillRect(-4 + (step ? 1 : 0), -2, 3, 3);
    ctx.fillRect(1 - (step ? 1 : 0), -2, 3, 3);
    // ㄷ 몸통
    ctx.fillStyle = color;
    ctx.fillRect(-6, -16, 12, 4);
    ctx.fillRect(-6, -16, 4, 15);
    ctx.fillRect(-6, -5, 12, 3);
    // 하이라이트
    ctx.fillStyle = shade(color, 1.35);
    ctx.fillRect(-5, -15, 2, 3);
    ctx.fillRect(-5, -12, 1, 6);
    // 테두리 음영
    ctx.fillStyle = shade(color, 0.72);
    ctx.fillRect(4, -15, 2, 2);
    ctx.fillRect(-6, -3, 12, 1);
    // 눈
    ctx.fillStyle = '#1b1f2e';
    const blink = (time % 4.2) < 0.12;
    if (blink) {
      ctx.fillRect(-4, -12, 2, 1);
      ctx.fillRect(-4, -8, 2, 1);
    } else {
      ctx.fillRect(-4, -13, 2, 3);
      ctx.fillRect(-4, -9, 2, 2);
    }
    ctx.fillStyle = '#f08aa0';
    ctx.fillRect(-1, -10, 2, 2);
    ctx.restore();
  }

  // 주인 캐릭터 — 여성 픽셀 캐릭터
  // 어깨까지 오는 밤색 단발 · 크림빛 로즈 니트 · 와인색 플리츠 스커트 · 멤버 색 벨트
  // shape 값 'mgr'(기존) · 'fm' · 'female' 모두 이 모양으로 그린다.
  function drawOwner(a, color, time) {
    const x = Math.round(a.x), y = Math.round(a.y);
    const walking = a.state === 'walk';
    const step = walking ? Math.floor(time * 8) % 2 : 0;
    const bob = walking ? (step ? 1 : 0) : (Math.sin(time * 1.7) > 0.82 ? 1 : 0);
    const yy = y - bob;
    const swingA = (walking && step) ? 1 : 0;   // 걸을 때 팔 흔들림
    const swingB = (walking && !step) ? 1 : 0;

    const hair = '#4a2f2c';        // 밤색 단발
    const hairHi = '#74483a';
    const skin = '#f4cdaa';
    const blush = '#e9909c';
    const lip = '#d4667a';
    const knit = '#f6ded9';        // 크림빛 로즈 니트
    const knitDark = '#e0bebc';
    const skirt = '#5d3a4c';       // 와인색 스커트
    const skirtHi = '#7a4f63';
    const skirtLo = '#472c3b';
    const shoe = '#241f2e';
    const gold = '#e8c060';
    const blink = (time % 4.4) < 0.12;

    ctx.save();
    ctx.translate(x, yy);
    if (a.dir < 0) ctx.scale(-1, 1);

    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(-5, 0, 11, 2);

    // 뒤로 흐르는 단발 (어깨 아래까지)
    ctx.fillStyle = hair;
    ctx.fillRect(-6, -20, 12, 13);
    ctx.fillRect(-5, -21, 10, 1);
    ctx.fillRect(-4, -22, 8, 1);
    ctx.fillStyle = hairHi;
    ctx.fillRect(-5, -19, 2, 1);
    ctx.fillRect(-6, -17, 1, 3);

    // 다리 + 힐
    ctx.fillStyle = skin;
    ctx.fillRect(-3 + step, -4, 2, 4);
    ctx.fillRect(1 - step, -4, 2, 4);
    ctx.fillStyle = shoe;
    ctx.fillRect(-3 + step, -1, 2, 1);
    ctx.fillRect(2 - step, -1, 2, 1);

    // 와인색 플리츠 스커트
    ctx.fillStyle = skirt;
    ctx.fillRect(-5, -7, 10, 3);
    ctx.fillStyle = skirtHi;
    ctx.fillRect(-4, -7, 1, 3);
    ctx.fillRect(-1, -7, 1, 3);
    ctx.fillRect(2, -7, 1, 3);
    ctx.fillStyle = skirtLo;
    ctx.fillRect(-5, -5, 10, 1);

    // 크림 니트 상의 + 소매
    ctx.fillStyle = knit;
    ctx.fillRect(-4, -12, 8, 4);
    ctx.fillStyle = knitDark;
    ctx.fillRect(-4, -12, 8, 1);
    ctx.fillRect(-5, -12, 1, 4 + swingA);
    ctx.fillRect(4, -12, 1, 4 + swingB);
    ctx.fillStyle = '#c9a2a1';
    ctx.fillRect(-5, -9, 1, 1);
    ctx.fillRect(4, -9, 1, 1);

    // 멤버 색 벨트 + 금 버클
    ctx.fillStyle = color;
    ctx.fillRect(-5, -8, 10, 1);
    ctx.fillStyle = shade(color, 1.3);
    ctx.fillRect(-5, -8, 2, 1);
    ctx.fillStyle = gold;
    ctx.fillRect(0, -8, 1, 1);

    // 목 + 가는 금 목걸이
    ctx.fillStyle = skin;
    ctx.fillRect(-1, -13, 2, 2);
    ctx.fillStyle = gold;
    ctx.fillRect(-1, -11, 3, 1);

    // 얼굴
    ctx.fillStyle = skin;
    ctx.fillRect(-4, -19, 8, 7);

    // 앞머리 + 옆머리 (얼굴을 감싸는 단발)
    ctx.fillStyle = hair;
    ctx.fillRect(-4, -20, 8, 2);
    ctx.fillRect(-4, -18, 6, 1);         // 한쪽으로 넘긴 앞머리 끝
    ctx.fillRect(-6, -19, 2, 10);
    ctx.fillRect(4, -19, 2, 10);

    // 눈 · 볼 · 입술
    ctx.fillStyle = '#2b1f2b';
    if (blink) {
      ctx.fillRect(-2, -16, 1, 1);
      ctx.fillRect(1, -16, 1, 1);
    } else {
      ctx.fillRect(-2, -16, 1, 2);
      ctx.fillRect(1, -16, 1, 2);
    }
    ctx.fillStyle = blush;
    ctx.fillRect(-4, -14, 1, 1);
    ctx.fillRect(3, -14, 1, 1);
    ctx.fillStyle = lip;
    ctx.fillRect(-1, -14, 2, 1);
    ctx.restore();
  }

  // 초대된 다른 피클: 색과 모양만 다른 작은 픽셀 생명체
  function drawBlob(a, color, shape, time) {
    const x = Math.round(a.x), y = Math.round(a.y);
    const walking = a.state === 'walk';
    const step = walking ? Math.floor(time * 8) % 2 : 0;
    const bob = walking ? (step ? 1 : 0) : (Math.sin(time * 1.8) > 0.7 ? 1 : 0);
    const yy = y - bob;

    ctx.save();
    ctx.translate(x, yy);
    if (a.dir < 0) ctx.scale(-1, 1);

    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(-6, 0, 12, 2);
    // 발
    ctx.fillStyle = shade(color, 0.65);
    ctx.fillRect(-4 + (step ? 1 : 0), -3, 3, 4);
    ctx.fillRect(1 - (step ? 1 : 0), -3, 3, 4);

    if (shape === 'ci') {
      // 둥근 몸
      ctx.fillStyle = color;
      ctx.fillRect(-5, -15, 10, 12);
      ctx.fillRect(-6, -12, 12, 7);
      ctx.fillStyle = shade(color, 1.3);
      ctx.fillRect(-4, -14, 3, 3);
      ctx.fillStyle = shade(color, 0.7);
      ctx.fillRect(-5, -4, 10, 1);
    } else {
      // 네모 몸 (sq / 기타)
      ctx.fillStyle = color;
      ctx.fillRect(-5, -15, 10, 12);
      ctx.fillStyle = shade(color, 1.3);
      ctx.fillRect(-4, -14, 2, 3);
      ctx.fillRect(-4, -10, 1, 4);
      ctx.fillStyle = shade(color, 0.7);
      ctx.fillRect(3, -14, 2, 2);
      ctx.fillRect(-5, -4, 10, 1);
    }
    // 눈
    ctx.fillStyle = '#1b1f2e';
    const blink = (time % 3.7) < 0.1;
    if (blink) {
      ctx.fillRect(-3, -10, 2, 1);
      ctx.fillRect(1, -10, 2, 1);
    } else {
      ctx.fillRect(-3, -11, 2, 2);
      ctx.fillRect(1, -11, 2, 2);
    }
    ctx.restore();
  }

  function drawActor(a, time) {
    const m = a.member || {};
    const color = m.color || '#facc15';
    if (m.shape === 'ㄷ') drawD(a, color, time);
    else if (m.shape === 'mgr' || m.shape === 'fm' || m.shape === 'female') drawOwner(a, color, time);
    else drawBlob(a, color, m.shape || 'sq', time);
  }

  function blocked(x, y) {
    if (x < 12 || x > 308 || y < 30 || y > 188) return true;
    for (let i = 0; i < OBSTACLES.length; i++) {
      const o = OBSTACLES[i];
      if (x > o.x - 5 && x < o.x + o.w + 5 && y > o.y - 8 && y < o.y + o.h + 6) return true;
    }
    return false;
  }

  function randomSpot(zoneKey) {
    const z = ZONES[zoneKey] || ZONES.board;
    for (let i = 0; i < 24; i++) {
      const x = z.x + 8 + Math.random() * (z.w - 16);
      const y = z.y + 10 + Math.random() * (z.h - 16);
      if (!blocked(x, y)) return { x: x, y: y };
    }
    return { x: z.spot.x, y: z.spot.y };
  }

  function syncActors() {
    const ms = memberList();
    const keep = {};
    ms.forEach(function (m) { keep[mid(m)] = true; });
    Object.keys(actors).forEach(function (id) { if (!keep[id]) delete actors[id]; });

    ms.forEach(function (m, i) {
      const id = mid(m);
      if (!actors[id]) {
        const zone = ZONE_OF[m.zone] || 'board';
        const farEnough = function (x, y) {
          return Object.keys(actors).every(function (other) {
            return Math.hypot(actors[other].x - x, actors[other].y - y) >= 26;
          });
        };
        let spot = randomSpot(zone);
        for (let k = 0; k < 20; k++) {
          if (farEnough(spot.x, spot.y)) break;
          // 한 곳에 몰리면 옆으로 비켜선 자리를 찾는다
          const nx = spot.x + (k % 2 ? 1 : -1) * Math.ceil((k + 1) / 2) * 11;
          const ny = spot.y + ((k % 3) - 1) * 7;
          if (!blocked(nx, ny) && farEnough(nx, ny)) { spot = { x: nx, y: ny }; break; }
          spot = randomSpot(zone);
        }
        actors[id] = {
          id: id, member: m,
          x: spot.x, y: spot.y,
          dir: 1, target: null, state: 'idle', t: 0,
          next: 2 + Math.random() * 3, zone: zone,
          bubble: '', bubbleT: 0
        };
      }
      actors[id].member = m;
    });
    actorList = ms.map(function (m) { return actors[mid(m)]; }).filter(Boolean);
    rebuildBubbles();
    paintBubbles();
  }

  function focusActors(zoneKey) {
    const key = ZONE_OF[zoneKey] || zoneKey;
    const z = ZONES[key];
    if (!z) return;
    actorList.forEach(function (a, i) {
      if (i > 0 && Math.random() < 0.45) return;
      const spot = randomSpot(key);
      a.target = { x: spot.x, y: Math.max(spot.y, z.y + 16) };
      a.state = 'walk';
      a.zone = key;
    });
  }

  function updateActor(a, dt, time) {
    if (a.target) {
      const dx = a.target.x - a.x, dy = a.target.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1.5) {
        a.target = null;
        a.state = 'idle';
        a.t = 0;
        a.next = 2 + Math.random() * 3;
      } else {
        const sp = 26 * dt;
        const before = { x: a.x, y: a.y };
        if (Math.abs(dx) > 0.6) {
          const nx = a.x + Math.sign(dx) * Math.min(Math.abs(dx), sp);
          if (!blocked(nx, a.y)) { a.x = nx; a.dir = dx > 0 ? 1 : -1; }
        }
        if (Math.abs(dy) > 0.4) {
          const ny = a.y + Math.sign(dy) * Math.min(Math.abs(dy), sp);
          if (!blocked(a.x, ny)) a.y = ny;
        }
        a.state = 'walk';
        const moved = Math.abs(a.x - before.x) + Math.abs(a.y - before.y);
        a.stuck = moved < 0.15 ? (a.stuck || 0) + dt : 0;
        if (a.stuck > 0.5) {
          a.stuck = 0;
          a.target = null;
          a.state = 'idle';
          a.next = 1 + Math.random() * 2;
        }
      }
    } else {
      a.t += dt;
      if (a.t > a.next) {
        const keys = Object.keys(ZONES);
        const key = (Math.random() < 0.45 && ZONES[a.zone]) ? a.zone : keys[Math.floor(Math.random() * keys.length)];
        a.target = randomSpot(key);
        a.zone = key;
        a.state = 'walk';
      }
    }
    if (a.bubbleT > 0) {
      a.bubbleT -= dt;
      if (a.bubbleT <= 0) a.bubble = '';
    }
  }

  const bubblePool = [];
  function refreshBubblePool() {
    const active = state.tasks.filter(function (t) { return t.status === 'active'; });
    const store = active.filter(function (t) { return t.zone === 'store'; }).length;
    const life = active.filter(function (t) { return t.zone === 'life'; }).length;
    const board = active.filter(function (t) { return t.zone === 'board'; }).length;
    bubblePool.length = 0;
    if (store) bubblePool.push('매장 업무 ' + store + '건 확인 중');
    if (board) bubblePool.push('현황판 정리 중');
    if (life) bubblePool.push('일상·위스키 쪽 챙기는 중');
    const open = state.requests.filter(function (x) { return x.status !== 'done'; }).length;
    if (open) bubblePool.push('지시 ' + open + '건 처리 중');
    bubblePool.push('할 일 정리 중', '잠깐 숨 고르는 중', '커피 한 모금', '메모 남기는 중');
  }

  let bubbleTimer = 0;
  const overlay = document.getElementById('overlay');
  let bubbleEls = {};
  let tagEls = {};
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function buildOverlay() {
    overlay.textContent = '';

    Object.keys(ZONES).forEach(function (key) {
      const z = ZONES[key];
      const hit = document.createElement('button');
      hit.className = 'zone-hit';
      hit.dataset.zone = ZONE_KEY[key];
      hit.style.left = (z.x / W * 100) + '%';
      hit.style.top = (z.y / H * 100) + '%';
      hit.style.width = (z.w / W * 100) + '%';
      hit.style.height = (z.h / H * 100) + '%';
      hit.setAttribute('aria-label', z.name + ' 열기');
      hit.addEventListener('click', function () { setFilter(ZONE_KEY[key]); });
      overlay.appendChild(hit);

      const label = document.createElement('div');
      label.className = 'zone-label';
      label.textContent = z.label;
      label.style.left = ((z.x + z.w / 2) / W * 100) + '%';
      label.style.top = ((z.labelY || z.y + 2) / H * 100) + '%';
      overlay.appendChild(label);
    });

    bubbleEls = {};
    tagEls = {};
  }

  function rebuildBubbles() {
    Object.keys(bubbleEls).forEach(function (k) { if (bubbleEls[k].parentNode) bubbleEls[k].parentNode.removeChild(bubbleEls[k]); });
    Object.keys(tagEls).forEach(function (k) { if (tagEls[k].parentNode) tagEls[k].parentNode.removeChild(tagEls[k]); });
    bubbleEls = {};
    tagEls = {};

    memberList().forEach(function (m, i) {
      const k = mid(m);
      const b = document.createElement('div');
      b.className = 'bubble';
      b.style.opacity = '0';
      b.style.background = '#f7f5ea';
      b.style.borderBottom = '2px solid ' + m.color;
      overlay.appendChild(b);
      bubbleEls[k] = b;

      const t = document.createElement('div');
      t.className = 'name-tag';
      t.textContent = m.name;
      t.style.borderColor = m.color;
      t.style.color = m.color;
      overlay.appendChild(t);
      tagEls[k] = t;
    });
  }

  function paintBubbles() {
    actorList.forEach(function (a) {
      const k = a.id;
      const el = bubbleEls[k];
      const tag = tagEls[k];
      if (tag) {
        tag.style.left = (a.x / W * 100) + '%';
        tag.style.top = ((a.y + 1) / H * 100) + '%';
      }
      if (!el) return;
      if (!a.bubble) { el.style.opacity = '0'; return; }
      el.style.opacity = '1';
      el.textContent = a.bubble;
      el.style.left = (a.x / W * 100) + '%';
      el.style.top = ((a.y - 22) / H * 100) + '%';
    });
  }

  function bubbleSay(a, text) {
    if (!a) return;
    a.bubble = text;
    a.bubbleT = 4.2;
    paintBubbles();
  }

  function updateBubbles(dt) {
    bubbleTimer += dt;
    if (bubbleTimer > 6.5) {
      bubbleTimer = 0;
      if (actorList.length && Math.random() < 0.75) {
        const ai = actorList.filter(function (a) { return a.member && a.member.role === 'ai'; });
        const pick = (ai.length ? ai : actorList)[Math.floor(Math.random() * (ai.length ? ai.length : actorList.length))];
        if (pick) {
          const st = (pick.member && pick.member.statusText) || '';
          bubbleSay(pick, st && Math.random() < 0.5 ? st : (bubblePool[Math.floor(Math.random() * bubblePool.length)] || '정리 중'));
        }
      }
    }
    paintBubbles();
  }

  /* ── 메인 루프 ── */
  let last = 0;
  function frame(ts) {
    const time = ts / 1000;
    let dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016;
    last = ts;

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0);

    // 화면 깜빡임
    const glow = 0.55 + Math.sin(time * 2.2) * 0.12;
    ctx.fillStyle = 'rgba(79,211,255,' + glow.toFixed(3) + ')';
    ctx.fillRect(120, 32, 4, 2);
    ctx.fillRect(120, 40, 4, 2);
    ctx.fillStyle = 'rgba(242,210,31,' + glow.toFixed(3) + ')';
    ctx.fillRect(120, 36, 3, 3);
    // 커피 스팀
    const st = Math.sin(time * 1.6) * 1.5;
    ctx.fillStyle = 'rgba(220,230,245,.35)';
    ctx.fillRect(31 + Math.round(st), 26, 1, 3);
    ctx.fillRect(32 - Math.round(st), 22, 1, 3);

    if (!reduceMotion) {
      actorList.forEach(function (a) { updateActor(a, dt, time); });
    }

    const drawList = actorList.slice().sort(function (a, b) { return a.y - b.y; });
    drawList.forEach(function (a) { drawActor(a, time); });

    updateBubbles(dt);
    requestAnimationFrame(frame);
  }

  /* ─────────────────────────── 새로고침 ─────────────────────────── */
  function snapKey() {
    return [
      state.tasks.map(function (t) { return [t.id, t.status, t.note, t.assignee, t.title, t.due].join('~'); }).join('|'),
      state.requests.map(function (r) { return [r.id, r.status, r.reply, r.updatedAt].join('~'); }).join('|'),
      state.members.map(function (m) { return [m.id, m.name, m.color, m.shape, m.statusText].join('~'); }).join('|')
    ].join('#');
  }

  let lastSnap = null;

  async function refresh(silent) {
    if (!hasRemote()) {
      state.remote = false;
      if (!silent) setSync(null, '로컬 저장');
      return;
    }
    state.remote = true;
    try {
      const data = await remoteList();
      applySnapshot(data);
      state.demo = false;
      setSync(true, '동기화됨');
      const key = snapKey();
      if (key !== lastSnap) {
        lastSnap = key;
        syncActors();
        render();
      }
    } catch (e) {
      setSync(false, '오프라인');
      if (!state.tasks.length) {
        const local = loadLocal();
        if (local) {
          state.tasks = normalizeTasks(local.tasks);
          state.requests = normalizeRequests(local.requests);
          state.members = normalizeMembers(local.members);
          syncActors();
          render();
        }
      }
    }
  }

  /* ─────────────────────────── 초대 문구 ─────────────────────────── */
  function syncLink() {
    if (!hasRemote()) return '';
    try {
      const o = { u: state.cfg.url, p: state.cfg.pin };
      const b = btoa(unescape(encodeURIComponent(JSON.stringify(o))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return location.origin + location.pathname + '#sync=' + b;
    } catch (e) { return ''; }
  }

  function inviteNote() {
    const link = syncLink();
    if (!link) return '동기화를 먼저 연결하면 초대 문구가 만들어집니다.';
    return '피클 오피스에 초대해요!\n' + link + '\n이 링크를 한 번 열면 같은 오피스에 캐릭터로 합류합니다.';
  }

  async function copyInvite() {
    const text = $('inviteNote').value;
    try {
      await navigator.clipboard.writeText(text);
      toast('초대 문구를 복사했어요');
    } catch (e) {
      const ta = $('inviteNote');
      ta.removeAttribute('readonly');
      ta.select();
      try { document.execCommand('copy'); toast('초대 문구를 복사했어요'); }
      catch (e2) { toast('복사가 안 되면 문구를 길게 눌러 복사해 주세요'); }
      ta.setAttribute('readonly', 'readonly');
    }
  }

  /* ─────────────────────────── UI 배선 ─────────────────────────── */
  function fillAssigneeOptions() {
    const sel = $('newAssignee');
    const prev = sel.value;
    sel.textContent = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '담당 없음';
    sel.appendChild(none);
    memberList().forEach(function (m) {
      const o = document.createElement('option');
      o.value = m.name;
      o.textContent = '@' + m.name;
      sel.appendChild(o);
    });
    const ai = firstAi();
    sel.value = (prev && memberList().some(function (m) { return m.name === prev; })) ? prev : (ai ? ai.name : '');
  }

  function switchTab(tab) {
    state.tab = tab;
    renderTabs();
    if (tab === 'inbox' && hasRemote()) refresh(true);
  }

  function initUI() {
    buildOverlay();

    document.querySelectorAll('.legend-chip').forEach(function (b) {
      b.addEventListener('click', function () { setFilter(b.dataset.zone); });
    });

    $('tabTasks').addEventListener('click', function () { switchTab('tasks'); });
    $('tabInbox').addEventListener('click', function () { switchTab('inbox'); });

    $('addForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const input = $('newTitle');
      const title = input.value.trim();
      if (!title) return;
      addTask(title, $('newZone').value, $('newAssignee').value);
      input.value = '';
    });

    $('clearFilter').addEventListener('click', function () { state.filter = null; render(); });

    $('panelGrip').addEventListener('click', function () {
      $('panel').classList.toggle('open');
    });

    $('reqForm').addEventListener('submit', function (e) {
      e.preventDefault();
      sendRequest();
    });

    $('reqRefresh').addEventListener('click', async function () {
      if (!hasRemote()) { toast('동기화를 먼저 연결해 주세요'); return; }
      await refresh(true);
      toast('새로고침했어요');
    });

    // 설정 모달
    const modal = $('settingsModal');
    $('settingsBtn').addEventListener('click', function () {
      $('cfgUrl').value = state.cfg.url;
      $('cfgPin').value = state.cfg.pin;
      $('cfgMsg').hidden = true;
      renderMembers();
      modal.hidden = false;
    });
    $('cfgClose').addEventListener('click', function () { modal.hidden = true; });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.hidden = true; });
    $('copyInvite').addEventListener('click', copyInvite);

    $('cfgSave').addEventListener('click', async function () {
      const url = $('cfgUrl').value.trim();
      const pin = $('cfgPin').value.trim();
      const msg = $('cfgMsg');
      msg.hidden = false;
      msg.className = 'modal-msg';
      if (!url || !pin) {
        msg.textContent = '주소와 PIN을 모두 넣어 주세요.';
        msg.classList.add('err');
        return;
      }
      state.cfg = { url: url, pin: pin };
      msg.textContent = '확인 중…';
      try {
        const data = await remoteList();
        state.remote = true;
        state.demo = false;
        applySnapshot(data);
        saveCfg();
        setSync(true, '동기화됨');
        syncActors();
        render();
        msg.textContent = '연결됐어요 · 할 일 ' + state.tasks.length + '건 · 지시 ' + state.requests.length + '건 · 멤버 ' + memberList().length + '명';
        msg.classList.add('ok');
        setTimeout(function () { modal.hidden = true; }, 1100);
        const a = aiActor();
        if (a) bubbleSay(a, '동기화 연결 완료!');
      } catch (e) {
        msg.textContent = '연결하지 못했어요. 주소와 PIN을 확인해 주세요. (' + e.message + ')';
        msg.classList.add('err');
        setSync(null, '로컬 저장');
      }
    });

    $('cfgDisconnect').addEventListener('click', function () {
      state.cfg = { url: '', pin: '' };
      state.remote = false;
      saveCfg();
      setSync(null, '로컬 저장');
      $('settingsModal').hidden = true;
      toast('동기화를 해제했어요. 이 기기에 저장된 내용만 보입니다.');
      render();
      renderMembers();
    });

    // 캐릭터 클릭(맵 위 아무 곳) — 캐릭터 근처를 누르면 인사
    canvas.addEventListener('click', function (e) {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width * W;
      const my = (e.clientY - rect.top) / rect.height * H;
      let hit = null, best = 13;
      actorList.forEach(function (a) {
        const d = Math.hypot(mx - a.x, my - (a.y - 9));
        if (d < best) { best = d; hit = a; }
      });
      if (hit) {
        bubbleSay(hit, hit.member.role === 'owner' ? '확인하고 있어요' : '네, 부르셨나요? 😊');
        return;
      }
      const ai = aiActor();
      if (ai && !blocked(mx, my)) {
        ai.target = { x: mx, y: my };
        ai.state = 'walk';
        bubbleSay(ai, '갑니다~');
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { $('settingsModal').hidden = true; }
    });

    // 다른 탭에서 돌아오면 최신 상태로
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && hasRemote()) refresh(true);
    });

    // 지시 회신을 놓치지 않도록 가볍게 주기 확인
    setInterval(function () {
      if (document.visibilityState === 'visible' && hasRemote()) refresh(true);
    }, 20000);
  }

  /* ─────────────────────────── 시작 ─────────────────────────── */
  function boot() {
    loadCfg();
    readHashSync();
    buildBackground();
    initUI();

    const local = loadLocal();
    if (local && local.tasks && local.tasks.length) {
      state.tasks = normalizeTasks(local.tasks);
      state.requests = normalizeRequests(local.requests);
      state.members = normalizeMembers(local.members);
    } else if (!hasRemote()) {
      state.tasks = normalizeTasks(DEMO_TASKS);
      state.requests = [];
      state.members = normalizeMembers(DEFAULT_MEMBERS);
      state.demo = true;
      saveLocal();
    } else {
      state.members = normalizeMembers(DEFAULT_MEMBERS);
    }

    syncActors();
    fillAssigneeOptions();
    render();

    requestAnimationFrame(frame);

    setTimeout(function () {
      const a = aiActor();
      if (a) bubbleSay(a, bubblePool[0] || '문 열었어요, 오늘도 화이팅!');
    }, 900);

    if (hasRemote()) {
      setSync(null, '연결 중');
      refresh(false);
    } else {
      setSync(null, '로컬 저장');
    }

    $('footRight').textContent = navigator.onLine ? '' : '오프라인';
    window.addEventListener('online', function () { if (hasRemote()) refresh(true); });
    window.addEventListener('offline', function () { setSync(false, '오프라인'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
