// sync.js — 数据同步引擎
/* =========================================================
   同步层（window.SYNC）
   仅在 Tauri 桌面运行时可用；浏览器版优雅降级。
   ========================================================= */

/** 默认同步端口 */
const SYNC_DEFAULT_PORT = 19826;
/** localStorage 键名：同步身份 */
const SYNC_IDENTITY_KEY = 'fw_sync_identity';

/**
 * 数据同步引擎（全局挂载 window.SYNC）
 * 职责：身份管理、服务控制、连接配对、事件分发
 */
const SYNC = (function () {
  const _T = window.__TAURI__;
  /** 是否为 Tauri 桌面运行时 */
  const isTauri = !!(
    _T &&
    _T.core &&
    typeof _T.core.invoke === 'function' &&
    _T.event &&
    typeof _T.event.listen === 'function'
  );

  /** 本机身份（内存缓存） */
  let _identity = null;
  /** 服务状态缓存 */
  let _serverStatus = null;
  /** 事件监听器 */
  const _listeners = {};

  // ── Tauri 调用封装 ──────────────────────────────────────────

  /** 调用 Tauri 命令 */
  function invoke(cmd, args) {
    if (!isTauri) return Promise.reject(new Error('非 Tauri 运行时'));
    return _T.core.invoke(cmd, args || {});
  }

  /** 监听 Tauri 事件 */
  function listen(evt, cb) {
    if (!isTauri) return () => {};
    let released = false;
    _T.event.listen(evt, function (e) {
      if (!released && cb) cb(e);
    });
    return function () {
      if (released) return;
      released = true;
    };
  }

  // ── 身份管理 ────────────────────────────────────────────────

  /** 生成 UUID v4（简化版，足够设备标识使用） */
  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // 回退：基于时间戳 + 随机数
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /** 获取或创建本机身份 */
  function getIdentity() {
    if (_identity) return _identity;

    const stored = localStorage.getItem(SYNC_IDENTITY_KEY);
    if (stored) {
      try {
        _identity = JSON.parse(stored);
        return _identity;
      } catch (_) {}
    }

    // 首次使用：创建新身份
    _identity = {
      deviceId: generateUUID(),
      nickname: '',
      createdAt: Date.now(),
    };
    localStorage.setItem(SYNC_IDENTITY_KEY, JSON.stringify(_identity));
    return _identity;
  }

  /** 设置昵称（同时更新本地存储和 Rust 状态） */
  async function setNickname(name) {
    const identity = getIdentity();
    identity.nickname = (name || '').trim();
    localStorage.setItem(SYNC_IDENTITY_KEY, JSON.stringify(identity));

    if (isTauri) {
      await invoke('sync_set_identity', {
        deviceId: identity.deviceId,
        nickname: identity.nickname,
      });
    }

    _emit('identity_changed', identity);
    return identity;
  }

  /** 初始化身份（启动时调用，将身份同步到 Rust） */
  async function initIdentity() {
    if (!isTauri) return;
    const identity = getIdentity();
    await invoke('sync_set_identity', {
      deviceId: identity.deviceId,
      nickname: identity.nickname,
    });
  }

  // ── 服务控制 ────────────────────────────────────────────────

  /** 启动同步服务 */
  async function startServer(port) {
    if (!isTauri) throw new Error('数据同步仅在桌面版中可用');

    const result = await invoke('sync_start', { port: port || null });
    _serverStatus = {
      running: true,
      port: result.port,
      code: result.code,
      localIps: result.localIps,
      codeExpiresIn: 300,
      sessions: [],
      pendingRequests: [],
    };

    _emit('server_started', _serverStatus);
    return _serverStatus;
  }

  /** 停止同步服务 */
  async function stopServer() {
    if (!isTauri) return;
    await invoke('sync_stop');
    _serverStatus = null;
    _emit('server_stopped');
  }

  /** 刷新连接码 */
  async function refreshCode() {
    if (!isTauri) throw new Error('非 Tauri 运行时');
    const code = await invoke('sync_refresh_code');
    if (_serverStatus) {
      _serverStatus.code = code;
      _serverStatus.codeExpiresIn = 300;
    }
    _emit('code_refreshed', code);
    return code;
  }

  /** 获取服务状态 */
  async function getServerStatus() {
    if (!isTauri) return null;
    const status = await invoke('sync_status');
    _serverStatus = status;
    return status;
  }

  // ── 连接管理 ────────────────────────────────────────────────

  /** 主动连接到对端 */
  async function connectToPeer(addr, code) {
    if (!isTauri) throw new Error('数据同步仅在桌面版中可用');

    const result = await invoke('sync_connect', { addr, code });
    const peer = result.peer;

    _emit('connected', peer);
    return peer;
  }

  /** 断开与对端的连接 */
  async function disconnect(sessionId) {
    if (!isTauri) return;
    await invoke('sync_disconnect', { sessionId });
    _emit('disconnected', sessionId);
  }

  /** 接受或拒绝入站连接请求 */
  async function acceptRequest(requestId, accepted) {
    if (!isTauri) return;
    const result = await invoke('sync_accept', { requestId, accepted });
    if (result.accepted) {
      _emit('request_accepted', result.peer);
    } else {
      _emit('request_rejected', requestId);
    }
    return result;
  }

  // ── 事件系统 ────────────────────────────────────────────────

  /** 注册事件监听 */
  function on(event, callback) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(callback);
  }

  /** 移除事件监听 */
  function off(event, callback) {
    if (!_listeners[event]) return;
    _listeners[event] = _listeners[event].filter((cb) => cb !== callback);
  }

  /** 触发事件（内部使用） */
  function _emit(event, data) {
    if (!_listeners[event]) return;
    _listeners[event].forEach((cb) => {
      try {
        cb(data);
      } catch (e) {
        console.error(`[SYNC] 事件处理器错误 (${event}):`, e);
      }
    });
  }

  // ── 初始化 ──────────────────────────────────────────────────

  /** 初始化同步引擎（应用启动时调用） */
  async function init() {
    if (!isTauri) return;

    // 初始化身份
    await initIdentity();

    // 监听入站连接请求
    listen('sync:incoming_request', function (event) {
      const payload = event.payload;
      _emit('incoming_request', {
        requestId: payload.requestId,
        deviceId: payload.deviceId,
        nickname: payload.nickname,
      });
    });

    // 获取初始状态
    await getServerStatus();
  }

  // ── 公开接口 ────────────────────────────────────────────────

  return {
    // 常量
    DEFAULT_PORT: SYNC_DEFAULT_PORT,

    // 属性
    get isTauri() {
      return isTauri;
    },

    // 身份
    getIdentity,
    setNickname,

    // 服务
    startServer,
    stopServer,
    refreshCode,
    getServerStatus,

    // 连接
    connectToPeer,
    disconnect,
    acceptRequest,

    // 事件
    on,
    off,

    // 初始化
    init,
  };
})();

window.SYNC = SYNC;
