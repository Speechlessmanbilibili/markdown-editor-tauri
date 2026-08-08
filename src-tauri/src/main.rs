// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::Manager;

/// 全局持有 sidecar 子进程句柄，应用退出时清理
static SIDECAR: Mutex<Option<Child>> = Mutex::new(None);

/// 定位 sidecar 可执行文件，按优先级：
/// 1. 打包安装后的资源目录（resources/）
/// 2. exe 同目录（直接运行 release exe 时，sidecar 放在旁边即可）
/// 3. 开发模式：src-tauri/binaries/ 或 target/debug/
fn sidecar_path(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let name = format!("markdown-server{}", std::env::consts::EXE_SUFFIX);

    let res = app.path().resource_dir()?.join(&name);
    if res.exists() {
        return Ok(res);
    }

    if let Ok(exe) = std::env::current_exe() {
        let beside = exe.parent().unwrap_or(std::path::Path::new(".")).join(&name);
        if beside.exists() {
            return Ok(beside);
        }
    }

    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(&name);
        if dev.exists() {
            return Ok(dev);
        }
        let target = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("debug")
            .join(&name);
        if target.exists() {
            return Ok(target);
        }
    }

    Err("sidecar 未找到：请将 markdown-server.exe 放在应用同目录或资源目录".into())
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let path = sidecar_path(app)?;

    // 数据目录：appDataDir/saves、appDataDir/uploads（跨版本保留，等同 Electron userData）
    let data_dir = app.path().app_data_dir()?;
    let saves_dir = data_dir.join("saves");
    let uploads_dir = data_dir.join("uploads");
    std::fs::create_dir_all(&saves_dir)?;
    std::fs::create_dir_all(&uploads_dir)?;

    let mut cmd = Command::new(&path);
    cmd.env("MARKDOWN_EDITOR_SAVES_DIR", &saves_dir)
        .env("MARKDOWN_EDITOR_UPLOADS_DIR", &uploads_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    // Windows：sidecar（Node SEA）是控制台程序，必须加 CREATE_NO_WINDOW
    // 否则每次启动都会弹出一个黑色命令行窗口
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn()?;

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
