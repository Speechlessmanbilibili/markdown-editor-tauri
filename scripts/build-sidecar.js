/**
 * 将 server.js 打包为 Node SEA（Single Executable Application）sidecar
 * 供 Tauri externalBin 使用。产物：src-tauri/binaries/markdown-server-<triple>.exe
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build');
const binariesDir = path.join(root, 'src-tauri', 'binaries');
const triple = process.env.TAURI_TARGET_TRIPLE || 'x86_64-pc-windows-msvc';
const sidecarName = `markdown-server-${triple}.exe`;
const outExe = path.join(binariesDir, sidecarName);
const nodeExe = process.execPath;

fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(binariesDir, { recursive: true });

function run(cmd, opts = {}) {
  console.log('>', cmd);
  execSync(cmd, { cwd: root, stdio: 'inherit', ...opts });
}

// 1. esbuild 打包 server.js + 依赖为单文件 CJS bundle
const bundleOut = path.join(buildDir, 'server.bundle.js');
run(`npx esbuild server.js --bundle --platform=node --target=node24 --format=cjs --outfile=${bundleOut} --log-level=warning`);

// 2. 生成 SEA 配置
const seaConfig = path.join(buildDir, 'sea-config.json');
fs.writeFileSync(seaConfig, JSON.stringify({
  main: bundleOut.replace(/\\/g, '/'),
  output: path.join(buildDir, 'sea-prep.blob').replace(/\\/g, '/'),
  disableExperimentalSEAWarning: true
}, null, 2));

// 3. 生成 SEA blob
run(`node --experimental-sea-config ${seaConfig}`);

// 4. 复制 node.exe 为 sidecar
fs.copyFileSync(nodeExe, outExe);

// 5. postject 注入 blob
const fuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
run(`npx postject ${outExe} NODE_SEA_BLOB ${path.join(buildDir, 'sea-prep.blob')} --sentinel-fuse ${fuse}`);

console.log('✅ sidecar 构建完成:', outExe, `(${(fs.statSync(outExe).size / 1024 / 1024).toFixed(1)} MB)`);
