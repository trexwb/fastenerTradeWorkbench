use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tokio::io::AsyncBufReadExt;

const DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_TOKEN_FILENAME: &str = "deepseek_token";
const DEFAULT_MODEL: &str = "deepseek-v4-flash";
const ALLOWED_MODELS: [&str; 2] = ["deepseek-v4-flash", "deepseek-v4-pro"];
const MAX_MESSAGES: usize = 20;
const MAX_MESSAGE_BYTES: usize = 30_000;
const MAX_TOKENS: u32 = 4096;
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
    ALLOWED_MODELS.iter().any(|m| *m == model)
}

#[derive(Debug, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

fn valid_messages(messages: &[ChatMessage]) -> bool {
    if messages.is_empty() || messages.len() > MAX_MESSAGES {
        return false;
    }
    messages.iter().all(|m| {
        matches!(m.role.as_str(), "system" | "user" | "assistant")
            && m.content.len() <= MAX_MESSAGE_BYTES
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
    fs::write(token_path(&app)?, token).map_err(|e| format!("写入 Token 文件失败: {e}"))
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

#[tauri::command]
fn ai_deepseek_model_default() -> String {
    DEFAULT_MODEL.to_string()
}

#[tauri::command]
fn ai_runtime_kind() -> &'static str {
    "tauri"
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
}

#[derive(Debug, Deserialize)]
struct UpstreamChoiceDelta {
    content: Option<String>,
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
) -> Result<String, String> {
    let token = {
        let p = token_path(&app)?;
        if !p.exists() {
            return Err("未设置 DeepSeek Token，请先在 AI 设置中填写".into());
        }
        let t = fs::read_to_string(&p).map_err(|e| format!("读取 Token 失败: {e}"))?;
        let t = t.trim().to_string();
        if t.is_empty() {
            return Err("未设置 DeepSeek Token，请先在 AI 设置中填写".into());
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
    };
    let payload =
        serde_json::to_vec(&body).map_err(|e| format!("序列化请求失败: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))?;

    let req = client
        .post(DEEPSEEK_BASE_URL)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", if stream { "text/event-stream" } else { "application/json" })
        .body(payload);

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
        let content = parsed
            .choices
            .and_then(|cs| cs.into_iter().next())
            .and_then(|c| c.delta)
            .and_then(|d| d.content);
        if let Some(text) = content {
            if !text.is_empty() {
                collected.push_str(&text);
                let _ = window.emit(&evt_name, serde_json::json!({ "text": &text }));
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ai_runtime_kind,
            ai_deepseek_token_write,
            ai_deepseek_token_has,
            ai_deepseek_model_default,
            ai_deepseek_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FastenerTradeWorkbench tauri application");
}
