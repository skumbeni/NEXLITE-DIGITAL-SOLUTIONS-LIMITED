'use strict';
// barcode.js — barcodes for MDM, in one plain script that index.html AND pos.html load (and node can require(), for the tests).
//
//   DRAW    EAN-13, UPC-A (as EAN-13 with a leading 0), EAN-8 and Code 128, as SVG (A4 sheets) or on a canvas (thermal labels).
//   LAYOUT  labelSheetHtml(): sticker sheets / plain A4 to cut out.   thermalJob(): ESC/POS picture bytes for RawBT.
//   READ    a BarcodeDetector for browsers that have none (iPhone Safari, desktop Chrome). It is installed ONLY when the browser has no
//           BarcodeDetector of its own, so Chrome and Samsung Internet on Android keep using theirs. The camera code in the till,
//           Scan Receive and Scan Count calls  new BarcodeDetector(...).detect(video)  and works unchanged.
//
// No library, nothing to download, works offline. Keep barcode.js in the sw.js precache list.
//
// WHAT THE READER CAN READ: EAN-13, EAN-8, UPC-A, Code 128 (all four carry a check digit or checksum, so a misread is thrown away).
// It does NOT read QR codes, Code 39, ITF or UPC-E: a browser with its own BarcodeDetector still does. A barcode must be roughly
// upright or on its side and fill a fair part of the picture; it reads rows and columns of the frame, so it is slower and less
// forgiving than the native reader. A hardware scanner is still the best tool for a busy till.

(function (root) {

  // ───────────────────────────── ENCODING ─────────────────────────────
  var L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  function inv(s) { return s.replace(/./g, function (c) { return c === '0' ? '1' : '0'; }); }
  function rev(s) { return s.split('').reverse().join(''); }
  var R = L.map(inv), G = R.map(rev);                       // right-hand digits are the inverse of L; G is R backwards
  var PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

  // Code 128: the 107 symbols as bar/space widths (bar first). 103-105 are the start codes, 106 the stop.
  var P128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
    '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
    '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
    '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
    '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
    '114131 311141 411131 211412 211214 211232 2331112').split(' ').map(function (s) { return s.split('').map(Number); });

  function ean13Check(d12) { var t = 0; for (var i = 0; i < 12; i++) t += (+d12[i]) * (i % 2 ? 3 : 1); return (10 - t % 10) % 10; }
  function ean8Check(d7) { var t = 0; for (var i = 0; i < 7; i++) t += (+d7[i]) * (i % 2 ? 1 : 3); return (10 - t % 10) % 10; }

  // text -> { kind: 'ean13' | 'ean8' | 'code128', text } or null. A 12-digit UPC-A is drawn as EAN-13 with a leading 0 (every scanner reads it as UPC-A).
  // Digits that do not pass the check digit are drawn as Code 128, so the label always scans back to exactly the stored text.
  function parse(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return null;
    if (/^\d{13}$/.test(s) && ean13Check(s.slice(0, 12)) === +s[12]) return { kind: 'ean13', text: s };
    if (/^\d{12}$/.test(s) && ean13Check('0' + s.slice(0, 11)) === +s[11]) return { kind: 'ean13', text: '0' + s, upc: s };
    if (/^\d{8}$/.test(s) && ean8Check(s.slice(0, 7)) === +s[7]) return { kind: 'ean8', text: s };
    if (/^[\x20-\x7E]{1,80}$/.test(s)) return { kind: 'code128', text: s };
    return null;
  }

  function bitsToRuns(bits) {
    var out = [], c = 1;
    for (var i = 1; i < bits.length; i++) { if (bits[i] === bits[i - 1]) c++; else { out.push(c); c = 1; } }
    out.push(c);
    return out;                                              // bits always start with a bar, so run 0 is a bar
  }

  function code128Values(s) {
    var v = [], i = 0, n = s.length, mode;
    function run(k) { var c = 0; while (k + c < n && s.charCodeAt(k + c) >= 48 && s.charCodeAt(k + c) <= 57) c++; return c; }
    var r0 = run(0);
    if ((r0 === n && r0 >= 2) || r0 >= 4) { mode = 'C'; v.push(105); } else { mode = 'B'; v.push(104); }
    while (i < n) {
      var rr = run(i);
      if (mode === 'C') {
        if (rr >= 2) { v.push((+s[i]) * 10 + (+s[i + 1])); i += 2; } else { mode = 'B'; v.push(100); }
      } else if (rr >= 6 || (rr >= 4 && i + rr === n)) {
        if (rr % 2 === 1) { v.push(s.charCodeAt(i) - 32); i++; }  // an odd run: the first digit stays in B so the pairs line up
        v.push(99); mode = 'C';
      } else { v.push(s.charCodeAt(i) - 32); i++; }
    }
    var sum = v[0]; for (var k = 1; k < v.length; k++) sum += v[k] * k;
    v.push(sum % 103);
    return v;
  }

  // parsed -> { runs: bar/space widths in modules (bar first), modules, quietL, quietR, guards: [[firstModule, lastModule], ...] }
  function encode(p) {
    var runs, modules, guards = null, ql, qr, i;
    if (p.kind === 'ean13') {
      var d = p.text, par = PARITY[+d[0]], bits = '101';
      for (i = 0; i < 6; i++) bits += (par[i] === 'L' ? L : G)[+d[1 + i]];
      bits += '01010';
      for (i = 0; i < 6; i++) bits += R[+d[7 + i]];
      bits += '101';
      runs = bitsToRuns(bits); modules = 95; ql = 11; qr = 7; guards = [[0, 2], [45, 49], [92, 94]];
    } else if (p.kind === 'ean8') {
      var e = p.text, b8 = '101';
      for (i = 0; i < 4; i++) b8 += L[+e[i]];
      b8 += '01010';
      for (i = 4; i < 8; i++) b8 += R[+e[i]];
      b8 += '101';
      runs = bitsToRuns(b8); modules = 67; ql = 7; qr = 7; guards = [[0, 2], [31, 35], [64, 66]];
    } else {
      var vals = code128Values(p.text).concat([106]);
      runs = []; modules = 0;
      vals.forEach(function (c) { P128[c].forEach(function (w) { runs.push(w); modules += w; }); });
      ql = 10; qr = 10;
    }
    return { kind: p.kind, text: p.text, runs: runs, modules: modules, quietL: ql, quietR: qr, guards: guards };
  }

  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function f3(n) { return String(+n.toFixed(3)); }

  // The module numbers (0-based, inside the symbol) where the digits of an EAN symbol are centred.
  function digitCentres(kind, text) {
    var out = [], i;
    if (kind === 'ean13') { out.push([text[0], -5]); for (i = 0; i < 6; i++) out.push([text[1 + i], 3 + 7 * i + 3.5]); for (i = 0; i < 6; i++) out.push([text[7 + i], 50 + 7 * i + 3.5]); }
    else if (kind === 'ean8') { for (i = 0; i < 4; i++) out.push([text[i], 3 + 7 * i + 3.5]); for (i = 0; i < 4; i++) out.push([text[4 + i], 36 + 7 * i + 3.5]); }
    return out;
  }

  // SVG of one barcode, in millimetres. o: { module: mm per module (0.33), bar: bar height in mm, text: false = no digits, font: digit height in mm,
  // quiet: false = no quiet zone, color, bg, mm: false = no width/height attributes (size it with CSS) }
  function svg(text, o) {
    o = o || {};
    var p = typeof text === 'object' && text && text.kind ? text : parse(text);
    if (!p) return '';
    var e = encode(p), m = o.module || 0.33, bar = o.bar || 14, withText = o.text !== false;
    var fs = withText ? (o.font || Math.max(2, Math.min(3.2, m * 7.5))) : 0;
    var ql = o.quiet === false ? 0 : e.quietL, qr = o.quiet === false ? 0 : e.quietR;
    var W = (ql + e.modules + qr) * m, ext = e.guards && fs ? fs * 0.9 : 0, H = bar + (fs ? fs * 1.2 : 0);
    var color = o.color || '#000', x = ql * m, d = '', i, isGuard = function (mod) { return e.guards && e.guards.some(function (g) { return mod >= g[0] && mod <= g[1]; }); };
    var mod = 0;
    e.runs.forEach(function (w, k) {
      if (k % 2 === 0) { var hh = bar + (isGuard(mod) ? ext : 0); d += 'M' + f3(x) + ' 0h' + f3(w * m) + 'v' + f3(hh) + 'h-' + f3(w * m) + 'z'; }
      x += w * m; mod += w;
    });
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + f3(W) + ' ' + f3(H) + '"' + (o.mm === false ? '' : ' width="' + f3(W) + 'mm" height="' + f3(H) + 'mm"') +
      ' shape-rendering="crispEdges" role="img" aria-label="' + escHtml(p.text) + '"><rect width="' + f3(W) + '" height="' + f3(H) + '" fill="' + (o.bg || '#fff') + '"/><path fill="' + color + '" d="' + d + '"/>';
    if (fs) {
      var font = 'font-family="Arial,Helvetica,sans-serif" font-size="' + f3(fs) + '" fill="' + color + '"', y = bar + fs * 0.98;
      if (e.kind === 'code128') out += '<text x="' + f3(W / 2) + '" y="' + f3(y) + '" text-anchor="middle" ' + font + '>' + escHtml(p.text) + '</text>';
      else digitCentres(e.kind, e.text).forEach(function (c) { out += '<text x="' + f3((ql + c[1]) * m) + '" y="' + f3(y) + '" text-anchor="middle" ' + font + '>' + c[0] + '</text>'; });
    }
    return out + '</svg>';
  }

  // Draws the bars on a canvas at whole dots (so every module is the same width on paper). Returns the symbol's width in dots.
  function drawBars(ctx, p, x0, y0, module, barH, guardExt) {
    var e = encode(p), x = x0, mod = 0;
    ctx.fillStyle = '#000';
    e.runs.forEach(function (w, k) {
      if (k % 2 === 0) {
        var g = e.guards && e.guards.some(function (q) { return mod >= q[0] && mod <= q[1]; });
        ctx.fillRect(x, y0, w * module, barH + (g ? (guardExt || 0) : 0));
      }
      x += w * module; mod += w;
    });
    return e.modules * module;
  }

  // ───────────────────────────── LABEL SHEETS (A4) ─────────────────────────────
  // Sticker sheets differ a little between makes: measure yours and pick the nearest. 'plain' is ordinary A4 paper with dotted cut lines.
  var SHEETS = {
    '3x8': { name: 'Stickers, 24 per sheet (64 x 34 mm)', cols: 3, rows: 8, w: 63.5, h: 33.9, left: 7.2, top: 15.15, gx: 2.5, gy: 0 },
    '2x7': { name: 'Stickers, 14 per sheet (99 x 38 mm)', cols: 2, rows: 7, w: 99.1, h: 38.1, left: 4.65, top: 15.15, gx: 2.5, gy: 0 },
    '5x13': { name: 'Stickers, 65 per sheet (38 x 21 mm)', cols: 5, rows: 13, w: 38.1, h: 21.2, left: 4.7, top: 10.7, gx: 1.9, gy: 0 },
    'plain': { name: 'Plain A4 to cut out, 24 per sheet', cols: 3, rows: 8, w: 62, h: 34, left: 8, top: 12.5, gx: 4, gy: 0, cut: true }
  };

  function oneLabelHtml(lb, P, o) {
    var pad = Math.min(1.6, P.h * 0.05), availW = P.w - pad * 2, p = parse(lb.code);
    var nameFs = Math.max(2.3, Math.min(3.6, P.h * 0.095)), priceFs = Math.max(3, Math.min(5.2, P.h * 0.15));
    var showPrice = o.price !== false && lb.price > 0, shop = o.shop ? String(o.shop) : '';
    var inner = '';
    if (shop) inner += '<div class="sh" style="font-size:' + f3(Math.max(1.9, nameFs * 0.72)) + 'mm">' + escHtml(shop) + '</div>';
    inner += '<div class="nm" style="font-size:' + f3(nameFs) + 'mm">' + escHtml(lb.name) + '</div>';
    if (showPrice) inner += '<div class="pr" style="font-size:' + f3(priceFs) + 'mm">' + escHtml((o.cur ? o.cur + ' ' : '') + Number(lb.price).toFixed(2)) + '</div>';
    if (p) {
      var e = encode(p), total = e.quietL + e.modules + e.quietR, m = Math.max(0.2, Math.min(0.45, availW / total));
      var used = pad * 2 + nameFs * 1.2 * (o.names2 === false ? 1 : 1.9) + (showPrice ? priceFs * 1.2 : 0) + (shop ? nameFs : 0);
      var bar = Math.max(7, Math.min(22, P.h - used - m * 8 - 1));
      inner += '<div class="bc">' + svg(p, { module: m, bar: bar, font: Math.max(2, Math.min(3, m * 7.5)) }) + '</div>';
    } else inner += '<div class="nm">(no barcode)</div>';
    return inner;
  }

  // The width in mm of the thinnest bar this code gets on one label of the sheet. Below about 0.24 mm cheap scanners start to miss it.
  function fitModule(code, preset) {
    var P = SHEETS[preset] || SHEETS['3x8'], p = parse(code);
    if (!p) return 0;
    var e = encode(p), pad = Math.min(1.6, P.h * 0.05);
    return (P.w - pad * 2) / (e.quietL + e.modules + e.quietR);
  }

  // labels: [{ name, code, price }] (already repeated once per sticker). o: { preset, skip, price, shop, cur, title, autoprint }
  function sheetHtml(labels, o) {
    o = o || {};
    var P = SHEETS[o.preset] || SHEETS['3x8'], per = P.cols * P.rows, skip = Math.max(0, Math.min(per - 1, o.skip | 0));
    var cells = [], i;
    for (i = 0; i < skip; i++) cells.push(null);
    labels.forEach(function (l) { cells.push(l); });
    var pages = Math.max(1, Math.ceil(cells.length / per)), body = '';
    for (var pg = 0; pg < pages; pg++) {
      body += '<div class="sheet">';
      for (var k = 0; k < per; k++) {
        var lb = cells[pg * per + k];
        if (!lb) continue;
        var c = k % P.cols, r = Math.floor(k / P.cols);
        body += '<div class="lb' + (P.cut ? ' cut' : '') + '" style="left:' + f3(P.left + c * (P.w + P.gx)) + 'mm;top:' + f3(P.top + r * (P.h + P.gy)) + 'mm">' + oneLabelHtml(lb, P, o) + '</div>';
      }
      body += '</div>';
    }
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escHtml(o.title || 'Barcode labels') + '</title><style>' +
      '@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#e9ebee}body{font-family:Arial,Helvetica,sans-serif;color:#000}' +
      '.bar{position:sticky;top:0;z-index:9;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:9px 14px;background:#f5f6f8;border-bottom:1px solid #ccc;font-size:13px}' +
      '.bar button{font:inherit;font-weight:700;padding:8px 14px;border-radius:7px;border:0;background:#1E8449;color:#fff;cursor:pointer}.bar span{color:#666}' +
      '.sheet{position:relative;width:210mm;height:297mm;margin:10px auto;background:#fff;overflow:hidden;page-break-after:always;break-after:page;box-shadow:0 1px 6px rgba(0,0,0,.25)}.sheet:last-child{page-break-after:auto;break-after:auto}' +
      '.lb{position:absolute;width:' + P.w + 'mm;height:' + P.h + 'mm;padding:' + f3(Math.min(1.6, P.h * 0.05)) + 'mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.4mm;overflow:hidden;text-align:center;background:#fff}' +
      '.lb.cut{outline:0.2mm dotted #888;outline-offset:-0.1mm}.nm{font-weight:700;line-height:1.15;max-height:2.4em;overflow:hidden;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.pr{font-weight:800;line-height:1.1}.sh{color:#444;line-height:1.1}.bc{line-height:0;max-width:100%}.bc svg{display:block;max-width:100%;height:auto}' +
      '@media print{html,body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.bar{display:none}.sheet{margin:0;box-shadow:none}}</style></head><body>' +
      '<div class="bar"><button onclick="window.print()">Print / Save PDF</button><span>' + cells.filter(Boolean).length + ' label(s), ' + pages + ' page(s). Print at 100% (Actual size), not "Fit to page".</span></div>' + body +
      (o.autoprint ? '<script>window.addEventListener("load",function(){setTimeout(function(){try{window.focus();window.print();}catch(e){}},500);});<\/script>' : '') + '</body></html>';
  }

  // ───────────────────────────── THERMAL LABELS (ESC/POS picture) ─────────────────────────────
  // makeCanvas(w, h) -> a canvas (document.createElement('canvas') in the page). Every label is drawn at whole dots, 1 bit per dot, so the
  // bars come out exactly as wide as the printer can make them. 58 mm paper = 384 dots, 80 mm = 576 (203 dpi).
  function wrapLines(ctx, text, maxW, maxLines) {
    var words = String(text || '').split(/\s+/).filter(Boolean), lines = [], cur = '';
    function fit(s) { return ctx.measureText(s).width <= maxW; }
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (fit(t)) { cur = t; return; }
      if (cur) lines.push(cur);
      cur = w;
      while (!fit(cur) && cur.length > 1) cur = cur.slice(0, -1);   // one word wider than the paper: cut it
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length > 1 && !fit(last + '\u2026')) last = last.slice(0, -1);
      lines[maxLines - 1] = last + '\u2026';
    }
    return lines;
  }

  // One label -> { w, h, gray } or { error }. item: { name, code, price }. o: { dots, price, shop, cur, cut }
  function thermalLabel(item, o, makeCanvas) {
    o = o || {};
    var D = o.dots || 384, p = parse(item.code);
    if (!p) return { error: 'no barcode' };
    var e = encode(p), total = e.quietL + e.modules + e.quietR, m = Math.min(5, Math.floor((D - 8) / total));
    if (m < 2) return { error: 'code too long for this paper' };
    var barH = Math.max(64, m * 20), ext = 12, fs = 22, big = D >= 576 ? 34 : 28;
    var shop = o.shop ? String(o.shop) : '', showPrice = o.price !== false && item.price > 0;
    var probe = makeCanvas(D, 10).getContext('2d');
    probe.font = 'bold ' + big + 'px Arial, Helvetica, sans-serif';
    var nameLines = wrapLines(probe, item.name, D - 16, 2);
    var H = 10 + (shop ? 24 : 0) + nameLines.length * (big + 4) + (showPrice ? big + 12 : 0) + barH + ext + fs + 20 + (o.cut === false ? 6 : 14);
    H = Math.ceil(H / 8) * 8;
    var cv = makeCanvas(D, H), ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, D, H); ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    var y = 10;
    if (shop) { ctx.font = '20px Arial, Helvetica, sans-serif'; ctx.fillText(shop.slice(0, 40), D / 2, y + 18); y += 24; }
    ctx.font = 'bold ' + big + 'px Arial, Helvetica, sans-serif';
    nameLines.forEach(function (ln) { ctx.fillText(ln, D / 2, y + big - 4); y += big + 4; });
    if (showPrice) { ctx.font = 'bold ' + (big + 6) + 'px Arial, Helvetica, sans-serif'; ctx.fillText((o.cur ? o.cur + ' ' : '') + Number(item.price).toFixed(2), D / 2, y + big + 2); y += big + 12; }
    var x0 = Math.floor((D - total * m) / 2) + e.quietL * m;
    drawBars(ctx, p, x0, y, m, barH, ext);
    ctx.font = fs + 'px "Courier New", monospace';
    var ty = y + barH + ext + fs - 2;
    if (e.kind === 'code128') ctx.fillText(p.text.length > 40 ? p.text.slice(0, 40) : p.text, D / 2, ty);
    else digitCentres(e.kind, e.text).forEach(function (c) { ctx.fillText(c[0], x0 + c[1] * m, ty); });
    if (o.cut !== false) { ctx.fillRect(0, 0, 0, 0); for (var x = 4; x < D - 4; x += 16) ctx.fillRect(x, H - 6, 8, 2); }
    var px = ctx.getImageData(0, 0, D, H).data, g = new Uint8Array(D * H);
    for (var i = 0; i < D * H; i++) g[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 151 + px[i * 4 + 2] * 28) >> 8;
    return { w: D, h: H, gray: g };
  }

  // Grey levels -> ESC/POS raster commands (GS v 0), BAND rows each. Dark (< 128) = a printed dot.
  function rasterBands(gray, D, rows, BAND) {
    BAND = BAND || 200;
    var rb = D >> 3, out = [];
    for (var y = 0; y < rows; y += BAND) {
      var n = Math.min(BAND, rows - y), c = new Uint8Array(8 + rb * n), o = 8;
      c[0] = 29; c[1] = 118; c[2] = 48; c[3] = 0; c[4] = rb & 255; c[5] = rb >> 8; c[6] = n & 255; c[7] = n >> 8;
      for (var r = 0; r < n; r++) {
        var base = (y + r) * D;
        for (var x = 0; x < rb; x++) { var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | (gray[base + x * 8 + j] < 128 ? 1 : 0); c[o++] = b; }
      }
      out.push(c);
    }
    return out;
  }

  // items: [{ name, code, price, copies }]. -> { parts: [Uint8Array], count, skipped: [names] }. A part is at most MAXPART bytes and always ends
  // between two labels, so RawBT can take them one tap at a time.
  function thermalJob(items, o, makeCanvas) {
    o = o || {};
    var MAXPART = o.maxPart || 150000, parts = [], cur = [Uint8Array.of(27, 64)], size = 2, count = 0, skipped = [];
    items.forEach(function (it) {
      var copies = Math.max(1, Math.min(500, it.copies | 0 || 1)), lab = thermalLabel(it, o, makeCanvas);
      if (lab.error) { skipped.push(it.name + ' (' + lab.error + ')'); return; }
      var bands = rasterBands(lab.gray, lab.w, lab.h), bytes = bands.reduce(function (a, b) { return a + b.length; }, 0);
      for (var k = 0; k < copies; k++) {
        if (size + bytes > MAXPART && cur.length > 1) { parts.push(cur); cur = [Uint8Array.of(27, 64)]; size = 2; }
        bands.forEach(function (b) { cur.push(b); }); size += bytes; count++;
      }
    });
    if (cur.length > 1) parts.push(cur);
    var bufs = parts.map(function (list, i) {
      if (i === parts.length - 1) list.push(Uint8Array.of(27, 100, 4));          // ESC d 4: feed the last label out
      var n = list.reduce(function (a, b) { return a + b.length; }, 0), u = new Uint8Array(n), q = 0;
      list.forEach(function (b) { u.set(b, q); q += b.length; });
      return u;
    });
    return { parts: bufs, count: count, skipped: skipped };
  }

  // ───────────────────────────── READING (camera fallback) ─────────────────────────────
  function widthsOf(bits) { return bitsToRuns(bits); }
  var LG_PATS = L.map(widthsOf).concat(G.map(widthsOf));         // 0-9 = L digit, 10-19 = G digit
  var R_PATS = R.map(widthsOf);
  var START_PATS = [P128[103], P128[104], P128[105]], SYM_PATS = P128.slice(0, 103).concat([P128[103], P128[104], P128[105]]), STOP = P128[106];

  // The pattern (of n runs, `mods` modules in all) that the runs at r[i..i+n) look most like: { idx, err } or null.
  function matchSym(r, i, n, pats, mods) {
    var sum = 0, k, j;
    for (k = 0; k < n; k++) sum += r[i + k];
    if (!(sum > 0)) return null;
    var u = sum / mods, best = -1, be = 1e9, dev;
    for (j = 0; j < pats.length; j++) {
      var p = pats[j], err = 0, mx = 0;
      for (k = 0; k < n; k++) { dev = Math.abs(r[i + k] / u - p[k]); err += dev; if (dev > mx) mx = dev; }
      if (mx < 0.95 && err < be) { be = err; best = j; }
    }
    return best < 0 ? null : { idx: best, err: be };
  }
  function near(x, u, lo, hi) { var q = x / u; return q >= lo && q <= hi; }

  function guardOk(r, s, u) { return near(r[s], u, 0.5, 1.7) && near(r[s + 1], u, 0.5, 1.7) && near(r[s + 2], u, 0.5, 1.7); }

  // EAN-13 / UPC-A starting at the bar r[s] (partial: runs cut by the edge of the picture; they may only serve as quiet zones)
  function ean13At(r, partial, s) {
    if (s < 1 || s + 59 > r.length) return null;
    var k, i, u = (r[s] + r[s + 1] + r[s + 2]) / 3;
    for (k = s; k < s + 59; k++) if (partial[k]) return null;
    if (!guardOk(r, s, u) || r[s - 1] < u * 3.5) return null;
    var digits = [], par = '', m;
    i = s + 3;
    for (k = 0; k < 6; k++, i += 4) {
      m = matchSym(r, i, 4, LG_PATS, 7);
      if (!m || m.err > 1.5) return null;
      var uu = (r[i] + r[i + 1] + r[i + 2] + r[i + 3]) / 7;
      if (uu < u * 0.55 || uu > u * 1.8) return null;
      digits.push(m.idx % 10); par += m.idx < 10 ? 'L' : 'G';
    }
    for (k = 0; k < 5; k++) if (!near(r[i + k], u, 0.45, 1.9)) return null;
    i += 5;
    for (k = 0; k < 6; k++, i += 4) {
      m = matchSym(r, i, 4, R_PATS, 7);
      if (!m || m.err > 1.5) return null;
      digits.push(m.idx);
    }
    for (k = 0; k < 3; k++) if (!near(r[i + k], u, 0.5, 1.8)) return null;
    var first = PARITY.indexOf(par);
    if (first < 0) return null;
    var text = first + digits.join('');
    if (ean13Check(text.slice(0, 12)) !== +text[12]) return null;
    return { text: text, last: s + 58, first: s };
  }

  function ean8At(r, partial, s) {
    if (s < 1 || s + 43 > r.length) return null;
    var k, i, u = (r[s] + r[s + 1] + r[s + 2]) / 3;
    for (k = s; k < s + 43; k++) if (partial[k]) return null;
    if (!guardOk(r, s, u) || r[s - 1] < u * 3.5) return null;
    var digits = [], m;
    i = s + 3;
    for (k = 0; k < 4; k++, i += 4) {
      m = matchSym(r, i, 4, LG_PATS.slice(0, 10), 7);
      if (!m || m.err > 1.5) return null;
      digits.push(m.idx);
    }
    for (k = 0; k < 5; k++) if (!near(r[i + k], u, 0.45, 1.9)) return null;
    i += 5;
    for (k = 0; k < 4; k++, i += 4) {
      m = matchSym(r, i, 4, R_PATS, 7);
      if (!m || m.err > 1.5) return null;
      digits.push(m.idx);
    }
    for (k = 0; k < 3; k++) if (!near(r[i + k], u, 0.5, 1.8)) return null;
    var text = digits.join('');
    if (ean8Check(text.slice(0, 7)) !== +text[7]) return null;
    return { text: text, last: s + 42, first: s };
  }

  function code128At(r, partial, s) {
    if (s < 1 || s + 13 > r.length) return null;
    var k, sum = 0;
    for (k = 0; k < 6; k++) { if (partial[s + k]) return null; sum += r[s + k]; }
    var u = sum / 11;
    if (r[s - 1] < u * 4.5) return null;
    var st = matchSym(r, s, 6, START_PATS, 11);
    if (!st || st.err > 1.7) return null;
    var vals = [103 + st.idx], i = s + 6, m;
    for (;;) {
      if (vals.length > 90) return null;
      if (i + 7 <= r.length) {
        var ok = true; for (k = 0; k < 7; k++) if (partial[i + k]) { ok = false; break; }
        if (ok) { var sp = matchSym(r, i, 7, [STOP], 13); if (sp && sp.err < 2.1) { i += 6; break; } }
      }
      if (i + 6 > r.length) return null;
      for (k = 0; k < 6; k++) if (partial[i + k]) return null;
      m = matchSym(r, i, 6, SYM_PATS, 11);
      if (!m || m.err > 1.7) return null;
      vals.push(m.idx); i += 6;
    }
    var n = vals.length;
    if (n < 4) return null;
    var chk = vals[0]; for (k = 1; k < n - 1; k++) chk += vals[k] * k;
    if (chk % 103 !== vals[n - 1]) return null;
    var mode = vals[0] === 103 ? 'A' : vals[0] === 104 ? 'B' : 'C', text = '';
    for (k = 1; k < n - 1; k++) {
      var v = vals[k];
      if (mode === 'C') { if (v < 100) text += (v < 10 ? '0' : '') + v; else if (v === 100) mode = 'B'; else if (v === 101) mode = 'A'; else return null; }
      else if (mode === 'B') { if (v < 96) text += String.fromCharCode(v + 32); else if (v === 99) mode = 'C'; else if (v === 101) mode = 'A'; else return null; }
      else { if (v < 64) text += String.fromCharCode(v + 32); else if (v < 96) return null; else if (v === 99) mode = 'C'; else if (v === 100) mode = 'B'; else return null; }
    }
    if (text.length < 2) return null;
    return { text: text, last: i, first: s };
  }

  // A row of grey values -> runs of dark/light with sub-pixel edges. { r: widths, pos: start of each run, partial, c0: true when run 0 is a bar }
  function toRuns(g, n) {
    var s = new Float32Array(n), i;
    s[0] = g[0]; s[n - 1] = g[n - 1];
    for (i = 1; i < n - 1; i++) s[i] = (g[i - 1] + 2 * g[i] + g[i + 1]) * 0.25;
    var Rw = Math.max(10, Math.min(Math.round(n / 8), 120)), mn = new Float32Array(n), mx = new Float32Array(n);
    var dq = new Int32Array(n), h = 0, t = 0, j;
    for (i = 0, j = 0; i < n; i++) {                                       // sliding-window maximum
      while (j <= Math.min(n - 1, i + Rw)) { while (t > h && s[dq[t - 1]] <= s[j]) t--; dq[t++] = j; j++; }
      while (dq[h] < i - Rw) h++;
      mx[i] = s[dq[h]];
    }
    h = 0; t = 0;
    for (i = 0, j = 0; i < n; i++) {                                       // sliding-window minimum
      while (j <= Math.min(n - 1, i + Rw)) { while (t > h && s[dq[t - 1]] >= s[j]) t--; dq[t++] = j; j++; }
      while (dq[h] < i - Rw) h++;
      mn[i] = s[dq[h]];
    }
    var d = new Float32Array(n);
    for (i = 0; i < n; i++) d[i] = (mx[i] - mn[i] < 28) ? (s[i] > 140 ? 40 : -40) : s[i] - (mx[i] + mn[i]) * 0.5;
    var X = [];
    for (i = 0; i < n - 1; i++) if ((d[i] < 0) !== (d[i + 1] < 0)) X.push(i + d[i] / (d[i] - d[i + 1]));
    if (X.length < 10) return null;
    var r = [X[0]], pos = [0], partial = [true];
    for (i = 1; i < X.length; i++) { r.push(X[i] - X[i - 1]); pos.push(X[i - 1]); partial.push(false); }
    r.push(n - 1 - X[X.length - 1]); pos.push(X[X.length - 1]); partial.push(true);
    return { r: r, pos: pos, partial: partial, c0: d[0] < 0 };
  }

  // All barcodes found in one row: [{ text, format, x0, x1 }]
  function decodeRow(g, n) {
    var rr = toRuns(g, n), out = [];
    if (!rr) return out;
    [false, true].forEach(function (backwards) {
      var r = rr.r, partial = rr.partial, pos = rr.pos, c0 = rr.c0, N = r.length;
      if (backwards) {
        r = r.slice().reverse(); partial = partial.slice().reverse();
        c0 = (N - 1) % 2 === 0 ? rr.c0 : !rr.c0;                          // the colour of the old last run
        var ends = rr.pos.map(function (p, i) { return i + 1 < N ? rr.pos[i + 1] : n - 1; });
        pos = ends.slice().reverse();                                   // start of each reversed run = end of the original
      }
      for (var s = 1; s < N - 12; s++) {
        if (((s % 2 === 0) !== c0)) continue;                           // runs at these places are light, a symbol starts with a bar
        var a = r[s], b = r[s + 1], c = r[s + 2];
        var hit = null, fmt = '';
        if (near(b, a, 0.4, 2.4) && near(c, a, 0.4, 2.4)) {
          hit = ean13At(r, partial, s); fmt = 'ean_13';
          if (!hit) { hit = ean8At(r, partial, s); fmt = 'ean_8'; }
        }
        if (!hit) { hit = code128At(r, partial, s); fmt = 'code_128'; }
        if (hit) {
          var xa = pos[hit.first], xb = backwards ? pos[hit.last] - r[hit.last] : (hit.last + 1 < pos.length ? pos[hit.last + 1] : n - 1);
          var lo = Math.min(xa, xb), hi = Math.max(xa, xb), text = hit.text;
          if (fmt === 'ean_13' && text[0] === '0') { fmt = 'upc_a'; text = text.slice(1); }   // the same symbol; the native reader says UPC-A too
          out.push({ text: text, format: fmt, x0: lo, x1: hi });
          s = hit.last;
        }
      }
    });
    return out;
  }

  // A grey picture (w x h, one byte per pixel) -> [{ rawValue, format, boundingBox, cornerPoints }] like BarcodeDetector.detect().
  // Reads rows across the middle of the picture and then columns (a barcode held sideways). A code must be seen on two lines.
  function scanGray(gray, w, h, opt) {
    opt = opt || {};
    var minVotes = opt.minVotes || 2, found = {}, y, x, i, k;
    function add(res, sideways, at) {
      res.forEach(function (q) {
        var key = q.format + '|' + q.text, f = found[key] || (found[key] = { text: q.text, format: q.format, votes: 0, a0: 1e9, a1: -1, b0: 1e9, b1: -1, side: sideways });
        if (f.side !== sideways) return;
        f.votes++; f.a0 = Math.min(f.a0, q.x0); f.a1 = Math.max(f.a1, q.x1); f.b0 = Math.min(f.b0, at); f.b1 = Math.max(f.b1, at);
      });
    }
    var rows = [], cols = [], line = new Float32Array(Math.max(w, h));
    for (k = 0; k <= 28; k++) rows.push(Math.round(h * (0.15 + 0.70 * k / 28)));
    for (k = 0; k <= 20; k++) cols.push(Math.round(w * (0.12 + 0.76 * k / 20)));
    rows.forEach(function (yy) {
      var y0 = Math.max(0, yy - 1), y1 = Math.min(h - 1, yy + 1), cnt = y1 - y0 + 1;
      for (x = 0; x < w; x++) { var s = 0; for (y = y0; y <= y1; y++) s += gray[y * w + x]; line[x] = s / cnt; }
      add(decodeRow(line, w), false, yy);
    });
    cols.forEach(function (xx) {
      var x0 = Math.max(0, xx - 1), x1 = Math.min(w - 1, xx + 1), cnt = x1 - x0 + 1;
      for (y = 0; y < h; y++) { var s = 0; for (x = x0; x <= x1; x++) s += gray[y * w + x]; line[y] = s / cnt; }
      add(decodeRow(line, h), true, xx);
    });
    var out = [];
    Object.keys(found).forEach(function (key) {
      var f = found[key];
      if (f.votes < minVotes) return;
      var bb = f.side ? { x: f.b0 - 1, y: f.a0, width: f.b1 - f.b0 + 2, height: f.a1 - f.a0 } : { x: f.a0, y: f.b0 - 1, width: f.a1 - f.a0, height: f.b1 - f.b0 + 2 };
      out.push({ rawValue: f.text, format: f.format, votes: f.votes, boundingBox: bb,
        cornerPoints: [{ x: bb.x, y: bb.y }, { x: bb.x + bb.width, y: bb.y }, { x: bb.x + bb.width, y: bb.y + bb.height }, { x: bb.x, y: bb.y + bb.height }] });
    });
    return out.sort(function (a, b) { return b.votes - a.votes; });
  }

  var FORMATS = ['ean_13', 'ean_8', 'upc_a', 'code_128'];
  var _cv = null;
  function installDetector(w) {
    if (!w || 'BarcodeDetector' in w) return false;
    function Detector(o) { var f = o && o.formats; this.formats = Array.isArray(f) ? f.filter(function (x) { return FORMATS.indexOf(x) >= 0; }) : FORMATS.slice(); }
    Detector.getSupportedFormats = function () { return Promise.resolve(FORMATS.slice()); };
    Detector.prototype.detect = function (src) {
      var self = this;
      return new Promise(function (resolve, reject) {
        try {
          var W = (src && (src.videoWidth || src.naturalWidth || src.width)) | 0, H = (src && (src.videoHeight || src.naturalHeight || src.height)) | 0;
          if (!W || !H) return resolve([]);
          var sc = Math.min(1, 1000 / W), cw = Math.max(1, Math.round(W * sc)), ch = Math.max(1, Math.round(H * sc));
          if (!_cv) _cv = w.document.createElement('canvas');
          _cv.width = cw; _cv.height = ch;
          var ctx = _cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(src, 0, 0, cw, ch);
          var px = ctx.getImageData(0, 0, cw, ch).data, g = new Uint8Array(cw * ch);
          for (var i = 0; i < cw * ch; i++) g[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 151 + px[i * 4 + 2] * 28) >> 8;
          var res = scanGray(g, cw, ch).filter(function (q) { return self.formats.indexOf(q.format) >= 0; }).map(function (q) {
            var b = q.boundingBox, k = 1 / sc;
            return { rawValue: q.rawValue, format: q.format, boundingBox: { x: b.x * k, y: b.y * k, width: b.width * k, height: b.height * k, left: b.x * k, top: b.y * k, right: (b.x + b.width) * k, bottom: (b.y + b.height) * k },
              cornerPoints: q.cornerPoints.map(function (c) { return { x: c.x * k, y: c.y * k }; }) };
          });
          resolve(res);
        } catch (e) { reject(e); }
      });
    };
    Detector.isMdmFallback = true;
    w.BarcodeDetector = Detector;
    return true;
  }

  var API = {
    parse: parse, encode: encode, svg: svg, drawBars: drawBars, ean13Check: ean13Check, ean8Check: ean8Check,
    SHEETS: SHEETS, fitModule: fitModule, sheetHtml: sheetHtml, thermalLabel: thermalLabel, thermalJob: thermalJob, rasterBands: rasterBands,
    decodeRow: decodeRow, scanGray: scanGray, installDetector: installDetector, FORMATS: FORMATS, _P128: P128, _values: code128Values
  };
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (root) { root.MDMBarcode = API; try { installDetector(root); } catch (e) { } }

})(typeof window !== 'undefined' ? window : null);
