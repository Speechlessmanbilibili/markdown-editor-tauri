/**
 * 构建后：把 sidecar 复制到 target/release/ 下，
 * 使未打包的 release exe 直接双击运行时也能找到 sidecar（exe 同目录查找）。
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src-tauri', 'binaries', 'markdown-server-x86_64-pc-windows-msvc.exe');
const destDir = path.join(__dirname, '..', 'src-tauri', 'target', 'release');
const dest = path.join(destDir, 'markdown-server.exe');

if (!fs.existsSync(src)) {
  console.log('[copy-sidecar] 源 sidecar 不存在，跳过:', src);
  process.exit(0);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('[copy-sidecar] 已复制 sidecar 到:', dest);
