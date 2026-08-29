fn main() {
    // 2026-08-29 Windows MAX_PATH 长路径（>260 字符）支持：
    // Tauri 2 tauri.conf.json 里没有 bundle.windows.longPathAware 字段（tauri-build 会报
    // unknown field `longPathAware`），改走 Windows 10 1607+ 官方推荐的
    //「应用程序兼容清单 + longPathAware 声明」嵌入到 .exe 资源，绕过 MAX_PATH 限制。
    // 路径示例：紧固件贸易/西游记/正文/分卷三/第一百二十回·长篇章节题名…/章节名.md 很
    // 容易叠加 C:\Users\<LongChineseUsername>\Downloads\ 前缀超过 260 = ERROR_FILENAME_EXCED_RANGE=206，
    // 之前在 Rust kb_walk 里直接 PathTooLong 跳过 → 0 文件/漏扫。
    // 注意：仅在 target_os = windows 时嵌入；其他平台（macOS/linux/cargo check on mac）
    // 执行 embed_resource 会失败，我们用 cfg(windows) 条件编译。
    // 等价 manifest：
    //   <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    //   <assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
    //     <application xmlns="urn:schemas-microsoft-com:asm.v3">
    //       <windowsSettings xmlns:ws2016="http://schemas.microsoft.com/SMI/2016/WindowsSettings">
    //         <ws2016:longPathAware xmlns:ws2016="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</ws2016:longPathAware>
    //       </windowsSettings>
    //     </application>
    //   </assembly>
    #[cfg(windows)]
    {
        // winresource 可以不引入第三方依赖：windows-rs 文档里推荐的最省依赖做法是
        // 把 manifest 写到临时文件再通过链接开关 /MANIFEST /MANIFESTINPUT:$file 传入。
        // 这里直接用 cargo 支持的「cargo:rustc-link-arg-msvc=/MANIFEST …」方案：
        let out_dir = std::env::var_os("OUT_DIR").expect("OUT_DIR missing");
        let manifest_path = std::path::PathBuf::from(out_dir).join("long-path-aware.manifest");
        if let Err(e) = std::fs::write(&manifest_path,
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings xmlns:ws2016="http://schemas.microsoft.com/SMI/2016/WindowsSettings">
      <ws2016:longPathAware xmlns:ws2016="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</ws2016:longPathAware>
    </windowsSettings>
  </application>
</assembly>
"#) { eprintln!("warning: failed to write windows long-path manifest: {e}"); }
        else {
            // /MANIFEST:EMBED 指定 ID=1 RT_MANIFEST 嵌入，确保 Windows 加载器读取
            let manifest_arg = format!(
                "/MANIFEST:EMBED,ID=1 /MANIFESTINPUT:{}",
                manifest_path.display()
            );
            // 只对 MSVC 工具链生效；GNU 工具链通过 .rs 资源文件方式实现，这里 MSVC 即可
            // （tauri 2 默认 x86_64-pc-windows-msvc / aarch64-pc-windows-msvc）。
            println!("cargo:rustc-link-arg-msvc={manifest_arg}");
        }
    }

    tauri_build::build()
}
