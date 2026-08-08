// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::Manager;

/// 全局持有 sidecar 子进程句柄，应用退出时清理
static SIDECAR: Mutex<Option<Child>> = Mutex::new(None);

/// 定位 sidecar 可执行文件：
/// - 开发模式：src-tauri/binaries/ 下
/// - 生产模式：打包后位于资源目录（resources/）
fn sidecar_path(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let name = format!("markdown-server{}", std::env::consts::EXE_SUFFIX);

    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(&name);
        if dev.exists() {
            return Ok(dev);
        }
        // tauri dev 也可能把 externalBin 复制到 target 目录
        let target = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("debug")
            .join(&name);
        if target.exists() {
            return Ok(target);
        }
    }

    let res = app.path().resource_dir()?.join(&name);
    Ok(res)
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let path = sidecar_path(app)?;

    // 数据目录：appDataDir/saves、appDataDir/uploads（跨版本保留，等同 Electron userData）
    let data_dir = app.path().app_data_dir()?;
    let saves_dir = data_dir.join("saves");
    let uploads_dir = data_dir.join("uploads");
    std::fs::create_dir_all(&saves_dir)?;
    std::fs::create_dir_all(&uploads_dir)?;

    let child = Command::new(&path)
        .env("MARKDOWN_EDITOR_SAVES_DIR", &saves_dir)
        .env("MARKDOWN_EDITOR_UPLOADS_DIR", &uploads_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    *SIDECAR.lock().unwrap() = Some(child);

    // 等待 sidecar 就绪（轮询端口，最多 10 秒），避免窗口先于服务打开导致前端请求失败
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        if std::net::TcpStream::connect("127.0.0.1:3055").is_ok() {
            break;
        }
        if std::time::Instant::now() > deadline {
            return Err("sidecar 10 秒内未就绪".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Err(e) = spawn_sidecar(app.handle()) {
                eprintln!("[markdown-editor-tauri] sidecar 启动失败: {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    // 应用退出后清理 sidecar 进程
    if let Some(mut child) = SIDECAR.lock().unwrap().take() {
        let _ = child.kill();
    }
}
