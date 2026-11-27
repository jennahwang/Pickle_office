/* 피클 오피스 — 픽셀 오피스 맵 + 할 일 현황판
 * 공개 저장소에는 개인정보를 두지 않는다. 실제 데이터는 동기화 주소(Apps Script)에서
 * PIN으로 받아오고, 없으면 이 브라우저(localStorage)에만 저장한다.
 */
(function () {
  'use strict';

  /* ─────────────────────────── 상수 ─────────────────────────── */
  const W = 320, H = 192;

  const ZONES = {
    store: { x: 12, y: 100, w: 92, h: 86, label: '매장 업무', name: '매장 업무 존', spot: { x: 84, y: 136 } },
    board: { x: 110, y: 26, w: 98, h: 66, label: '할 일 현황판', name: '현황판 존', spot: { x: 150, y: 94 } },
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
    { x: 204, y: 98, w: 52, h: 26 },
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
    filter: null,
    cfg: { url: '', pin: '' },
    remote: false,
    online: null,   // null=미확인, true=동기화됨, false=오프라인
    demo: false
  };

  const DEMO_TASKS = [
    { id: 'demo1', zone: 'store', title: '샘플 · 매장 리뷰 확인', status: 'active', due: '' },
    { id: 'demo2', zone: 'store', title: '샘플 · 재고 정리', status: 'pending', due: '' },
    { id: 'demo3', zone: 'board', title: '샘플 · 주간 할 일 정리', status: 'active', due: '' },
    { id: 'demo4', zone: 'life', title: '샘플 · 라운지 병 정리', status: 'active', due: '' },
    { id: 'demo5', zone: 'brk', title: '샘플 · 커피 사 오기', status: 'done', due: '' }
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
      localStorage.setItem(STORE_KEY, JSON.stringify({ tasks: state.tasks, updated: Date.now() }));
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
    return normalize(data.tasks || []);
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
    return normalize(data.tasks || []);
  }

  function normalize(list) {
    return list.filter(function (t) { return t && t.title; }).map(function (t) {
      return {
        id: String(t.id || Math.random().toString(36).slice(2, 10)),
        title: String(t.title).slice(0, 120),
        zone: ZONE_OF[t.zone] ? t.zone : 'board',
        status: (t.status === 'done' || t.status === 'pending') ? t.status : 'active',
        due: t.due ? String(t.due).slice(0, 20) : '',
        note: t.note ? String(t.note).slice(0, 200) : ''
      };
    });
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

  async function refresh() {
    if (!hasRemote()) {
      state.remote = false;
      setSync(null, '로컬 저장');
      return;
    }
    state.remote = true;
    try {
      const list = await remoteList();
      state.tasks = list;
      state.demo = false;
      saveLocal();
      setSync(true, '동기화됨');
      render();
    } catch (e) {
      setSync(false, '오프라인');
      if (!state.tasks.length) {
        const local = loadLocal();
        if (local) state.tasks = local.tasks;
        render();
      }
    }
  }

  /* ─────────────────────────── 렌더 DOM ─────────────────────────── */
  const $ = function (id) { return document.getElementById(id); };

  function zoneTag(zone) {
    const span = document.createElement('span');
    span.className = 'tag zone-' + zone;
    span.textContent = ZONES[ZONE_OF[zone]].label;
    return span;
  }

  function render() {
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

      const del = document.createElement('button');
      del.className = 'del';
      del.type = 'button';
      del.setAttribute('aria-label', '삭제');
      del.textContent = '✕';
      del.addEventListener('click', function () { removeTask(t); });

      row.appendChild(check);
      row.appendChild(body);
      row.appendChild(del);
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
    $('newZone').value = z || 'board';

    // 단무지 말풍선 후보 갱신
    refreshBubblePool();
  }

  /* ─────────────────────────── 동작 ─────────────────────────── */
  function uid() { return Math.random().toString(36).slice(2, 10); }

  async function pushRemote(payload) {
    if (!hasRemote()) { saveLocal(); return; }
    try {
      const list = await remoteSend(payload);
      state.tasks = list;
      saveLocal();
      setSync(true, '동기화됨');
      render();
    } catch (e) {
      setSync(false, '오프라인');
      toast('서버에 저장하지 못했어요. 이 기기에만 남겨 뒀습니다.');
    }
  }

  function toggleDone(t) {
    t.status = t.status === 'done' ? 'active' : 'done';
    saveLocal();
    render();
    if (state.remote) pushRemote({ action: 'update', task: t });
    bubbleSay('danmuji', t.status === 'done' ? '하나 끝! 🎉' : '다시 할 일로 돌렸어요');
  }

  function cycleStatus(t) {
    t.status = t.status === 'active' ? 'pending' : (t.status === 'pending' ? 'done' : 'active');
    saveLocal();
    render();
    if (state.remote) pushRemote({ action: 'update', task: t });
  }

  function removeTask(t) {
    state.tasks = state.tasks.filter(function (x) { return x.id !== t.id; });
    saveLocal();
    render();
    if (state.remote) pushRemote({ action: 'delete', id: t.id });
  }

  function addTask(title, zone) {
    const t = { id: uid(), title: title, zone: zone, status: 'active', due: '', note: '' };
    state.tasks.unshift(t);
    saveLocal();
    render();
    if (state.remote) pushRemote({ action: 'add', task: t });
    focusActor(ZONE_OF[zone]);
    bubbleSay('danmuji', '새 할 일 접수! 「' + title.slice(0, 18) + '」');
  }

  function setFilter(zone) {
    state.filter = state.filter === zone ? null : zone;
    render();
    if (zone) {
      focusActor(zone);
      bubbleSay('danmuji', ZONES[zone].name + ' 확인하러 갈게요');
    }
    openSheet(true);
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
    r(110, 96, 198, 92, C.woodA);
    for (let y = 96; y < 188; y += 7) {
      r(110, y, 198, 1, C.woodB);
      r(110 + (y % 14 === 0 ? 24 : 60), y, 1, 7, C.woodLine);
      r(110 + (y % 14 === 0 ? 130 : 96), y, 1, 7, C.woodLine);
    }
    // 좌우 벽
    r(0, 25, 6, H - 25, C.wallLine);
    r(314, 25, 6, H - 25, C.wallLine);
    r(6, 25, 1, H - 25, C.wallEdge);

    /* ── 휴식·커피 코너 (좌상) ── */
    // 카운터
    r(14, 28, 62, 20, C.deskFront);
    r(14, 28, 62, 12, C.deskTop);
    r(14, 40, 62, 2, C.deskEdge);
    r(20, 42, 50, 1, '#5c3f29');
    // 커피 머신
    r(20, 30, 16, 10, '#2b3150');
    r(22, 31, 12, 5, '#3d466b');
    r(24, 36, 3, 3, '#d9d3c4');
    r(30, 30, 2, 2, '#ef6b6b');
    r(31, 33, 1, 1, '#5fd08a');
    // 컵 두 개
    r(42, 33, 4, 4, C.white);
    r(48, 34, 3, 3, '#d5cfbe');
    // 화분 (좌상)
    r(86, 36, 12, 4, C.pot);
    r(88, 30, 8, 6, C.plant);
    r(86, 26, 12, 5, C.plantDark);
    r(90, 24, 4, 3, C.plant);
    // 원두 자루
    r(62, 33, 8, 6, '#8a6a4a');
    r(62, 33, 8, 1, '#a1835f');
    // 스툴
    r(14, 74, 12, 4, '#8a6a4a');
    r(16, 78, 2, 6, C.metalDark);
    r(23, 78, 2, 6, C.metalDark);

    /* ── 할 일 현황판 (중앙) ── */
    r(116, 26, 86, 48, '#2b3150');            // 프레임
    r(118, 28, 82, 44, C.screen);             // 화면
    r(118, 28, 82, 3, '#132a3d');
    // 화면 내용 — 미니 할일 막대
    for (let i = 0; i < 5; i++) {
      const y = 34 + i * 7;
      r(122, y, 3, 3, i < 3 ? '#f2d21f' : '#5fd08a');
      r(128, y, 40 + ((i * 13) % 34), 3, i < 3 ? '#4fd3ff' : '#3f8f6a');
      r(128, y + 3, 60, 1, '#1b2b3d');
    }
    r(118, 66, 82, 1, '#101d2b');
    // 스크린 스탠드
    r(150, 74, 18, 2, C.metalDark);
    r(156, 76, 6, 4, C.metalDark);
    // 옆 모니터 데스크
    r(196, 60, 26, 12, C.deskFront);
    r(196, 60, 26, 4, C.deskTop);
    r(200, 52, 14, 9, '#1b2035');
    r(201, 53, 12, 7, '#2e6d8f');
    r(205, 62, 4, 2, C.metalDark);
    // 액자
    r(78, 30, 10, 8, '#3a3350');
    r(79, 31, 8, 6, '#7f6fb8');

    /* ── 매장 업무 존 (좌하) ── */
    function desk(dx, dy) {
      r(dx, dy, 60, 24, C.deskFront);
      r(dx, dy, 60, 16, C.deskTop);
      r(dx, dy + 16, 60, 1, C.deskEdge);
      r(dx + 4, dy + 18, 52, 1, '#5c3f29');
      // 모니터
      r(dx + 6, dy - 10, 20, 12, '#1b2035');
      r(dx + 7, dy - 9, 18, 10, '#2c4a6b');
      r(dx + 11, dy - 6, 10, 1, '#7fd4ff');
      r(dx + 11, dy - 3, 6, 1, '#4a8fb8');
      r(dx + 14, dy + 2, 4, 2, C.metalDark);
      // 서류 / 컵
      r(dx + 32, dy - 4, 10, 7, C.paper);
      r(dx + 33, dy - 3, 8, 1, '#c9c3b0');
      r(dx + 33, dy - 1, 6, 1, '#c9c3b0');
      r(dx + 48, dy - 3, 4, 4, C.white);
      // 서랍
      r(dx + 2, dy + 18, 20, 4, '#6b4a30');
      r(dx + 2, dy + 19, 20, 1, C.deskEdge);
    }
    desk(14, 106);
    desk(14, 142);
    // 서류 캐비닛
    r(84, 102, 18, 22, '#8f8a7a');
    r(84, 102, 18, 2, '#a8a291');
    r(86, 108, 14, 1, '#6e695c');
    r(86, 116, 14, 1, '#6e695c');
    r(91, 111, 4, 2, '#4a463c');
    // 쌓인 박스
    r(86, 128, 10, 8, '#c9a06a');
    r(86, 128, 10, 1, '#e0bb85');
    r(88, 136, 8, 6, '#b98f5c');
    // 바닥 매트
    r(6, 96, 104, 92, '#3a4160');
    for (let y = 100; y < 186; y += 6) r(6, y, 104, 1, '#414866');

    /* ── 라운지 (우하) ── */
    // 러그
    r(122, 126, 60, 26, C.rug);
    r(124, 128, 56, 22, '#67568a');
    r(126, 130, 52, 18, C.rug);
    // 소파
    r(116, 158, 66, 26, C.sofaDark);
    r(118, 160, 62, 20, C.sofa);
    r(118, 160, 62, 4, '#d06a63');
    r(120, 166, 26, 6, '#b34c47');
    r(150, 166, 26, 6, '#b34c47');
    r(128, 152, 16, 8, '#e08883');
    r(148, 152, 16, 8, '#e08883');
    // 커피 테이블
    r(132, 132, 30, 16, C.deskTop);
    r(132, 132, 30, 3, '#d0a473');
    r(134, 148, 2, 4, C.deskFront);
    r(158, 148, 2, 4, C.deskFront);
    // 위스키 진열장
    r(204, 98, 52, 26, '#6b4a30');
    r(204, 98, 52, 2, '#8a6340');
    r(206, 104, 48, 1, '#4d3323');
    r(206, 114, 48, 1, '#4d3323');
    for (let i = 0; i < 7; i++) {
      const bxp = 208 + i * 6;
      const hgt = 6 + ((i * 5) % 4);
      r(bxp, 104 - hgt, 3, hgt, i % 3 === 0 ? '#4f8f5a' : (i % 3 === 1 ? C.whisky : '#b86b3a'));
      r(bxp, 103 - hgt, 1, 2, '#2b1f14');
    }
    for (let i = 0; i < 5; i++) {
      const bxp = 210 + i * 8;
      const hgt = 5 + ((i * 3) % 4);
      r(bxp, 115 - hgt, 4, hgt, i % 2 ? '#c9a26a' : '#8a4a56');
      r(bxp, 114 - hgt, 1, 2, '#2b1f14');
    }
    // 스탠드 조명
    r(196, 144, 8, 3, '#d9c9a0');
    r(198, 147, 2, 9, C.metalDark);
    r(195, 156, 8, 2, C.metalDark);
    // 고양이 (잠자는 중)
    r(260, 168, 14, 8, '#8d8b9c');
    r(262, 165, 8, 4, '#9d9bad');
    r(261, 163, 2, 2, '#8d8b9c');
    r(268, 163, 2, 2, '#8d8b9c');
    r(259, 174, 6, 2, '#7d7b8c');
    r(263, 168, 1, 1, '#2a2a35');
    r(269, 168, 1, 1, '#2a2a35');
    // 화분 (우하)
    r(296, 172, 12, 5, C.pot);
    r(298, 162, 8, 10, C.plant);
    r(294, 156, 16, 7, C.plantDark);
    r(300, 152, 6, 5, C.plant);
    // 벽시계
    r(282, 30, 10, 10, '#3a3350');
    r(283, 31, 8, 8, C.white);
    r(286, 33, 1, 3, '#333');
    r(287, 35, 2, 1, '#333');
    // 벽 액자 2
    r(176, 28, 8, 10, '#3a3350');
    r(177, 29, 6, 8, '#6b8fb8');
    r(288, 46, 12, 8, '#3a3350');
    r(289, 47, 10, 6, '#c9a06a');
  }

  /* ── 캐릭터 ── */
  const actors = {
    danmuji: { x: 92, y: 96, dir: 1, target: null, state: 'idle', t: 0, next: 2.5, zone: 'board', bubble: '', bubbleT: 0 },
    user: { x: 168, y: 100, dir: -1, target: null, state: 'idle', t: 0, next: 4.0, zone: 'board', bubble: '', bubbleT: 0 }
  };

  function drawDanmuji(a, time) {
    const x = Math.round(a.x), y = Math.round(a.y);
    const walking = a.state === 'walk';
    const step = walking ? Math.floor(time * 8) % 2 : 0;
    const bob = walking ? (step ? 1 : 0) : (Math.sin(time * 2) > 0.6 ? 1 : 0);
    const yy = y - bob;

    ctx.save();
    ctx.translate(x, yy);
    if (a.dir < 0) ctx.scale(-1, 1);

    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(-6, 0, 12, 2);
    // 다리
    ctx.fillStyle = C.yellowDark;
    ctx.fillRect(-4 + (step ? 1 : 0), -2, 3, 3); 
    ctx.fillRect(1 - (step ? 1 : 0), -2, 3, 3);
    // ㄷ 몸통
    ctx.fillStyle = C.yellow;
    ctx.fillRect(-6, -16, 12, 4);   // 윗변
    ctx.fillRect(-6, -16, 4, 15);   // 왼쪽 변
    ctx.fillRect(-6, -5, 12, 3);    // 아랫변
    // 하이라이트
    ctx.fillStyle = C.yellowLight;
    ctx.fillRect(-5, -15, 2, 3);
    ctx.fillRect(-5, -12, 1, 6);
    // 테두리 음영
    ctx.fillStyle = C.yellowDark;
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
    // 볼
    ctx.fillStyle = '#f08aa0';
    ctx.fillRect(-1, -10, 2, 2);
    ctx.restore();
  }

  function drawUser(a, time) {
    const x = Math.round(a.x), y = Math.round(a.y);
    const walking = a.state === 'walk';
    const step = walking ? Math.floor(time * 8) % 2 : 0;
    const bob = walking ? (step ? 1 : 0) : 0;
    const yy = y - bob;

    ctx.save();
    ctx.translate(x, yy);
    if (a.dir < 0) ctx.scale(-1, 1);

    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(-5, 0, 11, 2);
    // 다리
    ctx.fillStyle = '#1e2338';
    ctx.fillRect(-4 + (step ? 1 : 0), -5, 3, 6);
    ctx.fillRect(1 - (step ? 1 : 0), -5, 3, 6);
    ctx.fillStyle = '#0f1220';
    ctx.fillRect(-4 + (step ? 1 : 0), -1, 4, 1);
    ctx.fillRect(1 - (step ? 1 : 0), -1, 4, 1);
    // 상의 (재킷)
    ctx.fillStyle = '#2f3a5e';
    ctx.fillRect(-5, -12, 10, 8);
    ctx.fillStyle = '#3b4875';
    ctx.fillRect(-5, -12, 2, 8);
    // 셔츠 + 넥타이
    ctx.fillStyle = '#e8ecf7';
    ctx.fillRect(-1, -12, 3, 6);
    ctx.fillStyle = '#d4574f';
    ctx.fillRect(0, -11, 1, 4);
    // 팔
    ctx.fillStyle = '#2a3454';
    ctx.fillRect(-6, -11, 2, 5 + (walking ? (step ? 1 : 0) : 0));
    ctx.fillRect(4, -11, 2, 5 + (walking ? (step ? 0 : 1) : 0));
    // 명찰
    ctx.fillStyle = C.yellow;
    ctx.fillRect(2, -11, 2, 2);
    // 머리
    ctx.fillStyle = '#f0c8a0';
    ctx.fillRect(-4, -19, 8, 7);
    ctx.fillStyle = '#23263a';
    ctx.fillRect(-5, -21, 10, 4);
    ctx.fillRect(-5, -18, 2, 4);
    ctx.fillStyle = '#2e3250';
    ctx.fillRect(-4, -18, 3, 1);
    // 눈
    ctx.fillStyle = '#1b1f2e';
    ctx.fillRect(-2, -16, 1, 2);
    ctx.fillRect(2, -16, 1, 2);
    ctx.fillStyle = '#d8a888';
    ctx.fillRect(-1, -14, 3, 1);
    ctx.restore();
  }

  function blocked(x, y) {
    if (x < 12 || x > 308 || y < 30 || y > 188) return true;
    for (let i = 0; i < OBSTACLES.length; i++) {
      const o = OBSTACLES[i];
      if (x > o.x - 5 && x < o.x + o.w + 5 && y > o.y - 2 && y < o.y + o.h + 6) return true;
    }
    return false;
  }

  function randomSpot(zoneKey) {
    const z = ZONES[zoneKey];
    for (let i = 0; i < 24; i++) {
      const x = z.x + 8 + Math.random() * (z.w - 16);
      const y = z.y + 10 + Math.random() * (z.h - 16);
      if (!blocked(x, y)) return { x: x, y: y };
    }
    return { x: z.spot.x, y: z.spot.y };
  }

  function focusActor(zoneKey) {
    const z = ZONES[zoneKey];
    const a = actors.danmuji;
    const spot = randomSpot(zoneKey);
    a.target = { x: spot.x, y: Math.max(spot.y, z.y + 16) };
    a.state = 'walk';
    a.zone = ZONE_KEY[zoneKey];
    // 황가람님 캐릭터도 조금 따라온다
    const u = actors.user;
    if (Math.random() < 0.55) {
      const s2 = { x: z.spot.x + (Math.random() - 0.5) * 18, y: z.spot.y + 8 };
      u.target = blocked(s2.x, s2.y) ? { x: z.spot.x, y: z.spot.y } : s2;
      u.state = 'walk';
      u.zone = ZONE_KEY[zoneKey];
    }
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
        // x축 먼저, 막히면 y축으로 미끄러진다
        if (Math.abs(dx) > 0.6) {
          const nx = a.x + Math.sign(dx) * Math.min(Math.abs(dx), sp);
          if (!blocked(nx, a.y)) { a.x = nx; a.dir = dx > 0 ? 1 : -1; }
        }
        if (Math.abs(dy) > 0.4) {
          const ny = a.y + Math.sign(dy) * Math.min(Math.abs(dy), sp);
          if (!blocked(a.x, ny)) a.y = ny;
        }
        a.state = 'walk';
        // 거의 못 움직이면 목표를 버린다
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
        const key = Math.random() < 0.45 ? ZONE_OF[a.zone] || 'board' : keys[Math.floor(Math.random() * keys.length)];
        a.target = randomSpot(key);
        a.zone = ZONE_KEY[key];
        a.state = 'walk';
      }
    }
    if (a.bubbleT > 0) {
      a.bubbleT -= dt;
      if (a.bubbleT <= 0) a.bubble = '';
    }
  }

  const BUBBLE_POOLS = { danmuji: [], user: [] };
  function refreshBubblePool() {
    const active = state.tasks.filter(function (t) { return t.status === 'active'; });
    const store = active.filter(function (t) { return t.zone === 'store'; }).length;
    const life = active.filter(function (t) { return t.zone === 'life'; }).length;
    const board = active.filter(function (t) { return t.zone === 'board'; }).length;
    const pool = [];
    if (store) pool.push('매장 업무 ' + store + '건 확인 중');
    if (board) pool.push('현황판 정리 중');
    if (life) pool.push('일상·위스키 쪽 챙기는 중');
    pool.push('할 일 정리 중', '잠깐 숨 고르는 중', '커피 한 모금', '메모 남기는 중');
    BUBBLE_POOLS.danmuji = pool;
    BUBBLE_POOLS.user = ['확인 중…', '고고', '오늘도 화이팅', '읽는 중…'];
  }

  let bubbleTimer = 0;
  function bubbleSay(who, text) {
    actors[who].bubble = text;
    actors[who].bubbleT = 4.2;
    paintBubbles();
  }

  function updateBubbles(dt) {
    bubbleTimer += dt;
    if (bubbleTimer > 6.5) {
      bubbleTimer = 0;
      const pool = BUBBLE_POOLS.danmuji;
      if (pool.length && Math.random() < 0.75) bubbleSay('danmuji', pool[Math.floor(Math.random() * pool.length)]);
      else if (Math.random() < 0.35) bubbleSay('user', BUBBLE_POOLS.user[Math.floor(Math.random() * BUBBLE_POOLS.user.length)]);
    }
    paintBubbles();
  }

  const overlay = document.getElementById('overlay');
  let bubbleEls = null;
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
      label.style.top = ((z.y + 2) / H * 100) + '%';
      overlay.appendChild(label);
    });

    bubbleEls = {
      danmuji: document.createElement('div'),
      user: document.createElement('div')
    };
    Object.keys(bubbleEls).forEach(function (k) {
      const el = bubbleEls[k];
      el.className = 'bubble ' + k;
      el.style.opacity = '0';
      overlay.appendChild(el);
    });
  }

  function paintBubbles() {
    if (!bubbleEls) return;
    Object.keys(bubbleEls).forEach(function (k) {
      const a = actors[k];
      const el = bubbleEls[k];
      if (!a.bubble) { el.style.opacity = '0'; return; }
      el.style.opacity = '1';
      el.textContent = a.bubble;
      const headY = k === 'danmuji' ? a.y - 20 : a.y - 24;
      el.style.left = (a.x / W * 100) + '%';
      el.style.top = ((headY - 4) / H * 100) + '%';
    });
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
      updateActor(actors.danmuji, dt, time);
      updateActor(actors.user, dt, time);
    }

    // y 순서대로 그리기
    const drawList = [actors.danmuji, actors.user].sort(function (a, b) { return a.y - b.y; });
    drawList.forEach(function (a) {
      if (a === actors.danmuji) drawDanmuji(a, time);
      else drawUser(a, time);
    });

    updateBubbles(dt);
    requestAnimationFrame(frame);
  }

  /* ─────────────────────────── UI 배선 ─────────────────────────── */
  function openSheet(open) {
    const panel = $('panel');
    if (window.innerWidth > 880) return;
    panel.classList.add('collapsed');
    panel.classList.toggle('open', open !== false);
  }

  function initUI() {
    buildOverlay();

    document.querySelectorAll('.legend-chip').forEach(function (b) {
      b.addEventListener('click', function () { setFilter(b.dataset.zone); });
    });

    $('addForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const input = $('newTitle');
      const title = input.value.trim();
      if (!title) return;
      addTask(title, $('newZone').value);
      input.value = '';
      openSheet(true);
    });

    $('clearFilter').addEventListener('click', function () { state.filter = null; render(); });

    $('panelGrip').addEventListener('click', function () {
      const p = $('panel');
      p.classList.toggle('open');
    });

    // 설정 모달
    const modal = $('settingsModal');
    $('settingsBtn').addEventListener('click', function () {
      $('cfgUrl').value = state.cfg.url;
      $('cfgPin').value = state.cfg.pin;
      $('cfgMsg').hidden = true;
      modal.hidden = false;
    });
    $('cfgClose').addEventListener('click', function () { modal.hidden = true; });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.hidden = true; });

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
        const list = await remoteList();
        state.tasks = list;
        state.remote = true;
        state.demo = false;
        saveCfg();
        saveLocal();
        setSync(true, '동기화됨');
        render();
        msg.textContent = '연결됐어요 · 할 일 ' + list.length + '건';
        msg.classList.add('ok');
        setTimeout(function () { modal.hidden = true; }, 900);
        bubbleSay('danmuji', '동기화 연결 완료!');
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
      toast('동기화를 해제했어요. 이 기기에 저장된 할 일만 보입니다.');
      render();
    });

    // 캐릭터 클릭(맵 위 아무 곳) — 캐릭터 근처를 누르면 인사
    canvas.addEventListener('click', function (e) {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width * W;
      const my = (e.clientY - rect.top) / rect.height * H;
      const d = Math.hypot(mx - actors.danmuji.x, my - (actors.danmuji.y - 8));
      const u = Math.hypot(mx - actors.user.x, my - (actors.user.y - 8));
      if (d < 12) { bubbleSay('danmuji', '네, 부르셨나요? 😊'); return; }
      if (u < 12) { bubbleSay('user', '확인하고 있어요'); return; }
      // 빈 바닥을 누르면 그쪽으로 걸어간다
      if (!blocked(mx, my)) {
        actors.danmuji.target = { x: mx, y: my };
        actors.danmuji.state = 'walk';
        bubbleSay('danmuji', '갑니다~');
      }
    });

    // 모바일 시트: 처음엔 접힌 상태
    if (window.innerWidth <= 880) {
      const p = $('panel');
      p.classList.add('collapsed');
      // 접힌 헤더만 보이도록 상태 표시
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { $('settingsModal').hidden = true; }
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 880) {
        const p = $('panel');
        p.classList.remove('collapsed', 'open');
      }
    });

    // 다른 탭에서 돌아오면 최신 상태로
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && hasRemote()) refresh();
    });
  }

  /* ─────────────────────────── 시작 ─────────────────────────── */
  function boot() {
    loadCfg();
    buildBackground();
    initUI();

    const local = loadLocal();
    if (local && local.tasks.length) {
      state.tasks = local.tasks;
    } else if (!hasRemote()) {
      state.tasks = DEMO_TASKS.slice();
      state.demo = true;
      saveLocal();
    }

    render();
    requestAnimationFrame(frame);

    if (hasRemote()) {
      setSync(null, '연결 중');
      refresh();
    } else {
      setSync(null, '로컬 저장');
    }

    $('footRight').textContent = navigator.onLine ? '' : '오프라인';
    window.addEventListener('online', function () { if (hasRemote()) refresh(); });
    window.addEventListener('offline', function () { setSync(false, '오프라인'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
