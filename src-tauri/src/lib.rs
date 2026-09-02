use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::io::AsyncBufReadExt;

const DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com/v1/chat/completions";
const DEFAULT_MODEL: &str = "deepseek-v4-flash";
// P2/O4 修复：评估上限 20→40，保证多轮工具调用时上下文窗口足够（每条消息含 role/content/工具结果）
const MAX_MESSAGES: usize = 40;
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

/// 知识库缓存根目录：{app_data_dir}/kb_cache。
/// 临时安全范围书签（macOS）只要回调一返回就会被系统收回，
/// 导致后续 kb_read_b64 拿到半截字节→pdf 解析 chars===0。
/// 修复：在 pick_folder 回调权限有效时把命中文件复制到缓存，
/// 后续解析全走缓存路径，不再依赖原目录的临时授权。
fn kb_cache_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let p = data_root(app)?.join("kb_cache");
    fs::create_dir_all(&p).map_err(|e| format!("创建知识库缓存目录失败: {e}"))?;
    Ok(p)
}

/// 生成不重复的 cache_id：时间戳毫秒 + 进程号 + 小随机尾，
/// 不引入 uuid/rand 依赖。
fn gen_cache_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let pid = std::process::id();
    // 伪随机：用 ms 的低 16 位做尾，避免 1ms 内并发（用户不会连续选这么快）
    let tail = (ms & 0xFFFF) as u32;
    format!("kb-{ms:x}-{pid:x}-{tail:x}")
}

/// 把 files[i] 按 rel 路径复制到 cache_root/<cache_id>/<rel>，
/// 返回「(entries_with_cached_paths, 复制成功数, 复制失败数, 缓存绝对根路径)」。
/// 只复制 size ≤ KB_CACHE_MAX_FILE_BYTES 的文件（与前端 MAX_PDF_BYTES 对齐），
/// 其余保留原路径（后续 parseFile 会报"超过 20MB"给用户看）。
const KB_CACHE_MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;

fn copy_files_to_cache(
    app: &tauri::AppHandle,
    cache_id: &str,
    files: &mut Vec<KbFileEntry>,
) -> Result<(usize, usize, PathBuf, u64), String> {
    let root = kb_cache_root(app)?.join(cache_id);
    fs::create_dir_all(&root).map_err(|e| format!("创建缓存子目录失败: {e}"))?;
    let mut copied = 0usize;
    let mut failed = 0usize;
    let mut total_bytes: u64 = 0;
    for f in files.iter_mut() {
        // 超上限保留原路径（让 parseFile 报超限给用户）
        if f.size > KB_CACHE_MAX_FILE_BYTES {
            continue;
        }
        // 0 字节也复制（保留清单）
        let src = std::path::PathBuf::from(&f.path);
        let dst = if f.rel.is_empty() {
            root.join(f.name.clone())
        } else {
            // 兼容 Windows/Unix 分隔符：统一用 Path components 构造子目录
            let rel_path = std::path::PathBuf::from(&f.rel);
            if let Some(parent) = rel_path.parent() {
                let sub = root.join(parent);
                if let Err(e) = fs::create_dir_all(&sub) {
                    failed += 1;
                    // 保留原路径，不抛整体
                    eprintln!("[kb_cache] mkdir {sub:?} 失败: {e}");
                    continue;
                }
            }
            root.join(rel_path)
        };
        match fs::copy(&src, &dst) {
            Ok(bytes_written) => {
                match path_to_roundtrip_str(&dst) {
                    Ok(s) => {
                        f.path = s;
                        total_bytes = total_bytes.saturating_add(bytes_written);
                        copied += 1;
                    }
                    Err(()) => {
                        // 缓存路径 round-trip 失败（极端场景）：回退原路径
                        let _ = fs::remove_file(&dst);
                        failed += 1;
                    }
                }
            }
            Err(e) => {
                failed += 1;
                eprintln!("[kb_cache] 复制 {} → {:?} 失败: {e}", f.name, dst);
            }
        }
    }
    Ok((copied, failed, root, total_bytes))
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

/// 上游端点协议白名单：https 任意放行；http 仅允许本地回环（Ollama 类），
/// 禁止向内网/明文 http 端点携带 API Key 外发（有限 SSRF / Key 泄露面收敛）
fn valid_upstream_base_url(base_url: &str) -> bool {
    let b = base_url.trim().to_lowercase();
    if b.starts_with("https://") {
        return true;
    }
    is_local_endpoint(base_url)
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

/// 用系统默认浏览器打开外部链接（http/https）。
/// Tauri WebView 默认不处理 target="_blank" 外链导航，前端检测到
/// Tauri 运行时改为 invoke 本命令；浏览器版保持原生 target="_blank"。
#[tauri::command]
async fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("仅允许打开 http/https 链接".into());
    }
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("打开外部链接失败: {e}"))
}

/* =========================================================
   知识库（RAG）桌面适配：目录选择 / 扫描 / 读取 / 索引存储
   WKWebView 不支持 File System Access API（showDirectoryPicker），
   桌面版改走 Tauri 原生对话框 + 受限文件读取命令。
   ========================================================= */

static CACHE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
const KB_ALLOWED_EXT: [&str; 6] = [".md", ".txt", ".markdown", ".log", ".pdf", ".docx"];
const KB_MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
/// 2026-08-29 修复「西游记」等多层子目录知识库漏扫：
/// 原深度 3 在「<用户下载>/紧固件贸易/西游记/正文/卷一/章节001.md」这类场景
/// 从绑定的目录（西游记）算起，正文/卷一/章节 共 3 层刚好 OK；但用户有时会
/// 再套一层「合集/出版社/分卷/卷一/…」→ 4~5 层时旧值整棵子树全丢。
/// 放宽到 5 层（与前端 MAX_RECURSE_DEPTH 同步），数量上限 KB_MAX_FILES=500 仍有保护。
const KB_MAX_RECURSE_DEPTH: usize = 5;
const KB_MAX_FILES: usize = 500;

#[derive(serde::Serialize)]
struct KbFileEntry {
    name: String,
    rel: String,
    path: String,
    size: u64,
}

fn kb_is_allowed(name: &str) -> bool {
    let lower = name.to_lowercase();
    KB_ALLOWED_EXT.iter().any(|e| lower.ends_with(e))
}

/// 递归扫描目录（只读）：白名单扩展名 + 深度/数量/单文件大小上限。
/// 根目录入口由调用方保证「此时权限有效」（macOS Tauri 2 NSOpenPanel 仅在对话框回调
/// 上下文中授予权限；跨两条命令调用 read_dir 会 PermissionDenied）。
fn kb_walk(path: &std::path::Path, prefix: &str, depth: usize, out: &mut Vec<KbFileEntry>, skip: &mut KbSkipStats) {
    if depth > KB_MAX_RECURSE_DEPTH || out.len() >= KB_MAX_FILES { return; }
    let rd = match std::fs::read_dir(path) { Ok(r) => r, Err(e) => {
        // 2026-08-29：这里只在「子目录」级发生权限异常时静默跳过，但对典型
        // Windows 错误（路径过长 / 拒绝访问 / 非法编码）做统计，供上层诊断输出。
        #[cfg(windows)]
        {
            if let Some(code) = e.raw_os_error() {
                // ERROR_FILENAME_EXCED_RANGE=206 / ERROR_BUFFER_OVERFLOW=111 → 路径过长
                if code == 206 || code == 111 { skip.path_too_long += 1; }
                // ERROR_ACCESS_DENIED=5 / ERROR_SHARING_VIOLATION=32
                else if code == 5 || code == 32 { skip.access_denied += 1; }
            }
        }
        let _ = e;
        return;
    }};
    let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for ent in entries {
        if out.len() >= KB_MAX_FILES { return; }
        let fname = ent.file_name().to_string_lossy().to_string();
        // Windows WTF-16 孤立代理对等：文件名本身含 U+FFFD 替换 → 跳过并计数
        if fname.contains('\u{FFFD}') { skip.encoding += 1; continue; }
        if fname.starts_with('.') { skip.hidden += 1; continue; }
        let p = ent.path();
        if p.is_dir() {
            skip.dirs += 1;
            kb_walk(&p, &format!("{prefix}{fname}/"), depth + 1, out, skip);
        } else if kb_is_allowed(&fname) {
            // 2026-08-29：size==0 的白名单文件不再被直接丢弃。保留到清单 → 前端
            // parseFile 返回 chars=0，状态行显示「N 个文件 · 0 个分块」，files 计数
            // = 真实文件数，便于定位「读得到文件但内容为空」vs「根本没扫到文件」。
            let size = ent.metadata().map(|m| m.len()).unwrap_or(0);
            if size > KB_MAX_FILE_BYTES { skip.too_large += 1; continue; }
            let path_str = match path_to_roundtrip_str(&p) {
                Ok(s) => s,
                Err(()) => { skip.encoding += 1; continue; }
            };
            out.push(KbFileEntry {
                name: fname.clone(),
                rel: format!("{prefix}{fname}"),
                path: path_str,
                size,
            });
        } else {
            skip.unsupported += 1;
        }
    }
}

/// 弹出系统目录选择对话框（知识库绑定），返回所选目录路径（取消返回 None）
/// 采用官方 async 模式：非阻塞回调 + async channel 回传。
/// 不要改回 blocking_pick_folder：它是 block_on 包装，在 async 命令（tokio 线程）里
/// 调用会导致对话框弹出后事件循环死锁（系统卡死、无法选择目录）——已实测。
#[tauri::command]
async fn kb_pick_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<String>>(16);
    app.dialog()
        .file()
        .pick_folder(move |folder| {
            let payload = folder.and_then(|f| f.into_path().ok()).and_then(|p| path_to_roundtrip_str(&p).ok());
            tauri::async_runtime::spawn(async move {
                let _ = tx.send(payload).await;
            });
        });
    Ok(rx.recv().await.unwrap_or(None))
}

/// 弹出系统「批量选择文件」对话框（macOS 上文件级授权比目录递归简单可靠），
/// 返回所选文件路径数组（取消返回空数组）。必须是 async 命令（blocking 在主线程死锁）。
#[tauri::command]
async fn kb_pick_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, mut rx) = tauri::async_runtime::channel::<Vec<String>>(16);
    app.dialog()
        .file()
        .pick_files(move |list| {
            let paths: Vec<String> = list
                .map(|l| {
                    l.into_iter()
                        .filter_map(|f| f.into_path().ok())
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect()
                })
                .unwrap_or_default();
            tauri::async_runtime::spawn(async move {
                let _ = tx.send(paths).await;
            });
        });
    Ok(rx.recv().await.unwrap_or_default())
}

/// 扫描已绑定目录，返回知识库文件清单（含诊断统计）。
/// 2026-08-29：根目录 read_dir 失败不再静默吞，明确告诉前端是「不存在」、
///「macOS 权限过期」还是「Windows 路径过长/无权限」。
#[tauri::command]
async fn kb_scan_dir(path: String) -> Result<KbScanResult, String> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_dir() {
        return Err(format!("目录不存在：{path}"));
    }
    let rd = match std::fs::read_dir(&p) {
        Ok(rd) => rd,
        Err(e) => {
            let kind = e.kind();
            let hint: Option<String> = match kind {
                std::io::ErrorKind::PermissionDenied => Some("（macOS 目录访问权限已过期，典型：选择目录后隔一段时间/重启 App 导致 NSOpenPanel 临时授权失效。请点击「选择目录并索引」重新选一次该目录进行授权）".to_string()),
                std::io::ErrorKind::NotFound => Some("（目录可能已被移动或重命名）".to_string()),
                #[cfg(windows)]
                _ => {
                    if let Some(code) = e.raw_os_error() {
                        if code == 206 || code == 111 {
                            Some("（Windows 路径过长：ERROR_FILENAME_EXCED_RANGE。当前应用已通过嵌入应用程序兼容清单（build.rs）声明 longPathAware=true；若仍报此错，请确认运行系统为 Windows 10 1607+，或将知识库目录移动到更短的上层路径后重试）".to_string())
                        } else if code == 5 || code == 32 {
                            Some("（Windows 无权限：ERROR_ACCESS_DENIED / ERROR_SHARING_VIOLATION。请关闭其他程序对该目录/文件的独占占用，或以有权限的用户重新运行应用）".to_string())
                        } else { None }
                    } else { None }
                }
                #[cfg(not(windows))]
                _ => None,
            };
            let hint_str = hint.as_deref().unwrap_or("");
            return Err(format!("无法读取目录内容：{e}{hint_str}；raw={kind:?}; path={path}"));
        }
    };
    let mut out = Vec::new();
    let mut skip = KbSkipStats::default();
    collect_root_entries(rd, &mut out, &mut skip);
    let seen = out.len() + skip.unsupported + skip.too_large + skip.hidden + skip.encoding + skip.path_too_long + skip.access_denied;
    // 2026-08-29：打包后「重新索引」探针 —— 在把 out Vec 移入返回值之前先跑探针，
    // 防 E0382 borrow of moved value。
    let probe = probe_read_files(&out);
    Ok(KbScanResult {
        files: out,
        seen,
        skipped_unsupported: skip.unsupported,
        skipped_too_large: skip.too_large,
        skipped_hidden: skip.hidden,
        dirs_scanned: skip.dirs,
        skipped_encoding: skip.encoding,
        skipped_path_too_long: skip.path_too_long,
        skipped_access_denied: skip.access_denied,
        probe_read_bytes_ok: probe,
    })
}

/// 从根目录 ReadDir 开始收集，复用 kb_walk 的递归实现（保持深度/大小/数量策略一致）。
fn collect_root_entries(
    rd: std::fs::ReadDir,
    out: &mut Vec<KbFileEntry>,
    skip: &mut KbSkipStats,
) {
    let entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
    // 提取这些 entries 所属的根目录 —— 用第一个 entry.path().parent() 即可；
    // 若 entries 为空则没有工作要做。
    let parent = entries
        .first()
        .and_then(|e| e.path().parent().map(|p| p.to_path_buf()));
    if let Some(root) = parent {
        drop(entries);
        kb_walk(&root, "", 0, out, skip);
    }
}

#[derive(serde::Serialize, Default)]
struct KbSkipStats {
    unsupported: usize,
    too_large: usize,
    hidden: usize,
    dirs: usize,
    /// Windows WTF-16 文件名含孤立代理对（或 macOS/Linux 非法 UTF-8 字节序列）时
    /// PathBuf::to_string_lossy() 会把无法 round-trip 的字符替换成 U+FFFD。
    /// 后续 kb_read_text/kb_read_b64 用该字符串再 PathBuf::from 会找不到原文件 →
    /// 直接在扫描阶段将这些条目记入 skipped_encoding，前端在诊断里明确告诉用户
    /// 「N 个文件路径含非法 Unicode 字符，请重命名文件后重试」。
    encoding: usize,
    /// 仅 Windows：ERROR_FILENAME_EXCED_RANGE (206) / ERROR_BUFFER_OVERFLOW (111)
    /// 等路径长度相关错误；在 longPathAware=true 之外，作为失败计数用于提示。
    path_too_long: usize,
    /// 仅 Windows：ERROR_ACCESS_DENIED (5) 子目录或文件无权限（全局只读/加密）
    access_denied: usize,
}

/// 把 PathBuf 序列化成字符串给前端。若包含无法可逆转换的字符（Windows 孤立代理、
/// Unix 非法 UTF-8 字节），to_string_lossy 会出现 U+FFFD → 返回 Err(()) 让调用方
/// 计入 skip.encoding（而不是把坏字符串入清单导致后续 read 失败报奇怪的错）。
fn path_to_roundtrip_str(p: &std::path::Path) -> Result<String, ()> {
    let s = p.to_string_lossy().into_owned();
    if s.contains('\u{FFFD}') {
        return Err(());
    }
    Ok(s)
}

#[derive(serde::Serialize)]
struct KbPickAndScanResult {
    path: String,
    dir_name: String,
    files: Vec<KbFileEntry>,
    seen: usize,
    skipped_unsupported: usize,
    skipped_too_large: usize,
    skipped_hidden: usize,
    dirs_scanned: usize,
    skipped_encoding: usize,
    skipped_path_too_long: usize,
    skipped_access_denied: usize,
    /// 2026-08-29 macOS Tauri 2 打包后「临时安全范围书签过期」的最后一道防御：
    /// pick_folder 回调**内部**返回时，权限仍 100% 有效（这是 macOS 安全范围书签的
    /// 保证：只要回调帧还没弹出堆栈就能访问）。所以在回调里**立刻同步**额外再读一遍
    /// 根目录 `read_dir().next().transpose()` + 每个文件的 `File::open()`
    /// 读 1 字节，确保：
    ///   ① 预扫描清单 files[i].path 不是「列得出来但读不到」的假列表；
    ///   ② 前端选择目录后，用户看到的「3 个 PDF」我们都能实际读到字节 → parseFile
    ///      阶段不会逐个 PermissionDenied throw → 不会出现「0 文件 0 分块 0B」。
    /// 实际能读多少字节就存多少（与 files.len 对齐为 usize）。若此探针 0 成功 →
    /// 前端直接显示红提示「本目录临时授权异常，请重试」。
    probe_read_bytes_ok: usize,
    /// 2026-08-29 macOS sandbox 终极防线：在 pick 回调（权限有效）里把所有命中的
    /// PDF/DOCX/MD 等**整份字节复制到 app_data_dir/kb_cache/<cache_id>/<rel>**，
    /// 后续 parseFile 全部用缓存副本路径，再也不依赖「临时安全范围书签」。
    cache_id: Option<String>,
    cache_root: Option<String>,
    cached_files: usize,
    cache_copy_failed: usize,
    /// 缓存复制完成后，在回调内再用 probe_read_files() 逐文件跑 1 字节探针于
    /// 新缓存路径，校验「副本确实存在且可独立被读取」（完全不依赖原目录权限）。
    /// 若此探针 === cached_files 则表示缓存链路 100% 健康。
    probe_on_cache_ok: usize,
    /// 成功复制到缓存的字节总量（前端展示给用户做审计："已缓存 24.3 MB / 4 文件"）。
    cache_total_bytes: u64,
}

#[derive(serde::Serialize)]
struct KbScanResult {
    files: Vec<KbFileEntry>,
    seen: usize,
    skipped_unsupported: usize,
    skipped_too_large: usize,
    skipped_hidden: usize,
    dirs_scanned: usize,
    skipped_encoding: usize,
    skipped_path_too_long: usize,
    skipped_access_denied: usize,
    probe_read_bytes_ok: usize,
}

/// 同步探针：验证 pick_folder 回调权限上下文里，列出的每个文件是否能真正读字节。
/// 返回「成功读到至少 1 字节的文件数量」。只在权限有效期内调用才有意义。
fn probe_read_files(files: &[KbFileEntry]) -> usize {
    if files.is_empty() { return 0; }
    let mut ok = 0usize;
    for f in files {
        let p = std::path::PathBuf::from(&f.path);
        // 探针只需要读 1 个字节，避免大文件开销；PDF/docx 也能通过第一字节验证权限。
        match std::fs::File::open(&p) {
            Ok(mut fd) => {
                use std::io::Read;
                let mut one = [0u8; 1];
                match fd.read(&mut one) {
                    Ok(n) if n > 0 => { ok += 1; }
                    Ok(_) => {
                        // 0 字节文件（我们 Rust 端也保留）：也算成功
                        if f.size == 0 { ok += 1; }
                    }
                    Err(_) => { /* 读失败：不计入 ok，后续 parseFile 也会失败，让前端诊断路径用 */ }
                }
            }
            Err(_) => { /* 无法 File::open → 不计入 ok */ }
        }
    }
    ok
}

/// 【macOS Tauri 2 权限终极修复】把「选目录 + 扫描 + 复制到 app 缓存」合并。
/// 根因：macOS sandbox 通过 NSOpenPanel 给 pick_folder 的目录权限只是
/// 「临时安全范围书签」，回调一返回即被系统回收；此前 probe 1-byte 虽然通过，
/// 但后续 parseFile 里独立命令 kb_read_b64 读整文件时会拿半截字节（header 命中
/// VNode cache，body 被权限挡住返回空）→ pdf 对象 numPages=0/文本全空 → 前端
/// 抛「未从文件中提取到文本」chars===0。
/// 修复：在 pick 回调（权限 100% 有效时）同步 fs::copy 把所有 ≤20MB 的命中
/// 文件复制到 {app_data_dir}/kb_cache/<cache_id>/<rel>，并把 files[i].path
/// 改写成缓存副本路径，后续 parseFile 读的全部是缓存，不再依赖原目录临时授权。
#[tauri::command]
async fn kb_pick_and_scan_dir(app: tauri::AppHandle) -> Result<Option<KbPickAndScanResult>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<KbPickAndScanResult>>(16);
    app.dialog().file().pick_folder(move |folder| {
        let result: Option<KbPickAndScanResult> = folder.and_then(|f| {
            let path_pb = f.into_path().ok()?;
            let dir_name = path_pb
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| path_pb.to_string_lossy().into_owned());
            let root_path_s = match path_to_roundtrip_str(&path_pb) {
                Ok(s) => s,
                Err(()) => { return None; }
            };
            // 在对话框回调上下文（权限有效）里立刻同步扫描
            let mut files = Vec::new();
            let mut skip = KbSkipStats::default();
            kb_walk(&path_pb, "", 0, &mut files, &mut skip);
            let seen = files.len() + skip.unsupported + skip.too_large + skip.hidden + skip.encoding + skip.path_too_long + skip.access_denied;
            // 【探针 1】原目录路径 1 字节探针（仍在权限帧内）
            let probe_original = probe_read_files(&files);
            // 【关键修复】在回调里立刻整文件复制到 kb_cache。失败的条目保留原路径，
            // 前端后续 parseFile 会从原路径读（对 Windows 不受限场景仍兼容）。
            let cache_id = gen_cache_id();
            let (copied, failed, cache_root_pb, total_bytes) = match copy_files_to_cache(&app, &cache_id, &mut files) {
                Ok(t) => t,
                Err(_e) => {
                    // 缓存目录创建失败：降级为继续使用原路径，
                    // 前端解析时若权限过期会报「请重新选择目录」，用户重选即可。
                    // 返回 cache_id=None 让前端跳过后续清理。
                    return Some(KbPickAndScanResult {
                        path: root_path_s,
                        dir_name,
                        files,
                        seen,
                        skipped_unsupported: skip.unsupported,
                        skipped_too_large: skip.too_large,
                        skipped_hidden: skip.hidden,
                        dirs_scanned: skip.dirs,
                        skipped_encoding: skip.encoding,
                        skipped_path_too_long: skip.path_too_long,
                        skipped_access_denied: skip.access_denied,
                        probe_read_bytes_ok: probe_original,
                        cache_id: None,
                        cache_root: None,
                        cached_files: 0,
                        cache_copy_failed: 0,
                        probe_on_cache_ok: 0,
                        cache_total_bytes: 0,
                    });
                }
            };
            let cache_root_s = path_to_roundtrip_str(&cache_root_pb).ok();
            // 【探针 2】缓存副本路径 1 字节探针（权限帧内保证已写入）
            let probe_on_cache = probe_read_files(&files);
            Some(KbPickAndScanResult {
                path: root_path_s,
                dir_name,
                files,
                seen,
                skipped_unsupported: skip.unsupported,
                skipped_too_large: skip.too_large,
                skipped_hidden: skip.hidden,
                dirs_scanned: skip.dirs,
                skipped_encoding: skip.encoding,
                skipped_path_too_long: skip.path_too_long,
                skipped_access_denied: skip.access_denied,
                probe_read_bytes_ok: probe_original,
                cache_id: Some(cache_id),
                cache_root: cache_root_s,
                cached_files: copied,
                cache_copy_failed: failed,
                probe_on_cache_ok: probe_on_cache,
                cache_total_bytes: total_bytes,
            })
        });
        tauri::async_runtime::spawn(async move {
            let _ = tx.send(result).await;
        });
    });
    Ok(rx.recv().await.unwrap_or(None))
}

/// 清理知识库缓存。
/// - Some(id) → 只删 {cache_root}/{id}
/// - None    → 删整个 kb_cache（解绑所有知识库时用）
#[tauri::command]
async fn kb_clear_cache(app: tauri::AppHandle, cache_id: Option<String>) -> Result<usize, String> {
    let root = kb_cache_root(&app)?;
    let target = match cache_id.as_deref() {
        Some(id) => {
            // 防御：拒绝空串 / 路径穿越（含 .. 或分隔符的 id 直接报错）
            if id.is_empty() || id.contains("..") || id.contains('/') || id.contains('\\') {
                return Err("非法 cache_id".into());
            }
            root.join(id)
        }
        None => root.clone(),
    };
    if !target.exists() { return Ok(0); }
    // 只统计删除的文件数（返回给前端做审计展示）
    let mut removed = 0usize;
    if target.is_dir() {
        if let Ok(rd) = fs::read_dir(&target) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    match fs::remove_dir_all(&p) { Ok(_)=>removed+=1, Err(_)=>{} }
                } else {
                    match fs::remove_file(&p) { Ok(_)=>removed+=1, Err(_)=>{} }
                }
            }
        }
        // 单 cache_id → 删掉目标子目录本身
        if cache_id.is_some() {
            match fs::remove_dir_all(&target) { Ok(_)=>removed+=1, Err(_)=>{} }
        }
    } else {
        match fs::remove_file(&target) { Ok(_)=>removed+=1, Err(_)=>{} }
    }
    // 如果 kb_cache 根目录空了 → 一并删掉
    if let Ok(rd) = fs::read_dir(&root) {
        if rd.count() == 0 {
            let _ = fs::remove_dir(&root);
        }
    }
    Ok(removed)
}

/// 读取文本文件（md/txt/markdown/log），UTF-8 lossy 容错，单文件上限 10MB
#[tauri::command]
async fn kb_read_text(path: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| format!("读取失败：{e}"))?;
    if meta.len() > 10 * 1024 * 1024 {
        return Err("文本文件超过 10MB，已跳过".into());
    }
    let raw = fs::read(&p).map_err(|e| format!("读取失败：{e}"))?;
    Ok(String::from_utf8_lossy(&raw).trim_start_matches('\u{feff}').to_owned())
}

/// 读取二进制文件返回 base64（pdf/docx 供前端解析器使用），单文件上限 30MB
#[tauri::command]
async fn kb_read_b64(path: String) -> Result<String, String> {
    use std::io::Read;
    let p = std::path::PathBuf::from(&path);
    let mut f = fs::File::open(&p).map_err(|e| format!("读取失败：{e}"))?;
    let meta = f.metadata().map_err(|e| format!("读取失败：{e}"))?;
    if meta.len() > 30 * 1024 * 1024 {
        return Err("文件超过 30MB，已跳过".into());
    }
    let mut buf = Vec::with_capacity(meta.len() as usize);
    f.read_to_end(&mut buf).map_err(|e| format!("读取失败：{e}"))?;
    Ok(base64_encode(&buf))
}

/// Rust 侧直接提取 PDF 文本（桌面版专用）：
/// WKWebView 里 pdfjs 的 getTextContent 会返回空文本（浏览器 Chrome 正常），
/// 桌面版改由 Rust 侧用 pdf-extract 提取，绕开 WebKit 的 pdfjs 行为差异。
#[tauri::command]
async fn kb_read_pdf_text(path: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| format!("读取失败：{e}"))?;
    if meta.len() > 30 * 1024 * 1024 {
        return Err("PDF 超过解析大小上限（30MB）".into());
    }
    let data = fs::read(&p).map_err(|e| format!("读取失败：{e}"))?;
    if data.len() < 5 || &data[..4] != b"%PDF" {
        return Err("文件不是有效的 PDF（文件头缺失）".into());
    }
    pdf_extract::extract_text_from_mem(&data)
        .map(|t| t.replace('\u{feff}', ""))
        .map_err(|e| format!("PDF 文本提取失败：{e}"))
}

/// 极简 base64（标准字母表，带填充），避免引入新依赖
fn base64_encode(data: &[u8]) -> String {
    const TBL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        out.push(TBL[(n >> 18) as usize & 63] as char);
        out.push(TBL[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TBL[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TBL[n as usize & 63] as char } else { '=' });
    }
    out
}

/// 知识库索引存储（桌面版）：独立文件 kb-data.json（WKWebView 下 IndexedDB 不可靠）
#[tauri::command]
async fn kb_store_load(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let p = data_root(&app)?.join("kb-data.json");
    if !p.exists() { return Ok(None); }
    let raw = fs::read(&p).map_err(|e| format!("读取知识库索引失败: {e}"))?;
    if raw.is_empty() { return Ok(None); }
    Ok(Some(String::from_utf8_lossy(&raw).into_owned()))
}

#[tauri::command]
async fn kb_store_save(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let root = data_root(&app)?;
    fs::create_dir_all(&root).map_err(|e| format!("创建应用数据目录失败: {e}"))?;
    let _seq = CACHE_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = root.join(format!("kb-data.json.{}.tmp", std::process::id() as u64 ^ CACHE_SEQ.load(std::sync::atomic::Ordering::Relaxed)));
    let dst = root.join("kb-data.json");
    fs::write(&tmp, content).map_err(|e| format!("写入知识库索引失败: {e}"))?;
    fs::rename(&tmp, &dst).map_err(|e| format!("写入知识库索引失败: {e}"))
}

/// 返回应用数据目录（IndexedDB 之外的 Token 等文件也存于此）。
/// 供前端数据管理页展示「数据所在目录」。
#[tauri::command]
async fn data_dir_get(app: tauri::AppHandle) -> Result<String, String> {
    data_root(&app).map(|p| p.to_string_lossy().into_owned())
}

const DATA_FILENAME: &str = "data.json";
const BACKUP_PREFIX: &str = "backup_";

/// 校验备份文件名合法性（仅允许 backup_ 开头、.json 结尾的标准文件名，禁止路径穿越）。
/// 备份文件始终位于应用数据目录（与主数据文件同目录），文件名由前端按本地时区生成。
fn valid_backup_name(name: &str) -> bool {
    name.starts_with(BACKUP_PREFIX)
        && name.ends_with(".json")
        && name.len() <= 64
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
}

#[derive(Debug, Serialize)]
struct BackupInfo {
    name: String,
    /// 文件大小（字节）
    size: u64,
    /// 修改时间（Unix 秒）
    modified: u64,
}

fn backup_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 备份目录：应用数据目录下的 backups 子目录（打包桌面应用时数据同步目录即应用数据目录）
    let root = data_root(app)?;
    let backups = root.join("backups");
    fs::create_dir_all(&backups).map_err(|e| format!("创建备份目录失败: {e}"))?;
    Ok(backups)
}

/// 执行一次自动备份：把主数据文件 data.json 复制为备份目录中的带时间戳文件。
/// name 由前端生成（本地时区 YYYYMMDD_HHMMSS），Rust 侧仅做合法性校验。
#[tauri::command]
async fn backup_create(app: tauri::AppHandle, name: String) -> Result<String, String> {
    if !valid_backup_name(&name) {
        return Err("备份文件名不合法".into());
    }
    let root = backup_root(&app)?;
    // P2/C1 修复：备份源应为应用数据根目录下的主数据文件 data.json，而非 backups 子目录内的同名文件
    let src = data_root(&app)?.join(DATA_FILENAME);
    if !src.exists() {
        return Err("主数据文件不存在，无法备份".into());
    }
    let dst = root.join(&name);
    if dst.exists() {
        return Err("同名备份文件已存在，请重试".into());
    }
    fs::copy(&src, &dst).map_err(|e| format!("备份失败: {e}"))?;
    Ok(name)
}

/// 列出备份目录中的所有备份文件（按修改时间倒序，最新在前）。
#[tauri::command]
async fn backup_list(app: tauri::AppHandle) -> Result<Vec<BackupInfo>, String> {
    let root = backup_root(&app)?;
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(&root) {
        for entry in rd.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if !valid_backup_name(&name) {
                continue;
            }
            let md = entry.metadata().map_err(|e| format!("读取备份信息失败: {e}"))?;
            let modified = md
                .modified()
                .map(|t| t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
                .unwrap_or(0);
            out.push(BackupInfo { name, size: md.len(), modified });
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

/// 读取指定备份文件内容（JSON 字符串），供「从备份恢复」。
#[tauri::command]
async fn backup_read(app: tauri::AppHandle, name: String) -> Result<String, String> {
    if !valid_backup_name(&name) {
        return Err("备份文件名不合法".into());
    }
    let p = backup_root(&app)?.join(&name);
    if !p.exists() {
        return Err("备份文件不存在".into());
    }
    fs::read_to_string(&p).map_err(|e| format!("读取备份失败: {e}"))
}

/// 删除指定备份文件。
#[tauri::command]
async fn backup_remove(app: tauri::AppHandle, name: String) -> Result<(), String> {
    if !valid_backup_name(&name) {
        return Err("备份文件名不合法".into());
    }
    let p = backup_root(&app)?.join(&name);
    if !p.exists() {
        return Err("备份文件不存在".into());
    }
    fs::remove_file(&p).map_err(|e| format!("删除备份失败: {e}"))
}

/// 读取应用数据目录中的主数据文件（JSON 字符串）。
/// 文件不存在返回 Ok(None)。macOS WKWebView 的 tauri:// 协议下 IndexedDB
/// 可能挂起（open 无回调），因此桌面版主存储改用本机文件。
#[tauri::command]
async fn data_file_load(app: tauri::AppHandle) -> Result<Option<String>, String> {
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
async fn data_file_save(app: tauri::AppHandle, content: String) -> Result<(), String> {
    if content.len() > MAX_DATA_BYTES {
        return Err(format!("数据过大（{} 字节，上限 {}），拒绝写入", content.len(), MAX_DATA_BYTES));
    }
    let root = data_root(&app)?;
    fs::create_dir_all(&root).map_err(|e| format!("创建应用数据目录失败: {e}"))?;
    let p = root.join(DATA_FILENAME);
    let _seq = CACHE_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = p.with_extension(format!("{}.tmp", std::process::id() as u64 ^ CACHE_SEQ.load(std::sync::atomic::Ordering::Relaxed)));
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
static HTTP_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .expect("构建 HTTP 客户端失败")
    })
}

#[tauri::command]
async fn ai_deepseek_chat(
    _app: tauri::AppHandle,
    window: tauri::Window,
    messages: Vec<ChatMessage>,
    model: Option<String>,
    stream: Option<bool>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    stream_event: Option<String>,
    tools: Option<serde_json::Value>,
    base_url: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    // 本地端点（Ollama 等）免 Token；其余端点从 Token 文件读取
    let local_base = base_url
        .as_ref()
        .map(|b| is_local_endpoint(b))
        .unwrap_or(false);
    // 端点协议白名单：https 任意放行、http 仅限本地回环（R-S3：禁止内网/明文 http 携带 Key 外发）
    if let Some(b) = base_url.as_ref() {
        let b = b.trim();
        if !b.is_empty() && !valid_upstream_base_url(b) {
            return Err("自定义端点仅支持 https:// 或本地回环地址（如 Ollama http://127.0.0.1:11434/v1）".into());
        }
    }
    // Token 优先级：用户已保存的真实 Key > 本地端点占位（Ollama 兼容）> 报错
    // （oMLX 等本地服务会校验 Key 与自身配置一致，必须优先用真实 Key，不能一进本地就用占位）
    // Key 来源（明文方案）：前端每次请求随 body 传入（存 localStorage），Rust 不再读写 token 文件
    let token = match api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        Some(k) => k.to_string(),
        None => if local_base {
            // 本地端点无 Key：占位 token（Ollama 的 OpenAI 兼容层要求 Authorization 头非空）
            "ollama".to_string()
        } else {
            return Err("未设置 API_KEY，请先在 AI 设置中填写".into());
        }
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

    // 多模型接入：优先使用前端传入的 Base URL（OpenAI 兼容端点，如 Ollama http://127.0.0.1:11434/v1）
    let req_url = match base_url {
        Some(b) if !b.trim().is_empty() => {
            let b = b.trim().trim_end_matches('/').to_string();
            if b.ends_with("/chat/completions") { b } else { format!("{b}/chat/completions") }
        }
        _ => DEEPSEEK_BASE_URL.to_string(),
    };

    let mut req = http_client()
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
        .map_err(|e| format!("无法连接模型服务: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let code = status.as_u16();
        let raw = resp.bytes().await.unwrap_or_default();
        let text = String::from_utf8_lossy(&raw).into_owned();
        let snippet: String = text.chars().take(500).collect();
        return Err(format!(
            "模型服务返回错误 (HTTP {code})：{}",
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            kb_pick_dir,
            kb_pick_and_scan_dir,
            kb_clear_cache,
            kb_scan_dir,
            kb_read_text,
            kb_read_b64,
            kb_pick_files,
            kb_read_pdf_text,
            kb_store_load,
            kb_store_save,
            data_dir_get,
            data_file_load,
            data_file_save,
            backup_create,
            backup_list,
            backup_read,
            backup_remove,
            ai_deepseek_chat,
            open_external,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FastenerTradeWorkbench tauri application");
}
