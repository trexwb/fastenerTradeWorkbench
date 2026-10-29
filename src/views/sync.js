// views/sync.js — 数据同步视图
/* =========================================================
   同步视图（viewSync）
   服务控制、连接配对、身份管理
   ========================================================= */

/** 格式化连接时长 */
function _fmtSyncDuration(secs) {
  if (secs < 60) return secs + ' 秒';
  if (secs < 3600) return Math.floor(secs / 60) + ' 分钟';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h + ' 小时 ' + m + ' 分钟';
}

/** 格式化倒计时（秒 → "X:XX"） */
function _fmtCountdown(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

/** 复制到剪贴板 */
function _syncCopyText(text, label) {
  if (!navigator.clipboard) {
    toast('当前环境不支持剪贴板', 'warning');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    toast(label + '已复制', 'success');
  }).catch(() => {
    toast('复制失败', 'error');
  });
}

/** 连接码倒计时定时器 */
let _syncCountdownTimer = null;
/** 已连接会话轮询定时器（Rust 侧仅入站请求有事件，会话断开无通知；同步视图可见时定时拉状态刷新列表） */
const SYNC_STATUS_POLL_MS = 10000;
let _syncStatusPollTimer = null;
/** 启动服务状态轮询：同步视图可见期间每 10s 拉一次，会话列表变化时重渲染（离开视图自动停） */
function _startSyncStatusPoll() {
  if (_syncStatusPollTimer) clearInterval(_syncStatusPollTimer);
  _syncStatusPollTimer = setInterval(function () {
    if (view !== 'sync') { clearInterval(_syncStatusPollTimer); _syncStatusPollTimer = null; return; }
    SYNC.getServerStatus().then(function (s) {
      if (view !== 'sync') return;
      const prev = window._syncStatus;
      window._syncStatus = s;
      const changed = JSON.stringify((prev && prev.sessions) || []) !== JSON.stringify((s && s.sessions) || []);
      if (changed) render(); /* 对端断开/新会话接入时刷新已连接设备表（否则列表永久滞留旧状态） */
    }).catch(function () {});
  }, SYNC_STATUS_POLL_MS);
}
function _startSyncCountdown() {
  if (_syncCountdownTimer) clearInterval(_syncCountdownTimer);
  _syncCountdownTimer = setInterval(() => {
    const el = document.getElementById('syncCodeCountdown');
    if (!el || !window._syncStatus) { clearInterval(_syncCountdownTimer); return; }
    if (window._syncStatus.codeExpiresIn > 0) {
      window._syncStatus.codeExpiresIn--;
      el.textContent = _fmtCountdown(window._syncStatus.codeExpiresIn);
      if (window._syncStatus.codeExpiresIn <= 60) el.style.color = 'var(--red)';
    } else {
      clearInterval(_syncCountdownTimer);
      el.textContent = '已过期';
      el.style.color = 'var(--red)';
      /* v1.1.0 审查修复：过期后旧码必然连接失败，明确引导刷新而非只留红字 */
      const hint = el.parentElement;
      if (hint) hint.style.color = 'var(--red)';
    }
  }, 1000);
}

/** 同步视图主入口 */
function viewSync() {
  // 清理倒计时定时器
  if (_syncCountdownTimer) { clearInterval(_syncCountdownTimer); _syncCountdownTimer = null; }

  if (!SYNC.isTauri) {
    /* v1.1.0 审查修复：浏览器版空态原为死路——只告知不可用，无任何出路；
       补充引导到「数据管理」（本地文件同步/备份在彼处可用） */
    return '<div class="card" style="text-align:center;padding:60px 20px;">' +
      '<div style="opacity:0.4;margin-bottom:16px;">' + icon('link', '48') + '</div>' +
      '<h3 style="margin:0 0 8px;font-size:16px;font-weight:600;color:var(--ink);">数据同步仅在桌面版中可用</h3>' +
      '<p style="margin:0 0 4px;color:var(--gray);font-size:14px;">设备间局域网同步需要桌面版提供的本地网络服务能力。</p>' +
      '<p style="margin:0 0 20px;color:var(--gray);font-size:13px;">网页版可使用「数据管理」中的本地文件同步与自动备份防止数据丢失。</p>' +
      '<button class="btn primary" onclick="go(\'data\')">' + icon('database', '14') + ' 前往数据管理</button>' +
      '</div>';
  }

  const identity = SYNC.getIdentity();
  const status = window._syncStatus || null;

  /* v1.1.0 审查修复：刷新页面后 window._syncStatus 丢失而 Rust 服务可能仍在运行——
     页面误显「未启动」，用户再次启动会报端口冲突。渲染后立即异步拉取真实状态回填。 */
  setTimeout(function () {
    SYNC.getServerStatus().then(function (s) {
      if (view !== 'sync') return;
      if (s && s.running && (!window._syncStatus || !window._syncStatus.running)) { window._syncStatus = s; render(); }
    }).catch(function () {});
  }, 0);
  _startSyncStatusPoll();

  let html = '<header style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">' +
    '<div style="width:40px;height:40px;border-radius:var(--radius-md);background:var(--pri-l);display:flex;align-items:center;justify-content:center;color:var(--pri);">' + icon('link', '22') + '</div>' +
    '<div><h2 style="margin:0;font-size:20px;font-weight:600;color:var(--ink);">数据同步</h2>' +
    '<p style="margin:0;font-size:13px;color:var(--gray);">局域网内设备间的数据同步与传输</p></div>' +
    '</header>';

  // ── 设备身份 ──
  html += '<section class="card" style="margin-bottom:16px;">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">' +
    '<span style="color:var(--pri);">' + icon('users', '16') + '</span>' +
    '<h3 style="margin:0;font-size:15px;font-weight:600;color:var(--ink);">设备身份</h3>' +
    '</div>' +
    '<div style="display:grid;gap:12px;">' +
    '<div style="display:flex;align-items:center;gap:12px;">' +
    '<label for="syncDeviceId" style="min-width:70px;color:var(--gray);font-size:13px;">设备 ID</label>' +
    '<code id="syncDeviceId" style="flex:1;font-size:12px;color:var(--gray);background:var(--bg-soft);padding:8px 12px;border-radius:var(--radius-sm);word-break:break-all;">' + escHtml(identity.deviceId) + '</code>' +
    '<button class="btn sm" onclick="_syncCopyText(\'' + escAttr(identity.deviceId) + '\', \'设备 ID\')" title="复制设备 ID">' + icon('copy', '14') + '</button>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:12px;">' +
    '<label for="syncNickname" style="min-width:70px;color:var(--gray);font-size:13px;">昵称</label>' +
    '<input id="syncNickname" type="text" value="' + escAttr(identity.nickname) + '" placeholder="输入昵称，方便对方识别" style="flex:1;max-width:240px;padding:8px 12px;">' +
    '<button class="btn sm primary" onclick="_syncSaveNickname()">保存</button>' +
    '</div>' +
    '</div>' +
    '</section>';

  // ── 同步服务 ──
  if (status && status.running) {
    // 启动倒计时
    setTimeout(_startSyncCountdown, 0);

    html += '<section class="card" style="margin-bottom:16px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
      '<span style="color:var(--green);">' + icon('check', '16') + '</span>' +
      '<h3 style="margin:0;font-size:15px;font-weight:600;color:var(--ink);">同步服务</h3>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;">' +
      '<span class="tag ok">运行中</span>' +
      '<button id="syncStopBtn" class="btn sm danger" onclick="_syncStopServer()">' + icon('x', '12') + ' 停止</button>' +
      '</div>' +
      '</div>';

    // 本机地址区域
    html += '<div style="background:var(--bg-soft);border-radius:var(--radius-md);padding:16px;margin-bottom:16px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
      '<span style="font-size:13px;color:var(--gray);font-weight:500;">本机地址（告知对方）</span>' +
      '<button class="btn sm" onclick="_syncCopyAllAddresses()" title="复制全部地址">' + icon('copy', '12') + ' 复制</button>' +
      '</div>';
    (status.localIps || []).forEach(function (ip) {
      const addr = ip + ':' + status.port;
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
        '<code style="flex:1;font-size:14px;background:var(--card);padding:10px 14px;border-radius:var(--radius-sm);color:var(--ink);font-family:\'SF Mono\',Menlo,Consolas,monospace;">' +
        escHtml(addr) + '</code>' +
        '<button class="btn sm" onclick="_syncCopyText(\'' + escAttr(addr) + '\', \'地址\')" title="复制">' + icon('copy', '14') + '</button>' +
        '</div>';
    });
    html += '</div>';

    // 连接码区域
    html += '<div style="background:var(--pri-l);border:1px solid var(--pri-p);border-radius:var(--radius-md);padding:20px;margin-bottom:16px;text-align:center;">' +
      '<div style="font-size:13px;color:var(--gray);margin-bottom:8px;font-weight:500;">连接码</div>' +
      '<div style="display:flex;align-items:center;justify-content:center;gap:16px;">' +
      '<span id="syncCodeDisplay" style="font-size:36px;font-weight:700;letter-spacing:8px;font-family:\'SF Mono\',Menlo,Consolas,monospace;color:var(--pri);user-select:all;">' +
      escHtml(status.code) + '</span>' +
      '<button class="btn sm" onclick="_syncCopyText(document.getElementById(\'syncCodeDisplay\').textContent, \'连接码\')" title="复制连接码">' + icon('copy', '16') + '</button>' +
      '<button class="btn sm" onclick="_syncRefreshCode()" title="刷新连接码">' + icon('refresh', '16') + '</button>' +
      '</div>' +
      '<div style="margin-top:12px;font-size:13px;color:var(--gray);">有效期 <span id="syncCodeCountdown" style="font-weight:600;color:var(--pri);font-family:monospace;">' +
      _fmtCountdown(status.codeExpiresIn || 0) + '</span>' +
      '，过期后对方无法凭旧码连接，请点击刷新按钮重新生成</div>' +
      '</div>';

    html += '</section>';
  } else {
    html += '<section class="card" style="margin-bottom:16px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
      '<span style="color:var(--gray);">' + icon('clock', '16') + '</span>' +
      '<h3 style="margin:0;font-size:15px;font-weight:600;color:var(--ink);">同步服务</h3>' +
      '</div>' +
      '<span class="tag gray">未启动</span>' +
      '</div>' +
      '<div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;">' +
      '<label for="syncPort" style="color:var(--gray);font-size:13px;min-width:50px;">端口</label>' +
      '<input id="syncPort" type="number" min="1" max="65535" value="' + SYNC.DEFAULT_PORT + '" style="width:120px;padding:8px 12px;" placeholder="默认 ' + SYNC.DEFAULT_PORT + '">' +
      '<button id="syncStartBtn" class="btn primary" onclick="_syncStartServer()">' + icon('play', '14') + ' 启动</button>' +
      '<span style="font-size:12px;color:var(--gray);">（留空使用默认端口）</span>' +
      '</div>' +
      '</section>';
  }

  // ── 连接对端 ──
  html += '<section class="card" style="margin-bottom:16px;">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">' +
    '<span style="color:var(--accent);">' + icon('link', '16') + '</span>' +
    '<h3 style="margin:0;font-size:15px;font-weight:600;color:var(--ink);">连接对端</h3>' +
    '</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;">' +
    '<div style="display:flex;flex-direction:column;gap:4px;">' +
    '<label for="peerAddr" style="color:var(--gray);font-size:12px;font-weight:500;">对方地址</label>' +
    '<input id="peerAddr" type="text" placeholder="192.168.1.100:' + SYNC.DEFAULT_PORT + '" style="width:200px;padding:8px 12px;">' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:4px;">' +
    '<label for="peerCode" style="color:var(--gray);font-size:12px;font-weight:500;">连接码</label>' +
    '<input id="peerCode" type="text" maxlength="6" placeholder="000000" style="width:100px;padding:8px 12px;font-family:\'SF Mono\',Menlo,Consolas,monospace;font-size:15px;letter-spacing:3px;text-align:center;" oninput="this.value=this.value.replace(/[^0-9]/g,\'\')">' +
    '</div>' +
    '<button id="syncConnectBtn" class="btn primary" onclick="_syncConnectPeer()">' +
    icon('link', '14') + ' 连接</button>' +
    '</div>' +
    '</section>';

  // ── 已连接设备 ──
  if (status && status.sessions && status.sessions.length > 0) {
    html += '<section class="card">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">' +
      '<span style="color:var(--green);">' + icon('users', '16') + '</span>' +
      '<h3 style="margin:0;font-size:15px;font-weight:600;color:var(--ink);">已连接设备</h3>' +
      '<span class="tag info" style="margin-left:auto;">' + status.sessions.length + ' 台</span>' +
      '</div>' +
      '<div class="table-wrap"><table>' +
      '<thead><tr><th>昵称</th><th>设备 ID</th><th>连接时长</th><th style="text-align:right;">操作</th></tr></thead>' +
      '<tbody>';
    status.sessions.forEach(function (s) {
      const nick = s.peer.nickname || '未命名';
      html += '<tr>' +
        '<td style="font-weight:500;">' + escHtml(nick) + '</td>' +
        '<td><code style="font-size:11px;background:var(--bg-soft);padding:3px 8px;border-radius:var(--radius-sm);">' + escHtml(s.peer.device_id) + '</code></td>' +
        '<td style="color:var(--gray);">' + _fmtSyncDuration(s.connected_secs) + '</td>' +
        '<td class="td-act" style="text-align:right;">' +
        '<button class="btn sm danger" onclick="_syncDisconnect(\'' + escAttr(s.session_id) + '\', this)">' + icon('x', '12') + ' 断开</button>' +
        '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div></section>';
  }

  return html;
}

// ── 操作函数 ────────────────────────────────────────────────────

/** 保存昵称 */
async function _syncSaveNickname() {
  const input = document.getElementById('syncNickname');
  if (!input) return;
  const name = input.value.trim();
  const btn = input.nextElementSibling;
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try {
    await SYNC.setNickname(name);
    toast('昵称已保存', 'success');
  } catch (e) {
    toast('保存失败: ' + (e.message || e), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

/** 启动同步服务 */
async function _syncStartServer() {
  const portInput = document.getElementById('syncPort');
  const port = portInput ? parseInt(portInput.value, 10) : null;
  /* v1.1.0 审查修复：端口非法值（0/负数/超 65535）此前直接透传 Rust；前端先拦截并给焦点 */
  if (port !== null && !(port >= 1 && port <= 65535)) {
    toast('端口需为 1-65535 之间的数字，留空则使用默认端口', 'warning');
    if (portInput) portInput.focus();
    return;
  }
  /* v1.1.0 审查修复：loading 误挂到「连接对端」的连接按钮（syncConnectBtn 恒存在，
     原回退分支永不可达），启动按钮自身无任何反馈——改为用自身 id */
  const btn = document.getElementById('syncStartBtn');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try {
    const status = await SYNC.startServer(port || null);
    window._syncStatus = status;
    toast('同步服务已启动', 'success');
    render();
  } catch (e) {
    toast('启动失败: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

/** 停止同步服务 */
async function _syncStopServer() {
  /* v1.1.0 审查修复：querySelectorAll('.btn.danger') 取末尾拿到的是「已连接设备」行的断开按钮
     （其渲染在停止服务按钮之后），停止时禁用的是错误按钮——改为用自身 id */
  const btn = document.getElementById('syncStopBtn');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try {
    await SYNC.stopServer();
    window._syncStatus = null;
    toast('同步服务已停止', 'info');
    render();
  } catch (e) {
    toast('停止失败: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

/** 刷新连接码 */
async function _syncRefreshCode() {
  try {
    const code = await SYNC.refreshCode();
    if (window._syncStatus) {
      window._syncStatus.code = code;
      window._syncStatus.codeExpiresIn = 300;
    }
    toast('连接码已刷新', 'success');
    render();
  } catch (e) {
    toast('刷新失败: ' + (e.message || e), 'error');
  }
}

/** 复制全部本机地址 */
function _syncCopyAllAddresses() {
  const status = window._syncStatus;
  if (!status || !status.localIps) return;
  const all = status.localIps.map(ip => ip + ':' + status.port).join('\n');
  _syncCopyText(all, '全部地址');
}

/** 连接到对端 */
async function _syncConnectPeer() {
  const addrInput = document.getElementById('peerAddr');
  const codeInput = document.getElementById('peerCode');
  const btn = document.getElementById('syncConnectBtn');
  if (!addrInput || !codeInput) return;

  // 清理地址输入：去除 http:// https:// 前缀和尾部斜杠
  let addr = addrInput.value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  addrInput.value = addr;

  const code = codeInput.value.trim();
  if (!addr) { toast('请输入对方地址', 'warning'); addrInput.focus(); return; }
  if (!code || code.length !== 6) { toast('请输入 6 位连接码', 'warning'); codeInput.focus(); return; }

  // 设置加载状态
  if (btn) { btn.disabled = true; btn.classList.add('loading'); btn.innerHTML = icon('refresh', '14') + ' 连接中...'; }

  try {
    const peer = await SYNC.connectToPeer(addr, code);
    toast('已连接到 ' + (peer.nickname || '对方设备'), 'success');
    const status = await SYNC.getServerStatus();
    window._syncStatus = status;
    render();
  } catch (e) {
    toast(e.message || '连接失败', 'error');
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.innerHTML = icon('link', '14') + ' 连接'; }
  }
}

/** 断开连接 */
async function _syncDisconnect(sessionId, btn) {
  /* v1.1.0 审查修复：改为显式传按钮（this），不再依赖全局 event 隐式变量 */
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try {
    await SYNC.disconnect(sessionId);
    toast('已断开连接', 'info');
    const status = await SYNC.getServerStatus();
    window._syncStatus = status;
    render();
  } catch (e) {
    toast('断开失败: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

/** 处理入站连接请求（事件回调） */
SYNC.on('incoming_request', function (data) {
  const nickname = data.nickname || '未知设备';
  const msg = '设备 <strong>' + escHtml(nickname) + '</strong> 请求连接到本机。<br>' +
    '<small style="color:var(--gray);">设备 ID: ' + escHtml(data.deviceId) + '</small>';
  confirmModal(
    msg,
    async function () {
      try {
        await SYNC.acceptRequest(data.requestId, true);
        toast('已接受连接', 'success');
        const status = await SYNC.getServerStatus();
        window._syncStatus = status;
        if (view === 'sync') render();
      } catch (e) {
        toast('操作失败: ' + (e.message || e), 'error');
      }
    },
    '接受',
    '拒绝',
    async function () {
      try {
        await SYNC.acceptRequest(data.requestId, false);
        toast('已拒绝连接', 'info');
      } catch (e) {
        toast('操作失败: ' + (e.message || e), 'error');
      }
    },
    true
  );
});
