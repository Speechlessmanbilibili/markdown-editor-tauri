# 📝 Markdown Editor Pro — Tauri 版

基于 **Tauri 2** 的 Markdown 桌面编辑器，功能与 [Electron 版](https://github.com/Speechlessmanbilibili/markdown-editor-electron) 完全一致，但安装包更小、内存占用更低、启动更快。

## ✨ 功能

- **📝 Markdown 编辑** — 分屏实时预览，语法高亮，丰富的格式化工具栏
- **📥 文件导入** — 拖放导入 Word (.docx) / PDF / TXT / Markdown，自动转换
- **📤 多格式导出** — 一键导出 Markdown (.md) / Word (.doc) / PDF
- **🌓 深色/浅色主题** — 带圆形扩散过渡动画，偏好自动记忆
- **💾 自动保存** — 编辑内容自动保存，支持多文档管理
- **📋 大纲导航** — 自动生成文档大纲，点击跳转
- **🔍 查找替换** — Ctrl+F 查找，逐个替换和全部替换
- **⌨️ 快捷键** — `Ctrl+B` 粗体 `Ctrl+I` 斜体 `Ctrl+K` 链接 `Ctrl+S` 保存 `Ctrl+F` 查找

## 🏗 架构：Tauri 壳 + Node sidecar

```
┌─────────────────────────────────────────────┐
│  Tauri 2 窗口（WebView2）                    │
│  加载 public/ 前端（与 Electron 版共用）     │
└──────────────────┬──────────────────────────┘
                   │ fetch http://localhost:3055（CORS 全开）
┌──────────────────▼──────────────────────────┐
│  Node sidecar（SEA 单文件 exe）              │
│  server.js → Express（mammoth/pdf-parse/    │
│  marked/iconv… 全部原样复用）                │
└─────────────────────────────────────────────┘
```

- **前端与后端零改动复用**：`public/` 与 `server.js` 直接从 Electron 版迁移（仅前端 `API` 常量从同源改为指向 sidecar 地址的一行适配）
- **sidecar**：`server.js` 用 esbuild 打包 + Node SEA（Single Executable Application）生成单文件 exe，随 Tauri 分发
- **数据目录**：保存的文档与上传文件存于系统应用数据目录（`appDataDir/saves`、`appDataDir/uploads`），由 Rust 侧通过环境变量传给 sidecar，跨版本保留

## 🚀 开发

### 环境要求

- [Node.js](https://nodejs.org/) >= 20
- [Rust](https://rustup.rs/)（stable，含 MSVC 工具链）
- Windows：Visual Studio Build Tools 2022（C++ 桌面开发工作负载）
- 各平台系统 WebView（Windows 10/11 自带 WebView2，macOS 为 WKWebView，Linux 为 WebKitGTK）

### 开发运行

```bash
git clone https://github.com/Speechlessmanbilibili/markdown-editor-tauri.git
cd markdown-editor-tauri
npm install
npm run sidecar    # 构建 Node sidecar（server.js → SEA exe）
npm run dev        # 启动 Tauri 开发模式
```

### 构建安装包

```bash
npm run build      # 生成安装包（默认 NSIS for Windows）
```

## 📂 项目结构

```
markdown-editor-tauri/
├── public/               # 前端（与 Electron 版共用，零改动）
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── server.js             # Express 后端（与 Electron 版共用，仅加环境变量支持）
├── scripts/
│   └── build-sidecar.js  # esbuild + SEA 打包 sidecar 的脚本
├── src-tauri/
│   ├── binaries/         # sidecar 可执行文件（markdown-server-<triple>.exe）
│   ├── src/main.rs       # Tauri 主程序：启动 sidecar + 传递数据目录
│   ├── tauri.conf.json   # 窗口 / CSP / externalBin 配置
│   ├── Cargo.toml
│   └── icons/            # 应用图标
└── package.json
```

## 📄 许可证

[MIT](LICENSE) — 与 Electron 版相同。
