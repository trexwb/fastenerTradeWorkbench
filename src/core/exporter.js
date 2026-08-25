// exporter.js — Excel 导出引擎（基于 xlsx-js-style，SheetJS 0.18.5 样式版 fork）
// 不依赖任何构建工具，动态加载 xlsx-js-style 后生成真实 .xlsx 文件
// 加载策略：本地 js/vendor/ 优先（离线可用），CDN 兜底
// 依赖顺序：cpexcel.js（代码页表）→ xlsx.min.js（主库，检测到 cptable 后启用完整编码支持）

/* =========================================================
   SheetJS 动态加载（延迟到首次调用，确保纯 file:// 可用）
   ========================================================= */
// 注意：不声明 let/var XLSX，因为脚本内部已用 var XLSX 声明了全局变量。
// 若重复声明会触发 "Identifier 'XLSX' has already been declared" 错误。
// 直接使用 window.XLSX 判断和引用。

var _xlsxLoading = null; // 防止并发重复加载

// xlsx-js-style 是 SheetJS 0.18.5 的「支持样式写入」fork，仍暴露全局 window.XLSX
// （带 style_version 标记）。原 xlsx@0.18.5 社区版 write 端忽略单元格样式，
// 导致导出文件无边框/无底色，故改用此 fork 保证样式可写入。
// 本地化后离线可用，CDN 仅作兜底（网络可用且本地加载失败时）。
// cpexcel.js 提供完整代码页支持（多语言编码），xlsx.min.js 检测到全局 cptable 后自动启用。
// Vite public/vendor 目录（构建后 dist/vendor/，base: './' 下相对路径可用）
var _VENDOR = 'vendor/';
var _CDN = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/';
var _CPEXCEL_LOCAL = _VENDOR + 'cpexcel.js';
var _CPEXCEL_CDN  = _CDN + 'cpexcel.js';
var _XLSX_LOCAL   = _VENDOR + 'xlsx.min.js';
var _XLSX_CDN     = _CDN + 'xlsx.min.js';

/**
 * 动态加载 SheetJS 脚本，返回 Promise。
 * 加载顺序：cpexcel.js → xlsx.min.js（主库依赖 cptable 全局变量）。
 * 每个文件均本地优先、CDN 兜底。
 * 首次调用后缓存（window.XLSX 已存在则直接 resolve）。
 * @returns {Promise<void>} 加载完成后 resolve
 */
function loadXLSX() {
  if (window.XLSX && window.XLSX.style_version) return Promise.resolve();
  if (_xlsxLoading) return _xlsxLoading;
  _xlsxLoading = new Promise(function (resolve, reject) {
    // 若浏览器残留旧版 SheetJS（window.XLSX 已存在），xlsx-js-style 脚本内部
    // 检测到后不会覆盖全局。这里先清空，确保加载完成后全局是带样式支持的版本。
    try { window.XLSX = undefined; } catch (e) {}

    /**
     * 尝试从指定 URL 加载单个脚本标签
     * @param {string} src - 脚本 URL
     * @returns {Promise<void>} 加载成功 resolve，失败 reject
     */
    function loadScript(src) {
      return new Promise(function (res, rej) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = function () { res(); };
        s.onerror = function () { rej(new Error('加载失败: ' + src)); };
        document.head.appendChild(s);
      });
    }

    /**
     * 加载单个文件：本地优先 → CDN 兜底
     * @param {string} localSrc - 本地路径
     * @param {string} cdnSrc   - CDN 路径
     * @returns {Promise<void>}
     */
    function loadFileWithFallback(localSrc, cdnSrc) {
      return loadScript(localSrc).catch(function () {
        return loadScript(cdnSrc);
      });
    }

    // 1) 先加载 cpexcel.js（设置全局 cptable）
    loadFileWithFallback(_CPEXCEL_LOCAL, _CPEXCEL_CDN)
      .then(function () {
        // 2) 再加载 xlsx.min.js（检测到 cptable 后启用完整编码支持）
        return loadFileWithFallback(_XLSX_LOCAL, _XLSX_CDN);
      })
      .then(function () {
        if (window.XLSX && window.XLSX.style_version) {
          resolve();
        } else {
          _xlsxLoading = null;
          reject(new Error('SheetJS 样式版加载异常，请强制刷新（Cmd+Shift+R）后重试'));
        }
      })
      .catch(function () {
        _xlsxLoading = null;
        reject(new Error('SheetJS 加载失败（本地与 CDN 均不可用）'));
      });
  });
  return _xlsxLoading;
}

/* =========================================================
   单元格值格式化工具
   ========================================================= */
/**
 * 将值规范化为 Excel 单元格字符串（null/undefined → 空字符串）。
 * @param {*} v - 单元格原始值
 * @returns {string} 规范化后的字符串，空值返回 ''
 */
function ev(v) { return v == null ? '' : String(v); }

/* =========================================================
   Excel 下载入口
   ========================================================= */
/**
 * 将工作表对象转换为 Excel 文件并触发浏览器下载。
 * @param {Object} wb   - SheetJS 工作簿对象
 * @param {string} fname - 下载文件名（不含扩展名）
 * @returns {Promise<void>} 下载完成后 resolve
 */
function downloadWorkbook(wb, fname) {
  return new Promise(async function (resolve, reject) {
    var u8 = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    
    // 优先使用 File System Access API（Chrome 86+，file:// 也支持）
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        var handle = await window.showSaveFilePicker({
          suggestedName: fname + '.xlsx',
          types: [{
            description: 'Excel 文件',
            accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }
          }]
        });
        var writable = await handle.createWritable();
        await writable.write(u8);
        await writable.close();
        toast('已保存到：' + handle.name, 'success');
        resolve();
        return;
      } catch (err) {
        // 用户取消或其他错误，回退到传统下载方式
        if (err.name !== 'AbortError') {
          console.log('[exporter] showSaveFilePicker 失败，回退到传统下载:', err);
        }
      }
    }
    
    // 回退：传统 <a download> 方式（http(s):// 有效，file:// 可能失败）
    var blob = new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fname + '.xlsx';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      resolve();
    }, 300);
  });
}

/* =========================================================
   导出入口（按订单状态分发）
   ========================================================= */
/**
 * 导出采购订单为 Excel 文件。
 * @param {string} orderId - 订单 ID
 * @returns {Promise<void>} 导出完成后 resolve，失败 toast 提示
 */
async function exportOrder(orderId) {
  var o = DB.orders.find(function (x) { return x.id === orderId; });
  if (!o) { toast('未找到订单', 'error'); return; }
  try {
    await loadXLSX();
    switch (o.status) {
      case '待确认':  await _exportOrderPendingConfirm(o); break;
      case '寻货中':  await _exportOrderSourcing(o); break;
      case '报价中':
      case '未成交':  await _exportOrderQuoting(o); break;
      case '签约完成': await _exportOrderSignedComplete(o); break;
      case '送货中':  await _exportOrderDelivering(o); break;
      case '完成':    await _exportOrderDelivering(o); break;
      default:        await _exportOrderGeneral(o); break;
    }
  } catch (err) {
    console.log('[exporter] 导出异常:', err);
    toast('导出失败：' + err.message, 'error');
  }
}

/* =========================================================
   Excel 导出全局样式常量（所有状态共享，保持视觉统一）
   ========================================================= */
var _BD = { top: 'thin', left: 'thin', right: 'thin', bottom: 'thin' }; // 四边细线边框
var _FONT = '微软雅黑'; // 统一中文字体，Excel/WPS 默认渲染更美观

/* =========================================================
   共享样式表（六个导出函数公共部分，独有样式留在各函数内定义）
   ========================================================= */
var _SS_COMMON = {
  pageTitle: { t: 's', font: { name: _FONT, bold: true, color: 'FFFFFF', sz: 18 }, fill: { fgColor: '1F4E79' }, align: 'center', vertical: 'center', border: _BD },
  subtitle:  { t: 's', font: { name: _FONT, bold: true, color: 'FFFFFF', sz: 12 }, fill: { fgColor: '2E75B6' }, align: 'center', vertical: 'center', wrapText: true, border: _BD },
  th:        { t: 's', font: { name: _FONT, bold: true, color: 'FFFFFF', sz: 11 }, fill: { fgColor: '4472C4' }, align: 'center', vertical: 'center', wrapText: true, border: _BD },
  even:      { t: 's', font: { name: _FONT, sz: 11 }, fill: { fgColor: 'F2F7FB' }, vertical: 'center', wrapText: true, border: _BD },
  odd:       { t: 's', font: { name: _FONT, sz: 11 }, fill: { fgColor: 'FFFFFF' }, vertical: 'center', wrapText: true, border: _BD },
  evenN:     { t: 'n', font: { name: _FONT, sz: 11 }, fill: { fgColor: 'F2F7FB' }, align: 'right', vertical: 'center', wrapText: true, border: _BD },
  oddN:      { t: 'n', font: { name: _FONT, sz: 11 }, fill: { fgColor: 'FFFFFF' }, align: 'right', vertical: 'center', wrapText: true, border: _BD },
  evenSum:   { t: 'n', font: { name: _FONT, bold: true, sz: 11 }, fill: { fgColor: 'E8F5E9' }, align: 'right', vertical: 'center', wrapText: true, border: _BD },
  oddSum:    { t: 'n', font: { name: _FONT, bold: true, sz: 11 }, fill: { fgColor: 'F5FBF6' }, align: 'right', vertical: 'center', wrapText: true, border: _BD },
  sumLbl:    { t: 's', font: { name: _FONT, bold: true, sz: 12 }, fill: { fgColor: 'D9E8F5' }, vertical: 'center', border: _BD },
  sumVal:    { t: 'n', font: { name: _FONT, bold: true, sz: 13 }, fill: { fgColor: 'D9E8F5' }, align: 'right', vertical: 'center', border: _BD },
  totalLbl:  { t: 's', font: { name: _FONT, bold: true, sz: 13, color: '1F4E79' }, fill: { fgColor: 'BDD7EE' }, vertical: 'center', border: _BD },
  totalVal:  { t: 'n', font: { name: _FONT, bold: true, sz: 13, color: '1F4E79' }, fill: { fgColor: 'BDD7EE' }, align: 'right', vertical: 'center', border: _BD },
  footer:    { t: 's', font: { name: _FONT, sz: 10, color: '6E7B8B' }, wrapText: true, border: _BD },
};


/* =========================================================
   自动列宽：按单元格内容计算每列最大显示宽度（增强版）
   ========================================================= */
/**
 * 遍历工作表 !ref 范围内所有单元格，按内容估算每列最合适的列宽。
 * - 中文字符按 2.1 宽度、全角标点/日文按 2、ASCII 按 1、数字连续段适当加权
 * - 表头（含换行符）额外加 1 列宽冗余，防止双行表头被挤
 * - 最小列宽 8（避免序号/小数字列窄到看不见），最大 45（避免长备注列占满屏幕）
 * - 数字列（纯数字单元格内容）额外 +2 留白保证千分位展示
 * @param {Object} ws - SheetJS 工作表对象
 * @param {number} totalCols - 列数
 */
var _MIN_COL_W = 8;
var _MAX_COL_W = 45;
var _COL_PAD = 3;      // 普通列留白
var _COL_PAD_NUM = 4;  // 数字列留白（给千分位/小数位）
var _COL_PAD_HDR = 2;  // 表头换行额外留白

function _autoFitCols(ws, totalCols) {
  var widths = new Array(totalCols).fill(0);
  var colHasNum = new Array(totalCols).fill(false);
  var colHasHdrWrap = new Array(totalCols).fill(false);

  // 收集合并单元格左上角：整行标题/分组不应撑大单列宽度，跳过其列宽计算
  var merged = {};
  (ws['!merges'] || []).forEach(function (m) { merged[m.s.r + ',' + m.s.c] = true; });

  var range = window.XLSX.utils.decode_range(ws['!ref']);
  for (var R = range.s.r; R <= range.e.r; R++) {
    for (var C = range.s.c; C <= range.e.c; C++) {
      if (merged[R + ',' + C]) continue;
      var cell = ws[window.XLSX.utils.encode_cell({ r: R, c: C })];
      if (!cell || cell.v == null || cell.v === '') continue;

      var text = String(cell.v);
      if (text.indexOf('\n') >= 0) colHasHdrWrap[C] = true;
      if (/^-?\d+(\.\d+)?$/.test(text.trim())) colHasNum[C] = true;

      var maxLen = 0;
      text.split('\n').forEach(function (ln) {
        var len = 0;
        for (var k = 0; k < ln.length; k++) {
          var code = ln.charCodeAt(k);
          // 中文/全角字符权重略大于 2，补偿 Excel 对 CJK 字形实际宽度
          if (code > 0x2E7F || (code >= 0x3000 && code <= 0x303F) || (code >= 0xFF00 && code <= 0xFFEF)) {
            len += 2.1;
          } else if (code > 255) {
            len += 2;
          } else {
            len += 1;
          }
        }
        if (len > maxLen) maxLen = len;
      });
      if (maxLen > widths[C]) widths[C] = maxLen;
    }
  }

  ws['!cols'] = widths.map(function (w, idx) {
    var pad = colHasNum[idx] ? _COL_PAD_NUM : _COL_PAD;
    if (colHasHdrWrap[idx]) pad += _COL_PAD_HDR;
    var target = w + pad;
    // 在最小/最大范围内约束，并对小列稍放宽（序号类最低 10）
    if (target < 10 && colHasNum[idx]) target = 10;
    return { wch: Math.min(Math.max(target, _MIN_COL_W), _MAX_COL_W) };
  });
}

/* =========================================================
   样式适配：平铺样式 → xlsx-js-style 的 cell.s 对象
   ========================================================= */
// 历史写法把 border/font/fill/align/wrapText 平铺在单元格上，但 SheetJS
// 社区版 write 端忽略这些属性，导致导出文件无边框/无底色。
// xlsx-js-style 要求样式集中在 cell.s 子对象中：
//   border 每边为 { style: 'thin' }，fill 需 patternType，
//   font.color / fill.fgColor 需 { rgb: 'FFxxxxxx' }，align/wrapText 归入 alignment。
/**
 * 将颜色值规范化为 SheetJS 支持的 ARGB 格式（#RGB → #AARRGGBB）。
 * @param {*} v - 颜色值（支持 #RRGGBB / RRGGBB / null）
 * @returns {string|null} 规范化后的 8 位 ARGB 色值（大写），无效返回 null
 */
function _normColor(v) {
  if (v == null) return null;
  var s = String(v).replace(/^#/, '');
  if (s.length === 6) s = 'FF' + s;
  return s.toUpperCase();
}
/**
 * 将平铺格式的样式描述对象转换为 xlsx-js-style 的 cell.s 结构。
 * @param {Object} style - 样式描述（border/font/fill/align/wrapText）
 * @returns {Object|null} SheetJS 格式的样式对象，无有效字段返回 null
 */
function _toStyleObj(style) {
  if (!style) return null;
  var s = {};
  if (style.border) {
    var bd = {};
    ['top', 'bottom', 'left', 'right'].forEach(function (side) {
      if (style.border[side]) bd[side] = { style: String(style.border[side]) };
    });
    if (Object.keys(bd).length) s.border = bd;
  }
  if (style.font) {
    var f = {};
    ['name', 'sz', 'bold', 'italic', 'underline'].forEach(function (k) {
      if (style.font[k] != null) f[k] = style.font[k];
    });
    var fc = _normColor(style.font.color);
    if (fc) f.color = { rgb: fc };
    if (Object.keys(f).length) s.font = f;
  }
  if (style.fill && style.fill.fgColor) {
    var fg = _normColor(style.fill.fgColor);
    if (fg) s.fill = { patternType: 'solid', fgColor: { rgb: fg } };
  }
  if (style.align || style.wrapText || style.vertical) {
    s.alignment = {};
    if (style.align) s.alignment.horizontal = style.align;
    if (style.wrapText) s.alignment.wrapText = true;
    if (style.vertical) s.alignment.vertical = style.vertical;
  }
  return Object.keys(s).length ? s : null;
}
/**
 * 向工作表指定地址写入带样式的单元格值。
 * @param {Object} ws - SheetJS 工作表对象
 * @param {string} addr - 单元格地址（如 'A1'）
 * @param {Object} style - 样式描述对象（可选）
 * @param {*} value - 单元格值
 * @returns {void}
 */
function _wc(ws, addr, style, value) {
  var cell = { v: value };
  if (style && style.t) cell.t = style.t;
  var so = _toStyleObj(style);
  if (so) cell.s = so;
  ws[addr] = cell;
}

/* =========================================================
   补全合并单元格边框
   ========================================================= */
/**
 * SheetJS 合并单元格时只给左上角写样式，导致合并块（标题/分组/
 * 汇总）的外框边框缺失。这里给合并区内所有格子补写四边细线边框，
 * 与范例 Excel 中每个格子 s="1"（四边 thin）的做法一致。
 * @param {Object} ws - SheetJS 工作表对象
 */
function _fillMergeBorders(ws) {
  var bd = { border: {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' }
  } };
  (ws['!merges'] || []).forEach(function (m) {
    for (var R = m.s.r; R <= m.e.r; R++) {
      for (var C = m.s.c; C <= m.e.c; C++) {
        var addr = window.XLSX.utils.encode_cell({ r: R, c: C });
        var cell = ws[addr];
        if (!cell) {
          ws[addr] = { t: 's', v: '', s: bd };
        } else if (!cell.s || !cell.s.border) {
          cell.s = Object.assign({}, cell.s || {}, bd);
        }
      }
    }
  });
}

/* =========================================================
   状态处理器 1：待确认
   ========================================================= */
/**
 * 生成「待确认」状态订单的 Excel 工作簿。
 * 定位：发给采购商确认产品明细（规格/属性/数量/意向价）。
 *
 * 工作表布局（三段）：
 *   【头部】   — 单号 / 采购商 / 对接人 / 项目 / 交期 / 状态 / 创建时间
 *   【产品明细表】 — 16列（A~P），核心确认区
 *   【汇总】   — 产品项数 / 意向总额
 *
 * 产品明细表列（A~P）：
 *   A  确认(□)  — 采购商打勾确认用（黄色底醒目标记）
 *   B  序号
 *   C  SKU
 *   D  品名
 *   E  规格描述（spec 字段，如 M8*20）
 *   F  类型（螺栓/螺母/...）
 *   G  标准（GB/T / DIN / ...）
 *   H  直径（M3/M4/...）
 *   I  材质（304/316L/...）
 *   J  硬度（8.8/10.9/...）
 *   K  表面处理（彩锌/镀镍/...）
 *   L  数量（千支）
 *   M  意向价（元/千支）
 *   N  小计（数量×意向价）
 *   O  确认数量（空列，供采购商填写调整后的数量）
 *   P  备注
 *
 * @param {Object} o - 订单对象
 * @returns {Promise<void>} 下载触发后 resolve
 */
async function _exportOrderPendingConfirm(o) {
  var wb = {};
  var ws = {};
  wb.SheetNames = ['产品确认单'];
  wb.Sheets     = { '产品确认单': ws };

  /* ============ 局部样式定义 ============ */
  var SS = Object.assign({}, _SS_COMMON, {
thChk:      { t: 's', font: { name: _FONT, bold: true, color: '7F6000', sz: 11 }, fill: { fgColor: 'FFD966' }, align: 'center', vertical: 'center', wrapText: true, border: _BD },
evenChk:{ t: 's', font: { name: _FONT, sz: 16 }, fill: { fgColor: 'FFF9E6' }, align: 'center', vertical: 'center', wrapText: true, border: _BD },
oddChk: { t: 's', font: { name: _FONT, sz: 16 }, fill: { fgColor: 'FFFDF2' }, align: 'center', vertical: 'center', wrapText: true, border: _BD }
});

  /* ============ 辅助函数 ============ */
  function dataStyle(ri, isNum) {
    if (isNum) return ri % 2 === 0 ? SS.evenN : SS.oddN;
    return ri % 2 === 0 ? SS.even : SS.odd;
  }
  function chkStyle(ri) { return ri % 2 === 0 ? SS.evenChk : SS.oddChk; }
  function sumStyle(ri) { return ri % 2 === 0 ? SS.evenSum : SS.oddSum; }

  /**
   * 写入单元格（把平铺样式适配为 xlsx-js-style 的 cell.s 后写入）
   */
  function wc(addr, style, value) { _wc(ws, addr, style, value); }

  /* ============ 数据准备 ============ */
  var TOTAL_COLS  = 16; // A~P
  var TOTAL_LETTER = 'P';
  var deliveryStr  = typeof o.delivery === 'object' ? (o.delivery.time || '') : (o.delivery || '');

  /* ===================== 第1段：头部信息 ===================== */

  // 第1行：页面大标题（跨全部列）
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: TOTAL_COLS - 1 } }];
  wc('A1', SS.pageTitle, '产品确认单');
  ws['!rows'] = [{ hpt: 44 }];

  // 第2行：副标题（单号 + 采购商 + 项目）
  ws['!merges'].push({ s: { r: 1, c: 0 }, e: { r: 1, c: TOTAL_COLS - 1 } });
  var subtitleText = ev(o.id) + '  |  ' + ev(pName(o.buyerId)) +
    (o.project ? '  |  项目：' + ev(o.project) : '');
  wc('A2', SS.subtitle, subtitleText);
  ws['!rows'].push({ hpt: 28 });

  // 第3行：分组标签（跨全部列）
  ws['!merges'].push({ s: { r: 2, c: 0 }, e: { r: 2, c: TOTAL_COLS - 1 } });
  wc('A3', SS.subtitle, '订单基本信息');
  ws['!rows'].push({ hpt: 26 });

  // 第4行：基本信息值（7个字段，两两配对）
  var infoFields = [
    { label: '单号',     val: ev(o.id),                        cs: 0,  ce: 1  },
    { label: '采购商',   val: ev(pName(o.buyerId)),            cs: 2,  ce: 3  },
    { label: '对接人',   val: ev(o.buyerContact || '-'),       cs: 4,  ce: 5  },
    { label: '项目',     val: ev(o.project || '-'),            cs: 6,  ce: 7  },
    { label: '交期日期', val: ev(deliveryStr || '-'),          cs: 8,  ce: 9  },
    { label: '状态',     val: ev(o.status),                    cs: 10, ce: 11 },
    { label: '创建时间', val: ev(o.createdAt || '-'),          cs: 12, ce: 13 },
  ];
  infoFields.forEach(function (f) {
    wc(window.XLSX.utils.encode_cell({ r: 3, c: f.cs }), SS.th, f.label);
    wc(window.XLSX.utils.encode_cell({ r: 3, c: f.ce }), SS.odd, f.val);
  });
  ws['!rows'].push({ hpt: 24 });

  // 备注行（如有）
  var dataStartRow = 5; // 产品明细起始行（1基）
  if (o.remark) {
    ws['!merges'].push({ s: { r: 4, c: 0 }, e: { r: 4, c: 1 } });
    wc('A5', SS.th, '备注');
    ws['!merges'].push({ s: { r: 4, c: 2 }, e: { r: 4, c: TOTAL_COLS - 1 } });
    wc('C5', SS.odd, ev(o.remark));
    ws['!rows'].push({ hpt: 24 });
    dataStartRow = 6;
  }

  /* ===================== 第2段：产品明细表 ===================== */
  var tableStartRow = dataStartRow;

  // 分组标题行（跨全部列）
  ws['!merges'].push({ s: { r: tableStartRow - 1, c: 0 }, e: { r: tableStartRow - 1, c: TOTAL_COLS - 1 } });
  wc('A' + tableStartRow, SS.subtitle,
    '产品明细（共 ' + o.items.length + ' 项，请逐项确认规格/数量/价格）');
  ws['!rows'].push({ hpt: 36 });

  // 表头行（16列）
  var hdrRow = tableStartRow + 1;
  var headers = [
    '确认\n(□)',          // A — 黄色底醒目标记
    '序号',               // B
    'SKU',                // C
    '品名',               // D
    '规格\n(如M8×25)',     // E
    '类型',               // F
    '标准',               // G
    '直径',               // H
    '材质',               // I
    '硬度',               // J
    '表面处理',           // K
    '数量\n(千支)',        // L
    '意向价\n(元/千支)',   // M
    '小计\n(元)',          // N
    '确认数量\n(千支)',    // O — 采购商填写调整量
    '备注',               // P
  ];
  headers.forEach(function (h, i) {
    var style = i === 0 ? SS.thChk : SS.th;
    wc(window.XLSX.utils.encode_cell({ r: hdrRow - 1, c: i }), style, h);
  });
  ws['!rows'].push({ hpt: 40 }); // 双行高容纳换行表头

  // 数据行
  var grandTotal = 0;
  o.items.forEach(function (it, i) {
    var ri       = i + 1;
    var qty      = parseFloat(it.qty) || 0;
    var price    = parseFloat(it.salePrice) || 0;
    var lineTotal = qty * price;
    grandTotal += lineTotal;
    var rowIdx = hdrRow + i + 1;

    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 0  }), chkStyle(ri), '□');                            // A：确认
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 1  }), dataStyle(ri, false), i + 1);                  // B：序号
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 2  }), dataStyle(ri, false), ev(it.sku || it.name || '')); // C：SKU
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 3  }), dataStyle(ri, false), ev(it.name || ''));       // D：品名
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 4  }), dataStyle(ri, false), ev(it.spec || ''));       // E：规格描述
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 5  }), dataStyle(ri, false), ev(it.type || ''));       // F：类型
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 6  }), dataStyle(ri, false), ev(it.standard || ''));    // G：标准
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 7  }), dataStyle(ri, false), ev(it.diameter || ''));   // H：直径
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 8  }), dataStyle(ri, false), ev(it.material || ''));   // I：材质
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 9  }), dataStyle(ri, false), ev(it.hardness || ''));    // J：硬度
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 10 }), dataStyle(ri, false), ev(it.surface || ''));     // K：表面处理
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 11 }), dataStyle(ri, true),  qty);                       // L：数量
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 12 }), dataStyle(ri, true),  price);                    // M：意向价
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 13 }), sumStyle(ri),         lineTotal);                 // N：小计
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 14 }), chkStyle(ri),         '');                       // O：确认数量（空）
    wc(window.XLSX.utils.encode_cell({ r: rowIdx - 1, c: 15 }), dataStyle(ri, false), ev(it.remark || ''));      // P：备注

    ws['!rows'].push({ hpt: 26 });
  });

  /* ===================== 第3段：汇总 ===================== */
  var sumRow = hdrRow + o.items.length + 1; // 空一行后汇总

  // 汇总分组标题（跨全部列）
  ws['!merges'].push({ s: { r: sumRow - 1, c: 0 }, e: { r: sumRow - 1, c: TOTAL_COLS - 1 } });
  wc('A' + sumRow, SS.subtitle, '汇总');
  ws['!rows'].push({ hpt: 26 });

  var sumDataRow = sumRow + 1;

  // 产品项数（左半，A~G=标签，H~I=数值）
  ws['!merges'].push({ s: { r: sumDataRow - 1, c: 0 }, e: { r: sumDataRow - 1, c: 6 } });
  wc('A' + sumDataRow, SS.sumLbl, '产品项数');
  ws['!merges'].push({ s: { r: sumDataRow - 1, c: 7 }, e: { r: sumDataRow - 1, c: 8 } });
  wc('H' + sumDataRow, SS.sumVal, o.items.length);

  // 意向总额（右半，J~M=标签，N~P=数值，深蓝醒目）
  ws['!merges'].push({ s: { r: sumDataRow - 1, c: 9  }, e: { r: sumDataRow - 1, c: 12 } });
  ws['!merges'].push({ s: { r: sumDataRow - 1, c: 13 }, e: { r: sumDataRow - 1, c: 15 } });
  wc('J' + sumDataRow, SS.totalLbl, '意向总额（元）');
  wc('N' + sumDataRow, SS.totalVal, grandTotal);
  ws['!rows'].push({ hpt: 32 });

  /* ===================== 页脚 ===================== */
  var footerRow = sumDataRow + 2;
  // 汇总与页脚之间的空行：必须写入行高记录，否则 !rows 数组比实际行少一行，
  // 导致页脚行高被写进空行、页脚行自身无行高（文字被裁）。
  ws['!rows'].push({ hpt: 8 });
  ws['!merges'].push({ s: { r: footerRow - 1, c: 0 }, e: { r: footerRow - 1, c: TOTAL_COLS - 1 } });
  wc('A' + footerRow, SS.footer,
    '请核对以上产品明细，如有调整请在「确认数量」列填写实际数量后回传  |  本文件由紧固件贸易工作台自动生成  |  导出时间：' + new Date().toLocaleString('zh-CN'));
  ws['!rows'].push({ hpt: 28 });

  /* ===================== !ref 范围（SheetJS 核心）===================== */
  ws['!ref'] = 'A1:' + TOTAL_LETTER + footerRow;

  /* ===================== 应用自动列宽 ===================== */
  _autoFitCols(ws, TOTAL_COLS);

  /* ===================== 补全合并单元格边框 ===================== */
  _fillMergeBorders(ws);

  /* ===================== 下载 ===================== */
  var fname = '采购订单_' + o.id + '_' + o.status;
  await downloadWorkbook(wb, fname);
  toast('导出成功：' + fname + '.xlsx', 'success');
}

/* =========================================================
   状态处理器 2：寻货中
   ========================================================= */
/**
 * 生成「寻货中」状态订单的 Excel 工作簿。
 * 定位：内部寻源决策分析 —— 看清哪些产品已寻到供应商、哪些还没有，
 *       对比供应商采购价与意向价的差异，评估利润空间，
 *       判断意向是否过低、是否需要继续寻找货源。
 *
 * 工作表布局（四段）：
 *   【头部】   — 单号 / 采购商 / 对接人 / 项目 / 交期 / 状态 / 创建时间
 *   【产品寻源进度表】 — 产品维度（16列 A~P），每产品一行
 *   【供应商报价对比表】 — 供应商维度（13列 A~M），每供应商一条
 *   【汇总与决策提示】 — 寻源完成度 + 金额汇总 + 是否继续寻源建议
 *
 * 产品寻源进度表列（A~P）：
 *   A 序号
 *   B SKU
 *   C 品名
 *   D 规格描述（spec 字段，如 M8*20）
 *   E 属性（类型·标准·直径·硬度·表面处理·材质）
 *   F 数量（千支）
 *   G 意向价（元/千支）
 *   H 报价（元/千支）
 *   I 已分配（千支）
 *   J 剩余（千支，未满量时黄色醒目标记）
 *   K 寻源状态（待寻源/部分寻源/已确认，颜色区分）
 *   L 供应商数
 *   M 加权采购价（元/千支）= 采购成本 ÷ 已分配量
 *   N 意向-采购差价（元/千支）= 意向价 − 加权采购价（负值红字）
 *   O 行利润（元，负值红字）
 *   P 利润率（对意向金额，负值红字）
 *
 * 供应商报价对比表列（A~M）：
 *   A 序号   B 产品   C 供应商   D 联系人   E 来源
 *   F 采购价（元/千支）   G 分配（千支）
 *   H 意向价（元/千支）  I 报价（元/千支）
 *   J 采购-意向差价（元/千支）= 采购价 − 意向价（>0 说明高于意向，红字）
 *   K 单位利润（元/千支）   L 行利润（元）
 *   M 库存/交期备注
 *
 * @param {Object} o - 订单对象
 * @returns {Promise<void>} 下载触发后 resolve
 */
async function _exportOrderSourcing(o) {
  const wb = {};
  const ws = {};
  wb.SheetNames = ['寻源进度单'];
  wb.Sheets = { '寻源进度单': ws };

  /* ============ 局部样式定义 ============ */
  var SS = Object.assign({}, _SS_COMMON, {
evenNeg:   { t: 'n', font: { name: _FONT, sz: 11, color: '9C0006' }, fill: { fgColor: 'F2F7FB' }, align: 'right', vertical: 'center', wrapText: true, border: _BD },
oddNeg:    { t: 'n', font: { name: _FONT, sz: 11, color: '9C0006' }, fill: { fgColor: 'FFFFFF' }, align: 'right', vertical: 'center', wrapText: true, border: _BD },
evenNegS:  { t: 's', font: { name: _FONT, sz: 11, color: '9C0006' }, fill: { fgColor: 'F2F7FB' }, align: 'right', vertical: 'center', wrapText: true, border: _BD },
oddNegS:   { t: 's', font: { name: _FONT, sz: 11, color: '9C0006' }, fill: { fgColor: 'FFFFFF' }, align: 'right', vertical: 'center', wrapText: true, border: _BD },
warnLbl:   { t: 's', font: { name: _FONT, bold: true, sz: 11, color: '9C0006' }, fill: { fgColor: 'FFC7CE' }, vertical: 'center', wrapText: true, border: _BD },
okLbl:     { t: 's', font: { name: _FONT, bold: true, sz: 11, color: '006100' }, fill: { fgColor: 'C6EFCE' }, vertical: 'center', wrapText: true, border: _BD },
remainEven:{ t: 'n', font: { name: _FONT, bold: true, sz: 11, color: '7F6000' }, fill: { fgColor: 'FFE699' }, align: 'right', vertical: 'center', border: _BD },
remainOdd: { t: 'n', font: { name: _FONT, bold: true, sz: 11, color: '7F6000' }, fill: { fgColor: 'FFF2CC' }, align: 'right', vertical: 'center', border: _BD }
});
  // 寻源状态专用样式（K 列）
  const SS_SRC = {
    '待寻源':   { t: 's', font: { name: _FONT, bold: true, sz: 11, color: '9C0006' }, fill: { fgColor: 'FFC7CE' }, align: 'center', vertical: 'center', wrapText: true, border: _BD },
    '部分寻源': { t: 's', font: { name: _FONT, bold: true, sz: 11, color: '7F6000' }, fill: { fgColor: 'FFE699' }, align: 'center', vertical: 'center', wrapText: true, border: _BD },
    '已确认':   { t: 's', font: { name: _FONT, bold: true, sz: 11, color: '006100' }, fill: { fgColor: 'C6EFCE' }, align: 'center', vertical: 'center', wrapText: true, border: _BD },
  };

  /* ============ 辅助函数 ============ */
  function dataStyle(ri, isNum) {
    if (isNum) return ri % 2 === 0 ? SS.evenN : SS.oddN;
    return ri % 2 === 0 ? SS.even : SS.odd;
  }
  function numStyle(ri, v) {
    if (v < 0) return ri % 2 === 0 ? SS.evenNeg : SS.oddNeg;
    return dataStyle(ri, true);
  }
  function sumStyle(ri) { return ri % 2 === 0 ? SS.evenSum : SS.oddSum; }
  function wc(addr, style, value) { _wc(ws, addr, style, value); }
  function put(r, c, style, value) { wc(window.XLSX.utils.encode_cell({ r, c }), style, value); }
  function merge(r, c1, c2) { ws['!merges'].push({ s: { r, c: c1 }, e: { r, c: c2 } }); }

  ws['!merges'] = [];
  ws['!rows'] = [];
  let row = 0; // 0 基当前行号
  function pushRow(hpt) { ws['!rows'].push(hpt ? { hpt } : {}); row++; }

  /* ============ 数据准备 ============ */
  const TOTAL_COLS = 16; // A~P
  const TOTAL_LETTER = 'P';
  const deliveryStr = typeof o.delivery === 'object' ? (o.delivery.time || '') : (o.delivery || '');

  // 产品维度寻源统计
  const itemStat = o.items.map((it) => {
    const opts = itemOpts(it);
    const allocSum = itemAllocSum(it);
    const qty = parseFloat(it.qty) || 0;
    const intent = parseFloat(it.salePrice) || 0;
    const quote = itemQuotePrice(it);
    const cost = opts.reduce((s, opt) => s + (opt.price || 0) * (opt.allocQty || 0), 0);
    const avgCost = allocSum > 0 ? cost / allocSum : 0;        // 加权采购价（元/千支）
    const intentDiff = intent - avgCost;                       // 意向价 − 采购价（元/千支）
    const lineProfit = itemProfit(it);                         // 行利润（元）
    const intentTotal = qty * intent;                          // 意向金额
    const profitRate = intentTotal > 0 ? (lineProfit / intentTotal) : null; // 利润率（对意向金额）
    const [srcTxt] = itemSourcingStatus(it);                   // 待寻源/部分寻源/已确认
    return { it, opts, allocSum, remain: Math.max(0, qty - allocSum), srcTxt, qty, intent, quote, cost, avgCost, intentDiff, lineProfit, intentTotal, profitRate };
  });
  // 供应商维度明细
  const supplierRows = [];
  o.items.forEach((it) => {
    const intent = parseFloat(it.salePrice) || 0;
    const quote = itemQuotePrice(it);
    itemOpts(it).forEach((opt) => {
      const price = parseFloat(opt.price) || 0;
      const allocQty = parseFloat(opt.allocQty) || 0;
      supplierRows.push({
        product: (it.sku || it.name || '') + (it.spec ? ' ' + it.spec : ''),
        name: pName(opt.supplierId),
        contact: opt.contact || '',
        source: opt.source === 'manual' ? '手动' : (opt.source === 'import' ? '导入' : '价格库'),
        price,
        allocQty,
        intent,
        quote,
        unitDiff: price - intent,          // 采购价 − 意向价（>0 表示采购价高于意向）
        unitProfit: quote - price,         // 报价 − 采购价
        lineProfit: (quote - price) * allocQty,
        stockNote: opt.stockNote || '',
      });
    });
  });

  /* ===================== 第1段：头部信息 ===================== */

  /* 大标题 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.pageTitle, '寻源进度单');
  pushRow(44);

  /* 副标题 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, ev(o.id) + '  |  ' + ev(pName(o.buyerId)) + (o.project ? '  |  项目：' + ev(o.project) : ''));
  pushRow(28);

  /* 分组标签：订单基本信息 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '订单基本信息');
  pushRow(26);

  /* 基本信息（7 字段两两配对） */
  const infoFields = [
    { label: '单号',     val: ev(o.id),                  cs: 0,  ce: 1  },
    { label: '采购商',   val: ev(pName(o.buyerId)),      cs: 2,  ce: 3  },
    { label: '对接人',   val: ev(o.buyerContact || '-'), cs: 4,  ce: 5  },
    { label: '项目',     val: ev(o.project || '-'),      cs: 6,  ce: 7  },
    { label: '交期日期', val: ev(deliveryStr || '-'),    cs: 8,  ce: 9  },
    { label: '状态',     val: ev(o.status),              cs: 10, ce: 11 },
    { label: '创建时间', val: ev(o.createdAt || '-'),    cs: 12, ce: 13 },
  ];
  infoFields.forEach((f) => {
    put(row, f.cs, SS.th, f.label);
    if (f.cs === 12) merge(row, 13, 14);
    put(row, f.ce, SS.odd, f.val);
  });
  pushRow(24);

  /* 备注行（如有） */
  if (o.remark) {
    put(row, 0, SS.th, '备注');
    merge(row, 1, TOTAL_COLS - 1);
    put(row, 1, SS.odd, ev(o.remark));
    pushRow(24);
  }

  /* 空行分隔 */
  pushRow(8);

  /* ===================== 第2段：产品寻源进度表 ===================== */

  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '产品寻源进度（共 ' + o.items.length + ' 项，已分配 ' + itemStat.filter((s) => s.opts.length).length + ' 项）');
  pushRow(36);

  const srcHeaders = [
    '序号', 'SKU', '品名', '规格\n(如M8×25)', '属性', '数量\n(千支)',
    '意向价\n(元/千支)', '报价\n(元/千支)', '已分配\n(千支)', '剩余\n(千支)',
    '寻源状态', '供应商\n数', '加权采购价\n(元/千支)',
    '意向-采购\n差价(元/千支)', '行利润\n(元)', '利润率\n(对意向)',
  ];
  srcHeaders.forEach((h, c) => { put(row, c, SS.th, h); });
  pushRow(40);

  itemStat.forEach((s, i) => {
    const ri = i + 1;
    put(row, 0,  dataStyle(ri, false), ri);
    put(row, 1,  dataStyle(ri, false), ev(s.it.sku || ''));
    put(row, 2,  dataStyle(ri, false), ev(s.it.name || ''));
    put(row, 3,  dataStyle(ri, false), ev(s.it.spec || ''));
    put(row, 4,  dataStyle(ri, false), specLabel(s.it));
    put(row, 5,  dataStyle(ri, true),  s.qty);
    put(row, 6,  dataStyle(ri, true),  s.intent);
    put(row, 7,  dataStyle(ri, true),  s.quote);
    put(row, 8,  dataStyle(ri, true),  s.allocSum);
    put(row, 9,  s.remain > 0 ? (ri % 2 === 0 ? SS.remainEven : SS.remainOdd) : dataStyle(ri, true), s.remain);
    put(row, 10, SS_SRC[s.srcTxt] || SS.th, s.srcTxt);
    put(row, 11, dataStyle(ri, true),  s.opts.length);
    put(row, 12, s.opts.length ? dataStyle(ri, true) : dataStyle(ri, false), s.opts.length ? (Math.round(s.avgCost * 100) / 100) : '-');
    put(row, 13, s.opts.length ? numStyle(ri, s.intentDiff) : dataStyle(ri, false), s.opts.length ? (Math.round(s.intentDiff * 100) / 100) : '-');
    put(row, 14, s.opts.length ? numStyle(ri, s.lineProfit) : dataStyle(ri, false), s.opts.length ? (Math.round(s.lineProfit * 100) / 100) : '-');
    // 利润率列：值为 'xx.x%' 字符串，必须用字符串样式（t:'n' 配字符串会写出非法 XML）
    put(row, 15, (s.opts.length && s.profitRate != null)
      ? ((s.profitRate < 0 ? (ri % 2 === 0 ? SS.evenNegS : SS.oddNegS) : dataStyle(ri, false)))
      : dataStyle(ri, false),
      (s.opts.length && s.profitRate != null) ? ((s.profitRate * 100).toFixed(1) + '%') : '-');
    pushRow(26); // 自动行高 → 显式 26pt，避免 WPS/Excel 不自动撑高导致文字被裁
  });

  /* ===================== 第3段：供应商报价对比表 ===================== */

  pushRow(8);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '供应商报价对比（共 ' + supplierRows.length + ' 条，采购价 vs 意向价）');
  pushRow(36);

  const supHeaders = [
    '序号', '产品', '供应商', '联系人', '来源', '采购价\n(元/千支)', '分配\n(千支)',
    '意向价\n(元/千支)', '报价\n(元/千支)', '采购-意向\n差价(元/千支)', '单位利润\n(元/千支)', '行利润\n(元)', '库存/交期备注',
  ];
  supHeaders.forEach((h, c) => { put(row, c, SS.th, h); });
  pushRow(40);

  supplierRows.forEach((r, i) => {
    const ri = i + 1;
    put(row, 0,  dataStyle(ri, false), ri);
    put(row, 1,  dataStyle(ri, false), ev(r.product));
    put(row, 2,  dataStyle(ri, false), ev(r.name));
    put(row, 3,  dataStyle(ri, false), ev(r.contact));
    put(row, 4,  dataStyle(ri, false), ev(r.source));
    put(row, 5,  dataStyle(ri, true),  r.price);
    put(row, 6,  dataStyle(ri, true),  r.allocQty);
    put(row, 7,  dataStyle(ri, true),  r.intent);
    put(row, 8,  dataStyle(ri, true),  r.quote);
    put(row, 9,  numStyle(ri, r.unitDiff), Math.round(r.unitDiff * 100) / 100);
    put(row, 10, numStyle(ri, r.unitProfit), Math.round(r.unitProfit * 100) / 100);
    put(row, 11, numStyle(ri, r.lineProfit), Math.round(r.lineProfit * 100) / 100);
    put(row, 12, dataStyle(ri, false), ev(r.stockNote));
    pushRow(26); // 自动行高 → 显式 26pt，避免 WPS/Excel 不自动撑高导致文字被裁
  });

  /* ===================== 第4段：汇总与决策提示 ===================== */

  pushRow(8);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '汇总');
  pushRow(26);

  // 寻源完成度：产品项数 / 已确认 / 部分寻源 / 待寻源
  const cntDone = itemStat.filter((s) => s.srcTxt === '已确认').length;
  const cntPart = itemStat.filter((s) => s.srcTxt === '部分寻源').length;
  const cntNone = itemStat.filter((s) => s.srcTxt === '待寻源').length;

  put(row, 0, SS.sumLbl, '产品项数'); merge(row, 1, 3); put(row, 1, SS.sumVal, o.items.length);
  put(row, 4, SS.sumLbl, '已确认');   merge(row, 5, 7); put(row, 5, SS.sumVal, cntDone);
  put(row, 8, SS.sumLbl, '部分寻源'); merge(row, 9, 11); put(row, 9, SS.sumVal, cntPart);
  put(row, 12, SS.sumLbl, '待寻源');  merge(row, 13, 15); put(row, 13, SS.sumVal, cntNone);
  pushRow(32);

  // 金额汇总：意向总额 / 采购成本总额 / 报价总额 / 预估利润
  const grandIntent = orderIntent(o);
  const grandCost = orderCost(o);
  const grandQuote = orderSales(o);
  const grandProfit = orderProfit(o);

  put(row, 0, SS.sumLbl, '意向总额（元）');  merge(row, 1, 3); put(row, 1, SS.sumVal, grandIntent);
  put(row, 4, SS.sumLbl, '采购成本（元）');  merge(row, 5, 7); put(row, 5, SS.sumVal, grandCost);
  put(row, 8, SS.sumLbl, '报价总额（元）');  merge(row, 9, 11); put(row, 9, SS.sumVal, grandQuote);
  put(row, 12, SS.totalLbl, '预估利润（元）'); merge(row, 13, 15); put(row, 13, SS.totalVal, grandProfit);
  pushRow(32);

  // 决策提示：待寻源 / 余量未满 / 意向低于采购价（利润不足）
  const noneList = itemStat.filter((s) => s.srcTxt === '待寻源').map((s) => s.it.sku || s.it.name || ('第' + (itemStat.indexOf(s) + 1) + '项'));
  const partRows = itemStat.filter((s) => s.srcTxt === '部分寻源');
  const remainSum = partRows.reduce((a, s) => a + s.remain, 0);
  const negRows = itemStat.filter((s) => s.lineProfit < 0);
  const lowIntentRows = itemStat.filter((s) => s.opts.length && s.intentDiff < 0);
  const hints = [];
  if (cntNone > 0) hints.push('仍有 ' + cntNone + ' 项产品未寻到供应商（' + noneList.slice(0, 3).join('、') + (noneList.length > 3 ? ' 等' : '') + '），建议继续寻源');
  if (partRows.length > 0) hints.push(partRows.length + ' 项产品仅部分寻源，剩余合计 ' + fmtN(remainSum) + ' 千支，建议继续寻源补足');
  if (lowIntentRows.length > 0) hints.push(lowIntentRows.length + ' 项产品意向价低于采购价，利润空间不足，建议调整意向价或继续比价');
  if (negRows.length > 0) hints.push(negRows.length + ' 项产品行利润为负（' + negRows.map((s) => s.it.sku || s.it.name || '').slice(0, 3).join('、') + (negRows.length > 3 ? ' 等' : '') + '），建议与采购商沟通调价或更换供应商');

  pushRow(8);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '决策提示');
  pushRow(26);

  if (hints.length) {
    hints.forEach((h, i) => {
      merge(row, 0, TOTAL_COLS - 1);
      put(row, 0, SS.warnLbl, '⚠ ' + h);
      pushRow(36);
    });
  } else {
    merge(row, 0, TOTAL_COLS - 1);
    put(row, 0, SS.okLbl, '✓ 所有产品已寻源且利润为正，可进入「报价中」');
    pushRow(36);
  }

  /* ===================== 页脚 ===================== */
  pushRow(10);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.footer, '差价 = 采购价 − 意向价（正数说明供应商价格高于意向） | 利润率 = 行利润 ÷ 意向金额 | 本文件由紧固件贸易工作台自动生成  |  导出时间：' + new Date().toLocaleString('zh-CN'));
  pushRow(28);

  /* !ref 范围与自动列宽 */
  ws['!ref'] = 'A1:' + TOTAL_LETTER + row;
  _autoFitCols(ws, TOTAL_COLS);

  /* 补全合并单元格边框 */
  _fillMergeBorders(ws);

  const fname = '采购订单_' + o.id + '_' + o.status;
  await downloadWorkbook(wb, fname);
  toast('导出成功：' + fname + '.xlsx', 'success');
}

/* =========================================================
   状态处理器 3：报价中
   ========================================================= */
/**
 * 生成「报价中」状态订单的 Excel 工作簿（未成交订单同样使用该报价单模板）。
 * 定位：报给采购商的正式报价单 —— 仅包含采购商可见的报价数据
 *       （品名 / 规格 / 数量 / 单价 / 金额），不包含任何内部数据。
 *
 * 工作表布局（三段）：
 *   【头部】   — 单号 / 采购商 / 对接人 / 项目 / 交期 / 状态 / 创建时间
 *   【产品明细报价表】 — 面向采购商的报价明细（8列 A~H）：序号 / SKU / 品名 / 规格 / 属性 / 数量 / 单价 / 金额
 *   【汇总】   — 产品项数 + 报价总额
 *
 * 说明：本报价单会发给采购商，已剔除内部字段（意向价、供应商名称/联系人、
 *       供应商报价/进价、分配量、采购成本、利润等），仅保留报价数据。
 *
 * 产品明细报价表列（A~H）：
 *   A 序号
 *   B SKU
 *   C 品名
 *   D 规格描述（spec 字段，如 M8×25）
 *   E 属性（类型·标准·直径·硬度·表面处理·材质）
 *   F 数量（千支）
 *   G 单价（元/千支，报给采购商的报价）
 *   H 金额（元）= 单价 × 数量
 *
 * @param {Object} o - 订单对象
 * @returns {Promise<void>} 下载触发后 resolve
 */
async function _exportOrderQuoting(o) {
  const wb = {};
  const ws = {};
  wb.SheetNames = ['报价中报价单'];
  wb.Sheets = { '报价中报价单': ws };

  /* ============ 局部样式定义 ============ */
  var SS = Object.assign({}, _SS_COMMON, {
warnLbl:   { t: 's', font: { name: _FONT, bold: true, sz: 11, color: '9C0006' }, fill: { fgColor: 'FFC7CE' }, vertical: 'center', wrapText: true, border: _BD },
okLbl:     { t: 's', font: { name: _FONT, bold: true, sz: 11, color: '006100' }, fill: { fgColor: 'C6EFCE' }, vertical: 'center', wrapText: true, border: _BD },
remainEven:{ t: 'n', font: { name: _FONT, bold: true, sz: 11, color: '7F6000' }, fill: { fgColor: 'FFE699' }, align: 'right', vertical: 'center', border: _BD },
remainOdd: { t: 'n', font: { name: _FONT, bold: true, sz: 11, color: '7F6000' }, fill: { fgColor: 'FFF2CC' }, align: 'right', vertical: 'center', border: _BD }
});
  // 满足状态专用样式（J 列）
  const SS_SAT = {
    '已满足': { t: 's', font: { name: _FONT, bold: true, sz: 11, color: '006100' }, fill: { fgColor: 'C6EFCE' }, align: 'center', vertical: 'center', wrapText: true, border: _BD },
    '未满足': { t: 's', font: { name: _FONT, bold: true, sz: 11, color: '9C0006' }, fill: { fgColor: 'FFC7CE' }, align: 'center', vertical: 'center', wrapText: true, border: _BD },
  };

  /* ============ 辅助函数 ============ */
  function dataStyle(ri, isNum) {
    if (isNum) return ri % 2 === 0 ? SS.evenN : SS.oddN;
    return ri % 2 === 0 ? SS.even : SS.odd;
  }
  function sumStyle(ri) { return ri % 2 === 0 ? SS.evenSum : SS.oddSum; }
  function wc(addr, style, value) { _wc(ws, addr, style, value); }
  function put(r, c, style, value) { wc(window.XLSX.utils.encode_cell({ r, c }), style, value); }
  function merge(r, c1, c2) { ws['!merges'].push({ s: { r, c: c1 }, e: { r, c: c2 } }); }
  function vmerge(r1, c1, r2, c2) { ws['!merges'].push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } }); }

  ws['!merges'] = [];
  ws['!rows'] = [];
  let row = 0; // 0 基当前行号
  function pushRow(hpt) { ws['!rows'].push(hpt ? { hpt } : {}); row++; }

  /* ============ 数据准备 ============ */
  const TOTAL_COLS = 8; // A~H
  const TOTAL_LETTER = 'H';
  const deliveryStr = typeof o.delivery === 'object' ? (o.delivery.time || '') : (o.delivery || '');

  // 产品组：每个产品一行，单价 = 报给采购商的最终报价（itemQuotePrice），金额 = 单价 × 数量
  const prodRows = o.items.map((it) => {
    const qty = parseFloat(it.qty) || 0;
    const quote = parseFloat(itemQuotePrice(it)) || 0;
    return { it, qty, quote, amount: Math.round(qty * quote * 100) / 100 };
  });

  /* ===================== 第1段：头部信息 ===================== */

  /* 大标题 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.pageTitle, '报价中报价单');
  pushRow(44);

  /* 副标题 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, ev(o.id) + '  |  ' + ev(pName(o.buyerId)) + (o.project ? '  |  项目：' + ev(o.project) : ''));
  pushRow(28);

  /* 分组标签：订单基本信息 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '订单基本信息');
  pushRow(26);

  /* 基本信息（8 列两行：单号/采购商/对接人/项目 + 交期/状态/创建时间） */
  const infoFieldsRow1 = [
    { label: '单号',     val: ev(o.id),                  cs: 0,  ce: 1  },
    { label: '采购商',   val: ev(pName(o.buyerId)),      cs: 2,  ce: 3  },
    { label: '对接人',   val: ev(o.buyerContact || '-'), cs: 4,  ce: 5  },
    { label: '项目',     val: ev(o.project || '-'),      cs: 6,  ce: 7  },
  ];
  const infoFieldsRow2 = [
    { label: '交期日期', val: ev(deliveryStr || '-'),    cs: 0,  ce: 1  },
    { label: '状态',     val: ev(o.status),              cs: 2,  ce: 3  },
    { label: '创建时间', val: ev(o.createdAt || '-'),    cs: 4,  ce: 5  },
  ];
  [infoFieldsRow1, infoFieldsRow2].forEach((fields) => {
    fields.forEach((f) => {
      put(row, f.cs, SS.th, f.label);
      if (f.label === '创建时间') merge(row, 5, TOTAL_COLS - 1);
      put(row, f.ce, SS.odd, f.val);
    });
    pushRow(24);
  });

  /* 备注行（如有） */
  if (o.remark) {
    put(row, 0, SS.th, '备注');
    merge(row, 1, TOTAL_COLS - 1);
    put(row, 1, SS.odd, ev(o.remark));
    pushRow(24);
  }

  /* 空行分隔 */
  pushRow(8);

  /* ===================== 第2段：产品明细报价表 ===================== */

  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '产品明细与报价（共 ' + o.items.length + ' 项产品）');
  pushRow(36);

  const pHeaders = [
    '序号', 'SKU', '品名', '规格\n(如M8×25)', '属性', '数量\n(千支)', '单价\n(元/千支)', '金额\n(元)',
  ];
  pHeaders.forEach((h, c) => { put(row, c, SS.th, h); });
  pushRow(40);

  prodRows.forEach((p, idx) => {
    const ri = idx + 1;
    put(row, 0, dataStyle(ri, false), ri);                       // A 序号
    put(row, 1, dataStyle(ri, false), ev(p.it.sku || ''));       // B SKU
    put(row, 2, dataStyle(ri, false), ev(p.it.name || ''));      // C 品名
    put(row, 3, dataStyle(ri, false), ev(p.it.spec || ''));      // D 规格
    put(row, 4, dataStyle(ri, false), specLabel(p.it));          // E 属性
    put(row, 5, dataStyle(ri, true),  p.qty);                    // F 数量
    put(row, 6, dataStyle(ri, true),  p.quote);                  // G 单价（报给采购商的报价）
    put(row, 7, sumStyle(ri),         p.amount);                 // H 金额
    pushRow(26);
  });

  /* ===================== 第3段：汇总 ===================== */

  pushRow(8);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '汇总');
  pushRow(26);

  const grandAmount = prodRows.reduce((a, p) => a + p.amount, 0);

  put(row, 0, SS.sumLbl, '产品项数'); merge(row, 1, 3);  put(row, 1, SS.sumVal, o.items.length);
  put(row, 4, SS.totalLbl, '报价总额（元）'); merge(row, 5, TOTAL_COLS - 1); put(row, 5, SS.totalVal, Math.round(grandAmount * 100) / 100);
  pushRow(32);

  /* ===================== 页脚 ===================== */
  pushRow(10);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.footer,
    '金额 = 单价 × 数量  |  本报价单由紧固件贸易工作台自动生成  |  导出时间：' + new Date().toLocaleString('zh-CN'));
  pushRow(28);

  /* !ref 范围与自动列宽 */
  ws['!ref'] = 'A1:' + TOTAL_LETTER + row;
  _autoFitCols(ws, TOTAL_COLS);

  /* 补全合并单元格边框 */
  _fillMergeBorders(ws);

  const fname = '采购订单_' + o.id + '_' + o.status;
  await downloadWorkbook(wb, fname);
  toast('导出成功：' + fname + '.xlsx', 'success');
}

/* =========================================================
   签约完成结算导出：采购商结算明细（应收）+ 供应商结算明细（应付）
   结构：头部信息 → 采购商应收明细 → 供应商应付明细 → 供应商汇总 → 结算状态提醒
   金额口径与「对账结算」页面一致：应收=报价×需求数量、应付=供应商报价×分配量
   ========================================================= */
async function _exportOrderSignedComplete(o) {
  const wb = {};
  const ws = {};
  wb.SheetNames = ['签约完成结算单'];
  wb.Sheets = { '签约完成结算单': ws };

  /* ============ 局部样式定义 ============ */
  var SS = Object.assign({}, _SS_COMMON, {
warnLbl:   { t: 's', font: { name: _FONT, bold: true, sz: 11, color: '9C0006' }, fill: { fgColor: 'FFC7CE' }, vertical: 'center', wrapText: true, border: _BD },
okLbl:     { t: 's', font: { name: _FONT, bold: true, sz: 11, color: '006100' }, fill: { fgColor: 'C6EFCE' }, vertical: 'center', wrapText: true, border: _BD },
negEven:   { t: 'n', font: { name: _FONT, bold: true, sz: 11, color: '9C0006' }, fill: { fgColor: 'FFC7CE' }, align: 'right', vertical: 'center', border: _BD },
negOdd:    { t: 'n', font: { name: _FONT, bold: true, sz: 11, color: '9C0006' }, fill: { fgColor: 'FDE4E6' }, align: 'right', vertical: 'center', border: _BD },
posEven:   { t: 'n', font: { name: _FONT, bold: true, sz: 11, color: '006100' }, fill: { fgColor: 'C6EFCE' }, align: 'right', vertical: 'center', border: _BD },
posOdd:    { t: 'n', font: { name: _FONT, bold: true, sz: 11, color: '006100' }, fill: { fgColor: 'E2EFDA' }, align: 'right', vertical: 'center', border: _BD }
});

  /* ============ 辅助函数 ============ */
  function dataStyle(ri, isNum) {
    if (isNum) return ri % 2 === 0 ? SS.evenN : SS.oddN;
    return ri % 2 === 0 ? SS.even : SS.odd;
  }
  function sumStyle(ri) { return ri % 2 === 0 ? SS.evenSum : SS.oddSum; }
  function negStyle(ri) { return ri % 2 === 0 ? SS.negEven : SS.negOdd; }
  function posStyle(ri) { return ri % 2 === 0 ? SS.posEven : SS.posOdd; }
  function wc(addr, style, value) { _wc(ws, addr, style, value); }
  function put(r, c, style, value) { wc(window.XLSX.utils.encode_cell({ r, c }), style, value); }
  function merge(r, c1, c2) { ws['!merges'].push({ s: { r, c: c1 }, e: { r, c: c2 } }); }
  function vmerge(r1, c1, r2, c2) { ws['!merges'].push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } }); }
  function r2(v) { var n = v || 0; return Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100 * (n < 0 ? -1 : 1); }

  ws['!merges'] = [];
  ws['!rows'] = [];
  let row = 0; // 0 基当前行号
  function pushRow(hpt) { ws['!rows'].push(hpt ? { hpt } : {}); row++; }

  /* ============ 数据准备 ============ */
  const TOTAL_COLS = 9; // A~I
  const TOTAL_LETTER = 'I';
  const deliveryStr = typeof o.delivery === 'object' ? (o.delivery.time || '') : (o.delivery || '');

  // 采购商结算明细：按产品行，应收 = 报价单价 × 需求数量
  const recvRows = (o.items || []).map((it) => {
    const qty = parseFloat(it.qty) || 0;
    const price = itemQuotePrice(it);
    return { it, qty, price, amt: r2(qty * price) };
  });
  // 采购商已收金额（口径同 settleUnitOrderDetails：结算记录按订单关联）
  function settleMatched(type, unitId) {
    let amt = 0;
    (DB.settlements || []).forEach(function (s) {
      if (s.type !== type || s.unitId !== unitId) return;
      (s.orders || []).forEach(function (so) {
        if (so.orderId === o.id) amt += so.amount || 0;
      });
    });
    return r2(amt);
  }
  const recvTotal = r2(recvRows.reduce((a, r) => a + r.amt, 0));
  const recvPaid = settleMatched('receipt', o.buyerId);
  const recvGap = r2(recvTotal - recvPaid);

  // 供应商结算明细：按产品 × 已选供应商报价行，应付 = 报价 × 分配量
  const supplierMap = {};
  (o.items || []).forEach((it) => {
    itemOpts(it).forEach((op) => {
      if (!op.supplierId) return;
      if (!supplierMap[op.supplierId]) {
        supplierMap[op.supplierId] = { id: op.supplierId, rows: [], payable: 0 };
      }
      const amt = r2((op.price || 0) * (op.allocQty || 0));
      supplierMap[op.supplierId].rows.push({ it, op, amt });
      supplierMap[op.supplierId].payable += amt;
    });
  });
  const suppliers = Object.values(supplierMap).map((s) => {
    s.payable = r2(s.payable);
    s.paid = settleMatched('payment', s.id);
    s.gap = r2(s.payable - s.paid);
    return s;
  }).sort((a, b) => b.payable - a.payable);
  const payTotal = r2(suppliers.reduce((a, s) => a + s.payable, 0));
  const payPaid = r2(suppliers.reduce((a, s) => a + s.paid, 0));
  const payGap = r2(payTotal - payPaid);

  /* ===================== 第1段：头部信息 ===================== */

  /* 大标题 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.pageTitle, '签约完成结算单');
  pushRow(44);

  /* 副标题 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, ev(o.id) + '  |  ' + ev(pName(o.buyerId)) + (o.project ? '  |  项目：' + ev(o.project) : ''));
  pushRow(28);

  /* 分组标签：订单基本信息 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '订单基本信息');
  pushRow(26);

  /* 基本信息（两行：第一行4对、第二行3对） */
  const infoRow1 = [
    { label: '单号',     val: ev(o.id),                  c: 0 },
    { label: '采购商',   val: ev(pName(o.buyerId)),      c: 2 },
    { label: '对接人',   val: ev(o.buyerContact || '-'), c: 4 },
    { label: '项目',     val: ev(o.project || '-'),      c: 6 },
  ];
  infoRow1.forEach((f) => { put(row, f.c, SS.th, f.label); put(row, f.c + 1, SS.odd, f.val); });
  pushRow(24);

  const infoRow2 = [
    { label: '交期日期', val: ev(deliveryStr || '-'),      c: 0 },
    { label: '状态',     val: ev(o.status),                c: 2 },
    { label: '创建时间', val: ev(o.createdAt || '-'),      c: 4 },
  ];
  infoRow2.forEach((f) => { put(row, f.c, SS.th, f.label); put(row, f.c + 1, SS.odd, f.val); });
  pushRow(24);

  /* 备注行（如有） */
  if (o.remark) {
    put(row, 0, SS.th, '备注');
    merge(row, 1, TOTAL_COLS - 1);
    put(row, 1, SS.odd, ev(o.remark));
    pushRow(24);
  }

  /* 空行分隔 */
  pushRow(8);

  /* ===================== 第2段：采购商结算明细（应收） ===================== */

  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '采购商结算明细（应收，共 ' + recvRows.length + ' 项产品）');
  pushRow(36);

  const rHeaders = ['序号', 'SKU', '品名', '规格', '属性', '需求数量\n(千支)', '结算单价\n(元/千支)', '应收金额\n(元)'];
  rHeaders.forEach((h, c) => { put(row, c, SS.th, h); });
  pushRow(40);

  recvRows.forEach((r, idx) => {
    const ri = idx + 1;
    put(row, 0, dataStyle(ri, false), ri);
    put(row, 1, dataStyle(ri, false), ev(r.it.sku || ''));
    put(row, 2, dataStyle(ri, false), ev(r.it.name || ''));
    put(row, 3, dataStyle(ri, false), ev(r.it.spec || ''));
    put(row, 4, dataStyle(ri, false), specLabel(r.it));
    put(row, 5, dataStyle(ri, true),  r.qty);
    put(row, 6, dataStyle(ri, true),  r.price);
    put(row, 7, sumStyle(ri),         r.amt);
    pushRow(26);
  });

  /* 采购商汇总 */
  pushRow(8);
  put(row, 0, SS.sumLbl, '应收总额（元）'); merge(row, 1, 2); put(row, 1, SS.sumVal, recvTotal);
  put(row, 3, SS.sumLbl, '已收金额（元）'); merge(row, 4, 5); put(row, 4, SS.sumVal, recvPaid);
  put(row, 6, SS.totalLbl, '未收金额（元）'); merge(row, 7, 8); put(row, 7, recvGap > 0 ? SS.negEven : SS.posEven, recvGap);
  pushRow(32);

  /* ===================== 第3段：供应商结算明细（应付） ===================== */

  pushRow(8);
  const payRowCount = suppliers.reduce((a, s) => a + s.rows.length, 0);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '供应商结算明细（应付，共 ' + suppliers.length + ' 家供应商、' + payRowCount + ' 条报价）');
  pushRow(36);

  const pHeaders = ['序号', '供应商', '联系人', 'SKU', '品名', '规格', '供应商报价\n(元/千支)', '分配\n(千支)', '应付金额\n(元)'];
  pHeaders.forEach((h, c) => { put(row, c, SS.th, h); });
  pushRow(40);

  let sIdx = 0;
  suppliers.forEach((s) => {
    s.rows.forEach((r, i) => {
      const ri = (sIdx++) + 1;
      if (i === 0) {
        put(row, 0, dataStyle(ri, false), ri);  // A 序号（供应商首行）
        put(row, 1, dataStyle(ri, false), ev(pName(s.id))); // B 供应商
        put(row, 2, dataStyle(ri, false), ev(r.op.contact || '-')); // C 联系人
      }
      put(row, 3, dataStyle(ri, false), ev(r.it.sku || ''));
      put(row, 4, dataStyle(ri, false), ev(r.it.name || ''));
      put(row, 5, dataStyle(ri, false), ev(r.it.spec || ''));
      put(row, 6, dataStyle(ri, true),  r.op.price || 0);
      put(row, 7, dataStyle(ri, true),  r.op.allocQty || 0);
      put(row, 8, sumStyle(ri),         r.amt);
      pushRow(26);
    });
    /* 供应商的序号/供应商/联系人/SKU/品名/规格列垂直合并 */
    if (s.rows.length > 1) {
      const firstR = row - s.rows.length;
      for (let c = 0; c <= 5; c++) vmerge(firstR, c, firstR + s.rows.length - 1, c);
    }
  });

  /* 供应商结算汇总 */
  pushRow(8);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '供应商结算汇总');
  pushRow(26);

  const sHeaders = ['序号', '供应商', '应付金额\n(元)', '已付金额\n(元)', '未付金额\n(元)'];
  sHeaders.forEach((h, c) => { put(row, c, SS.th, h); });
  pushRow(28);

  suppliers.forEach((s, idx) => {
    const ri = idx + 1;
    put(row, 0, dataStyle(ri, false), ri);
    put(row, 1, dataStyle(ri, false), ev(pName(s.id)));
    put(row, 2, sumStyle(ri), s.payable);
    put(row, 3, sumStyle(ri), s.paid);
    put(row, 4, s.gap > 0 ? negStyle(ri) : posStyle(ri), s.gap);
    pushRow(26);
  });

  put(row, 0, SS.totalLbl, '合计'); merge(row, 1, 1); put(row, 1, SS.totalVal, '');
  put(row, 2, SS.totalVal, payTotal);
  put(row, 3, SS.totalVal, payPaid);
  put(row, 4, payGap > 0 ? SS.negEven : SS.posEven, payGap);
  pushRow(30);

  /* ===================== 第4段：结算状态提醒 ===================== */

  pushRow(8);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '结算状态提醒');
  pushRow(26);

  const buyerName = ev(pName(o.buyerId)) || '采购商';
  if (recvGap > 0) {
    merge(row, 0, TOTAL_COLS - 1);
    put(row, 0, SS.warnLbl,
      '⚠ 采购商「' + buyerName + '」应收 ' + fmtN(recvTotal) + ' 元，已收 ' + fmtN(recvPaid) + ' 元，未收 ' + fmtN(recvGap) + ' 元，请在「对账结算」中登记收款');
    pushRow(36);
  } else {
    merge(row, 0, TOTAL_COLS - 1);
    put(row, 0, SS.okLbl, '✓ 采购商「' + buyerName + '」应收 ' + fmtN(recvTotal) + ' 元已全部结清');
    pushRow(36);
  }

  const unpaidSup = suppliers.filter((s) => s.gap > 0);
  if (unpaidSup.length) {
    unpaidSup.forEach((s) => {
      merge(row, 0, TOTAL_COLS - 1);
      put(row, 0, SS.warnLbl,
        '⚠ 供应商「' + ev(pName(s.id)) + '」应付 ' + fmtN(s.payable) + ' 元，已付 ' + fmtN(s.paid) + ' 元，未付 ' + fmtN(s.gap) + ' 元，请在「对账结算」中登记付款');
      pushRow(36);
    });
    merge(row, 0, TOTAL_COLS - 1);
    put(row, 0, SS.warnLbl, '⚠ 共 ' + unpaidSup.length + ' 家供应商未结清，合计未付 ' + fmtN(payGap) + ' 元');
    pushRow(36);
  } else if (suppliers.length) {
    merge(row, 0, TOTAL_COLS - 1);
    put(row, 0, SS.okLbl, '✓ 所有供应商应付 ' + fmtN(payTotal) + ' 元已全部结清');
    pushRow(36);
  } else {
    merge(row, 0, TOTAL_COLS - 1);
    put(row, 0, SS.okLbl, '✓ 本单暂无供应商分配记录');
    pushRow(36);
  }

  /* ===================== 页脚 ===================== */
  pushRow(10);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.footer,
    '应收金额 = 结算单价 × 需求数量  |  应付金额 = 供应商报价 × 分配量  |  已收/已付来自「对账结算」记录（按订单关联）  |  红色为未结清金额  |  本文件由紧固件贸易工作台自动生成  |  导出时间：' + new Date().toLocaleString('zh-CN'));
  pushRow(28);

  /* !ref 范围与自动列宽 */
  ws['!ref'] = 'A1:' + TOTAL_LETTER + row;
  _autoFitCols(ws, TOTAL_COLS);

  /* 补全合并单元格边框 */
  _fillMergeBorders(ws);

  const fname = '采购订单_' + o.id + '_' + o.status;
  await downloadWorkbook(wb, fname);
  toast('导出成功：' + fname + '.xlsx', 'success');
}

/* =========================================================
   送货中 / 完成 状态导出：送货结算单
   两状态内容一致（仅文件名中的状态不同）
   结构：头部信息 → 送货信息（快递至采购商）→ 采购商结算明细（应收）
         → 供应商结算明细（应付）+ 汇总 → 供应商邮寄信息（发货至我方）
         → 结算状态提醒
   业务链路：各供应商将产品快递至我方 → 统一收货验货 → 快递至采购商
   ========================================================= */
async function _exportOrderDelivering(o) {
  const wb = {};
  const ws = {};
  wb.SheetNames = ['送货结算单'];
  wb.Sheets = { '送货结算单': ws };

  /* ============ 局部样式定义 ============ */
  var SS = Object.assign({}, _SS_COMMON, {
warnLbl:   { t: 's', font: { name: _FONT, bold: true, sz: 11, color: '9C0006' }, fill: { fgColor: 'FFC7CE' }, vertical: 'center', wrapText: true, border: _BD },
okLbl:     { t: 's', font: { name: _FONT, bold: true, sz: 11, color: '006100' }, fill: { fgColor: 'C6EFCE' }, vertical: 'center', wrapText: true, border: _BD },
shipLbl:   { t: 's', font: { name: _FONT, bold: true, sz: 11, color: '006100' }, fill: { fgColor: 'C6EFCE' }, vertical: 'center', wrapText: true, border: _BD },
shipVal:   { t: 's', font: { name: _FONT, sz: 11 }, fill: { fgColor: 'F5FBF6' }, vertical: 'center', wrapText: true, border: _BD },
negEven:   { t: 'n', font: { name: _FONT, bold: true, sz: 11, color: '9C0006' }, fill: { fgColor: 'FFC7CE' }, align: 'right', vertical: 'center', border: _BD },
negOdd:    { t: 'n', font: { name: _FONT, bold: true, sz: 11, color: '9C0006' }, fill: { fgColor: 'FDE4E6' }, align: 'right', vertical: 'center', border: _BD },
posEven:   { t: 'n', font: { name: _FONT, bold: true, sz: 11, color: '006100' }, fill: { fgColor: 'C6EFCE' }, align: 'right', vertical: 'center', border: _BD },
posOdd:    { t: 'n', font: { name: _FONT, bold: true, sz: 11, color: '006100' }, fill: { fgColor: 'E2EFDA' }, align: 'right', vertical: 'center', border: _BD }
});

  /* ============ 辅助函数 ============ */
  function dataStyle(ri, isNum) {
    if (isNum) return ri % 2 === 0 ? SS.evenN : SS.oddN;
    return ri % 2 === 0 ? SS.even : SS.odd;
  }
  function sumStyle(ri) { return ri % 2 === 0 ? SS.evenSum : SS.oddSum; }
  function negStyle(ri) { return ri % 2 === 0 ? SS.negEven : SS.negOdd; }
  function posStyle(ri) { return ri % 2 === 0 ? SS.posEven : SS.posOdd; }
  function wc(addr, style, value) { _wc(ws, addr, style, value); }
  function put(r, c, style, value) { wc(window.XLSX.utils.encode_cell({ r, c }), style, value); }
  function merge(r, c1, c2) { ws['!merges'].push({ s: { r, c: c1 }, e: { r, c: c2 } }); }
  function vmerge(r1, c1, r2, c2) { ws['!merges'].push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } }); }
  function r2(v) { var n = v || 0; return Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100 * (n < 0 ? -1 : 1); }

  ws['!merges'] = [];
  ws['!rows'] = [];
  let row = 0; // 0 基当前行号
  function pushRow(hpt) { ws['!rows'].push(hpt ? { hpt } : {}); row++; }

  /* ============ 数据准备 ============ */
  const TOTAL_COLS = 9; // A~I
  const TOTAL_LETTER = 'I';
  const deliveryStr = typeof o.delivery === 'object' ? (o.delivery.time || '') : (o.delivery || '');

  // 采购商结算明细：按产品行，应收 = 报价单价 × 需求数量
  const recvRows = (o.items || []).map((it) => {
    const qty = parseFloat(it.qty) || 0;
    const price = itemQuotePrice(it);
    return { it, qty, price, amt: r2(qty * price) };
  });
  // 采购商已收金额（口径同 settleUnitOrderDetails：结算记录按订单关联）
  function settleMatched(type, unitId) {
    let amt = 0;
    (DB.settlements || []).forEach(function (s) {
      if (s.type !== type || s.unitId !== unitId) return;
      (s.orders || []).forEach(function (so) {
        if (so.orderId === o.id) amt += so.amount || 0;
      });
    });
    return r2(amt);
  }
  const recvTotal = r2(recvRows.reduce((a, r) => a + r.amt, 0));
  const recvPaid = settleMatched('receipt', o.buyerId);
  const recvGap = r2(recvTotal - recvPaid);

  // 供应商结算明细：按产品 × 已选供应商报价行，应付 = 报价 × 分配量
  const supplierMap = {};
  (o.items || []).forEach((it) => {
    itemOpts(it).forEach((op) => {
      if (!op.supplierId) return;
      if (!supplierMap[op.supplierId]) {
        supplierMap[op.supplierId] = { id: op.supplierId, rows: [], payable: 0 };
      }
      const amt = r2((op.price || 0) * (op.allocQty || 0));
      supplierMap[op.supplierId].rows.push({ it, op, amt });
      supplierMap[op.supplierId].payable += amt;
    });
  });
  const suppliers = Object.values(supplierMap).map((s) => {
    s.payable = r2(s.payable);
    s.paid = settleMatched('payment', s.id);
    s.gap = r2(s.payable - s.paid);
    return s;
  }).sort((a, b) => b.payable - a.payable);
  const payTotal = r2(suppliers.reduce((a, s) => a + s.payable, 0));
  const payPaid = r2(suppliers.reduce((a, s) => a + s.paid, 0));
  const payGap = r2(payTotal - payPaid);

  // 供应商邮寄信息辅助（发货至我方，需联系人/电话/地址）
  function unitOf(id) { return (DB.units || []).find((u) => u.id === id) || null; }
  function unitContact(unit, preferName) {
    if (!unit || !unit.contacts || !unit.contacts.length) return null;
    if (preferName) {
      const hit = unit.contacts.find((c) => c.name === preferName);
      if (hit) return hit;
    }
    return unit.contacts.find((c) => c.side === '供应商') || unit.contacts[0];
  }
  function unitPhone(unit, preferName) {
    const c = unitContact(unit, preferName);
    return c && c.phone ? c.phone : '';
  }
  function unitAddress(unit) {
    return unit && unit.invoice && unit.invoice.address ? unit.invoice.address : '';
  }

  /* ===================== 第1段：头部信息 ===================== */

  /* 大标题 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.pageTitle, '送货结算单');
  pushRow(44);

  /* 副标题 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, ev(o.id) + '  |  ' + ev(pName(o.buyerId)) + '  |  状态：' + ev(o.status) + (o.project ? '  |  项目：' + ev(o.project) : ''));
  pushRow(28);

  /* 分组标签：订单基本信息 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '订单基本信息');
  pushRow(26);

  /* 基本信息（两行：第一行4对、第二行3对） */
  const infoRow1 = [
    { label: '单号',     val: ev(o.id),                  c: 0 },
    { label: '采购商',   val: ev(pName(o.buyerId)),      c: 2 },
    { label: '对接人',   val: ev(o.buyerContact || '-'), c: 4 },
    { label: '项目',     val: ev(o.project || '-'),      c: 6 },
  ];
  infoRow1.forEach((f) => { put(row, f.c, SS.th, f.label); put(row, f.c + 1, SS.odd, f.val); });
  pushRow(24);

  const infoRow2 = [
    { label: '交期日期', val: ev(deliveryStr || '-'), c: 0 },
    { label: '状态',     val: ev(o.status),           c: 2 },
    { label: '创建时间', val: ev(o.createdAt || '-'), c: 4 },
  ];
  infoRow2.forEach((f) => { put(row, f.c, SS.th, f.label); put(row, f.c + 1, SS.odd, f.val); });
  pushRow(24);

  /* 备注行（如有） */
  if (o.remark) {
    put(row, 0, SS.th, '备注');
    merge(row, 1, TOTAL_COLS - 1);
    put(row, 1, SS.odd, ev(o.remark));
    pushRow(24);
  }

  /* 空行分隔 */
  pushRow(8);

  /* ===================== 第2段：送货信息（快递至采购商） ===================== */

  const shipInfo = typeof o.delivery === 'object' ? o.delivery : null;
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '送货信息（各供应商已发货至我方，统一收货验货后快递至采购商）');
  pushRow(36);

  /* 送货地址行 */
  put(row, 0, SS.shipLbl, '送货地址');
  merge(row, 1, TOTAL_COLS - 1);
  put(row, 1, SS.shipVal, shipInfo && shipInfo.address ? ev(shipInfo.address) : '（未填写）');
  pushRow(26);

  /* 快递单号 / 送货时间 行 */
  put(row, 0, SS.shipLbl, '快递单号');
  merge(row, 1, 4);
  put(row, 1, SS.shipVal, shipInfo && shipInfo.tracking ? ev(shipInfo.tracking) : '（未填写）');
  put(row, 5, SS.shipLbl, '送货时间');
  merge(row, 6, TOTAL_COLS - 1);
  put(row, 6, SS.shipVal, shipInfo && shipInfo.time ? ev(shipInfo.time) : '（未填写）');
  pushRow(26);

  /* 空行分隔 */
  pushRow(8);

  /* ===================== 第3段：采购商结算明细（应收） ===================== */

  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '采购商结算明细（应收，共 ' + recvRows.length + ' 项产品）');
  pushRow(36);

  const rHeaders = ['序号', 'SKU', '品名', '规格', '属性', '需求数量\n(千支)', '结算单价\n(元/千支)', '应收金额\n(元)'];
  rHeaders.forEach((h, c) => { put(row, c, SS.th, h); });
  pushRow(40);

  recvRows.forEach((r, idx) => {
    const ri = idx + 1;
    put(row, 0, dataStyle(ri, false), ri);
    put(row, 1, dataStyle(ri, false), ev(r.it.sku || ''));
    put(row, 2, dataStyle(ri, false), ev(r.it.name || ''));
    put(row, 3, dataStyle(ri, false), ev(r.it.spec || ''));
    put(row, 4, dataStyle(ri, false), specLabel(r.it));
    put(row, 5, dataStyle(ri, true),  r.qty);
    put(row, 6, dataStyle(ri, true),  r.price);
    put(row, 7, sumStyle(ri),         r.amt);
    pushRow(26);
  });

  /* 采购商汇总 */
  pushRow(8);
  put(row, 0, SS.sumLbl, '应收总额（元）'); merge(row, 1, 2); put(row, 1, SS.sumVal, recvTotal);
  put(row, 3, SS.sumLbl, '已收金额（元）'); merge(row, 4, 5); put(row, 4, SS.sumVal, recvPaid);
  put(row, 6, SS.totalLbl, '未收金额（元）'); merge(row, 7, 8); put(row, 7, recvGap > 0 ? SS.negEven : SS.posEven, recvGap);
  pushRow(32);

  /* ===================== 第4段：供应商结算明细（应付） ===================== */

  pushRow(8);
  const payRowCount = suppliers.reduce((a, s) => a + s.rows.length, 0);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '供应商结算明细（应付，共 ' + suppliers.length + ' 家供应商、' + payRowCount + ' 条报价）');
  pushRow(36);

  const pHeaders = ['序号', '供应商', '联系人', 'SKU', '品名', '规格', '供应商报价\n(元/千支)', '分配\n(千支)', '应付金额\n(元)'];
  pHeaders.forEach((h, c) => { put(row, c, SS.th, h); });
  pushRow(40);

  let sIdx = 0;
  suppliers.forEach((s) => {
    s.rows.forEach((r, i) => {
      const ri = (sIdx++) + 1;
      if (i === 0) {
        put(row, 0, dataStyle(ri, false), ri);  // A 序号（供应商首行）
        put(row, 1, dataStyle(ri, false), ev(pName(s.id))); // B 供应商
        put(row, 2, dataStyle(ri, false), ev(r.op.contact || '-')); // C 联系人
      }
      put(row, 3, dataStyle(ri, false), ev(r.it.sku || ''));
      put(row, 4, dataStyle(ri, false), ev(r.it.name || ''));
      put(row, 5, dataStyle(ri, false), ev(r.it.spec || ''));
      put(row, 6, dataStyle(ri, true),  r.op.price || 0);
      put(row, 7, dataStyle(ri, true),  r.op.allocQty || 0);
      put(row, 8, sumStyle(ri),         r.amt);
      pushRow(26);
    });
    /* 供应商的序号/供应商/联系人/SKU/品名/规格列垂直合并 */
    if (s.rows.length > 1) {
      const firstR = row - s.rows.length;
      for (let c = 0; c <= 5; c++) vmerge(firstR, c, firstR + s.rows.length - 1, c);
    }
  });

  /* 供应商结算汇总 */
  pushRow(8);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '供应商结算汇总');
  pushRow(26);

  const sHeaders = ['序号', '供应商', '应付金额\n(元)', '已付金额\n(元)', '未付金额\n(元)'];
  sHeaders.forEach((h, c) => { put(row, c, SS.th, h); });
  pushRow(28);

  suppliers.forEach((s, idx) => {
    const ri = idx + 1;
    put(row, 0, dataStyle(ri, false), ri);
    put(row, 1, dataStyle(ri, false), ev(pName(s.id)));
    put(row, 2, sumStyle(ri), s.payable);
    put(row, 3, sumStyle(ri), s.paid);
    put(row, 4, s.gap > 0 ? negStyle(ri) : posStyle(ri), s.gap);
    pushRow(26);
  });

  put(row, 0, SS.totalLbl, '合计'); merge(row, 1, 1); put(row, 1, SS.totalVal, '');
  put(row, 2, SS.totalVal, payTotal);
  put(row, 3, SS.totalVal, payPaid);
  put(row, 4, payGap > 0 ? SS.negEven : SS.posEven, payGap);
  pushRow(30);

  /* ===================== 第5段：供应商邮寄信息（发货至我方） ===================== */

  pushRow(8);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '供应商邮寄信息（请各供应商按下列信息将产品快递至我方，统一收货验货）');
  pushRow(36);

  const mHeaders = ['序号', '供应商', '联系人', '联系电话', '邮寄地址', 'SKU', '品名', '规格', '数量\n(千支)'];
  mHeaders.forEach((h, c) => { put(row, c, SS.th, h); });
  pushRow(40);

  if (suppliers.length) {
    let mIdx = 0;
    suppliers.forEach((s) => {
      const unit = unitOf(s.id);
      const firstOp = s.rows[0].op;
      const contactName = (firstOp && firstOp.contact) || '';
      const contactObj = unitContact(unit, contactName);
      const dispName = contactName || (contactObj ? contactObj.name : '');
      const dispPhone = unitPhone(unit, contactName);
      const dispAddr = unitAddress(unit) || '（未填写）';
      s.rows.forEach((r, i) => {
        const ri = (mIdx++) + 1;
        if (i === 0) {
          put(row, 0, dataStyle(ri, false), ri);                                // A 序号
          put(row, 1, dataStyle(ri, false), ev(pName(s.id)));                   // B 供应商
          put(row, 2, dataStyle(ri, false), ev(dispName || '-'));               // C 联系人
          put(row, 3, dataStyle(ri, false), ev(dispPhone || '-'));              // D 联系电话
          put(row, 4, dataStyle(ri, false), ev(dispAddr));                      // E 邮寄地址
        }
        put(row, 5, dataStyle(ri, false), ev(r.it.sku || ''));                  // F SKU
        put(row, 6, dataStyle(ri, false), ev(r.it.name || ''));                 // G 品名
        put(row, 7, dataStyle(ri, false), ev(r.it.spec || ''));                 // H 规格
        put(row, 8, dataStyle(ri, true),  r.op.allocQty || 0);                  // I 数量
        pushRow(26);
      });
      /* 序号/供应商/联系人/联系电话/邮寄地址列垂直合并 */
      if (s.rows.length > 1) {
        const firstR = row - s.rows.length;
        for (let c = 0; c <= 4; c++) vmerge(firstR, c, firstR + s.rows.length - 1, c);
      }
    });
  } else {
    merge(row, 0, TOTAL_COLS - 1);
    put(row, 0, SS.warnLbl, '⚠ 本单暂无供应商分配记录，无法生成邮寄信息');
    pushRow(36);
  }

  /* ===================== 第6段：结算状态提醒 ===================== */

  pushRow(8);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '结算状态提醒');
  pushRow(26);

  const buyerName = ev(pName(o.buyerId)) || '采购商';
  if (recvGap > 0) {
    merge(row, 0, TOTAL_COLS - 1);
    put(row, 0, SS.warnLbl,
      '⚠ 采购商「' + buyerName + '」应收 ' + fmtN(recvTotal) + ' 元，已收 ' + fmtN(recvPaid) + ' 元，未收 ' + fmtN(recvGap) + ' 元，请在「对账结算」中登记收款');
    pushRow(36);
  } else {
    merge(row, 0, TOTAL_COLS - 1);
    put(row, 0, SS.okLbl, '✓ 采购商「' + buyerName + '」应收 ' + fmtN(recvTotal) + ' 元已全部结清');
    pushRow(36);
  }

  const unpaidSup = suppliers.filter((s) => s.gap > 0);
  if (unpaidSup.length) {
    unpaidSup.forEach((s) => {
      merge(row, 0, TOTAL_COLS - 1);
      put(row, 0, SS.warnLbl,
        '⚠ 供应商「' + ev(pName(s.id)) + '」应付 ' + fmtN(s.payable) + ' 元，已付 ' + fmtN(s.paid) + ' 元，未付 ' + fmtN(s.gap) + ' 元，请在「对账结算」中登记付款');
      pushRow(36);
    });
    merge(row, 0, TOTAL_COLS - 1);
    put(row, 0, SS.warnLbl, '⚠ 共 ' + unpaidSup.length + ' 家供应商未结清，合计未付 ' + fmtN(payGap) + ' 元');
    pushRow(36);
  } else if (suppliers.length) {
    merge(row, 0, TOTAL_COLS - 1);
    put(row, 0, SS.okLbl, '✓ 所有供应商应付 ' + fmtN(payTotal) + ' 元已全部结清');
    pushRow(36);
  } else {
    merge(row, 0, TOTAL_COLS - 1);
    put(row, 0, SS.okLbl, '✓ 本单暂无供应商分配记录');
    pushRow(36);
  }

  /* ===================== 页脚 ===================== */
  pushRow(10);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.footer,
    '送货链路：供应商 → 我方（收货验货）→ 采购商  |  应收金额 = 结算单价 × 需求数量  |  应付金额 = 供应商报价 × 分配量  |  已收/已付来自「对账结算」记录（按订单关联）  |  红色为未结清金额  |  本文件由紧固件贸易工作台自动生成  |  导出时间：' + new Date().toLocaleString('zh-CN'));
  pushRow(28);

  /* !ref 范围与自动列宽 */
  ws['!ref'] = 'A1:' + TOTAL_LETTER + row;
  _autoFitCols(ws, TOTAL_COLS);

  /* 补全合并单元格边框 */
  _fillMergeBorders(ws);

  const fname = '采购订单_' + o.id + '_' + o.status;
  await downloadWorkbook(wb, fname);
  toast('导出成功：' + fname + '.xlsx', 'success');
}

/* =========================================================
   通用状态导出：非「待确认」状态的采购订单
   结构：头部信息 → 产品明细（意向价/报价）→ 供应商分配 → 汇总
   ========================================================= */
async function _exportOrderGeneral(o) {
  var wb = {};
  var ws = {};
  wb.SheetNames = ['采购订单'];
  wb.Sheets = { '采购订单': ws };

  var TOTAL_COLS = 15; // A~O
  var TOTAL_LETTER = 'O';
  var deliveryStr = typeof o.delivery === 'object' ? (o.delivery.time || '') : (o.delivery || '');

  var SS = Object.assign({}, _SS_COMMON);

  function dataStyle(ri, isNum) { return isNum ? (ri % 2 === 0 ? SS.evenN : SS.oddN) : (ri % 2 === 0 ? SS.even : SS.odd); }
  function sumStyle(ri) { return ri % 2 === 0 ? SS.evenSum : SS.oddSum; }
  function wc(addr, style, value) { _wc(ws, addr, style, value); }
  function put(r, c, style, value) { wc(window.XLSX.utils.encode_cell({ r: r, c: c }), style, value); }
  function merge(r, c1, c2) { ws['!merges'].push({ s: { r: r, c: c1 }, e: { r: r, c: c2 } }); }

  ws['!merges'] = [];
  ws['!rows'] = [];
  var row = 0; // 0 基当前行号
  function pushRow(hpt) { ws['!rows'].push(hpt ? { hpt: hpt } : {}); row++; }

  /* 大标题 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.pageTitle, '采购订单');
  pushRow(44);

  /* 副标题 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, ev(o.id) + '  |  ' + ev(pName(o.buyerId)) + (o.project ? '  |  项目：' + ev(o.project) : ''));
  pushRow(28);

  /* 分组标签：订单基本信息 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '订单基本信息');
  pushRow(26);

  /* 基本信息（7 字段两两配对） */
  var infoFields = [
    { label: '单号',     val: ev(o.id),                  cs: 0,  ce: 1  },
    { label: '采购商',   val: ev(pName(o.buyerId)),      cs: 2,  ce: 3  },
    { label: '对接人',   val: ev(o.buyerContact || '-'), cs: 4,  ce: 5  },
    { label: '项目',     val: ev(o.project || '-'),      cs: 6,  ce: 7  },
    { label: '交期日期', val: ev(deliveryStr || '-'),    cs: 8,  ce: 9  },
    { label: '状态',     val: ev(o.status),              cs: 10, ce: 11 },
    { label: '创建时间', val: ev(o.createdAt || '-'),    cs: 12, ce: 13 },
  ];
  infoFields.forEach(function (f) {
    put(row, f.cs, SS.th, f.label);
    if (f.cs === 12) merge(row, 13, 14);
    put(row, f.ce, SS.odd, f.val);
  });
  pushRow(24);

  /* 备注行（如有） */
  if (o.remark) {
    put(row, 0, SS.th, '备注');
    merge(row, 1, TOTAL_COLS - 1);
    put(row, 1, SS.odd, ev(o.remark));
    pushRow(24);
  }

  /* 空行分隔 */
  pushRow(8);

  /* 分组标题：产品明细 */
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '产品明细（共 ' + o.items.length + ' 项）');
  pushRow(36);

  /* 产品明细表头 */
  var pHeaders = ['序号', 'SKU', '品名', '规格', '类型', '标准', '直径', '材质', '硬度', '表面处理', '数量(千支)', '意向价(元/千支)', '报价(元/千支)', '小计(元)', '备注'];
  pHeaders.forEach(function (h, c) { put(row, c, SS.th, h); });
  pushRow(40);

  /* 产品明细数据 */
  var grandSale = 0, grandQuote = 0;
  o.items.forEach(function (it, i) {
    var ri = i + 1;
    var qty = parseFloat(it.qty) || 0;
    var sale = parseFloat(it.salePrice) || 0;
    var quote = parseFloat(itemQuotePrice(it)) || 0;
    var lineQuote = qty * quote;
    grandSale += qty * sale;
    grandQuote += lineQuote;
    put(row, 0,  dataStyle(ri, false), i + 1);
    put(row, 1,  dataStyle(ri, false), ev(it.sku || ''));
    put(row, 2,  dataStyle(ri, false), ev(it.name || ''));
    put(row, 3,  dataStyle(ri, false), ev(it.spec || ''));
    put(row, 4,  dataStyle(ri, false), ev(it.type || ''));
    put(row, 5,  dataStyle(ri, false), ev(it.standard || ''));
    put(row, 6,  dataStyle(ri, false), ev(it.diameter || ''));
    put(row, 7,  dataStyle(ri, false), ev(it.material || ''));
    put(row, 8,  dataStyle(ri, false), ev(it.hardness || ''));
    put(row, 9,  dataStyle(ri, false), ev(it.surface || ''));
    put(row, 10, dataStyle(ri, true),  qty);
    put(row, 11, dataStyle(ri, true),  sale);
    put(row, 12, dataStyle(ri, true),  quote);
    put(row, 13, sumStyle(ri),         lineQuote);
    put(row, 14, dataStyle(ri, false), ev(it.remark || ''));
    pushRow(26);
  });

  /* 供应商分配明细 */
  var allocRows = [];
  o.items.forEach(function (it) { (it.options || []).forEach(function (opt) { allocRows.push({ it: it, opt: opt }); }); });
  if (allocRows.length) {
    pushRow(8);
    merge(row, 0, TOTAL_COLS - 1);
    put(row, 0, SS.subtitle, '供应商分配明细（共 ' + allocRows.length + ' 条）');
    pushRow(36);

    var aHeaders = ['产品', '供应商', '联系人', '分配(千支)', '是否寄出', '寄出数量', '寄出日期', '是否收到', '收到数量', '收货日期'];
    aHeaders.forEach(function (h, c) { put(row, c, SS.th, h); });
    pushRow(40);

    allocRows.forEach(function (r, i) {
      var opt = r.opt, ri = i + 1;
      var hasShp = !!(opt.shipped && parseFloat(opt.shippedQty) > 0);
      var hasRcv = !!(opt.received && parseFloat(opt.receivedQty) > 0);
      put(row, 0, dataStyle(ri, false), ev((r.it.sku || r.it.name || '') + (r.it.spec ? ' ' + r.it.spec : '')));
      put(row, 1, dataStyle(ri, false), ev(pName(opt.supplierId)));
      put(row, 2, dataStyle(ri, false), ev(opt.contact || '-'));
      put(row, 3, dataStyle(ri, true),  parseFloat(opt.allocQty) || 0);
      put(row, 4, dataStyle(ri, false), opt.shipped ? '是' : '否');
      put(row, 5, dataStyle(ri, hasShp), hasShp ? parseFloat(opt.shippedQty) : '-');
      put(row, 6, dataStyle(ri, false), opt.shipped ? ev(opt.shippedDate || '-') : '-');
      put(row, 7, dataStyle(ri, false), opt.received ? '是' : '否');
      put(row, 8, dataStyle(ri, hasRcv), hasRcv ? parseFloat(opt.receivedQty) : '-');
      put(row, 9, dataStyle(ri, false), opt.received ? ev(opt.receivedDate || '-') : '-');
      pushRow(26);
    });
  }

  /* 汇总 */
  pushRow(8);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.subtitle, '汇总');
  pushRow(26);

  put(row, 0, SS.sumLbl, '产品项数'); merge(row, 1, 3); put(row, 1, SS.sumVal, o.items.length);
  put(row, 4, SS.sumLbl, '意向总额（元）'); merge(row, 5, 7); put(row, 5, SS.sumVal, grandSale);
  put(row, 8, SS.totalLbl, '报价总额（元）'); merge(row, 9, TOTAL_COLS - 1); put(row, 9, SS.totalVal, grandQuote);
  pushRow(32);

  /* 页脚 */
  pushRow(10);
  merge(row, 0, TOTAL_COLS - 1);
  put(row, 0, SS.footer, '本文件由紧固件贸易工作台自动生成  |  导出时间：' + new Date().toLocaleString('zh-CN'));
  pushRow(28);

  /* !ref 范围与自动列宽 */
  ws['!ref'] = 'A1:' + TOTAL_LETTER + row;
  _autoFitCols(ws, TOTAL_COLS);

  /* 补全合并单元格边框 */
  _fillMergeBorders(ws);

  var fname = '采购订单_' + o.id + '_' + o.status;
  await downloadWorkbook(wb, fname);
  toast('导出成功：' + fname + '.xlsx', 'success');
}
