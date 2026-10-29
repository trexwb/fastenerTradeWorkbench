// sync_server.rs — 数据同步 HTTP 服务
//
// Tauri 主进程内置 HTTP 服务器，用于同一局域网内设备间配对连接。
// 连接码配对 → 双方确认 → 建立会话。

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, oneshot};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use tauri::Emitter;

// ── 常量 ────────────────────────────────────────────────────────

/// 连接码有效期（5 分钟）
const CODE_TTL: Duration = Duration::from_secs(300);
/// 连接码错误尝试上限
const MAX_FAILED_ATTEMPTS: u32 = 5;
/// 错误锁定时间（1 分钟）
const LOCKOUT_DURATION: Duration = Duration::from_secs(60);
/// 等待对方确认超时（2 分钟）
const CONFIRM_TIMEOUT: Duration = Duration::from_secs(120);
/// 默认监听端口
const DEFAULT_PORT: u16 = 19826;

// ── 公开类型 ────────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncIdentity {
    pub device_id: String,
    pub nickname: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub device_id: String,
    pub nickname: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub running: bool,
    pub port: u16,
    pub code: String,
    pub code_expires_in: u64,
    pub local_ips: Vec<String>,
    pub sessions: Vec<SessionInfo>,
    pub pending_requests: Vec<PendingInfo>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub peer: PeerInfo,
    pub connected_secs: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingInfo {
    pub request_id: String,
    pub peer: PeerInfo,
    pub waiting_secs: u64,
}

// ── 内部类型 ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct HelloRequest {
    code: String,
    device_id: String,
    nickname: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelloResponse {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    peer: Option<PeerInfo>,
}

#[derive(Serialize)]
struct PingResponse {
    ok: bool,
    device_id: String,
    nickname: String,
}

struct PendingConnection {
    requester: PeerInfo,
    tx: oneshot::Sender<HelloResponse>,
    request_id: String,
    #[allow(dead_code)]
    created_at: Instant,
}

struct ActiveSession {
    session_id: String,
    peer: PeerInfo,
    connected_at: Instant,
}

pub struct SyncState {
    identity: SyncIdentity,
    running: bool,
    port: u16,
    code: String,
    code_expires: Option<Instant>,
    failed_attempts: u32,
    locked_until: Option<Instant>,
    pending: HashMap<String, PendingConnection>,
    sessions: HashMap<String, ActiveSession>,
    cancel_token: Option<CancellationToken>,
}

// ── 状态构造 ────────────────────────────────────────────────────

pub fn new_state() -> Arc<Mutex<SyncState>> {
    Arc::new(Mutex::new(SyncState {
        identity: SyncIdentity {
            device_id: String::new(),
            nickname: String::new(),
        },
        running: false,
        port: 0,
        code: String::new(),
        code_expires: None,
        failed_attempts: 0,
        locked_until: None,
        pending: HashMap::new(),
        sessions: HashMap::new(),
        cancel_token: None,
    }))
}

// ── 公开接口（供 Tauri 命令调用）────────────────────────────────

/// 设置本机身份信息
pub async fn set_identity(state: &Arc<Mutex<SyncState>>, identity: SyncIdentity) {
    let mut s = state.lock().await;
    s.identity = identity;
}

/// 启动同步服务，返回 (端口, 连接码, 本机 IP 列表)
pub async fn start(
    state: &Arc<Mutex<SyncState>>,
    app: tauri::AppHandle,
    preferred_port: Option<u16>,
) -> Result<(u16, String, Vec<String>), String> {
    // 检查是否已在运行
    {
        let s = state.lock().await;
        if s.running {
            return Err("服务已在运行，请先停止当前服务".to_string());
        }
    }

    let port = find_available_port(preferred_port.unwrap_or(DEFAULT_PORT))
        .ok_or_else(|| "无法找到可用端口（已尝试 100 个）".to_string())?;

    let code = generate_code();
    let cancel_token = CancellationToken::new();
    let local_ips = get_local_ips();

    let app_router = Router::new()
        .route("/api/sync/hello", post(handle_hello))
        .route("/api/sync/ping", get(handle_ping))
        .with_state((state.clone(), app));

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("绑定端口 {port} 失败: {e}"))?;

    let ct = cancel_token.clone();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app_router)
            .with_graceful_shutdown(async move { ct.cancelled().await })
            .await;
    });

    {
        let mut s = state.lock().await;
        s.running = true;
        s.port = port;
        s.code = code.clone();
        s.code_expires = Some(Instant::now() + CODE_TTL);
        s.failed_attempts = 0;
        s.locked_until = None;
        s.cancel_token = Some(cancel_token);
    }

    Ok((port, code, local_ips))
}

/// 停止同步服务
pub async fn stop(state: &Arc<Mutex<SyncState>>) -> Result<(), String> {
    let mut s = state.lock().await;
    if let Some(token) = s.cancel_token.take() {
        token.cancel();
    }
    s.running = false;
    s.port = 0;
    s.code.clear();
    s.code_expires = None;
    s.pending.clear();
    s.sessions.clear();
    Ok(())
}

/// 刷新连接码
pub async fn refresh_code(state: &Arc<Mutex<SyncState>>) -> Result<String, String> {
    let mut s = state.lock().await;
    if !s.running {
        return Err("服务未运行".to_string());
    }
    let code = generate_code();
    s.code = code.clone();
    s.code_expires = Some(Instant::now() + CODE_TTL);
    s.failed_attempts = 0;
    s.locked_until = None;
    Ok(code)
}

/// 获取服务状态快照
pub async fn get_status(state: &Arc<Mutex<SyncState>>) -> ServerStatus {
    let s = state.lock().await;
    let now = Instant::now();
    let code_expires_in = s
        .code_expires
        .map(|t| t.saturating_duration_since(now).as_secs())
        .unwrap_or(0);

    ServerStatus {
        running: s.running,
        port: s.port,
        code: s.code.clone(),
        code_expires_in,
        local_ips: get_local_ips(),
        sessions: s
            .sessions
            .values()
            .map(|sess| SessionInfo {
                session_id: sess.session_id.clone(),
                peer: sess.peer.clone(),
                connected_secs: sess.connected_at.elapsed().as_secs(),
            })
            .collect(),
        pending_requests: s
            .pending
            .values()
            .map(|p| PendingInfo {
                request_id: p.request_id.clone(),
                peer: p.requester.clone(),
                waiting_secs: p.created_at.elapsed().as_secs(),
            })
            .collect(),
    }
}

/// 接受或拒绝一个待确认的连接请求
pub async fn accept_request(
    state: &Arc<Mutex<SyncState>>,
    request_id: String,
    accepted: bool,
) -> Result<Option<PeerInfo>, String> {
    let mut s = state.lock().await;

    let pending = s
        .pending
        .remove(&request_id)
        .ok_or_else(|| "请求不存在或已处理".to_string())?;

    if accepted {
        let session_id = Uuid::new_v4().to_string();
        let peer = pending.requester.clone();

        s.sessions.insert(
            session_id.clone(),
            ActiveSession {
                session_id: session_id.clone(),
                peer: peer.clone(),
                connected_at: Instant::now(),
            },
        );

        let _ = pending.tx.send(HelloResponse {
            status: "accepted".to_string(),
            session_id: Some(session_id),
            peer: Some(peer.clone()),
        });

        Ok(Some(peer))
    } else {
        let _ = pending.tx.send(HelloResponse {
            status: "rejected".to_string(),
            session_id: None,
            peer: None,
        });
        Ok(None)
    }
}

/// 断开一个活跃会话
pub async fn disconnect_session(
    state: &Arc<Mutex<SyncState>>,
    session_id: String,
) -> Result<(), String> {
    let mut s = state.lock().await;
    s.sessions
        .remove(&session_id)
        .ok_or_else(|| "会话不存在".to_string())?;
    Ok(())
}

/// 主动连接到对端（客户端角色）
pub async fn connect_to_peer(
    state: &Arc<Mutex<SyncState>>,
    addr: String,
    code: String,
) -> Result<PeerInfo, String> {
    let identity = {
        let s = state.lock().await;
        if s.identity.device_id.is_empty() {
            return Err("请先在同步设置中填写昵称以初始化设备身份".to_string());
        }
        s.identity.clone()
    };

    let addr = addr.trim().to_string();
    if addr.is_empty() {
        return Err("请输入对方地址".to_string());
    }
    let code = code.trim().to_string();
    if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
        return Err("连接码必须为 6 位数字".to_string());
    }

    let url = format!("http://{}/api/sync/hello", addr.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(130))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let body = serde_json::to_string(&serde_json::json!({
        "code": code,
        "device_id": identity.device_id,
        "nickname": identity.nickname,
    }))
    .map_err(|e| format!("序列化请求失败: {e}"))?;

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("Connection refused") || msg.contains("connect") {
                "无法连接到对方，请检查 IP 和端口是否正确，以及对方是否已开启同步服务"
                    .to_string()
            } else if msg.contains("timed out") || msg.contains("timeout") {
                "连接超时，请检查网络是否正常".to_string()
            } else {
                format!("连接失败: {msg}")
            }
        })?;

    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;

    let hello_resp: HelloResponse =
        serde_json::from_str(&text).map_err(|e| format!("响应格式错误: {e}"))?;

    match hello_resp.status.as_str() {
        "accepted" => Ok(hello_resp.peer.unwrap_or(PeerInfo {
            device_id: String::new(),
            nickname: "未知设备".to_string(),
        })),
        "invalid_code" => Err("连接码错误".into()),
        "code_expired" => Err("连接码已过期，请对方刷新后重试".into()),
        "locked" => Err("对方服务已暂时锁定（多次输错连接码），请稍后再试".into()),
        "rejected" => Err("对方拒绝了连接请求".into()),
        "timeout" => Err("对方确认超时，请重试".into()),
        "service_stopped" => Err("对方同步服务未运行".into()),
        other => Err(format!("连接失败: {other}")),
    }
}

// ── HTTP 处理器 ──────────────────────────────────────────────────

/// GET /api/sync/ping — 健康检查，返回本机身份信息
async fn handle_ping(
    State((state, _)): State<(Arc<Mutex<SyncState>>, tauri::AppHandle)>,
) -> impl IntoResponse {
    let s = state.lock().await;
    Json(PingResponse {
        ok: true,
        device_id: s.identity.device_id.clone(),
        nickname: s.identity.nickname.clone(),
    })
}

/// POST /api/sync/hello — 接收连接请求，验证连接码，等待用户确认
async fn handle_hello(
    State((state, app)): State<(Arc<Mutex<SyncState>>, tauri::AppHandle)>,
    Json(req): Json<HelloRequest>,
) -> (StatusCode, Json<HelloResponse>) {
    let now = Instant::now();
    let rx: oneshot::Receiver<HelloResponse>;
    let request_id: String;

    // 阶段 1：校验连接码，创建待确认请求（持锁）
    {
        let mut s = state.lock().await;

        // 检查锁定
        if let Some(locked_until) = s.locked_until {
            if now < locked_until {
                return (
                    StatusCode::TOO_MANY_REQUESTS,
                    Json(HelloResponse {
                        status: "locked".into(),
                        session_id: None,
                        peer: None,
                    }),
                );
            }
            s.locked_until = None;
            s.failed_attempts = 0;
        }

        // 检查服务运行状态
        if !s.running || s.code.is_empty() {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(HelloResponse {
                    status: "service_stopped".into(),
                    session_id: None,
                    peer: None,
                }),
            );
        }

        // 检查连接码过期
        if let Some(expires) = s.code_expires {
            if now > expires {
                s.code = generate_code();
                s.code_expires = Some(now + CODE_TTL);
                return (
                    StatusCode::GONE,
                    Json(HelloResponse {
                        status: "code_expired".into(),
                        session_id: None,
                        peer: None,
                    }),
                );
            }
        }

        // 校验连接码
        if req.code != s.code {
            s.failed_attempts += 1;
            if s.failed_attempts >= MAX_FAILED_ATTEMPTS {
                s.locked_until = Some(now + LOCKOUT_DURATION);
            }
            return (
                StatusCode::UNAUTHORIZED,
                Json(HelloResponse {
                    status: "invalid_code".into(),
                    session_id: None,
                    peer: None,
                }),
            );
        }

        // 创建待确认连接
        let (tx, rx_inner) = oneshot::channel::<HelloResponse>();
        request_id = Uuid::new_v4().to_string();
        let requester = PeerInfo {
            device_id: req.device_id.clone(),
            nickname: req.nickname.clone(),
        };

        s.pending.insert(
            request_id.clone(),
            PendingConnection {
                requester,
                tx,
                request_id: request_id.clone(),
                created_at: now,
            },
        );

        rx = rx_inner;
    } // 锁释放

    // 阶段 2：通知前端有新的连接请求
    let _ = app.emit(
        "sync:incoming_request",
        serde_json::json!({
            "requestId": request_id,
            "deviceId": req.device_id,
            "nickname": req.nickname,
        }),
    );

    // 阶段 3：等待用户确认（带超时）
    match tokio::time::timeout(CONFIRM_TIMEOUT, rx).await {
        Ok(Ok(resp)) => {
            let status = match resp.status.as_str() {
                "accepted" => StatusCode::OK,
                "rejected" => StatusCode::FORBIDDEN,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            (status, Json(resp))
        }
        Ok(Err(_)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(HelloResponse {
                status: "error".into(),
                session_id: None,
                peer: None,
            }),
        ),
        Err(_) => {
            // 超时，清理待确认记录
            let mut s = state.lock().await;
            s.pending.remove(&request_id);
            (
                StatusCode::REQUEST_TIMEOUT,
                Json(HelloResponse {
                    status: "timeout".into(),
                    session_id: None,
                    peer: None,
                }),
            )
        }
    }
}

// ── 工具函数 ────────────────────────────────────────────────────

/// 生成 6 位随机数字连接码
fn generate_code() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    format!("{:06}", rng.gen_range(100000..=999999))
}

/// 获取本机局域网 IP 地址列表
fn get_local_ips() -> Vec<String> {
    let mut ips = Vec::new();
    // UDP socket 技巧：通过 "连接" 一个外部地址来确定主网卡 IP
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("10.255.255.0:1").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                let ip = addr.ip().to_string();
                if !ips.contains(&ip) {
                    ips.push(ip);
                }
            }
        }
    }
    if ips.is_empty() {
        ips.push("127.0.0.1".to_string());
    }
    ips
}

/// 在 preferred 端口附近查找可用端口
fn find_available_port(preferred: u16) -> Option<u16> {
    for port in preferred..=preferred.saturating_add(100) {
        if std::net::TcpListener::bind(("0.0.0.0", port)).is_ok() {
            return Some(port);
        }
    }
    None
}
