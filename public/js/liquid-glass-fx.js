/**
 * Liquid Glass FX — SVG feDisplacementMap 液态玻璃滤镜管线
 * ================================================================
 * 基于 Shu Ding 的 liquid-glass 思路，用 feTurbulence 噪声
 * 驱动 feDisplacementMap 产生有机的折射扭曲效果，而非纯模糊。
 *
 * 效果分层：
 *   1. 底层 — 弱模糊 + 饱和度提升（磨砂基底）
 *   2. 中层 — feDisplacementMap 折射扭曲（液态感来源）
 *   3. 顶层 — 微对比度增强（玻璃边缘高光）
 */

(function () {
  'use strict';

  const FILTER_ID = 'liquid-glass-fx';
  let svg = null;
  let orbEls = [];
  let raf = 0;
  let mouseX = 0.5, mouseY = 0.5;
  let tx = 0.5, ty = 0.5;

  /**
   * 构建 SVG 滤镜定义
   */
  function createSVGFilter() {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:0;';

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // --- 滤镜 1: 液态玻璃（侧边栏 / 顶栏） ---
    const f1 = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    f1.setAttribute('id', FILTER_ID);
    f1.setAttribute('filterUnits', 'userSpaceOnUse');
    f1.setAttribute('color-interpolation-filters', 'sRGB');
    f1.setAttribute('x', '0');
    f1.setAttribute('y', '0');
    f1.setAttribute('width', '100%');
    f1.setAttribute('height', '100%');

    // 噪声源 — 模拟玻璃内部的微小折射不均匀
    const turbulence = document.createElementNS('http://www.w3.org/2000/svg', 'feTurbulence');
    turbulence.setAttribute('type', 'fractalNoise');
    turbulence.setAttribute('baseFrequency', '0.012 0.018');
    turbulence.setAttribute('numOctaves', '4');
    turbulence.setAttribute('seed', '3');
    turbulence.setAttribute('result', 'noise');

    // 衰减噪声强度（只保留微弱分量做折射）
    const colorMatrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
    colorMatrix.setAttribute('type', 'matrix');
    colorMatrix.setAttribute('in', 'noise');
    colorMatrix.setAttribute('result', 'softNoise');
    // R,G 通道系数 = 0.12  → 折射强度约 12% 噪声幅值
    colorMatrix.setAttribute('values',
      '0.12 0 0 0 0 ' +
      '0 0.12 0 0 0 ' +
      '0 0 0 0 0 ' +
      '0 0 0 0.5 0');

    // 位移映射 — 用 R/G 通道驱动 X/Y 偏移
    const displacement = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    displacement.setAttribute('in', 'SourceGraphic');
    displacement.setAttribute('in2', 'softNoise');
    displacement.setAttribute('scale', '6');
    displacement.setAttribute('xChannelSelector', 'R');
    displacement.setAttribute('yChannelSelector', 'G');
    displacement.setAttribute('result', 'displaced');

    // 很轻微的模糊叠加（让扭曲后的图像柔和一些）
    const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    blur.setAttribute('in', 'displaced');
    blur.setAttribute('stdDeviation', '0.4');
    blur.setAttribute('result', 'blurred');

    // 增强对比度 → 玻璃透亮感
    const contrast = document.createElementNS('http://www.w3.org/2000/svg', 'feComponentTransfer');
    contrast.setAttribute('in', 'blurred');
    const feFuncR = document.createElementNS('http://www.w3.org/2000/svg', 'feFuncR');
    feFuncR.setAttribute('type', 'linear');
    feFuncR.setAttribute('slope', '1.04');
    feFuncR.setAttribute('intercept', '-0.01');
    const feFuncG = document.createElementNS('http://www.w3.org/2000/svg', 'feFuncG');
    feFuncG.setAttribute('type', 'linear');
    feFuncG.setAttribute('slope', '1.04');
    feFuncG.setAttribute('intercept', '-0.01');
    const feFuncB = document.createElementNS('http://www.w3.org/2000/svg', 'feFuncB');
    feFuncB.setAttribute('type', 'linear');
    feFuncB.setAttribute('slope', '1.04');
    feFuncB.setAttribute('intercept', '-0.01');
    contrast.appendChild(feFuncR);
    contrast.appendChild(feFuncG);
    contrast.appendChild(feFuncB);

    f1.appendChild(turbulence);
    f1.appendChild(colorMatrix);
    f1.appendChild(displacement);
    f1.appendChild(blur);
    f1.appendChild(contrast);

    // --- 滤镜 2: 轻量版（标签栏等薄玻璃） ---
    const f2 = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    f2.setAttribute('id', FILTER_ID + '-light');
    f2.setAttribute('filterUnits', 'userSpaceOnUse');
    f2.setAttribute('color-interpolation-filters', 'sRGB');
    f2.setAttribute('x', '0');
    f2.setAttribute('y', '0');
    f2.setAttribute('width', '100%');
    f2.setAttribute('height', '100%');

    const turb2 = document.createElementNS('http://www.w3.org/2000/svg', 'feTurbulence');
    turb2.setAttribute('type', 'fractalNoise');
    turb2.setAttribute('baseFrequency', '0.02');
    turb2.setAttribute('numOctaves', '2');
    turb2.setAttribute('seed', '7');
    turb2.setAttribute('result', 'noise');

    const cm2 = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
    cm2.setAttribute('type', 'matrix');
    cm2.setAttribute('in', 'noise');
    cm2.setAttribute('result', 'softNoise');
    cm2.setAttribute('values',
      '0.06 0 0 0 0 ' +
      '0 0.06 0 0 0 ' +
      '0 0 0 0 0 ' +
      '0 0 0 0.5 0');

    const disp2 = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    disp2.setAttribute('in', 'SourceGraphic');
    disp2.setAttribute('in2', 'softNoise');
    disp2.setAttribute('scale', '3');
    disp2.setAttribute('xChannelSelector', 'R');
    disp2.setAttribute('yChannelSelector', 'G');

    f2.appendChild(turb2);
    f2.appendChild(cm2);
    f2.appendChild(disp2);

    defs.appendChild(f1);
    defs.appendChild(f2);
    svg.appendChild(defs);
    document.body.prepend(svg);
  }

  /**
   * 初始化环境光球 — 鼠标跟踪产生微妙的视差偏移
   */
  function initOrbTracking() {
    orbEls = Array.from(document.querySelectorAll('.bg-orb'));
  }

  function updateOrbs() {
    const dx = (tx - 0.5) * 30;
    const dy = (ty - 0.5) * 30;
    if (orbEls[0]) orbEls[0].style.transform = `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(1.02)`;
    if (orbEls[1]) orbEls[1].style.transform = `translate(${-dx * 0.4}px, ${-dy * 0.4}px) scale(1.01)`;
    if (orbEls[2]) orbEls[2].style.transform = `translate(${dx * 0.3}px, ${-dy * 0.5}px) scale(1.03)`;
  }

  function onMouseMove(e) {
    mouseX = e.clientX / window.innerWidth;
    mouseY = e.clientY / window.innerHeight;
  }

  function tick() {
    raf = 0;
    // 平滑跟随
    tx += (mouseX - tx) * 0.04;
    ty += (mouseY - ty) * 0.04;
    updateOrbs();
    scheduleTick();
  }

  function scheduleTick() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  /**
   * 公开 API
   */
  function init() {
    createSVGFilter();
    initOrbTracking();
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    scheduleTick();
    console.log('%c💎 液态玻璃滤镜 %c已激活',
      'color:#a78bfa;font-weight:bold;', 'color:inherit;');
  }

  function destroy() {
    if (raf) cancelAnimationFrame(raf);
    document.removeEventListener('mousemove', onMouseMove);
    if (svg) svg.remove();
    svg = null;
    orbEls = [];
  }

  // 暴露到全局
  window.liquidGlassFX = { init, destroy };
})();
