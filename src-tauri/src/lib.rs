use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::io::AsyncBufReadExt;

const DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_TOKEN_FILENAME: &str = "deepseek_token";
const DEFAULT_MODEL: &str = "deepseek-v4-flash";
const MAX_MESSAGES: usize = 20;
const MAX_MESSAGE_BYTES: usize = 30_000;
const MAX_TOOL_MESSAGE_BYTES: usize = 200_000; // tool 消息（查询结果 JSON）上限
const MAX_TOKENS: u32 = 4096;
const MAX_DATA_BYTES: usize = 128 * 1024 * 1024; // 主数据文件大小上限 128MB
const REQUEST_TIMEOUT_SECS: u64 = 180;
const RESPONSE_BODY_CAP: usize = 2_000_000; // 2MB

fn data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))
}

fn token_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_root(app)?.join(DEEPSEEK_TOKEN_FILENAME))
}

fn valid_model(model: &str) -> bool {
    // 多模型接入：允许任意 OpenAI 兼容模型名（仅限制非空与长度）
    !model.trim().is_empty() && model.len() <= 100
}

/// 判断是否为本地端点（Ollama 等，免 API_KEY）
fn is_local_endpoint(base_url: &str) -> bool {
    let b = base_url.trim().to_lowercase();
    b.starts_with("http://127.0.0.1") || b.starts_with("http://localhost")
        || b.starts_with("https://127.0.0.1") || b.starts_with("https://localhost")
}

#[derive(Debug, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
    /// assistant 工具调用消息（OpenAI 协议：tool 消息必须紧跟带 tool_calls 的 assistant）
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<serde_json::Value>,
    /// tool 角色消息的关联 ID（须与 assistant.tool_calls[].id 精确匹配）
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

fn valid_messages(messages: &[ChatMessage]) -> bool {
    if messages.is_empty() || messages.len() > MAX_MESSAGES {
        return false;
    }
    messages.iter().all(|m| {
        let role_ok = matches!(m.role.as_str(), "system" | "user" | "assistant" | "tool");
        // tool 消息承载查询结果 JSON，上限放宽到 200KB；其余角色维持 30KB
        let limit = if m.role == "tool" { MAX_TOOL_MESSAGE_BYTES } else { MAX_MESSAGE_BYTES };
        role_ok && m.content.len() <= limit
    })
}

#[tauri::command]
fn ai_deepseek_token_write(app: tauri::AppHandle, token: String) -> Result<(), String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        // 空串视为删除
        let p = token_path(&app)?;
        if p.exists() {
            fs::remove_file(&p).map_err(|e| format!("删除 Token 文件失败: {e}"))?;
        }
        return Ok(());
    }
    if token.len() > 4000 {
        return Err("Token 过长，无法保存".into());
    }
    let root = data_root(&app)?;
    fs::create_dir_all(&root).map_err(|e| format!("创建应用数据目录失败: {e}"))?;
    let p = token_path(&app)?;
    let tmp = p.with_extension("tmp");
    fs::write(&tmp, &token).map_err(|e| format!("写入 Token 文件失败: {e}"))?;
    // Unix 下将 Token 文件权限收紧为仅属主可读写
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, PermissionsExt::from_mode(0o600))
            .map_err(|e| format!("设置 Token 文件权限失败: {e}"))?;
    }
    fs::rename(&tmp, &p).map_err(|e| format!("替换 Token 文件失败: {e}"))
}

#[tauri::command]
fn ai_deepseek_token_has(app: tauri::AppHandle) -> Result<bool, String> {
    let p = token_path(&app)?;
    if !p.exists() {
        return Ok(false);
    }
    let tok = fs::read_to_string(&p).map_err(|e| format!("读取 Token 文件失败: {e}"))?;
    Ok(!tok.trim().is_empty())
}

/// 读取已保存的 Token 明文（供 AI 设置弹窗编辑态回显；非编辑状态不展示）。
#[tauri::command]
fn ai_deepseek_token_get(app: tauri::AppHandle) -> Result<String, String> {
    let p = token_path(&app)?;
    if !p.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&p).map_err(|e| format!("读取 Token 文件失败: {e}"))
}

/// 用系统默认浏览器打开外部链接（http/https）。
/// Tauri WebView 默认不处理 target="_blank" 外链导航，前端检测到
/// Tauri 运行时改为 invoke 本命令；浏览器版保持原生 target="_blank"。
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("仅允许打开 http/https 链接".into());
    }
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("打开外部链接失败: {e}"))
}

/// 返回应用数据目录（IndexedDB 之外的 Token 等文件也存于此）。
/// 供前端数据管理页展示「数据所在目录」。
#[tauri::command]
fn data_dir_get(app: tauri::AppHandle) -> Result<String, String> {
    data_root(&app).map(|p| p.to_string_lossy().into_owned())
}

const DATA_FILENAME: &str = "data.json";

/// 读取应用数据目录中的主数据文件（JSON 字符串）。
/// 文件不存在返回 Ok(None)。macOS WKWebView 的 tauri:// 协议下 IndexedDB
/// 可能挂起（open 无回调），因此桌面版主存储改用本机文件。
#[tauri::command]
fn data_file_load(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let p = data_root(&app)?.join(DATA_FILENAME);
    if !p.exists() {
        return Ok(None);
    }
    let raw = fs::read(&p).map_err(|e| format!("读取数据文件失败: {e}"))?;
    if raw.is_empty() {
        return Ok(None);
    }
    // 严格 UTF-8 校验：文件损坏时返回错误而非静默替换字符
    String::from_utf8(raw)
        .map(Some)
        .map_err(|e| format!("数据文件不是有效 UTF-8（可能已损坏）: {e}"))
}

/// 将主数据 JSON 写入应用数据目录（原子写入：临时文件 + rename，避免写一半损坏）。
#[tauri::command]
fn data_file_save(app: tauri::AppHandle, content: String) -> Result<(), String> {
    if content.len() > MAX_DATA_BYTES {
        return Err(format!("数据过大（{} 字节，上限 {}），拒绝写入", content.len(), MAX_DATA_BYTES));
    }
    let root = data_root(&app)?;
    fs::create_dir_all(&root).map_err(|e| format!("创建应用数据目录失败: {e}"))?;
    let p = root.join(DATA_FILENAME);
    let tmp = p.with_extension("tmp");
    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("写入数据文件失败: {e}"))?;
    fs::rename(&tmp, &p).map_err(|e| format!("替换数据文件失败: {e}"))
}

#[derive(Debug, Serialize)]
struct UpstreamBody<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
struct UpstreamFunctionDelta {
    name: Option<String>,
    arguments: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct UpstreamToolCallDelta {
    index: Option<usize>,
    id: Option<String>,
    function: Option<UpstreamFunctionDelta>,
}

#[derive(Debug, Deserialize)]
struct UpstreamChoiceDelta {
    content: Option<String>,
    tool_calls: Option<Vec<UpstreamToolCallDelta>>,
}

#[derive(Debug, Deserialize)]
struct UpstreamChoice {
    delta: Option<UpstreamChoiceDelta>,
}

#[derive(Debug, Deserialize)]
struct UpstreamChunk {
    choices: Option<Vec<UpstreamChoice>>,
}

/// DeepSeek chat completions：非流式直接返回 JSON 字符串；流式按行 emit 文本块（前端拼接为完整回复）。
#[tauri::command]
async fn ai_deepseek_chat(
    app: tauri::AppHandle,
    window: tauri::Window,
    messages: Vec<ChatMessage>,
    model: Option<String>,
    stream: Option<bool>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    stream_event: Option<String>,
    tools: Option<serde_json::Value>,
    base_url: Option<String>,
) -> Result<String, String> {
    // 本地端点（Ollama 等）免 Token；其余端点从 Token 文件读取
    let local_base = base_url
        .as_ref()
        .map(|b| is_local_endpoint(b))
        .unwrap_or(false);
    let token = if local_base {
        String::new()
    } else {
        let p = token_path(&app)?;
        if !p.exists() {
            return Err("未设置 API_KEY，请先在 AI 设置中填写".into());
        }
        let t = fs::read_to_string(&p).map_err(|e| format!("读取 Token 失败: {e}"))?;
        let t = t.trim().to_string();
        if t.is_empty() {
            return Err("未设置 API_KEY，请先在 AI 设置中填写".into());
        }
        t
    };

    if !valid_messages(&messages) {
        return Err("请求消息格式不符合限制".into());
    }
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
    if !valid_model(&model) {
        return Err(format!("不支持的模型: {model}"));
    }
    let stream = stream.unwrap_or(true);
    let max_tokens = match max_tokens {
        Some(v) => v.clamp(1, MAX_TOKENS),
        None => 1200,
    };
    let temperature = temperature.map(|v| v.clamp(0.0, 1.0));

    let body = UpstreamBody {
        model: &model,
        messages: &messages,
        stream,
        temperature,
        max_tokens: Some(max_tokens),
        tools,
    };
    let payload =
        serde_json::to_vec(&body).map_err(|e| format!("序列化请求失败: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))?;

    // 多模型接入：优先使用前端传入的 Base URL（OpenAI 兼容端点，如 Ollama http://127.0.0.1:11434/v1）
    let req_url = match base_url {
        Some(b) if !b.trim().is_empty() => {
            let b = b.trim().trim_end_matches('/').to_string();
            if b.ends_with("/chat/completions") { b } else { format!("{b}/chat/completions") }
        }
        _ => DEEPSEEK_BASE_URL.to_string(),
    };

    let mut req = client
        .post(req_url)
        .header("Content-Type", "application/json")
        .header("Accept", if stream { "text/event-stream" } else { "application/json" });
    // 本地端点免 Token；其余端点带 Authorization
    if !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    let req = req.body(payload);

    let resp = req
        .send()
        .await
        .map_err(|e| format!("无法连接 DeepSeek 服务: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let code = status.as_u16();
        let raw = resp.bytes().await.unwrap_or_default();
        let text = String::from_utf8_lossy(&raw).into_owned();
        let snippet: String = text.chars().take(500).collect();
        return Err(format!(
            "DeepSeek 返回错误 (HTTP {code})：{}",
            if snippet.is_empty() { "无返回内容".into() } else { snippet }
        ));
    }

    if !stream {
        let raw = resp
            .bytes()
            .await
            .map_err(|e| format!("读取响应失败: {e}"))?;
        if raw.len() > RESPONSE_BODY_CAP {
            return Err("响应体过大".into());
        }
        let text = String::from_utf8_lossy(&raw).into_owned();
        // 非流式把 assistant 内容抽出返回：解析 JSON → 取 choices[0].message.content，失败则回退原始字符串
        let assistant_text: String = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("choices")?
                    .as_array()?
                    .first()?
                    .get("message")?
                    .get("content")?
                    .as_str()
                    .map(|s| s.to_string())
            })
            .unwrap_or(text);
        return Ok(assistant_text);
    }

    // 流式：按 SSE 行解析，逐块向前端 emit
    let evt_name = stream_event.unwrap_or_else(|| "ai:deepseek:chunk".into());
    let mut collected = String::new();

    let byte_stream = resp.bytes_stream();
    let reader = tokio_util::io::StreamReader::new(
        byte_stream.map(|r| r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))),
    );
    let mut lines = tokio::io::BufReader::new(reader).lines();

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("读取流式响应失败: {e}"))?
    {
        if !line.starts_with("data:") {
            continue;
        }
        let raw = line["data:".len()..].trim();
        if raw.is_empty() || raw == "[DONE]" {
            continue;
        }
        let parsed: UpstreamChunk = match serde_json::from_str(raw) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(delta) = parsed
            .choices
            .and_then(|cs| cs.into_iter().next())
            .and_then(|c| c.delta)
        {
            if let Some(text) = delta.content {
                if !text.is_empty() {
                    collected.push_str(&text);
                    let _ = window.emit(&evt_name, serde_json::json!({ "text": &text }));
                }
            }
            if let Some(tcs) = delta.tool_calls {
                if !tcs.is_empty() {
                    let _ = window.emit(
                        &evt_name,
                        serde_json::json!({ "text": "", "toolCalls": tcs }),
                    );
                }
            }
        }
    }

    // 流式结束再返回最终完整字符串，方便前端兜底处理
    // （emit 已经把增量发给前端了）
    Ok(collected)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            data_dir_get,
            data_file_load,
            data_file_save,
            ai_deepseek_token_write,
            ai_deepseek_token_has,
            ai_deepseek_token_get,
            ai_deepseek_chat,
            open_external,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FastenerTradeWorkbench tauri application");
}
