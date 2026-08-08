/**
 * Markdown Editor — Express Server
 * 导出 createServer() 供 Electron main process 直接调用（兼容 asar 打包）
 * 同时也支持直接 node server.js 运行（命令行模式）
 */

const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const { marked } = require('marked');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const iconv = require('iconv-lite');
const { v4: uuidv4 } = require('uuid');

/**
 * 创建 Express 应用
 * @param {{ publicDir?: string, savesDir?: string, uploadsDir?: string }} opts
 * @returns Express app 实例
 */
function createApp(opts = {}) {
  const publicDir = opts.publicDir || path.join(__dirname, 'public');
  const savesDir = opts.savesDir || path.join(__dirname, 'saves');
  const uploadsDir = opts.uploadsDir || path.join(publicDir, 'uploads');

  // 确保目录存在
  for (const dir of [uploadsDir, savesDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(publicDir));

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, uuidv4() + ext);
    }
  });
  const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

  // ==================== 文件转换 API ====================

  // Word/PDF → Markdown
  app.post('/api/convert-to-markdown', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: '请上传文件' });

      const filePath = req.file.path;
      const ext = path.extname(req.file.originalname).toLowerCase();
      let markdown = '';

      if (ext === '.docx' || ext === '.doc') {
        markdown = await wordToMarkdown(filePath);
      } else if (ext === '.pdf') {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        markdown = data.text;
      } else if (ext === '.txt' || ext === '.md' || ext === '.markdown') {
        markdown = readTextFileAutoDetect(filePath);
      } else {
        fs.unlinkSync(filePath);
        return res.status(400).json({ error: '不支持的文件格式，支持 .docx / .pdf / .txt / .md' });
      }

      fs.unlinkSync(filePath);
      res.json({ markdown, filename: req.file.originalname });
    } catch (err) {
      console.error('转换失败:', err);
      res.status(500).json({ error: '文件转换失败: ' + err.message });
    }
  });

  // Markdown → HTML 预览
  app.post('/api/preview', (req, res) => {
    try {
      const { markdown, theme } = req.body;
      if (!markdown) return res.status(400).json({ error: '请提供 Markdown 内容' });

      const isDark = theme !== 'light';
      const bg      = isDark ? '#0d0d1a' : '#ffffff';
      const fg      = isDark ? '#e8e8ee' : '#1a1a22';
      const codeBg  = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
      const codeFg  = isDark ? '#ff8aab' : '#c7254e';
      const preBg   = isDark ? '#1a1a28' : '#f5f5f7';
      const preBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
      const thBg    = isDark ? '#1e1e30' : '#eeeef1';
      const tdBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
      const h1Border = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
      const bqColor  = isDark ? '#b0b0b8' : '#58585c';
      const bqBorder = isDark ? '#3399ff' : '#0066d6';
      const aColor   = isDark ? '#3399ff' : '#0066d6';
      const h1Color  = isDark ? '#fafafc' : '#161618';
      const h2Color  = isDark ? '#e8e8ee' : '#1a1a22';
      const h3Color  = isDark ? '#d0d0d8' : '#3a3a44';

      const html = marked.parse(markdown);
      const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif; line-height: 1.8; padding: 40px; max-width: 800px; margin: 0 auto; color: ${fg}; background: ${bg}; }
  h1 { color: ${h1Color}; border-bottom: 2px solid ${h1Border}; padding-bottom: 8px; }
  h2 { color: ${h2Color}; }
  h3 { color: ${h3Color}; }
  code { background: ${codeBg}; padding: 2px 6px; border-radius: 4px; color: ${codeFg}; }
  pre { background: ${preBg}; padding: 16px; border-radius: 8px; overflow-x: auto; border: 1px solid ${preBorder}; }
  pre code { background: none; padding: 0; color: ${fg}; }
  blockquote { border-left: 4px solid ${bqBorder}; padding-left: 16px; color: ${bqColor}; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid ${tdBorder}; padding: 8px 12px; }
  th { background: ${thBg}; }
  img { max-width: 100%; }
  a { color: ${aColor}; }
</style>
</head>
<body>${html}</body>
</html>`;
      res.json({ html: fullHtml });
    } catch (err) {
      res.status(500).json({ error: '预览生成失败' });
    }
  });

  // Markdown → Word
  app.post('/api/convert-to-word', (req, res) => {
    try {
      const { markdown } = req.body;
      if (!markdown) return res.status(400).json({ error: '请提供 Markdown 内容' });

      const html = marked.parse(markdown);
      const filename = `converted-${uuidv4()}.doc`;

      const wordHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: 'Microsoft YaHei', 'SimSun', sans-serif; font-size: 14px; line-height: 1.8; color: #333; }
  h1 { font-size: 24px; color: #1a1a2e; border-bottom: 2px solid #333; padding-bottom: 6px; }
  h2 { font-size: 20px; color: #2e7d32; }
  h3 { font-size: 16px; color: #e65100; }
  code { background: #f5f5f5; padding: 2px 4px; font-family: 'Consolas', monospace; }
  pre { background: #f5f5f5; padding: 12px; border: 1px solid #ddd; font-family: 'Consolas', monospace; font-size: 12px; }
  blockquote { border-left: 4px solid #1976d2; padding-left: 12px; color: #666; font-style: italic; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #999; padding: 6px 10px; }
  th { background: #e0e0e0; }
  p { margin: 8px 0; }
</style>
</head>
<body>${html}</body>
</html>`;

      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, wordHtml, 'utf-8');
      res.json({ filename, downloadUrl: `/uploads/${filename}` });
    } catch (err) {
      console.error('转换 Word 失败:', err);
      res.status(500).json({ error: 'Word 转换失败: ' + err.message });
    }
  });

  // Markdown → PDF 打印页
  app.post('/api/convert-to-pdf', (req, res) => {
    try {
      const { markdown } = req.body;
      if (!markdown) return res.status(400).json({ error: '请提供 Markdown 内容' });

      const html = marked.parse(markdown);
      const filename = `print-${uuidv4()}.html`;

      const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>导出 PDF</title>
<style>
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  body { font-family: 'Microsoft YaHei', 'SimHei', sans-serif; font-size: 14px; line-height: 1.8; padding: 40px; color: #333; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 26px; color: #1a1a2e; border-bottom: 2px solid #333; padding-bottom: 8px; }
  h2 { font-size: 22px; color: #2e7d32; }
  h3 { font-size: 18px; color: #e65100; }
  code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: 'Consolas', monospace; font-size: 13px; }
  pre { background: #f5f5f5; padding: 14px; border-radius: 6px; border: 1px solid #ddd; overflow-x: auto; font-size: 13px; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #1976d2; padding-left: 14px; color: #666; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #999; padding: 8px 12px; }
  th { background: #e8e8e8; }
  img { max-width: 100%; }
  p { margin: 10px 0; }
  .print-btn {
    position: fixed; top: 16px; right: 16px; z-index: 999;
    padding: 10px 20px; background: #4f6ef6; color: #fff; border: none;
    border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600;
    box-shadow: 0 4px 12px rgba(79,110,246,0.3);
  }
  .print-btn:hover { background: #3b5de7; }
  @media print { .print-btn { display: none; } }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">🖨 打印 / 另存为 PDF</button>
${html}
<script>
  setTimeout(() => {
    if (confirm('页面已生成，是否立即打印/另存为 PDF？\\n\\n点击"确定"打开打印对话框，在目标中选择"另存为 PDF"即可。')) {
      window.print();
    }
  }, 500);
</script>
</body>
</html>`;

      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, fullHtml, 'utf-8');
      res.json({ filename, downloadUrl: `/uploads/${filename}` });
    } catch (err) {
      console.error('生成 PDF 打印页失败:', err);
      res.status(500).json({ error: 'PDF 打印页生成失败: ' + err.message });
    }
  });

  // Markdown → 直接打印
  app.post('/api/markdown-to-print', (req, res) => {
    try {
      const { markdown } = req.body;
      const html = marked.parse(markdown);
      const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>打印 PDF</title>
<style>@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
body{font-family:'Microsoft YaHei',sans-serif;padding:40px;font-size:14px;line-height:1.8;color:#333;max-width:800px;margin:0 auto;}
h1{border-bottom:2px solid #333;padding-bottom:8px;}
pre{background:#f5f5f5;padding:14px;border-radius:6px;border:1px solid #ddd;overflow-x:auto;}
code{background:#f5f5f5;padding:2px 6px;border-radius:3px;}
pre code{background:none;padding:0;}
blockquote{border-left:4px solid #1976d2;padding-left:14px;color:#666;}
table{border-collapse:collapse;width:100%;}th,td{border:1px solid #999;padding:8px 12px;}th{background:#e8e8e8;}
</style></head><body>${html}<script>window.onload=function(){window.print();}<\/script></body></html>`;

      res.set('Content-Type', 'text/html; charset=utf-8');
      res.send(fullHtml);
    } catch (err) {
      res.status(500).json({ error: '生成失败: ' + err.message });
    }
  });

  // ==================== 文档保存 / 加载 API ====================

  function autoTitle(content) {
    const m = content.match(/^#\s+(.+)/m);
    return m ? m[1].trim() : '未命名文档';
  }

  app.get('/api/saves', (req, res) => {
    try {
      const files = fs.readdirSync(savesDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const raw = fs.readFileSync(path.join(savesDir, f), 'utf-8');
          const doc = JSON.parse(raw);
          return { id: doc.id, title: doc.title, updatedAt: doc.updatedAt };
        })
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      res.json(files);
    } catch (err) {
      res.status(500).json({ error: '读取列表失败' });
    }
  });

  app.get('/api/saves/:id', (req, res) => {
    try {
      const fp = path.join(savesDir, req.params.id + '.json');
      if (!fs.existsSync(fp)) return res.status(404).json({ error: '未找到' });
      res.json(JSON.parse(fs.readFileSync(fp, 'utf-8')));
    } catch (err) {
      res.status(500).json({ error: '读取失败' });
    }
  });

  app.post('/api/saves', (req, res) => {
    try {
      const { id, title, content } = req.body;
      if (!content) return res.status(400).json({ error: '内容为空' });
      const docId = id || uuidv4();
      const now = new Date().toISOString();
      const doc = {
        id: docId,
        title: title || autoTitle(content),
        content,
        createdAt: id ? undefined : now,
        updatedAt: now,
      };
      const fp = path.join(savesDir, docId + '.json');
      if (id && fs.existsSync(fp)) {
        const old = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        doc.createdAt = old.createdAt || now;
      }
      fs.writeFileSync(fp, JSON.stringify(doc, null, 2), 'utf-8');
      res.json({ id: docId, title: doc.title, updatedAt: doc.updatedAt });
    } catch (err) {
      res.status(500).json({ error: '保存失败: ' + err.message });
    }
  });

  app.delete('/api/saves/:id', (req, res) => {
    try {
      const fp = path.join(savesDir, req.params.id + '.json');
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
        res.json({ ok: true });
      } else {
        res.status(404).json({ error: '未找到' });
      }
    } catch (err) {
      res.status(500).json({ error: '删除失败' });
    }
  });

  return app;
}

// ==================== 辅助函数 ====================

const WORD_STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='heading 4'] => h4:fresh",
  "p[style-name='Heading 5'] => h5:fresh",
  "p[style-name='heading 5'] => h5:fresh",
  "p[style-name='Heading 6'] => h6:fresh",
  "p[style-name='heading 6'] => h6:fresh",
  "p[style-name='标题 1'] => h1:fresh",
  "p[style-name='标题1'] => h1:fresh",
  "p[style-name='标题 2'] => h2:fresh",
  "p[style-name='标题2'] => h2:fresh",
  "p[style-name='标题 3'] => h3:fresh",
  "p[style-name='标题3'] => h3:fresh",
  "p[style-name='标题 4'] => h4:fresh",
  "p[style-name='标题4'] => h4:fresh",
  "p[style-name='标题 5'] => h5:fresh",
  "p[style-name='标题5'] => h5:fresh",
  "p[style-name='标题 6'] => h6:fresh",
  "p[style-name='标题6'] => h6:fresh",
  "p[style-name='副标题'] => h2:fresh",
  "p[style-name='标题'] => h1:fresh",
  "p[style-name='Quote'] => blockquote",
  "p[style-name='Intense Quote'] => blockquote",
  "p[style-name='引用'] => blockquote",
  "p[style-name='明显引用'] => blockquote",
  "p[style-name='Normal (Web)'] => p",
  "p[style-name='正文'] => p",
  "p[style-name='正文文本'] => p",
  "p[style-name='List Paragraph'] => p",
  "p[style-name='列表段落'] => p",
  "r[style-name='副标题 字符'] => span",
  "r[style-name='引用 字符'] => span",
  "r[style-name='明显引用 字符'] => span",
  "r[style-name='标题 1 字符'] => span",
  "r[style-name='标题1 字符'] => span",
  "r[style-name='标题 2 字符'] => span",
  "r[style-name='标题2 字符'] => span",
  "r[style-name='标题 3 字符'] => span",
  "r[style-name='标题3 字符'] => span",
  "r[style-name='标题 4 字符'] => span",
  "r[style-name='标题4 字符'] => span",
  "r[style-name='标题 5 字符'] => span",
  "r[style-name='标题5 字符'] => span",
  "r[style-name='标题 6 字符'] => span",
  "r[style-name='标题6 字符'] => span",
  "r[style-name='标题 字符'] => span",
  "r[style-name='要点'] => em",
  "r[style-name='要点 字符'] => em",
  "r[style-name='强调'] => strong",
  "r[style-name='强调 字符'] => strong",
  "r[style-name='Emphasis'] => em",
  "r[style-name='Subtle Emphasis'] => em",
  "r[style-name='Intense Emphasis'] => strong",
  "r[style-name='Strong'] => strong",
  "r[style-name='Hyperlink'] => span",
  "r[style-name='超链接'] => span",
  "r[style-name='Subtle Reference'] => span",
  "r[style-name='Intense Reference'] => span",
  "r[style-name='Bookend Title'] => span",
  "r[style-name='No Spacing'] => span",
  "r[style-name='HTML Code'] => code",
  "r[style-name='HTML Preformatted'] => code",
  "r[style-name='Code'] => code",
];

async function wordToMarkdown(filePath) {
  const result = await mammoth.convertToMarkdown(
    { path: filePath },
    {
      styleMap: WORD_STYLE_MAP,
      convertImage: mammoth.images.imgElement((image) => {
        return image.read('base64').then((buffer) => ({
          src: `data:${image.contentType};base64,${buffer}`
        }));
      })
    }
  );
  if (result.messages.length > 0) {
    console.log('Mammoth:', result.messages.map(m => m.message));
  }
  return result.value;
}

function readTextFileAutoDetect(filePath) {
  const buf = fs.readFileSync(filePath);

  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.slice(3).toString('utf-8');
  }
  if (buf[0] === 0xFF && buf[1] === 0xFE) {
    return iconv.decode(buf.slice(2), 'utf-16le');
  }
  if (buf[0] === 0xFE && buf[1] === 0xFF) {
    return iconv.decode(buf.slice(2), 'utf-16be');
  }

  const utf8 = buf.toString('utf-8');
  if (!utf8.includes('�')) return utf8;

  const encodings = ['gbk', 'gb2312', 'big5', 'shiftjis', 'euc-kr'];
  for (const enc of encodings) {
    try {
      const decoded = iconv.decode(buf, enc);
      const replacementRatio = (decoded.match(/�/g) || []).length / Math.max(1, decoded.length);
      if (replacementRatio < 0.01) return decoded;
    } catch { /* skip */ }
  }

  try { return iconv.decode(buf, 'latin1').replace(/�/g, '?'); } catch {}
  return utf8;
}

// 导出供 Electron 使用
module.exports = { createApp };

// ==================== 直接运行时启动 ====================
if (require.main === module) {
  // sidecar 模式：可由 Tauri 通过环境变量指定数据目录（saves/uploads）
  const app = createApp({
    savesDir: process.env.MARKDOWN_EDITOR_SAVES_DIR,
    uploadsDir: process.env.MARKDOWN_EDITOR_UPLOADS_DIR
  });
  const PORT = 3055;
  const os = require('os');

  function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const v4 = [], v6 = [];
    for (const [, ifaces] of Object.entries(interfaces)) {
      for (const iface of ifaces) {
        if (iface.internal) continue;
        if (iface.family === 'IPv4') v4.push(iface.address);
        if (iface.family === 'IPv6') {
          const scopeId = iface.scopeid ? '%' + iface.scopeid : '';
          v6.push(iface.address + scopeId);
        }
      }
    }
    return { v4, v6 };
  }

  app.listen(PORT, '127.0.0.1', () => {
    const ips = getLocalIPs();
    console.log(`📝 Markdown Editor 服务已启动`);
    console.log(`   本地访问:    http://127.0.0.1:${PORT}`);
    for (const ip of ips.v4) {
      console.log(`   IPv4:  http://${ip}:${PORT}`);
    }
    for (const ip of ips.v6) {
      console.log(`   IPv6:  http://[${ip}]:${PORT}`);
    }
  });
}
