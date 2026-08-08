/**
 * Markdown Editor Pro — Frontend Application
 * ===========================================
 * Features:
 *  - Live Markdown preview (server-rendered HTML)
 *  - Drag-and-drop file import (.docx / .pdf → Markdown)
 *  - Export Markdown to Word / PDF / .md download
 *  - Dark / Light theme with localStorage persistence
 *  - Auto-save to localStorage
 *  - Keyboard shortcuts
 */

/* ============================================================
   State
   ============================================================ */
const API = 'http://127.0.0.1:3055';
const AUTOSAVE_ID = '__autosave__';
let currentView = 'split';
let previewTimer = null;
let currentFileName = null;
let currentSaveId = null;  // 当前文档在服务器的保存 ID
let outlineTimeout = null;
let findMatches = [];
let findIdx = -1;

/* ============================================================
   DOM References
   ============================================================ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  editor:       $('#editor'),
  preview:      $('#previewFrame'),
  dropZone:     $('#dropZone'),
  fileInput:    $('#fileInput'),
  fileInfo:     $('#fileInfo'),
  fileName:     $('#fileName'),
  editorPane:  $('#editor-pane'),
  previewPane: $('#preview-pane'),
  toastContainer: $('#toastContainer'),
  tabs:          $$('.tab'),
};

/* ============================================================
   Toast Notifications
   ============================================================ */
const ICONS = { success: '✓', error: '✗', info: 'i', warning: '!' };

function toast(message, type = 'info', duration = 3800) {
  const container = dom.toastContainer;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${ICONS[type] || 'i'}</span>${message}`;
  container.appendChild(el);

  const remove = () => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 300);
  };

  setTimeout(remove, duration);

  // Click to dismiss early
  el.addEventListener('click', remove);
}

/* ============================================================
   Preview
   ============================================================ */
function currentTheme() {
  return document.body.classList.contains('dark') ? 'dark' : 'light';
}

async function renderPreview() {
  const md = dom.editor.value;
  const theme = currentTheme();

  if (!md.trim()) {
    dom.preview.srcdoc = emptyPreviewHTML(theme);
    return;
  }

  try {
    const res = await fetch(`${API}/api/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: md, theme }),
    });
    if (!res.ok) throw new Error('预览服务异常');
    const data = await res.json();
    dom.preview.srcdoc = data.html;
  } catch {
    dom.preview.srcdoc = errorPreviewHTML(theme);
  }
}

function emptyPreviewHTML(theme) {
  const bg = theme === 'light' ? '#ffffff' : '#0d0d1a';
  const fg = theme === 'light' ? '#98989d' : '#707078';
  return `<html><body style="display:flex;align-items:center;justify-content:center;height:100%;
    color:${fg};font-family:-apple-system,system-ui,sans-serif;background:${bg};margin:0;">
    <div style="text-align:center"><div style="font-size:40px;margin-bottom:10px;">📄</div>
    <p style="font-size:14px;">在左侧编辑器中编写 Markdown 即可实时预览</p></div></body></html>`;
}

function errorPreviewHTML(theme) {
  const bg = theme === 'light' ? '#ffffff' : '#0d0d1a';
  return `<html><body style="display:flex;align-items:center;justify-content:center;height:100%;
    color:#c83030;font-family:-apple-system,system-ui,sans-serif;background:${bg};margin:0;">
    <p>预览加载失败，请检查后端服务是否运行</p></body></html>`;
}

// Debounced input → preview + outline + stats + instant auto-save
dom.editor.addEventListener('input', () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 180);

  renderOutline();
  updateStats();
  autoSave();
});

// Initial stats
updateStats();
renderOutline();

/* ============================================================
   View Tabs
   ============================================================ */
function switchView(view) {
  currentView = view;

  dom.tabs.forEach(t => {
    t.classList.toggle('active', t.dataset.pane === view);
  });

  dom.editorPane.classList.toggle('hidden', view === 'preview');
  dom.previewPane.classList.toggle('hidden', view === 'editor');

  // Reset flex on both when returning to split
  if (view === 'split') {
    dom.editorPane.style.flex = '';
    dom.previewPane.style.flex = '';
  }

  // 切到有预览的模式时刷新预览（避免显示过时内容）
  if (view !== 'editor') {
    renderPreview();
  }
}

/* ============================================================
   Theme
   ============================================================ */
function restoreTheme() {
  if (localStorage.getItem('md-editor-theme') === 'dark') {
    document.body.classList.add('dark');
  }
}

async function toggleTheme(btn) {
  // 当前是 dark → 即将切到 light；当前是 light → 即将切到 dark
  const switchingToLight = document.body.classList.contains('dark');

  // 计算按钮中心坐标，作为扩散动画原点
  const rect = btn.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );
  document.documentElement.style.setProperty('--tx-x', x + 'px');
  document.documentElement.style.setProperty('--tx-y', y + 'px');
  document.documentElement.style.setProperty('--tx-radius', radius + 'px');

  // 统一主题应用：切类 + 更新预览
  const apply = async () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('md-editor-theme', switchingToLight ? 'light' : 'dark');
    dom.preview.style.opacity = '0';
    await renderPreview();
    dom.preview.style.opacity = '1';
  };

  if (document.startViewTransition) {
    // async callback → VT 等待 promise resolve 后才拍"新状态"快照
    // 此时 iframe 已渲染完新主题内容，快照中的预览与主页面一致
    const transition = document.startViewTransition(() => apply());
    await transition.finished;
  } else {
    await apply();
  }
}

// ===== Init: 液态玻璃 → 恢复主题 → 渲染预览 → 加载保存列表 → 统计 =====
(async function init() {
  if (window.liquidGlassFX) window.liquidGlassFX.init();
  restoreTheme();
  await renderPreview();
  renderSavesList();
  updateStats();
  renderOutline();
})();

/* ============================================================
   Backend Save / Load
   ============================================================ */

/** 手动保存 — 每次创建新文档，永不覆盖 */
async function saveDocument() {
  const content = dom.editor.value;
  if (!content.trim()) return toast('请先编写内容', 'warning');

  try {
    const res = await fetch(`${API}/api/saves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error('保存失败');
    const data = await res.json();
    currentSaveId = data.id;
    toast('已保存为新文档', 'success');
    if (document.getElementById('savesPanel').classList.contains('open')) {
      renderSavesList();
    }
  } catch (err) {
    toast('保存失败：' + err.message, 'error');
  }
}

/** 从服务器加载指定文档；如果是自动保存文件，加载后删除旧的自动保存 */
async function loadDocument(id, fromPanel = true) {
  try {
    const res = await fetch(`${API}/api/saves/${id}`);
    if (!res.ok) throw new Error('加载失败');
    const doc = await res.json();
    if (dom.editor.value.trim() && !confirm('当前内容将被覆盖，是否继续？')) return;
    dom.editor.value = doc.content;
    currentSaveId = doc.id;
    renderPreview();
    renderOutline();
    updateStats();

    if (id === AUTOSAVE_ID) {
      toast('已加载自动保存草稿', 'success');
    } else {
      toast(`已加载：${doc.title}`, 'success');
    }

    if (fromPanel) {
      closeSavesPanel();
      renderSavesList();
    }
  } catch (err) {
    toast('加载失败：' + err.message, 'error');
  }
}

/** 删除服务器上的保存 */
async function deleteSave(id, e) {
  if (e) e.stopPropagation();
  if (!confirm('确定删除此保存？')) return;
  try {
    await fetch(`${API}/api/saves/${id}`, { method: 'DELETE' });
    if (currentSaveId === id) currentSaveId = null;
    toast('已删除', 'info');
    renderSavesList();
  } catch {
    toast('删除失败', 'error');
  }
}

/** 刷新已保存文档面板 */
async function renderSavesList() {
  const container = document.getElementById('savesPanelBody');
  try {
    const res = await fetch(`${API}/api/saves`);
    const all = await res.json();

    // 分离自动保存和手动保存
    const autosave = all.find(d => d.id === AUTOSAVE_ID);
    const manual = all.filter(d => d.id !== AUTOSAVE_ID);

    if (!autosave && !manual.length) {
      container.innerHTML = '<div class="saves-empty">暂无保存的文档</div>';
      return;
    }

    let html = '';

    // 自动保存 — 始终置顶
    if (autosave) {
      const time = fmtTime(autosave.updatedAt);
      html += `
        <div class="save-card save-card-autosave" onclick="loadDocument('${AUTOSAVE_ID}')">
          <div class="save-card-icon">💾</div>
          <div class="save-card-info">
            <div class="save-card-title">${escHtml(autosave.title)}</div>
            <div class="save-card-meta">
              <span>${time}</span>
              <span class="save-card-badge">自动保存</span>
            </div>
          </div>
          <div class="save-card-actions">
            <button class="save-card-btn del" onclick="deleteSave('${AUTOSAVE_ID}', event)" title="删除">✕</button>
          </div>
        </div>`;
    }

    // 手动保存列表
    html += manual.map(d => {
      const time = fmtTime(d.updatedAt);
      return `
        <div class="save-card" onclick="loadDocument('${d.id}')">
          <div class="save-card-icon">📄</div>
          <div class="save-card-info">
            <div class="save-card-title">${escHtml(d.title)}</div>
            <div class="save-card-meta">${time}</div>
          </div>
          <div class="save-card-actions">
            <button class="save-card-btn load" onclick="event.stopPropagation(); loadDocument('${d.id}')" title="加载">📋</button>
            <button class="save-card-btn del" onclick="deleteSave('${d.id}', event)" title="删除">✕</button>
          </div>
        </div>`;
    }).join('');

    container.innerHTML = html;
  } catch {
    container.innerHTML = '<div class="saves-empty">加载失败</div>';
  }
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

let autosaveBusy = false;

/** 自动保存 — 先删旧的自动保存，再创建新的 */
async function autoSave() {
  if (autosaveBusy) return;  // 上一次保存还在进行中，跳过（下次编辑会再触发）
  const content = dom.editor.value;
  if (!content.trim()) return;

  autosaveBusy = true;
  try {
    // 删除旧的自动保存
    try { await fetch(`${API}/api/saves/${AUTOSAVE_ID}`, { method: 'DELETE' }); } catch {}

    // 创建新的自动保存
    const res = await fetch(`${API}/api/saves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: AUTOSAVE_ID, content }),
    });
    const data = await res.json();
    if (data.id) {
      currentSaveId = data.id;
      if (document.getElementById('savesPanel').classList.contains('open')) {
        renderSavesList();
      }
    }
  } catch { /* 静默失败 */ }
  autosaveBusy = false;
}

/* ============================================================
   Saves Panel — 侧边抽屉开关
   ============================================================ */
function openSavesPanel() {
  document.getElementById('savesOverlay').classList.add('open');
  document.getElementById('savesPanel').classList.add('open');
  renderSavesList();
}
function closeSavesPanel() {
  document.getElementById('savesOverlay').classList.remove('open');
  document.getElementById('savesPanel').classList.remove('open');
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ============================================================
   Drag & Drop / File Upload
   ============================================================ */
dom.dropZone.addEventListener('click', () => dom.fileInput.click());

dom.fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

['dragenter', 'dragover'].forEach(evt => {
  dom.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dom.dropZone.classList.add('drag-over');
  });
});

['dragleave', 'drop'].forEach(evt => {
  dom.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dom.dropZone.classList.remove('drag-over');
  });
});

dom.dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

// Also allow dropping on the entire page
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  // Only handle if not already handled by dropzone
  if (e.target.closest('#dropZone')) return;
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['docx', 'doc', 'pdf', 'txt', 'md', 'markdown'].includes(ext)) {
    toast('支持 .docx / .pdf / .txt / .md 文件', 'error');
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    toast('文件大小不能超过 50MB', 'error');
    return;
  }

  toast('正在转换文件 …', 'info');

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res = await fetch(`${API}/api/convert-to-markdown`, { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '服务器错误');
    }
    const data = await res.json();
    dom.editor.value = data.markdown;
    renderPreview();
    renderOutline();
    updateStats();
    currentSaveId = null;
    autoSave();

    currentFileName = data.filename;
    dom.fileName.textContent = currentFileName;
    dom.fileInfo.classList.add('visible');
    dom.fileInfo.style.display = 'flex';

    toast(`${file.name} 转换完成`, 'success');
  } catch (err) {
    toast(`转换失败：${err.message}`, 'error');
  }

  dom.fileInput.value = '';
}

/* ============================================================
   Export Actions
   ============================================================ */

/** 是否运行在 Tauri（有原生对话框与文件能力） */
const inTauri = () => typeof window.__TAURI__ !== 'undefined';

/** Tauri：弹出原生「另存为」对话框，返回用户选择的路径（取消返回 null） */
async function saveViaDialog(defaultName) {
  if (!inTauri()) return null;
  try {
    const result = await window.__TAURI__.dialog.save({ defaultPath: defaultName });
    return result || null;
  } catch {
    return null;
  }
}

/** Download the current markdown as .md file */
async function downloadMD() {
  const md = dom.editor.value;
  if (!md.trim()) return toast('请先编写内容', 'warning');

  if (inTauri()) {
    const dest = await saveViaDialog('document.md');
    if (!dest) return;
    try {
      await window.__TAURI__.core.invoke('write_text_file', { path: dest, content: md });
      toast(`已保存到 ${dest}`, 'success');
    } catch (err) {
      toast(`保存失败：${err}`, 'error');
    }
    return;
  }

  downloadBlob(md, 'document.md', 'text/markdown;charset=utf-8');
  toast('Markdown 文件已下载', 'success');
}

/** Convert Markdown → Word (.doc) */
async function convertToWord() {
  const md = dom.editor.value;
  if (!md.trim()) return toast('请先编写内容', 'warning');

  toast('正在生成 Word 文档 …', 'info');

  try {
    const res = await fetch(`${API}/api/convert-to-word`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: md }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '转换失败');
    }
    const data = await res.json();

    // Tauri：原生「另存为」对话框选择保存位置
    if (inTauri()) {
      const dest = await saveViaDialog(data.filename || 'converted.doc');
      if (!dest) return;
      try {
        const dir = await window.__TAURI__.core.invoke('uploads_dir');
        await window.__TAURI__.core.invoke('copy_export_file', {
          src: `${dir}/${data.filename}`,
          dest,
        });
        toast(`已保存到 ${dest}`, 'success');
      } catch (err) {
        toast(`Word 导出失败：${err}`, 'error');
      }
      return;
    }

    // Trigger download（浏览器回退）
    const a = document.createElement('a');
    a.href = data.downloadUrl;
    a.download = 'converted.doc';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    toast('Word 文档已下载', 'success');
  } catch (err) {
    toast(`Word 导出失败：${err.message}`, 'error');
  }
}

/** Convert Markdown → PDF via print dialog */
async function convertToPDF() {
  const md = dom.editor.value;
  if (!md.trim()) return toast('请先编写内容', 'warning');

  toast('正在准备打印页 …', 'info');

  try {
    const res = await fetch(`${API}/api/convert-to-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: md }),
    });
    if (!res.ok) throw new Error('服务器错误');

    const data = await res.json();

    // Tauri：原生「另存为」对话框保存打印页 HTML
    if (inTauri()) {
      const dest = await saveViaDialog(data.filename || 'print-pdf.html');
      if (!dest) return;
      try {
        const dir = await window.__TAURI__.core.invoke('uploads_dir');
        await window.__TAURI__.core.invoke('copy_export_file', {
          src: `${dir}/${data.filename}`,
          dest,
        });
        toast(`已保存打印页到 ${dest}，用浏览器打开后 Ctrl+P 可另存为 PDF`, 'success');
      } catch (err) {
        toast(`PDF 导出失败：${err}`, 'error');
      }
      return;
    }

    const win = window.open(data.downloadUrl, '_blank');

    if (!win) {
      // Popup blocked — fallback to direct download
      const a = document.createElement('a');
      a.href = data.downloadUrl;
      a.download = 'print-pdf.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast('HTML 已下载，用浏览器打开后 Ctrl+P 打印为 PDF', 'success');
    } else {
      toast('在打印对话框中选择「另存为 PDF」即可', 'success');
    }
  } catch {
    // Fallback: direct client-side print
    try {
      const res = await fetch(`${API}/api/markdown-to-print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: md }),
      });
      if (res.ok) {
        const html = await res.text();
        const win = window.open('', '_blank');
        if (win) {
          win.document.write(html);
          win.document.close();
        } else {
          toast('请允许弹窗后重试', 'error');
        }
      }
    } catch {
      toast('PDF 导出失败', 'error');
    }
  }
}

/* ============================================================
   Clear / Insert
   ============================================================ */
function clearAll() {
  if (dom.editor.value.trim() && !confirm('确定要清空编辑器内容吗？')) return;

  dom.editor.value = '';
  currentSaveId = null;
  renderPreview();
  renderOutline();
  updateStats();
  autoSave();
  clearFileInfo();
  toast('已清空', 'info', 1500);
}

function clearFileInfo() {
  currentFileName = null;
  dom.fileInfo.style.display = 'none';
  dom.fileInfo.classList.remove('visible');
}

function insertSample() {
  dom.editor.value = sampleMarkdown();
  renderPreview();
  renderOutline();
  updateStats();
  autoSave();
  toast('示例文本已插入', 'success');
}

function sampleMarkdown() {
  return `# Markdown 编辑器 Pro

## 欢迎使用 🎉

这是一个功能丰富的 **Markdown 在线编辑器**，支持：

- 📝 实时分屏预览
- 📥 拖放导入 Word / PDF
- 📤 一键导出 Word / PDF
- 🌓 深色 / 浅色主题

---

## 文本格式化

**粗体文本**、*斜体文本*、~~删除线~~、\`行内代码\`

## 代码块

\`\`\`javascript
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
console.log(fibonacci(10)); // → 55
\`\`\`

\`\`\`python
def greet(name):
    """向用户问好"""
    return f"你好，{name}！欢迎使用 Markdown 编辑器。"

print(greet("世界"))
\`\`\`

## 表格

| 功能 | 状态 | 说明 |
|:---|:---:|:---|
| Word → Markdown | ✅ | 支持 .docx |
| PDF → Markdown | ✅ | 文本提取 |
| Markdown → Word | ✅ | .doc 格式 |
| Markdown → PDF | ✅ | 打印导出 |
| 拖放导入 | ✅ | 全页面支持 |
| 自动保存 | ✅ | localStorage |

## 引用

> Markdown 是一种轻量级标记语言，创始人为 John Gruber。
> 它允许人们使用易读易写的纯文本格式编写文档，
> 然后转换成有效的 XHTML（或 HTML）文档。

## 任务列表

- [x] 核心编辑器功能
- [x] 文件格式转换
- [x] 深色/浅色主题
- [x] 自动保存恢复
- [ ] 多标签页支持
- [ ] 在线协作编辑

---

> 💡 **提示**：拖放 .docx 或 .pdf 文件到页面任意位置即可导入！
`;
}

/* ============================================================
   Formatting Toolbar
   ============================================================ */
function getSelection() {
  const el = dom.editor;
  return { start: el.selectionStart, end: el.selectionEnd, text: el.value.substring(el.selectionStart, el.selectionEnd) };
}
function replaceSelection(replacement, cursorOffset) {
  const el = dom.editor;
  const s = el.selectionStart, e = el.selectionEnd;
  el.value = el.value.substring(0, s) + replacement + el.value.substring(e);
  const pos = cursorOffset != null ? s + cursorOffset : s + replacement.length;
  el.selectionStart = el.selectionEnd = pos;
  el.focus();
  renderPreview(); autoSave();
}

function toolBold()           { const sel = getSelection(); replaceSelection('**' + (sel.text || '粗体') + '**', sel.text ? null : 2); }
function toolItalic()         { const sel = getSelection(); replaceSelection('*' + (sel.text || '斜体') + '*', sel.text ? null : 1); }
function toolStrikethrough()  { const sel = getSelection(); replaceSelection('~~' + (sel.text || '删除线') + '~~', sel.text ? null : 2); }
function toolHeading(level)   {
  const lineStart = dom.editor.value.lastIndexOf('\n', dom.editor.selectionStart - 1) + 1;
  const lineEnd = dom.editor.value.indexOf('\n', dom.editor.selectionStart);
  const line = dom.editor.value.substring(lineStart, lineEnd === -1 ? dom.editor.value.length : lineEnd);
  const bare = line.replace(/^#{1,6}\s*/, '');
  dom.editor.value = dom.editor.value.substring(0, lineStart) + '#'.repeat(level) + ' ' + bare + dom.editor.value.substring(lineEnd === -1 ? dom.editor.value.length : lineEnd);
  dom.editor.selectionStart = dom.editor.selectionEnd = lineStart + level + 1 + bare.length;
  dom.editor.focus();
  renderPreview(); autoSave();
}
function toolLink()           { const sel = getSelection(); replaceSelection('[' + (sel.text || '链接文字') + '](url)', sel.text ? null : 1); }
function toolImage()          { const sel = getSelection(); replaceSelection('![' + (sel.text || '图片描述') + '](url)', sel.text ? null : 2); }
function toolCode()           { const sel = getSelection(); replaceSelection('`' + (sel.text || '代码') + '`', sel.text ? null : 1); }
function toolCodeBlock()      { const sel = getSelection(); replaceSelection('\n```\n' + (sel.text || '代码块') + '\n```\n', sel.text ? 1 : 1); }
function toolQuote()          { const sel = getSelection(); const prefix = '> '; replaceSelection(prefix + (sel.text || '引用文字'), sel.text ? null : 2); }
function toolList(prefix)     { const sel = getSelection(); replaceSelection(prefix + (sel.text || '列表项'), sel.text ? null : 2); }
function toolHorizontalRule() { replaceSelection('\n---\n', 1); }

/* ============================================================
   Outline / Table of Contents
   ============================================================ */
let outlineHeadings = [];

function renderOutline(immediate = false) {
  const doRender = () => {
    const md = dom.editor.value;
    const headings = [];
    const re = /^(#{1,4})\s+(.+)$/gm;
    let m;
    while ((m = re.exec(md)) !== null) {
      headings.push({ level: m[1].length, text: m[2].trim(), pos: m.index });
    }
    outlineHeadings = headings;
    const container = document.getElementById('outlineList');
    if (!headings.length) {
      container.innerHTML = '<div class="outline-empty">编写标题后自动生成</div>';
      return;
    }
    container.innerHTML = headings.map((h, i) =>
      `<div class="outline-item lvl-${h.level}" onclick="jumpToHeading(${i})" title="${escHtml(h.text)}">
        <span class="outline-marker">${'H' + h.level}</span>${escHtml(h.text)}
      </div>`
    ).join('');
  };

  if (immediate) {
    doRender();
  } else {
    clearTimeout(outlineTimeout);
    outlineTimeout = setTimeout(doRender, 300);
  }
}

// 每秒自动刷新大纲，防止事件遗漏导致不同步
setInterval(() => renderOutline(true), 1000);

function jumpToHeading(idx) {
  const h = outlineHeadings[idx];
  if (!h) return;

  // 编辑器跳到标题位置
  dom.editor.focus();
  dom.editor.setSelectionRange(h.pos, h.pos);
  const line = dom.editor.value.substring(0, h.pos).split('\n').length;
  const lh = 23;
  dom.editor.scrollTop = Math.max(0, (line - 3) * lh);

  // 预览跟随滚动
  scrollPreviewToHeading(h.text, h.level);
}

function scrollPreviewToHeading(text, level) {
  try {
    const iframeDoc = dom.preview.contentDocument || dom.preview.contentWindow.document;
    if (!iframeDoc) return;
    const all = iframeDoc.querySelectorAll('h1,h2,h3,h4');
    for (const el of all) {
      if (parseInt(el.tagName[1]) === level && el.textContent.trim() === text) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    // 模糊匹配：忽略标记符号
    const clean = text.replace(/[*_~`\[\]()]/g, '').trim();
    for (const el of all) {
      if (parseInt(el.tagName[1]) === level && el.textContent.trim().replace(/[*_~`\[\]()]/g, '').trim() === clean) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
  } catch { /* 跨域等问题静默忽略 */ }
}

/* ============================================================
   Word / Character Count
   ============================================================ */
function updateStats() {
  const text = dom.editor.value;
  const chars = text.length;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const words = chineseChars + (text.match(/[a-zA-Z0-9]+/g) || []).length; // 中文字 = 词，英文按空格分
  const readMin = Math.max(1, Math.ceil(words / 300)); // 300 字/分钟
  document.getElementById('wordCount').textContent = words + ' 词';
  document.getElementById('charCount').textContent = chars + ' 字符';
  document.getElementById('readTime').textContent = '~' + readMin + ' 分钟';
}

/* ============================================================
   Find & Replace
   ============================================================ */
function openFind() {
  document.getElementById('findBar').style.display = 'flex';
  document.getElementById('findInput').focus();
}
function closeFind() {
  document.getElementById('findBar').style.display = 'none';
  findMatches = [];
  findIdx = -1;
  document.getElementById('findCount').textContent = '';
}
function doFind() {
  const q = document.getElementById('findInput').value;
  findMatches = [];
  findIdx = -1;
  if (!q) { document.getElementById('findCount').textContent = ''; return; }
  const md = dom.editor.value;
  let idx = 0;
  while ((idx = md.indexOf(q, idx)) !== -1) { findMatches.push(idx); idx += q.length; }
  document.getElementById('findCount').textContent = findMatches.length ? findMatches.length + ' 个' : '无匹配';
  if (findMatches.length) findNext();
}
function findNext() {
  if (!findMatches.length) return;
  findIdx = (findIdx + 1) % findMatches.length;
  selectMatch();
}
function findPrev() {
  if (!findMatches.length) return;
  findIdx = (findIdx - 1 + findMatches.length) % findMatches.length;
  selectMatch();
}
function selectMatch() {
  const q = document.getElementById('findInput').value;
  dom.editor.focus();
  dom.editor.setSelectionRange(findMatches[findIdx], findMatches[findIdx] + q.length);
}
function doReplace() {
  if (!findMatches.length || findIdx < 0) return;
  const q = document.getElementById('findInput').value;
  const rep = document.getElementById('replaceInput').value;
  const md = dom.editor.value;
  const pos = findMatches[findIdx];
  dom.editor.value = md.substring(0, pos) + rep + md.substring(pos + q.length);
  dom.editor.setSelectionRange(pos, pos + rep.length);
  doFind();
  renderPreview(); autoSave();
}
function doReplaceAll() {
  const q = document.getElementById('findInput').value;
  if (!q) return;
  const rep = document.getElementById('replaceInput').value;
  const count = (dom.editor.value.match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  if (!count) { toast('无匹配项', 'warning'); return; }
  if (!confirm('确定替换全部 ' + count + ' 处？')) return;
  dom.editor.value = dom.editor.value.split(q).join(rep);
  closeFind();
  renderPreview(); autoSave();
  toast('已替换 ' + count + ' 处', 'success');
}

/* ============================================================
   Keyboard Shortcuts
   ============================================================ */
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  // Ctrl+S → Save to server
  if (mod && e.key === 's') {
    e.preventDefault();
    saveDocument();
    return;
  }

  // Ctrl+F → Find
  if (mod && e.key === 'f') {
    e.preventDefault();
    openFind();
    return;
  }

  // Escape → Close find bar
  if (e.key === 'Escape') { closeFind(); }

  // Only in editor mode (unless it's find bar focused)
  if (document.activeElement !== dom.editor) return;

  // Ctrl+B → Bold
  if (mod && e.key === 'b') {
    e.preventDefault();
    toolBold();
  }

  // Ctrl+I → Italic
  if (mod && e.key === 'i') {
    e.preventDefault();
    toolItalic();
  }

  // Ctrl+K → Link
  if (mod && e.key === 'k') {
    e.preventDefault();
    toolLink();
  }

  // Ctrl+` → Inline code
  if (mod && e.key === '`') {
    e.preventDefault();
    toolCode();
  }

  // Tab → Indent with 2 spaces
  if (e.key === 'Tab') {
    e.preventDefault();
    insertAtCursor('  ');
    renderPreview();
    autoSave();
  }
});

function wrapSelection(before, after) {
  const el = dom.editor;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const text = el.value.substring(start, end);
  const replacement = before + text + after;
  el.value = el.value.substring(0, start) + replacement + el.value.substring(end);
  el.selectionStart = start + before.length;
  el.selectionEnd = end + before.length;
  el.focus();
  renderPreview();
  autoSave();
}

function insertAtCursor(str) {
  const el = dom.editor;
  const start = el.selectionStart;
  el.value = el.value.substring(0, start) + str + el.value.substring(el.selectionEnd);
  el.selectionStart = el.selectionEnd = start + str.length;
  el.focus();
}

/* ============================================================
   Utility
   ============================================================ */
function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================================================
   Init
   ============================================================ */
console.log('%c📝 Markdown Editor Pro %c已就绪',
  'font-weight:bold;color:#5b7cff;', 'color:#a78bfa;');
console.log('  %cCtrl+S%c  —  保存到服务器', 'font-weight:bold;', '');
console.log('  %cCtrl+B%c  —  粗体',  'font-weight:bold;', '');
console.log('  %cCtrl+I%c  —  斜体',  'font-weight:bold;', '');
console.log('  %cCtrl+K%c  —  插入链接', 'font-weight:bold;', '');
console.log('  %cCtrl+`%c  —  行内代码', 'font-weight:bold;', '');
console.log('  %cTab%c    —  缩进',   'font-weight:bold;', '');
