/**
 * PreviewKit SDK v2.1.0
 *
 * Modal-based photo customiser — drag · pinch-zoom · mobile-first
 * Drop-in: renders a single "Customize" CTA button; vendor's product images stay untouched.
 * Works with Shopify / WooCommerce / plain HTML.
 *
 * Usage:
 *   PreviewKit.init({ container:'#pk', modelKey:'iphone_17', apiKey:'pk_live_…' });
 *   PreviewKit.on('confirm', fn);
 */
(function (root) {
  'use strict';

  var SDK_VERSION = '2.5.0';
  var DEFAULT_URL = 'http://localhost:8080';
  var SCALE_MIN = 1.0;
  var SCALE_MAX = 4.0;
  var SCALE_STEP = 0.25;

  /* ─── Theme system ────────────────────────────────────────────────────────
     Theme is one of 'light' | 'dark' | 'auto' (default 'auto').
     Auto walks DOM ancestors of the container, computes Rec.709 luminance of
     the first opaque background; <0.5 ⇒ dark, else light. Falls back to
     prefers-color-scheme, finally to light.
  ─────────────────────────────────────────────────────────────────────────── */
  function _luma(rgb) {
    return 0.2126 * (rgb[0]/255) + 0.7152 * (rgb[1]/255) + 0.0722 * (rgb[2]/255);
  }
  function _parseRGB(str) {
    if (!str) return null;
    var m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (!m) return null;
    var alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (alpha < 0.05) return null;
    return [parseInt(m[1],10), parseInt(m[2],10), parseInt(m[3],10)];
  }
  function _resolveTheme(cfgTheme, container) {
    if (cfgTheme === 'light' || cfgTheme === 'dark') return cfgTheme;
    var node = container;
    while (node && node !== document.documentElement) {
      var rgb = _parseRGB(getComputedStyle(node).backgroundColor);
      if (rgb) return _luma(rgb) < 0.5 ? 'dark' : 'light';
      node = node.parentElement;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  }

  // Universal phone-back fallback image (used when no vendorTemplate is provided)
  var FALLBACK_IMAGE_URL = 'https://res.cloudinary.com/dtjbyme7m/image/upload/v1777397169/Iphone17_bp99hm.webp';
  // Photo-zone over the fallback image, expressed in IMAGE-relative fractions (0–1
   // of the natural image size). This keeps it aligned regardless of canvas size.
   // The fallback image (Iphone17_bp99hm.webp) is square; the phone occupies roughly
   // x: 32%..68%, y: 8%..92% of the image. Full Back covers the whole case.
  // Phone bounds within the natural fallback image (Iphone17_bp99hm.webp, 900×900).
  // We crop the image to this rect so the phone fills the canvas tightly (no margin).
  // Vertical span tuned so top + bottom bezels render at the same thickness as the
  // side bezels (was 0.05/0.90 → too thick top/bottom; tightened to 0.065/0.872).
  var FALLBACK_PHONE_BOUNDS_IMG = { xPctImg: 0.295, yPctImg: 0.065, wPctImg: 0.41, hPctImg: 0.872 };

  // Photo zones expressed in IMAGE-relative fractions; converted at render time
  // to pixels within the cropped phone-bounds rect on the canvas.
  // `radiusFrac` (optional, 0–1 fraction of canvas width) round-clips the photo
  // so its corners follow the phone case curvature rather than being sharp.
  var FALLBACK_LAYOUT_ZONES = {
    // Full Back = entire phone case rectangle (matches FALLBACK_PHONE_BOUNDS_IMG
    // exactly so the photo fills edge-to-edge). The case PNG is drawn ON TOP after
    // the photo, so opaque bezels + camera island stay visible above the photo.
    // radiusFrac matches the case PNG's outer corner curvature (~8% of canvas width
    // for the iPhone 17 case). With sharp corners, the photo extended past the case
    // edge into transparent corner area, exposing the modal background and making
    // the corners look "thick". This radius lets the photo terminate exactly at the
    // case outer edge so the bezel appears uniformly thin all the way around.
    full_back:   { xPctImg: 0.295, yPctImg: 0.065, wPctImg: 0.41, hPctImg: 0.872, radiusFrac: 0.08 },
    // Below Camera = photo only below the camera plateau (vertically centered with symmetric ~0.04 margins).
    skip_camera: { xPctImg: 0.32,  yPctImg: 0.40,  wPctImg: 0.36, hPctImg: 0.48 }
  };

  /* ─── CSS ─────────────────────────────────────────────────────────────────── */
  var CSS = [
    /* Base */
    '.pk{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;',
    'color:#0a0a0a;line-height:1;user-select:none;-webkit-user-select:none;',
    '-webkit-tap-highlight-color:transparent;}',

    /* ── Trigger button (standalone, no card) ── */
    '.pk-open-btn{',
    'display:inline-flex;align-items:center;justify-content:center;gap:9px;',
    'width:100%;padding:15px 20px;border:none;border-radius:14px;',
    'background:linear-gradient(135deg,#6366f1 0%,#4f46e5 100%);',
    'color:#fff;font-size:15px;font-weight:600;letter-spacing:-0.1px;',
    'cursor:pointer;',
    'box-shadow:0 4px 20px rgba(99,102,241,0.38),0 1px 4px rgba(99,102,241,0.18);',
    'transition:transform 0.15s,box-shadow 0.15s,background 0.2s;',
    'position:relative;overflow:hidden;',
    '}',
    '.pk-open-btn::before{',
    'content:"";position:absolute;inset:0;',
    'background:linear-gradient(135deg,rgba(255,255,255,0.10) 0%,transparent 60%);',
    'pointer-events:none;',
    '}',
    '.pk-open-btn:hover{transform:translateY(-2px);',
    'box-shadow:0 8px 28px rgba(99,102,241,0.52),0 2px 8px rgba(99,102,241,0.2);}',
    '.pk-open-btn:active{transform:translateY(0);}',
    '.pk-open-btn.pk-btn-done{',
    'background:linear-gradient(135deg,#10b981,#059669);',
    'box-shadow:0 4px 20px rgba(16,185,129,0.4);}',

    /* ── Backdrop ── */
    '.pk-backdrop{',
    'position:fixed;inset:0;',
    'background:rgba(8,8,20,0.72);',
    'backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);',
    'z-index:9998;',
    'display:flex;align-items:center;justify-content:center;',
    'padding:24px;',
    'opacity:0;pointer-events:none;',
    'transition:opacity 0.3s cubic-bezier(0.4,0,0.2,1);',
    '}',
    '.pk-backdrop.pk-open{opacity:1;pointer-events:auto;}',

    /* ── Modal ── */
    '.pk-modal{',
    'position:relative;',
    'width:min(860px,100%);',
    'max-height:min(700px,92vh);',
    'background:#fff;',
    'border-radius:26px;',
    'overflow:hidden;',
    'display:flex;flex-direction:row;',
    'box-shadow:0 40px 120px rgba(0,0,0,0.4),0 4px 28px rgba(0,0,0,0.2);',
    'transform:scale(0.93) translateY(24px);',
    'transition:transform 0.34s cubic-bezier(0.34,1.15,0.64,1);',
    '}',
    '.pk-backdrop.pk-open .pk-modal{transform:scale(1) translateY(0);}',

    /* ── Preview column ── */
    '.pk-preview-col{',
    'flex:0 0 52%;',
    'background:linear-gradient(150deg,#0c0c18 0%,#141428 65%,#191935 100%);',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'padding:44px 36px 30px;gap:22px;',
    'position:relative;overflow:hidden;',
    '}',
    /* Ambient glows */
    '.pk-preview-col::before{content:"";position:absolute;top:-80px;left:50%;transform:translateX(-50%);',
    'width:480px;height:360px;',
    'background:radial-gradient(ellipse,rgba(99,102,241,0.18) 0%,transparent 68%);',
    'pointer-events:none;}',
    '.pk-preview-col::after{content:"";position:absolute;bottom:-80px;right:-80px;',
    'width:240px;height:240px;',
    'background:radial-gradient(circle,rgba(79,70,229,0.1) 0%,transparent 70%);',
    'pointer-events:none;}',

    /* Canvas shell */
    '.pk-shell{',
    'position:relative;border-radius:22px;overflow:hidden;',
    'box-shadow:0 0 0 1px rgba(255,255,255,0.07),',
    '0 32px 90px rgba(0,0,0,0.75),0 8px 28px rgba(0,0,0,0.45);',
    'cursor:crosshair;touch-action:none;background:#fff;',
    'transition:box-shadow 0.25s;',
    '}',
    '.pk-shell.pk-can-drag{cursor:grab;}',
    '.pk-shell.pk-dragging{cursor:grabbing;}',
    '.pk-canvas{display:block;}',

    /* Drag hint */
    '.pk-hint-overlay{position:absolute;inset:0;display:flex;align-items:flex-end;',
    'justify-content:center;padding-bottom:14px;pointer-events:none;}',
    '.pk-hint-pill{',
    'display:flex;align-items:center;gap:5px;',
    'background:rgba(0,0,0,0.56);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);',
    'border:1px solid rgba(255,255,255,0.1);border-radius:100px;',
    'padding:6px 12px;font-size:11px;font-weight:500;letter-spacing:0.1px;',
    'color:rgba(255,255,255,0.9);',
    'opacity:0;transform:translateY(5px);',
    'transition:opacity 0.35s,transform 0.35s;',
    '}',
    '.pk-shell.pk-can-drag .pk-hint-pill{opacity:1;transform:translateY(0);}',

    /* Zoom pill */
    '.pk-zoom{',
    'display:flex;align-items:center;gap:8px;',
    'background:rgba(255,255,255,0.08);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);',
    'border:1px solid rgba(255,255,255,0.1);border-radius:100px;',
    'padding:7px 16px;',
    'opacity:0;transform:translateY(6px);',
    'transition:opacity 0.25s,transform 0.25s;',
    '}',
    '.pk-preview-col.pk-has-img .pk-zoom{opacity:1;transform:translateY(0);}',
    '.pk-zb{width:26px;height:26px;border-radius:50%;border:none;',
    'background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.85);font-size:15px;line-height:1;',
    'cursor:pointer;display:flex;align-items:center;justify-content:center;',
    'padding:0;transition:background 0.15s;flex-shrink:0;}',
    '.pk-zb:hover{background:rgba(255,255,255,0.2);}',
    '.pk-zb:disabled{opacity:0.22;cursor:not-allowed;}',
    '.pk-z-track{width:68px;height:2px;background:rgba(255,255,255,0.14);border-radius:2px;flex-shrink:0;}',
    '.pk-z-fill{height:100%;background:rgba(255,255,255,0.72);border-radius:2px;transition:width 0.1s;}',
    '.pk-z-lbl{font-size:11px;font-weight:600;color:rgba(255,255,255,0.48);min-width:30px;text-align:center;}',
    '.pk-z-sep{width:1px;height:14px;background:rgba(255,255,255,0.1);flex-shrink:0;}',
    '.pk-z-reset{font-size:11px;font-weight:500;color:rgba(255,255,255,0.38);background:none;border:none;',
    'cursor:pointer;padding:2px 0;transition:color 0.15s;white-space:nowrap;}',
    '.pk-z-reset:hover{color:rgba(255,255,255,0.82);}',

    /* ── Controls column ── */
    '.pk-controls-col{',
    'flex:0 0 48%;display:flex;flex-direction:column;',
    'overflow-y:auto;padding:36px 32px 32px;gap:20px;',
    'position:relative;',
    '}',

    /* Header row */
    '.pk-modal-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}',
    '.pk-modal-title{font-size:21px;font-weight:700;letter-spacing:-0.4px;color:#0a0a0a;margin-bottom:4px;}',
    '.pk-modal-sub{font-size:12px;color:#9090a0;line-height:1.5;}',

    /* Close button */
    '.pk-close{flex-shrink:0;width:30px;height:30px;border-radius:50%;border:none;',
    'background:rgba(0,0,0,0.06);color:rgba(0,0,0,0.4);',
    'cursor:pointer;display:flex;align-items:center;justify-content:center;',
    'font-size:15px;line-height:1;margin-top:3px;',
    'transition:background 0.15s,color 0.15s;}',
    '.pk-close:hover{background:rgba(0,0,0,0.1);color:rgba(0,0,0,0.8);}',

    /* Divider */
    '.pk-divider{height:1px;background:#f0f0f5;margin:0 -2px;}',

    /* Badge */
    '.pk-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;',
    'letter-spacing:0.3px;padding:3px 10px;border-radius:100px;}',
    '.pk-live{background:#dcfce7;color:#15803d;}',
    '.pk-demo{background:#ede9fe;color:#5b21b6;}',
    '.pk-dot{width:5px;height:5px;border-radius:50%;background:currentColor;display:inline-block;}',

    /* Upload zone */
    '.pk-upload{border:1.5px dashed #d8d8e4;border-radius:14px;',
    'padding:26px 18px;text-align:center;cursor:pointer;',
    'background:#fafafd;transition:all 0.2s;}',
    '.pk-upload:hover,.pk-upload.pk-drag-over{border-color:#6366f1;background:#f4f3ff;}',
    '.pk-upload.pk-filled{border-style:solid;border-color:#10b981;background:#f0fdf9;',
    'padding:14px 16px;cursor:default;text-align:left;}',
    '.pk-upload-icon{display:block;margin:0 auto 10px;color:#c4c4d4;transition:color 0.2s;}',
    '.pk-upload:hover .pk-upload-icon,.pk-upload.pk-drag-over .pk-upload-icon{color:#6366f1;}',
    '.pk-upload-h{font-size:13px;font-weight:600;color:#0a0a0a;margin:0 0 4px;}',
    '.pk-upload-s{font-size:11px;color:#9494a4;margin:0;}',
    '.pk-file-row{display:flex;align-items:center;gap:10px;}',
    '.pk-thumb{width:40px;height:40px;border-radius:8px;object-fit:cover;flex-shrink:0;',
    'box-shadow:0 1px 4px rgba(0,0,0,0.1);}',
    '.pk-file-info{flex:1;min-width:0;}',
    '.pk-file-name{font-size:12px;font-weight:600;color:#0a0a0a;white-space:nowrap;overflow:hidden;',
    'text-overflow:ellipsis;display:block;margin-bottom:2px;}',
    '.pk-file-meta{font-size:11px;color:#9090a0;}',
    '.pk-file-chg{font-size:12px;font-weight:500;color:#6366f1;background:none;border:none;',
    'cursor:pointer;padding:0;flex-shrink:0;transition:opacity 0.15s;}',
    '.pk-file-chg:hover{opacity:0.7;}',
    'input.pk-file-inp{display:none;}',

    /* Resolution warning */
    '.pk-warn{display:none;align-items:flex-start;gap:8px;',
    'background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;',
    'padding:10px 12px;font-size:11px;color:#78350f;line-height:1.5;}',
    '.pk-warn.pk-show{display:flex;}',
    '.pk-warn svg{flex-shrink:0;margin-top:1px;}',

    /* Layout section */
    '.pk-section-label{font-size:10px;font-weight:700;color:#9090a0;',
    'text-transform:uppercase;letter-spacing:0.8px;margin-bottom:9px;}',
    '.pk-layouts{display:flex;gap:7px;}',
    '.pk-lpill{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:5px;',
    'padding:10px 6px;border-radius:12px;border:1.5px solid #e8e8f0;background:#fafafd;',
    'cursor:pointer;transition:all 0.15s;}',
    '.pk-lpill:hover{border-color:#6366f1;background:#f4f3ff;}',
    '.pk-lpill.pk-on{border-color:#6366f1;background:#eeecff;}',
    '.pk-lpill svg{display:block;}',
    '.pk-lpill-lbl{font-size:10px;font-weight:600;color:#3a3a4a;letter-spacing:0.1px;}',
    '.pk-lpill.pk-on .pk-lpill-lbl{color:#4f46e5;}',

    /* CTA */
    '.pk-cta{width:100%;padding:15px 20px;border:none;border-radius:14px;',
    'background:linear-gradient(135deg,#6366f1 0%,#4f46e5 100%);',
    'color:#fff;font-size:14px;font-weight:600;letter-spacing:-0.1px;',
    'cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;',
    'box-shadow:0 4px 20px rgba(99,102,241,0.38),0 1px 4px rgba(99,102,241,0.2);',
    'transition:transform 0.15s,box-shadow 0.15s,background 0.15s;}',
    '.pk-cta:hover:not(:disabled){transform:translateY(-1px);',
    'box-shadow:0 8px 28px rgba(99,102,241,0.5);}',
    '.pk-cta:active:not(:disabled){transform:translateY(0);}',
    '.pk-cta:disabled{opacity:0.36;cursor:not-allowed;box-shadow:none;transform:none;}',
    '.pk-cta.pk-done{background:linear-gradient(135deg,#10b981,#059669);',
    'box-shadow:0 4px 20px rgba(16,185,129,0.38);}',

    /* Spinner */
    '.pk-spin{width:15px;height:15px;border-radius:50%;',
    'border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;',
    'animation:pk-r .6s linear infinite;flex-shrink:0;}',
    '@keyframes pk-r{to{transform:rotate(360deg)}}',

    /* Sub hint */
    '.pk-sub{font-size:11px;color:#a8a8b4;text-align:center;line-height:1.5;margin:0;}',

    /* Loading / error */
    '.pk-loading{padding:48px 20px;text-align:center;',
    'font-family:-apple-system,sans-serif;color:#8a8a96;font-size:13px;}',
    '.pk-loading-ring{width:28px;height:28px;border-radius:50%;',
    'border:2.5px solid #e4e4ec;border-top-color:#6366f1;',
    'animation:pk-r .7s linear infinite;margin:0 auto 14px;}',
    '.pk-err{padding:16px 20px;background:#fff0f0;border:1px solid #fecaca;',
    'border-radius:12px;color:#dc2626;font-size:13px;font-family:-apple-system,sans-serif;}',

    /* ── Missing-preview (404) banner ── */
    '.pk-missing{display:flex;align-items:center;gap:10px;',
    'padding:12px 14px;background:#fbf6ec;border:1px solid #ecd9b8;',
    'border-radius:12px;color:#234b46;font-size:13px;font-weight:500;',
    'font-family:-apple-system,sans-serif;line-height:1.4;}',
    '.pk-missing-msg{flex:1;}',
    '.pk-missing-x{flex-shrink:0;width:22px;height:22px;border-radius:50%;border:none;',
    'background:transparent;color:#c0532b;font-size:14px;line-height:1;cursor:pointer;',
    'display:flex;align-items:center;justify-content:center;padding:0;',
    'transition:background 0.15s,color 0.15s;}',
    '.pk-missing-x:hover{background:rgba(192,83,43,0.12);color:#a0431f;}',

    /* ── Mobile: bottom sheet ── */
    '@media(max-width:640px){',
    '.pk-backdrop{padding:0;align-items:flex-end;}',
    '.pk-modal{width:100%;max-height:95vh;border-radius:26px 26px 0 0;flex-direction:column;',
    'transform:translateY(60px);}',
    '.pk-backdrop.pk-open .pk-modal{transform:translateY(0);}',
    '.pk-preview-col{flex:0 0 auto;padding:28px 20px 18px;}',
    '.pk-controls-col{flex:1;overflow-y:auto;padding:18px 20px 36px;',
    '-webkit-overflow-scrolling:touch;}',
    '.pk-modal-title{font-size:18px;}',
    '}',

    /* ════════════════════════════════════════════════════════════════════════
       THEME: LIGHT — premium ink-on-white. Applied via .pk-theme-light on
       the merchant container AND the body-level backdrop.
    ════════════════════════════════════════════════════════════════════════ */
    '.pk-theme-light .pk-open-btn,.pk.pk-theme-light .pk-open-btn{',
    'background:#0f172a;color:#fff;',
    'box-shadow:0 4px 14px rgba(15,23,42,0.22),0 1px 3px rgba(15,23,42,0.10);}',
    '.pk-theme-light .pk-open-btn::before,.pk.pk-theme-light .pk-open-btn::before{',
    'background:linear-gradient(135deg,rgba(255,255,255,0.08) 0%,transparent 60%);}',
    '.pk-theme-light .pk-open-btn:hover,.pk.pk-theme-light .pk-open-btn:hover{',
    'background:#1e293b;box-shadow:0 8px 22px rgba(15,23,42,0.30);}',
    '.pk-theme-light .pk-open-btn.pk-btn-done,.pk.pk-theme-light .pk-open-btn.pk-btn-done{',
    'background:linear-gradient(135deg,#10b981,#059669);',
    'box-shadow:0 4px 16px rgba(16,185,129,0.32);}',

    '.pk-backdrop.pk-theme-light{background:rgba(15,23,42,0.45);}',
    '.pk-theme-light .pk-modal{background:#ffffff;',
    'box-shadow:0 40px 120px rgba(15,23,42,0.22),0 4px 28px rgba(15,23,42,0.10);}',
    '.pk-theme-light .pk-preview-col{',
    'background:linear-gradient(160deg,#f8fafc 0%,#eef2f7 100%);}',
    '.pk-theme-light .pk-preview-col::before{',
    'background:radial-gradient(ellipse,rgba(15,23,42,0.04) 0%,transparent 68%);}',
    '.pk-theme-light .pk-preview-col::after{',
    'background:radial-gradient(circle,rgba(15,23,42,0.03) 0%,transparent 70%);}',
    '.pk-theme-light .pk-shell{background:#ffffff;',
    'box-shadow:0 0 0 1px rgba(15,23,42,0.06),',
    '0 16px 40px rgba(15,23,42,0.10),0 4px 14px rgba(15,23,42,0.06);}',

    '.pk-theme-light .pk-hint-pill{background:rgba(15,23,42,0.78);',
    'border-color:rgba(255,255,255,0.10);color:rgba(255,255,255,0.95);}',

    '.pk-theme-light .pk-zoom{background:rgba(15,23,42,0.04);',
    'border-color:rgba(15,23,42,0.08);}',
    '.pk-theme-light .pk-zb{background:rgba(15,23,42,0.06);color:rgba(15,23,42,0.78);}',
    '.pk-theme-light .pk-zb:hover{background:rgba(15,23,42,0.12);}',
    '.pk-theme-light .pk-z-track{background:rgba(15,23,42,0.10);}',
    '.pk-theme-light .pk-z-fill{background:#0f172a;}',
    '.pk-theme-light .pk-z-lbl{color:rgba(15,23,42,0.50);}',
    '.pk-theme-light .pk-z-sep{background:rgba(15,23,42,0.10);}',
    '.pk-theme-light .pk-z-reset{color:rgba(15,23,42,0.45);}',
    '.pk-theme-light .pk-z-reset:hover{color:#0f172a;}',

    '.pk-theme-light .pk-modal-title{color:#0f172a;}',
    '.pk-theme-light .pk-modal-sub{color:#64748b;}',
    '.pk-theme-light .pk-close{background:rgba(15,23,42,0.05);color:rgba(15,23,42,0.45);}',
    '.pk-theme-light .pk-close:hover{background:rgba(15,23,42,0.10);color:rgba(15,23,42,0.85);}',
    '.pk-theme-light .pk-divider{background:#e2e8f0;}',

    '.pk-theme-light .pk-upload{border-color:#cbd5e1;background:#f8fafc;}',
    '.pk-theme-light .pk-upload:hover,.pk-theme-light .pk-upload.pk-drag-over{',
    'border-color:#0f172a;background:#f1f5f9;}',
    '.pk-theme-light .pk-upload.pk-filled{border-color:#10b981;background:#f0fdf4;}',
    '.pk-theme-light .pk-upload-icon{color:#94a3b8;}',
    '.pk-theme-light .pk-upload:hover .pk-upload-icon,',
    '.pk-theme-light .pk-upload.pk-drag-over .pk-upload-icon{color:#0f172a;}',
    '.pk-theme-light .pk-upload-h{color:#0f172a;}',
    '.pk-theme-light .pk-upload-s{color:#94a3b8;}',
    '.pk-theme-light .pk-file-name{color:#0f172a;}',
    '.pk-theme-light .pk-file-meta{color:#64748b;}',
    '.pk-theme-light .pk-file-chg{color:#0f172a;}',
    '.pk-theme-light .pk-section-label{color:#64748b;}',

    '.pk-theme-light .pk-lpill{border-color:#e2e8f0;background:#f8fafc;}',
    '.pk-theme-light .pk-lpill:hover{border-color:#0f172a;background:#f1f5f9;}',
    '.pk-theme-light .pk-lpill.pk-on{border-color:#0f172a;background:#eef2ff;}',
    '.pk-theme-light .pk-lpill-lbl{color:#475569;}',
    '.pk-theme-light .pk-lpill.pk-on .pk-lpill-lbl{color:#0f172a;}',

    '.pk-theme-light .pk-cta{background:#0f172a;color:#ffffff;',
    'box-shadow:0 4px 14px rgba(15,23,42,0.22),0 1px 3px rgba(15,23,42,0.10);}',
    '.pk-theme-light .pk-cta:hover:not(:disabled){background:#1e293b;',
    'box-shadow:0 8px 22px rgba(15,23,42,0.30);}',
    '.pk-theme-light .pk-cta.pk-done{background:linear-gradient(135deg,#10b981,#059669);',
    'box-shadow:0 4px 16px rgba(16,185,129,0.32);}',

    '.pk-theme-light .pk-sub{color:#94a3b8;}',
    '.pk-theme-light .pk-loading{color:#64748b;}',
    '.pk-theme-light .pk-loading-ring{border-color:#e2e8f0;border-top-color:#0f172a;}',
    '.pk-theme-light .pk-err{background:#fef2f2;border-color:#fecaca;color:#b91c1c;}',
    '.pk-theme-light .pk-missing,.pk.pk-theme-light .pk-missing{',
    'background:#f8fafc;border-color:#e2e8f0;color:#0f172a;}',
    '.pk-theme-light .pk-missing-x,.pk.pk-theme-light .pk-missing-x{color:#64748b;}',
    '.pk-theme-light .pk-missing-x:hover,.pk.pk-theme-light .pk-missing-x:hover{',
    'background:rgba(15,23,42,0.08);color:#0f172a;}',
    '.pk-theme-light .pk-warn{background:#fffbeb;border-color:#fcd34d;color:#78350f;}',

    /* ════════════════════════════════════════════════════════════════════════
       THEME: DARK — premium pearl-on-slate.
    ════════════════════════════════════════════════════════════════════════ */
    '.pk-theme-dark .pk-open-btn,.pk.pk-theme-dark .pk-open-btn{',
    'background:#fafaf9;color:#0f172a;',
    'box-shadow:0 4px 14px rgba(0,0,0,0.30),0 1px 3px rgba(0,0,0,0.20);}',
    '.pk-theme-dark .pk-open-btn::before,.pk.pk-theme-dark .pk-open-btn::before{',
    'background:linear-gradient(135deg,rgba(15,23,42,0.04) 0%,transparent 60%);}',
    '.pk-theme-dark .pk-open-btn:hover,.pk.pk-theme-dark .pk-open-btn:hover{',
    'background:#e7e5e4;box-shadow:0 8px 22px rgba(0,0,0,0.40);}',
    '.pk-theme-dark .pk-open-btn.pk-btn-done,.pk.pk-theme-dark .pk-open-btn.pk-btn-done{',
    'background:linear-gradient(135deg,#34d399,#10b981);color:#0f172a;',
    'box-shadow:0 4px 16px rgba(52,211,153,0.30);}',

    '.pk-backdrop.pk-theme-dark{background:rgba(2,6,23,0.78);}',
    '.pk-theme-dark .pk-modal{background:#0f172a;',
    'box-shadow:0 40px 120px rgba(0,0,0,0.55),0 4px 28px rgba(0,0,0,0.35);}',
    '.pk-theme-dark .pk-preview-col{',
    'background:linear-gradient(160deg,#1e293b 0%,#172033 100%);}',
    '.pk-theme-dark .pk-preview-col::before{',
    'background:radial-gradient(ellipse,rgba(167,139,250,0.10) 0%,transparent 68%);}',
    '.pk-theme-dark .pk-preview-col::after{',
    'background:radial-gradient(circle,rgba(167,139,250,0.06) 0%,transparent 70%);}',
    '.pk-theme-dark .pk-shell{background:#0f172a;',
    'box-shadow:0 0 0 1px rgba(255,255,255,0.06),',
    '0 16px 40px rgba(0,0,0,0.50),0 4px 14px rgba(0,0,0,0.30);}',

    '.pk-theme-dark .pk-hint-pill{background:rgba(2,6,23,0.78);',
    'border-color:rgba(255,255,255,0.12);color:rgba(255,255,255,0.95);}',

    '.pk-theme-dark .pk-zoom{background:rgba(255,255,255,0.06);',
    'border-color:rgba(255,255,255,0.10);}',
    '.pk-theme-dark .pk-zb{background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.85);}',
    '.pk-theme-dark .pk-zb:hover{background:rgba(255,255,255,0.18);}',
    '.pk-theme-dark .pk-z-track{background:rgba(255,255,255,0.14);}',
    '.pk-theme-dark .pk-z-fill{background:#fafaf9;}',
    '.pk-theme-dark .pk-z-lbl{color:rgba(255,255,255,0.55);}',
    '.pk-theme-dark .pk-z-sep{background:rgba(255,255,255,0.12);}',
    '.pk-theme-dark .pk-z-reset{color:rgba(255,255,255,0.45);}',
    '.pk-theme-dark .pk-z-reset:hover{color:#fafaf9;}',

    '.pk-theme-dark .pk-modal-title{color:#f8fafc;}',
    '.pk-theme-dark .pk-modal-sub{color:#94a3b8;}',
    '.pk-theme-dark .pk-close{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.55);}',
    '.pk-theme-dark .pk-close:hover{background:rgba(255,255,255,0.14);color:rgba(255,255,255,0.95);}',
    '.pk-theme-dark .pk-divider{background:rgba(255,255,255,0.06);}',

    '.pk-theme-dark .pk-upload{border-color:rgba(255,255,255,0.12);background:rgba(255,255,255,0.03);}',
    '.pk-theme-dark .pk-upload:hover,.pk-theme-dark .pk-upload.pk-drag-over{',
    'border-color:#a78bfa;background:rgba(167,139,250,0.06);}',
    '.pk-theme-dark .pk-upload.pk-filled{border-color:#34d399;background:rgba(52,211,153,0.07);}',
    '.pk-theme-dark .pk-upload-icon{color:rgba(255,255,255,0.40);}',
    '.pk-theme-dark .pk-upload:hover .pk-upload-icon,',
    '.pk-theme-dark .pk-upload.pk-drag-over .pk-upload-icon{color:#c4b5fd;}',
    '.pk-theme-dark .pk-upload-h{color:#f8fafc;}',
    '.pk-theme-dark .pk-upload-s{color:rgba(255,255,255,0.55);}',
    '.pk-theme-dark .pk-file-name{color:#f8fafc;}',
    '.pk-theme-dark .pk-file-meta{color:rgba(255,255,255,0.55);}',
    '.pk-theme-dark .pk-file-chg{color:#c4b5fd;}',
    '.pk-theme-dark .pk-section-label{color:rgba(255,255,255,0.55);}',

    '.pk-theme-dark .pk-lpill{border-color:rgba(255,255,255,0.10);background:rgba(255,255,255,0.03);}',
    '.pk-theme-dark .pk-lpill:hover{border-color:#a78bfa;background:rgba(167,139,250,0.08);}',
    '.pk-theme-dark .pk-lpill.pk-on{border-color:#a78bfa;background:rgba(167,139,250,0.14);}',
    '.pk-theme-dark .pk-lpill-lbl{color:rgba(255,255,255,0.75);}',
    '.pk-theme-dark .pk-lpill.pk-on .pk-lpill-lbl{color:#c4b5fd;}',

    '.pk-theme-dark .pk-cta{background:#fafaf9;color:#0f172a;',
    'box-shadow:0 4px 14px rgba(0,0,0,0.30),0 1px 3px rgba(0,0,0,0.20);}',
    '.pk-theme-dark .pk-cta:hover:not(:disabled){background:#e7e5e4;',
    'box-shadow:0 8px 22px rgba(0,0,0,0.40);}',
    '.pk-theme-dark .pk-cta.pk-done{background:linear-gradient(135deg,#34d399,#10b981);color:#0f172a;',
    'box-shadow:0 4px 16px rgba(52,211,153,0.30);}',
    '.pk-theme-dark .pk-cta .pk-spin{border-color:rgba(15,23,42,0.30);border-top-color:#0f172a;}',

    '.pk-theme-dark .pk-sub{color:rgba(255,255,255,0.55);}',
    '.pk-theme-dark .pk-loading{color:rgba(255,255,255,0.55);}',
    '.pk-theme-dark .pk-loading-ring{border-color:rgba(255,255,255,0.10);border-top-color:#fafaf9;}',
    '.pk-theme-dark .pk-err{background:rgba(239,68,68,0.10);border-color:rgba(239,68,68,0.30);color:#fca5a5;}',
    '.pk-theme-dark .pk-missing,.pk.pk-theme-dark .pk-missing{',
    'background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.08);color:rgba(255,255,255,0.75);}',
    '.pk-theme-dark .pk-missing-x,.pk.pk-theme-dark .pk-missing-x{color:rgba(255,255,255,0.55);}',
    '.pk-theme-dark .pk-missing-x:hover,.pk.pk-theme-dark .pk-missing-x:hover{',
    'background:rgba(255,255,255,0.08);color:#fafaf9;}',
    '.pk-theme-dark .pk-warn{background:rgba(252,211,77,0.10);border-color:rgba(252,211,77,0.30);color:#fcd34d;}',
  ].join('');

  function _injectStyles() {
    if (document.getElementById('pk-css-v2')) return;
    var s = document.createElement('style');
    s.id = 'pk-css-v2';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* Polyfill for ctx.roundRect (experimental API, not widely supported) */
  function _polyfillRoundRect() {
    if (CanvasRenderingContext2D && !CanvasRenderingContext2D.prototype.roundRect) {
      CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        if (typeof r === 'undefined') r = 0;
        if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
        else {
          r = { tl: r.tl || 0, tr: r.tr || 0, br: r.br || 0, bl: r.bl || 0 };
        }
        this.beginPath();
        this.moveTo(x + r.tl, y);
        this.lineTo(x + w - r.tr, y);
        this.quadraticCurveTo(x + w, y, x + w, y + r.tr);
        this.lineTo(x + w, y + h - r.br);
        this.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
        this.lineTo(x + r.bl, y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - r.bl);
        this.lineTo(x, y + r.tl);
        this.quadraticCurveTo(x, y, x + r.tl, y);
        this.closePath();
      };
    }
  }

  /* ─── Widget ──────────────────────────────────────────────────────────────── */
  function Widget(cfg) {
    this.config = cfg;
    this.apiUrl = (cfg.apiUrl || DEFAULT_URL).replace(/\/$/, '');
    this.apiKey = cfg.apiKey || null;
    // Accept modelKey OR templateId (Shopify integration uses templateId from metafields)
    this.modelKey = cfg.modelKey || cfg.templateId || null;           // e.g. "iphone_17"
    this.templateKey = null;                           // set from vendorTemplate if present
    // When true, render programmatic case/camera/buttons even without a vendorTemplate.
    // Default false → fall back to the universal phone image when no vendorTemplate exists.
    this.useProgrammaticCase = !!cfg.useProgrammaticCase;
    this.fallbackImageUrl = cfg.fallbackImageUrl || cfg.fallbackUrl || FALLBACK_IMAGE_URL;
    // Theme: 'light' | 'dark' | 'auto' (default 'auto'). Resolved at init() once
    // we have the container so auto-detect can read its ancestors.
    this.themePref = (cfg.theme === 'light' || cfg.theme === 'dark' || cfg.theme === 'auto')
        ? cfg.theme : 'auto';
    this.theme = null; // resolved 'light' or 'dark'
    this.template = null;
    this.canvas = null;
    this.ctx = null;
    this.userImage = null;
    this.userFile = null;
    this.uploadId = null;
    this.imageOffsetX = 0;
    this.imageOffsetY = 0;
    this.imageScale = 1.0;
    this._drag = null;
    this._pinch = null;
    this.overlayImage = null;
    this._overlayLoad = false;
    this.fallbackImage = null;
    this._fallbackLoad = false;
    this.selectedLayout = 'full_back';
    this.listeners = {};
    this.container = null;
    this._hintTimer = null;
    this._backdrop = null;
    this._modal = null;
  }

  Widget.prototype = {

    /* ── Public API ── */
    init: function () {
      _injectStyles();
      _polyfillRoundRect();
      var self = this;
      var cfg = this.config;
      var el = typeof cfg.container === 'string'
        ? document.querySelector(cfg.container)
        : cfg.container;
      if (!el) throw new Error('PreviewKit: container not found: ' + cfg.container);
      this.container = el;
      el.classList.add('pk');

      // Resolve theme & apply class to container so trigger button + 404 banner are themed
      this.theme = _resolveTheme(this.themePref, el);
      el.classList.remove('pk-theme-light', 'pk-theme-dark');
      el.classList.add('pk-theme-' + this.theme);

      if (this.apiKey && this.modelKey) {
        this._loading();
        fetch(this.apiUrl + '/v1/models/' + this.modelKey,
          { headers: { 'X-PreviewKit-Key': this.apiKey } })
          .then(function (r) {
            if (r.status === 404) {
              self._renderMissingPreviewBanner();
              return Promise.reject({ __pkHandled: true });
            }
            if (!r.ok) return r.json().then(function (e) { return Promise.reject(e); });
            return r.json();
          })
          .then(function (resp) {
            // resp = { model: { modelKey, deviceSpecs, ... }, vendorTemplate: { templateKey, templateJson } | null }
            var m = resp.model;
            var vt = resp.vendorTemplate;
            if (vt) {
              self.templateKey = vt.templateKey;
            }
            self.template = self._norm(null, {
              deviceSpecs: m.deviceSpecs,
              templateKey: m.modelKey,
              vendorTemplate: vt
            });
            self._mount();
          })
          .catch(function (e) {
            if (e && e.__pkHandled) return;
            var msg = (e && e.error && e.error.message) || 'Could not load model.';
            el.innerHTML = '<div class="pk-err">&#9888; ' + _esc(msg) + '</div>';
          });
      } else if (cfg.template) {
        this.template = this._norm(cfg.template);
        this._mount();
      } else {
        throw new Error('PreviewKit: provide apiKey+modelKey or template.');
      }
    },

    on: function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; },
    _emit: function (ev, d) { (this.listeners[ev] || []).forEach(function (f) { f(d); }); },

    reset: function () {
      this.userImage = null;
      this.userFile = null;
      this.uploadId = null;
      this.overlayImage = null;
      this._overlayLoad = false;
      // keep fallbackImage cached across reset() — it never changes per session
      this.imageOffsetX = 0;
      this.imageOffsetY = 0;
      this.imageScale = 1.0;
      this._drag = null;
      this._pinch = null;
      if (!this.canvas || !this._modal) return;
      this._render();
      this._syncZoom();
      var col = this._modal.querySelector('.pk-preview-col');
      var shell = this._modal.querySelector('.pk-shell');
      if (col) col.classList.remove('pk-has-img');
      if (shell) shell.classList.remove('pk-can-drag', 'pk-dragging');
      var zone = this._modal.querySelector('.pk-upload');
      if (zone) { zone.classList.remove('pk-filled'); zone.innerHTML = this._uploadHTML(); }
      var warn = this._modal.querySelector('.pk-warn');
      if (warn) warn.classList.remove('pk-show');
      var btn = this._modal.querySelector('.pk-cta');
      if (btn) { btn.disabled = true; btn.classList.remove('pk-done'); btn.innerHTML = this._ctaHTML(); }
      this._drawTrigger();
    },

    /* ── Template normalise ── */
    _norm: function (t, api) {
      api = api || {};
      var ds = api.deviceSpecs || null;   // physical specs → dynamic compute
      var vt = api.vendorTemplate || null; // vendor template from GET /v1/models

      // ── Priority 1: deviceSpecs → fully compute layout from physical dimensions
      if (ds) {
        var computed = this._computeFromSpecs(ds);
        computed.templateKey = api.templateKey || (t && (t.templateKey || t.templateId)) || 'dynamic';

        // Override canvas size with API-provided dimensions if available.
        // (Skipped for fallback_image mode below — that path sets its own canvas size
        // matching the phone-bounds aspect to eliminate letterbox margin.)
        var skipCanvasOverride = !(vt && vt.templateJson
          && vt.templateJson.photoZones && vt.templateJson.photoZones.length)
          && !this.useProgrammaticCase;
        if (!skipCanvasOverride && api.model && api.model.canvasWidthPx && api.model.canvasHeightPx) {
          computed.canvas.width = api.model.canvasWidthPx;
          computed.canvas.height = api.model.canvasHeightPx;
        }

        // Decide rendering mode based on vendorTemplate + photoZones
        var hasVendorZone = vt && vt.templateJson
          && vt.templateJson.photoZones && vt.templateJson.photoZones.length;
        if (hasVendorZone) {
          // Vendor template defines a real photo zone → constrain preview to that zone, ignore layout buttons
          var tj = vt.templateJson;
          computed.type = tj.type || 'overlay';
          computed.overlayUrl = (tj.overlay && tj.overlay.image_url) || null;
          computed.photoZones = tj.photoZones;
          computed.photoZone = tj.photoZones[0];
        } else if (this.useProgrammaticCase) {
          // Opt-in: keep the programmatic case/camera renderer
          computed.type = 'programmatic';
          computed.overlayUrl = null;
          computed.photoZones = null;
        } else {
          // No vendor zone: render universal phone-back fallback image
          // and let the Print Layout buttons pick the photo zone over it.
          computed.type = 'fallback_image';
          computed.overlayUrl = this.fallbackImageUrl;
          computed.photoZones = null;
          computed.photoZone = null; // resolved per-render via selectedLayout
          // Resize canvas to match the phone-bounds aspect ratio so the cropped
          // image fills the canvas tightly (no letterbox margin).
          var pb = FALLBACK_PHONE_BOUNDS_IMG;
          var phoneAspect = pb.wPctImg / pb.hPctImg; // width / height
          var targetW = 360;
          computed.canvas.width = targetW;
          computed.canvas.height = Math.round(targetW / phoneAspect);
        }
        return computed;
      }

      // ── Priority 2: inline template object (demo/offline mode)
      if (t && (t.preview || t.canvas)) {
        var cw, ch;
        if (t.preview) { cw = t.preview.canvasWidth; ch = t.preview.canvasHeight; }
        else { cw = t.canvas.width; ch = t.canvas.height; }
        var p = t.preview || t;
        return {
          templateKey: t.templateKey || t.templateId || 'inline',
          canvas: { width: cw, height: ch }, phoneCase: p.phoneCase, printArea: p.printArea,
          layouts: p.layouts || null, camera: p.camera, buttons: p.buttons,
          port: p.port, constraints: t.constraints || {},
          type: 'programmatic', overlayUrl: null, photoZones: null
        };
      }

      // ── Priority 3: fallback → compute from iPhone 17 defaults
      var fb = this._computeFromSpecs({
        widthMm: 71.5, heightMm: 149.6, cornerRadiusMm: 10.0, bleedMm: 3.0,
        camera: { type: 'island', layout: 'vertical', shape: 'rounded_square', count: 2 },
        buttons: { left: 3, right: 1 }, portWidthMm: 11.0
      });
      fb.templateKey = (t && (t.templateKey || t.templateId)) || api.templateKey || 'fallback';
      fb.type = 'programmatic';
      fb.overlayUrl = null;
      fb.photoZones = null;
      return fb;
    },

    /* ─────────────────────────────────────────────────────────────────────────
       Dynamic layout computation from physical device specs
       Input:  deviceSpecs = { widthMm, heightMm, cornerRadiusMm, bleedMm,
                               camera: { type, layout, count },
                               buttons: { left, right }, portWidthMm }
       Output: full template object ready for rendering (no pixel coords needed)
    ───────────────────────────────────────────────────────────────────────── */
    _computeFromSpecs: function (ds) {
      var CANVAS_W = 360, CASE_W = 280, CASE_X = 40, CASE_Y = 20;
      var scale = CASE_W / ds.widthMm;                         // px per mm
      var caseH = Math.round(ds.heightMm * scale);
      var canvasH = caseH + CASE_Y * 2;
      var cornerR = Math.round(ds.cornerRadiusMm * scale);
      var camZoneH = Math.round(caseH * 0.22);                    // top 22% = camera zone

      // Print area — below camera zone, inset 18px each side
      var paX = CASE_X + 18, paY = CASE_Y + camZoneH;
      var paW = CASE_W - 36, paH = caseH - camZoneH - 10;

      var camera = this._specsCamera(ds.camera, CASE_X, CASE_Y, CASE_W, camZoneH);
      var buttons = this._specsButtons(ds.buttons, caseH);
      var portW = Math.max(30, Math.round(ds.portWidthMm * scale));

      return {
        canvas: { width: CANVAS_W, height: canvasH },
        phoneCase: {
          x: CASE_X, y: CASE_Y, width: CASE_W, height: caseH,
          radius: cornerR, caseColor: '#ffffff', borderColor: '#d0d0d0'
        },
        printArea: { x: paX, y: paY, width: paW, height: paH, radius: 4 },
        layouts: {
          full_back: { label: 'Full Back', printArea: { x: CASE_X + 18, y: CASE_Y + 8, width: CASE_W - 36, height: caseH - 18, radius: 4 } },
          centered: { label: 'Centered', printArea: { x: CASE_X + 48, y: CASE_Y + 48, width: CASE_W - 96, height: caseH - 96, radius: 4 } },
          skip_camera: { label: 'Skip Camera', printArea: { x: paX, y: paY, width: paW, height: paH, radius: 4 } }
        },
        camera: camera,
        buttons: buttons,
        port: { width: portW, height: 12, radius: 4 },
        constraints: {}
      };
    },

    /* Camera computation — returns { island?, lenses[], flash? } */
    _specsCamera: function (cam, caseX, caseY, caseW, camZoneH) {
      if (!cam || !cam.count) return null;

      const type = cam.type || 'island';
      const layout = cam.layout || 'vertical';
      const shape = cam.shape || 'circle';
      const count = cam.count || 3;

      if (type === 'individual_lenses') {
        let result;

        if (layout === 'scattered') {
          result = this._scatteredLenses(count, caseX, caseY, caseW, camZoneH);
        } else if (layout === 'vertical') {
          result = this._verticalLenses(count, caseX, caseY, caseW, camZoneH);
        } else {
          result = this._verticalLenses(count, caseX, caseY, caseW, camZoneH);
        }

        return {
          island: null, // ❌ IMPORTANT
          lenses: result.lenses,
          flash: result.flash
        };
      }



      const island = this._computeIslandShape(shape, caseX, caseY, caseW, camZoneH);

      const lenses = this._computeLenses(layout, count, island);

      // Flash: for pill islands sit it just outside the right edge, slightly above centre
      // — close to the bump but not overlapping. For other shapes keep bottom-right inside.
      const flash = island.shape === 'pill'
        ? {
          cx: island.x + island.width + 6,   // close to right edge, not too far
          cy: island.y + island.height * 0.3, // slightly above centre
          radius: 4
        }
        : {
          cx: island.x + island.width * 0.8,
          cy: island.y + island.height * 0.8,
          radius: 5
        };

      return {
        island,
        lenses,
        flash
      };
    },

    _computeIslandShape: function (shape, caseX, caseY, caseW, camZoneH) {
      const size = camZoneH * 0.8;

      // ── Pill: wide, short capsule — matches iPhone 16 / 17 camera bump ──
      // The real iPhone 16/17 bump is roughly 2:1 wide-to-tall, centered
      // horizontally and sitting in the upper-left quadrant of the back.
      if (shape === 'pill') {
        // Portrait-dominant capsule — matches iPhone 17 rear camera bump (~1:1.8 tall)
        const pillW = size * 0.75;
        const pillH = size * 1.35;
        const pillR = pillW / 2;     // fully rounded ends (true capsule)
        return {
          x: caseX + caseW * 0.05,   // tighter to left edge, like real Apple placement
          y: caseY + camZoneH * 0.1,
          width: pillW,
          height: pillH,
          radius: pillR,
          shape: 'pill'             // propagate so lens layout can use it
        };
      }

      return {
        x: caseX + caseW * 0.08,
        y: caseY + camZoneH * 0.1,
        width: size,
        height: size,
        radius: shape === 'rounded_square' ? size * 0.25 : size / 2
      };
    },

    _computeLenses: function (layoutType, count, island) {
      const cx = island.x + island.width / 2;
      const cy = island.y + island.height / 2;

      // ════════════════════════════════════════════════════════════════════
      // BIFURCATION 1: APPLE PILL LAYOUT (iPhone 16, 17 — isolated path)
      // ════════════════════════════════════════════════════════════════════
      if (island.shape === 'pill') {
        const lensOuter = Math.round(island.width * 0.32);   // sized to pill width
        const lensInner = Math.round(lensOuter * 0.65);
        const spacing = island.height * 0.28;              // vertical gap between centres
        const lenses = [];

        if (count >= 2) {
          lenses.push({ cx, cy: cy - spacing / 2, outerRadius: lensOuter, innerRadius: lensInner });
          lenses.push({ cx, cy: cy + spacing / 2, outerRadius: lensOuter, innerRadius: lensInner });
        } else {
          lenses.push({ cx, cy, outerRadius: lensOuter, innerRadius: lensInner });
        }

        return lenses;  // EXIT: Pill layout complete, no Samsung logic applied
      }

      // ════════════════════════════════════════════════════════════════════
      // BIFURCATION 2: TRIANGULAR LAYOUT (iPhone Pro — isolated path)
      // ════════════════════════════════════════════════════════════════════
      if (layoutType === 'triangular') {
        if (count !== 3) {
          console.warn('Triangular layout only supports 3 lenses, got:', count);
        }
        const offset = island.width * 0.25;
        return [
          { cx: cx - offset, cy: cy - offset * 0.6, outerRadius: 10, innerRadius: 6 },
          { cx: cx + offset, cy: cy - offset * 0.6, outerRadius: 10, innerRadius: 6 },
          { cx: cx, cy: cy + offset * 0.6, outerRadius: 10, innerRadius: 6 }
        ];
        // EXIT: Triangular layout complete, no Samsung logic applied
      }

      // ════════════════════════════════════════════════════════════════════
      // BIFURCATION 3: SAMSUNG VERTICAL LAYOUT (S24, S23, traditional — isolated path)
      // ════════════════════════════════════════════════════════════════════
      if (layoutType === 'vertical') {
        // Samsung vertical: lenses stacked top-to-bottom inside rectangular island
        // Scale lens size proportionally to island width for visual consistency
        const lensOuter = Math.round(island.width * 0.35);   // Optimized for Samsung
        const lensInner = Math.round(lensOuter * 0.65);
        
        const totalSpan = (count - 1) * (island.width * 0.35);  // Spacing based on island
        const startY = cy - totalSpan / 2;
        
        return Array.from({ length: count }).map((_, i) => ({
          cx,
          cy: startY + i * (island.width * 0.35),
          outerRadius: lensOuter,
          innerRadius: lensInner
        }));
        // EXIT: Samsung vertical layout complete
      }

      // ════════════════════════════════════════════════════════════════════
      // BIFURCATION 4: SAMSUNG HORIZONTAL LAYOUT (S24 Ultra, S23 Ultra — isolated path)
      // ════════════════════════════════════════════════════════════════════
      if (layoutType === 'horizontal') {
        // Samsung horizontal: lenses arranged left-to-right inside rectangular island
        const lensOuter = Math.round(island.width * 0.35);   // Optimized for Samsung
        const lensInner = Math.round(lensOuter * 0.65);
        
        const totalSpan = (count - 1) * (island.width * 0.35);  // Spacing based on island
        const startX = cx - totalSpan / 2;
        
        return Array.from({ length: count }).map((_, i) => ({
          cx: startX + i * (island.width * 0.35),
          cy,
          outerRadius: lensOuter,
          innerRadius: lensInner
        }));
        // EXIT: Samsung horizontal layout complete
      }

      // Fallback: no recognized layout
      return [];
    },

    /* 3-lens vertical column (Samsung S24, S23, S22, A54, A34) */
    _verticalLenses: function (count, caseX, caseY, caseW, caseH) {
      const camZoneH = caseH * 0.22;       // top 22% is camera zone
      const colX = caseX + caseW * 0.15;   // slight left padding
      const startY = caseY + camZoneH * 0.40;  // 25% from top of zone
      const spacing = camZoneH * 0.50;    // well-spaced vertical gap

      // Scale lens size relative to camera zone - increased for visibility
      const outerRadius = Math.round(camZoneH * 0.22);
      const innerRadius = Math.round(outerRadius * 0.60);

      const lenses = [];
      for (let i = 0; i < count; i++) {
        lenses.push({
          cx: colX,
          cy: startY + i * spacing,
          outerRadius: outerRadius,
          innerRadius: innerRadius
        });
      }

      // Flash positioned between 1st and 2nd lens, to the right
      const flashCx = colX + (outerRadius * 1.8);
      const flashCy = startY + spacing * 0.5;  // midpoint between first two lenses
      const flash = {
        cx: flashCx,
        cy: flashCy,
        radius: Math.round(innerRadius * 0.5)
      };

      return { lenses, flash };
    },

    /* 4-lens 2×2 grid (Samsung S24 Ultra, S23 Ultra) */
    _scatteredLenses: function (count, caseX, caseY, caseW, camZoneH) {
      var col1x = Math.round(caseX + caseW * 0.38);
      var col2x = Math.round(caseX + caseW * 0.56);
      var row1y = Math.round(caseY + camZoneH * 0.28);
      var row2y = Math.round(caseY + camZoneH * 0.68);
      var outerRs = [
        Math.round(camZoneH * 0.135),
        Math.round(camZoneH * 0.118),
        Math.round(camZoneH * 0.115),
        Math.round(camZoneH * 0.100)
      ];
      var positions = [
        { cx: col1x, cy: row1y }, { cx: col2x, cy: row1y },
        { cx: col1x, cy: row2y }, { cx: col2x, cy: row2y }
      ];
      var lenses = [];
      for (var i = 0; i < Math.min(count, 4); i++) {
        var or = outerRs[i];
        lenses.push({
          cx: positions[i].cx, cy: positions[i].cy,
          outerRadius: or, innerRadius: Math.round(or * 0.72)
        });
      }
      return {
        lenses: lenses,
        flash: { cx: col2x, cy: row2y + outerRs[3] + 8, radius: 5 }
      };
    },

    /* Lenses inside a shared circular island (Apple style) */
    _islandLenses: function (ix, iy, iw, count) {
      var cx = ix + iw / 2, cy = iy + iw / 2;
      var off = Math.round(iw * 0.22);
      if (count === 2) {
        return [
          { cx: cx - off, cy: cy, outerRadius: Math.round(iw * 0.20), innerRadius: Math.round(iw * 0.14) },
          { cx: cx + off, cy: cy, outerRadius: Math.round(iw * 0.17), innerRadius: Math.round(iw * 0.12) }
        ];
      }
      return [
        { cx: cx - off, cy: cy - Math.round(off * 0.5), outerRadius: Math.round(iw * 0.20), innerRadius: Math.round(iw * 0.14) },
        { cx: cx + off, cy: cy - Math.round(off * 0.5), outerRadius: Math.round(iw * 0.17), innerRadius: Math.round(iw * 0.12) },
        { cx: cx - off, cy: cy + Math.round(off * 0.5), outerRadius: Math.round(iw * 0.15), innerRadius: Math.round(iw * 0.11) }
      ];
    },

    /* Button placement from left/right counts */
    _specsButtons: function (btns, caseH) {
      var result = [];
      var left = btns ? (btns.left || 0) : 0;
      var right = btns ? (btns.right || 0) : 2;

      // Samsung style: 2 right buttons (volume long + power short)
      if (right === 2 && left === 0) {
        result.push({ side: 'right', offset: Math.round(caseH * 0.224), length: 60, thickness: 5, radius: 2 });
        result.push({ side: 'right', offset: Math.round(caseH * 0.362), length: 40, thickness: 5, radius: 2 });
      }
      // iPhone style: 3 left (action + vol up + vol down) + 1 right (power)
      if (left >= 3) {
        result.push({ side: 'left', offset: Math.round(caseH * 0.157), length: 22, thickness: 5, radius: 2 });
        result.push({ side: 'left', offset: Math.round(caseH * 0.229), length: 55, thickness: 5, radius: 2 });
        result.push({ side: 'left', offset: Math.round(caseH * 0.354), length: 55, thickness: 5, radius: 2 });
        result.push({ side: 'right', offset: Math.round(caseH * 0.250), length: 80, thickness: 5, radius: 2 });
      }
      // Generic single right button
      if (right === 1 && left === 0) {
        result.push({ side: 'right', offset: Math.round(caseH * 0.300), length: 70, thickness: 5, radius: 2 });
      }
      return result;
    },

    /* ── end dynamic compute ─────────────────────────────────────────────── */

    /* ── Loading placeholder ── */
    _loading: function () {
      this.container.innerHTML =
        '<div class="pk-loading"><div class="pk-loading-ring"></div>Loading&#8230;</div>';
    },

    /* ── 404 missing-preview banner (dismissible) ── */
    _renderMissingPreviewBanner: function () {
      var el = this.container;
      el.innerHTML =
        '<div class="pk-missing">' +
          '<span class="pk-missing-msg">This product doesn’t have a custom preview yet.</span>' +
          '<button class="pk-missing-x" type="button" aria-label="Dismiss">✕</button>' +
        '</div>';
      var x = el.querySelector('.pk-missing-x');
      if (x) x.addEventListener('click', function () { el.innerHTML = ''; });
    },

    /* ── Mount ── */
    _mount: function () {
      this._renderTrigger();
      this._buildModal();
    },

    /* ─────────────────────────────────────────────────────────────────────────
       TRIGGER BUTTON
       The vendor's own product images stay untouched on their page.
       We inject only a "Customize Your Case" button into the container.
    ───────────────────────────────────────────────────────────────────────── */
    _renderTrigger: function () {
      var self = this;
      var el = this.container;

      el.innerHTML =
        '<button class="pk-open-btn">' +
        _svgWand() + 'Customize Your Case' +
        '</button>';

      el.querySelector('.pk-open-btn').addEventListener('click', function () {
        self._openModal();
      });
    },

    /* No-op — trigger has no canvas to redraw */
    _drawTrigger: function () { },

    _updateTriggerDone: function () {
      var btn = this.container.querySelector('.pk-open-btn');
      if (!btn) return;
      btn.classList.add('pk-btn-done');
      btn.innerHTML = _svg('check', 16, 16, '#fff') + 'Design Saved';
    },

    /* ─────────────────────────────────────────────────────────────────────────
       MODAL
    ───────────────────────────────────────────────────────────────────────── */
    _buildModal: function () {
      var self = this;
      var t = this.template;

      /* Backdrop — apply resolved theme so all modal chrome themes correctly */
      var backdrop = document.createElement('div');
      backdrop.className = 'pk pk-backdrop pk-theme-' + (this.theme || 'light');

      /* Modal panel */
      var modal = document.createElement('div');
      modal.className = 'pk-modal';
      modal.innerHTML = this._modalHTML();
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      this._backdrop = backdrop;
      this._modal = modal;

      /* Canvas */
      var canvas = modal.querySelector('.pk-canvas');
      canvas.width = t.canvas.width;
      canvas.height = t.canvas.height;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this._sizeCanvas();

      /* Interactions */
      this._setupDrag();
      this._setupZoom();
      this._setupUpload();
      this._setupLayouts();

      /* CTA */
      var btn = modal.querySelector('.pk-cta');
      if (btn) btn.addEventListener('click', function () { self._confirm(); });

      /* Close */
      var closeBtn = modal.querySelector('.pk-close');
      if (closeBtn) closeBtn.addEventListener('click', function () { self._closeModal(); });

      /* Backdrop tap */
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) self._closeModal();
      });

      /* ESC */
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && backdrop.classList.contains('pk-open')) self._closeModal();
      });

      /* Resize */
      window.addEventListener('resize', _debounce(function () { self._sizeCanvas(); }, 100));

      this._render();
    },

    _openModal: function () {
      var self = this;
      if (!this._backdrop) return;
      this._backdrop.classList.add('pk-open');
      document.body.style.overflow = 'hidden';
      setTimeout(function () { self._sizeCanvas(); self._render(); }, 20);
    },

    _closeModal: function () {
      if (!this._backdrop) return;
      this._backdrop.classList.remove('pk-open');
      document.body.style.overflow = '';
      this._drawTrigger();
    },

    _modalHTML: function () {
      var t = this.template;
      var isOverlay = t.type === 'overlay';
      var hasVendorZone = t.photoZones && t.photoZones.length >= 1;
      var hideLayouts = hasVendorZone || isOverlay;
      var isLive = !!this.apiKey;

      return (
        /* ── Preview column ── */
        '<div class="pk-preview-col">' +
        '<div class="pk-shell">' +
        '<canvas class="pk-canvas"></canvas>' +
        '<div class="pk-hint-overlay"><div class="pk-hint-pill">' +
        _svg('move', 12, 12, 'rgba(255,255,255,0.7)') +
        'Drag &nbsp;&middot;&nbsp; Pinch or scroll to zoom' +
        '</div></div>' +
        '</div>' +
        '<div class="pk-zoom">' +
        '<button class="pk-zb pk-zm" title="Zoom out">&#8722;</button>' +
        '<div class="pk-z-track"><div class="pk-z-fill" style="width:0"></div></div>' +
        '<button class="pk-zb pk-zp" title="Zoom in">+</button>' +
        '<span class="pk-z-lbl">1.0&times;</span>' +
        '<div class="pk-z-sep"></div>' +
        '<button class="pk-z-reset">Reset</button>' +
        '</div>' +
        '</div>' +

        /* ── Controls column ── */
        '<div class="pk-controls-col">' +
        /* Header */
        '<div class="pk-modal-header">' +
        '<div>' +
        '<div class="pk-modal-title">Customize Your Case</div>' +
        '<div class="pk-modal-sub">Upload a photo &nbsp;&middot;&nbsp; drag to reposition &nbsp;&middot;&nbsp; pinch to zoom</div>' +
        '</div>' +
        '<button class="pk-close" title="Close">&#x2715;</button>' +
        '</div>' +

        '<div class="pk-divider"></div>' +

        /* Badge */
        '<div>' +
        '<span class="pk-badge ' + (isLive ? 'pk-live' : 'pk-demo') + '">' +
        '<span class="pk-dot"></span>' + (isLive ? 'Live Mode' : 'Demo Mode') +
        '</span>' +
        '</div>' +

        /* Upload */
        '<div class="pk-upload">' + this._uploadHTML() + '</div>' +
        '<input class="pk-file-inp" type="file" accept="image/jpeg,image/png">' +

        /* Res warning */
        '<div class="pk-warn">' +
        _svg('alert', 14, 14, '#b45309') +
        '<span>For best print quality, use a photo at least 768&thinsp;&times;&thinsp;1654&nbsp;px.</span>' +
        '</div>' +

        /* Layout selector */
        (!hideLayouts
          ? '<div>' +
          '<div class="pk-section-label">Print layout</div>' +
          '<div class="pk-layouts">' +
          _lpill('full_back', 'Full Back', _svgLayoutFull(), true) +
          _lpill('skip_camera', 'Below Camera', _svgLayoutSkip(), false) +
          '</div>' +
          '</div>'
          : '') +

        /* CTA */
        '<button class="pk-cta" disabled>' + this._ctaHTML() + '</button>' +
        '<p class="pk-sub">Confirmed designs are delivered digitally as a print-ready file.</p>' +
        '</div>'
      );
    },

    /* ── Canvas sizing ── */
    _sizeCanvas: function () {
      var t = this.template;
      var col = this._modal && this._modal.querySelector('.pk-preview-col');
      if (!col) return;
      var mobile = window.innerWidth < 640;
      /* height-first sizing */
      var maxH = mobile
        ? 260
        : Math.min(490, Math.round(window.innerHeight * 0.54));
      var maxW = Math.round(maxH * t.canvas.width / t.canvas.height);
      /* constrain by column width */
      var colW = col.offsetWidth || (mobile ? window.innerWidth : 440);
      var padX = mobile ? 40 : 72;
      maxW = Math.min(maxW, colW - padX);
      if (maxW < 100) maxW = 100;
      maxH = Math.round(maxW * t.canvas.height / t.canvas.width);
      this.canvas.style.width = maxW + 'px';
      this.canvas.style.height = maxH + 'px';
    },

    /* ── HTML helpers ── */
    _uploadHTML: function () {
      return (
        _svgUpload() +
        '<p class="pk-upload-h">Drop your photo here</p>' +
        '<p class="pk-upload-s">JPEG or PNG &nbsp;&middot;&nbsp; up to 20 MB</p>'
      );
    },

    _ctaHTML: function () {
      return _svg('check', 15, 15, '#fff') + ' Confirm Design';
    },

    /* ─────────────────────────────────────────────────────────────────────────
       DRAG
    ───────────────────────────────────────────────────────────────────────── */
    _setupDrag: function () {
      var self = this;
      var cvs = this.canvas;
      var shell = this._modal.querySelector('.pk-shell');

      cvs.addEventListener('mousedown', function (e) {
        if (!self.userImage) return;
        e.preventDefault();
        var pt = self._pt(e);
        self._drag = { sx: pt.x, sy: pt.y, ox: self.imageOffsetX, oy: self.imageOffsetY };
        shell.classList.add('pk-dragging');
      });
      window.addEventListener('mousemove', function (e) {
        if (!self._drag) return;
        var pt = self._pt(e);
        self.imageOffsetX = self._drag.ox + (pt.x - self._drag.sx);
        self.imageOffsetY = self._drag.oy + (pt.y - self._drag.sy);
        self._clamp(); self._render();
      });
      window.addEventListener('mouseup', function () {
        self._drag = null;
        if (shell) shell.classList.remove('pk-dragging');
      });

      cvs.addEventListener('wheel', function (e) {
        if (!self.userImage) return;
        e.preventDefault();
        self._zoom(self.imageScale + (e.deltaY < 0 ? SCALE_STEP : -SCALE_STEP));
      }, { passive: false });

      cvs.addEventListener('touchstart', function (e) {
        if (!self.userImage) return;
        e.preventDefault();
        if (e.touches.length === 1) {
          var pt = self._pt(e);
          self._drag = { sx: pt.x, sy: pt.y, ox: self.imageOffsetX, oy: self.imageOffsetY };
          self._pinch = null;
        } else if (e.touches.length === 2) {
          self._drag = null;
          self._pinch = { dist: _dist2(e), scale: self.imageScale };
        }
      }, { passive: false });

      cvs.addEventListener('touchmove', function (e) {
        if (!self.userImage) return;
        e.preventDefault();
        if (e.touches.length === 1 && self._drag) {
          var pt = self._pt(e);
          self.imageOffsetX = self._drag.ox + (pt.x - self._drag.sx);
          self.imageOffsetY = self._drag.oy + (pt.y - self._drag.sy);
          self._clamp(); self._render();
        } else if (e.touches.length === 2 && self._pinch) {
          self._zoom(self._pinch.scale * (_dist2(e) / self._pinch.dist));
        }
      }, { passive: false });

      cvs.addEventListener('touchend', function (e) {
        if (e.touches.length === 0) { self._drag = null; self._pinch = null; }
        else if (e.touches.length === 1 && self._pinch) {
          self._pinch = null;
          var pt = self._pt(e);
          self._drag = { sx: pt.x, sy: pt.y, ox: self.imageOffsetX, oy: self.imageOffsetY };
        }
      });
    },

    _pt: function (e) {
      var r = this.canvas.getBoundingClientRect();
      var sx = this.template.canvas.width / r.width;
      var sy = this.template.canvas.height / r.height;
      var s = (e.touches && e.touches[0]) || e;
      return { x: (s.clientX - r.left) * sx, y: (s.clientY - r.top) * sy };
    },

    _zoom: function (v) {
      this.imageScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, v));
      this._clamp(); this._render(); this._syncZoom();
    },

    _clamp: function () {
      if (!this.userImage) return;
      var z = this._zone(), img = this.userImage;
      var bs = Math.max(z.w / img.width, z.h / img.height);
      var rs = bs * this.imageScale;
      var mx = Math.max(0, (img.width * rs - z.w) / 2);
      var my = Math.max(0, (img.height * rs - z.h) / 2);
      this.imageOffsetX = Math.max(-mx, Math.min(mx, this.imageOffsetX));
      this.imageOffsetY = Math.max(-my, Math.min(my, this.imageOffsetY));
    },

    _zone: function () {
      var t = this.template;
      // Vendor overlay with a real photoZone → strict: limit preview to that zone
      if (t.type === 'overlay') {
        if (!t.photoZone) {
          console.warn('PreviewKit: overlay mode but no photoZone defined. Falling back to canvas.');
          return { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height };
        }
        return this._normalizeZone(t.photoZone, t.canvas.width, t.canvas.height);
      }
      // Fallback image mode → canvas equals phone-bounds. Re-express the
      // image-fraction zone as a phone-bounds fraction, then map to canvas pixels.
      if (t.type === 'fallback_image') {
        var ly = this.selectedLayout || 'full_back';
        var pz = FALLBACK_LAYOUT_ZONES[ly] || FALLBACK_LAYOUT_ZONES.full_back;
        var pb = FALLBACK_PHONE_BOUNDS_IMG;
        var fx = (pz.xPctImg - pb.xPctImg) / pb.wPctImg;
        var fy = (pz.yPctImg - pb.yPctImg) / pb.hPctImg;
        var fw = pz.wPctImg / pb.wPctImg;
        var fh = pz.hPctImg / pb.hPctImg;
        var zone = {
          x: Math.round(fx * t.canvas.width),
          y: Math.round(fy * t.canvas.height),
          w: Math.round(fw * t.canvas.width),
          h: Math.round(fh * t.canvas.height)
        };
        if (pz.radiusFrac) zone.radius = Math.round(pz.radiusFrac * t.canvas.width);
        return zone;
      }
      var pa = this._area();
      return pa ? { x: pa.x, y: pa.y, w: pa.width, h: pa.height }
        : { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height };
    },

    /* Resolve a zone definition to absolute canvas pixels.
       Accepts:
         - fractional:  { xPct, yPct, wPct, hPct }            values 0–1
         - percentage:  { xPct, yPct, wPct, hPct }            values 0–100   (auto-detected)
         - absolute:    { xPx, yPx, widthPx, heightPx }       canvas pixels
         - snake_case:  { x_pct, y_pct, width_pct, height_pct } (legacy)
       Heuristic: if any *Pct value is > 1, treat them as percentage (0–100). Else fraction (0–1). */
    _normalizeZone: function (pz, cw, ch) {
      var hasPx = pz.xPx != null || pz.widthPx != null || pz.heightPx != null;
      if (hasPx) {
        return {
          x: Math.round(pz.xPx || 0),
          y: Math.round(pz.yPx || 0),
          w: Math.round(pz.widthPx || cw),
          h: Math.round(pz.heightPx || ch)
        };
      }
      var xPct = pz.xPct != null ? pz.xPct : (pz.x_pct != null ? pz.x_pct : 0);
      var yPct = pz.yPct != null ? pz.yPct : (pz.y_pct != null ? pz.y_pct : 0);
      var wPct = pz.wPct != null ? pz.wPct : (pz.width_pct != null ? pz.width_pct : 1);
      var hPct = pz.hPct != null ? pz.hPct : (pz.height_pct != null ? pz.height_pct : 1);
      // Auto-detect: if any value exceeds 1, assume percentage scale (0–100)
      var anyOverOne = xPct > 1 || yPct > 1 || wPct > 1 || hPct > 1;
      var div = anyOverOne ? 100 : 1;
      return {
        x: Math.round((xPct / div) * cw),
        y: Math.round((yPct / div) * ch),
        w: Math.round((wPct / div) * cw),
        h: Math.round((hPct / div) * ch)
      };
    },

    _area: function () {
      var t = this.template, ly = this.selectedLayout || 'full_back';
      if (t.layouts && t.layouts[ly] && t.layouts[ly].printArea) return t.layouts[ly].printArea;
      return t.printArea;
    },

    /* ─────────────────────────────────────────────────────────────────────────
       ZOOM BAR
    ───────────────────────────────────────────────────────────────────────── */
    _setupZoom: function () {
      var self = this;
      var minus = this._modal.querySelector('.pk-zm');
      var plus = this._modal.querySelector('.pk-zp');
      var reset = this._modal.querySelector('.pk-z-reset');
      if (minus) minus.addEventListener('click', function () { self._zoom(self.imageScale - SCALE_STEP); });
      if (plus) plus.addEventListener('click', function () { self._zoom(self.imageScale + SCALE_STEP); });
      if (reset) reset.addEventListener('click', function () {
        self.imageOffsetX = 0; self.imageOffsetY = 0; self._zoom(1.0);
      });
    },

    _syncZoom: function () {
      if (!this._modal) return;
      var pct = (this.imageScale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 100;
      var fill = this._modal.querySelector('.pk-z-fill');
      var lbl = this._modal.querySelector('.pk-z-lbl');
      var minus = this._modal.querySelector('.pk-zm');
      var plus = this._modal.querySelector('.pk-zp');
      if (fill) fill.style.width = pct + '%';
      if (lbl) lbl.textContent = this.imageScale.toFixed(1) + '\u00d7';
      if (minus) minus.disabled = this.imageScale <= SCALE_MIN;
      if (plus) plus.disabled = this.imageScale >= SCALE_MAX;
    },

    /* ─────────────────────────────────────────────────────────────────────────
       UPLOAD
    ───────────────────────────────────────────────────────────────────────── */
    _setupUpload: function () {
      var self = this;
      var zone = this._modal.querySelector('.pk-upload');
      var input = this._modal.querySelector('.pk-file-inp');
      zone.addEventListener('click', function () { if (!zone.classList.contains('pk-filled')) input.click(); });
      input.addEventListener('change', function () { if (input.files[0]) self._process(input.files[0]); });
      zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('pk-drag-over'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('pk-drag-over'); });
      zone.addEventListener('drop', function (e) {
        e.preventDefault(); zone.classList.remove('pk-drag-over');
        if (e.dataTransfer.files[0]) self._process(e.dataTransfer.files[0]);
      });
    },

    _process: function (file) {
      var self = this;
      if (!['image/jpeg', 'image/png'].includes(file.type)) { alert('Please upload a JPEG or PNG.'); return; }
      if (file.size > 20 * 1024 * 1024) { alert('File exceeds 20 MB.'); return; }

      this.userFile = file;
      this.imageOffsetX = 0; this.imageOffsetY = 0; this.imageScale = 1.0;

      new Promise(function (res) {
        var r = new FileReader();
        r.onload = function (ev) { res(ev.target.result); };
        r.readAsDataURL(file);
      }).then(function (src) {
        return new Promise(function (res) {
          var img = new Image(); img.onload = function () { res(img); }; img.src = src;
        });
      }).then(function (img) {
        self.userImage = img;

        var col = self._modal.querySelector('.pk-preview-col');
        var shell = self._modal.querySelector('.pk-shell');
        if (col) col.classList.add('pk-has-img');
        if (shell) shell.classList.add('pk-can-drag');

        clearTimeout(self._hintTimer);
        self._hintTimer = setTimeout(function () {
          if (shell) shell.classList.remove('pk-can-drag');
        }, 3000);

        var zone = self._modal.querySelector('.pk-upload');
        if (zone) {
          zone.classList.add('pk-filled');
          var mb = (file.size / 1024 / 1024).toFixed(1);
          zone.innerHTML =
            '<div class="pk-file-row">' +
            '<img class="pk-thumb" src="' + _esc(img.src) + '" alt="">' +
            '<div class="pk-file-info">' +
            '<span class="pk-file-name">' + _esc(file.name) + '</span>' +
            '<span class="pk-file-meta">' + mb + ' MB</span>' +
            '</div>' +
            '<button class="pk-file-chg" data-chg>Change</button>' +
            '</div>';
          zone.querySelector('[data-chg]').addEventListener('click', function (e) {
            e.stopPropagation();
            self._modal.querySelector('.pk-file-inp').click();
          });
        }

        var warn = self._modal.querySelector('.pk-warn');
        var c = self.template.constraints || {};
        if (warn) warn.classList.toggle('pk-show',
          img.width < (c.minRecommendedWidthPx || 768) ||
          img.height < (c.minRecommendedHeightPx || 1654));

        self._render(); self._syncZoom();

        var btn = self._modal.querySelector('.pk-cta');
        if (btn) btn.disabled = false;
        self._emit('upload', { file: file, width: img.width, height: img.height });
      });
    },

    _upload: function () {
      var self = this;
      var btn = this._modal.querySelector('.pk-cta');
      if (btn) { btn.disabled = true; btn.innerHTML = '<div class="pk-spin"></div> Uploading&#8230;'; }

      var fd = new FormData();
      fd.append('file', this.userFile);
      fd.append('modelKey', this.modelKey);
      if (this.templateKey) fd.append('templateKey', this.templateKey);
      fd.append('scale', this.imageScale);
      fd.append('offsetX', this.imageOffsetX);
      fd.append('offsetY', this.imageOffsetY);

      var z = this._zone();
      fd.append('zoneX', z.x);
      fd.append('zoneY', z.y);
      fd.append('zoneW', z.w);
      fd.append('zoneH', z.h);

      return fetch(this.apiUrl + '/v1/uploads', {
        method: 'POST',
        headers: { 'X-PreviewKit-Key': this.apiKey },
        body: fd
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (e) { throw e; });
          return r.json();
        })
        .then(function (d) {
          if (!d || !d.uploadId) {
            throw new Error('uploadId missing in response');
          }
          self.uploadId = d.uploadId;
          return d; // ✅ IMPORTANT
        })
        .catch(function (e) {
          console.error(e);
          throw e;   // ✅ IMPORTANT: rethrow so _confirm knows it failed
        });
    },

    /* ─────────────────────────────────────────────────────────────────────────
       CONFIRM
    ───────────────────────────────────────────────────────────────────────── */
    _confirm: function () {
      var self = this;
      var btn = this._modal.querySelector('.pk-cta');
      if (!btn || btn.disabled) return;

      if (!this.apiKey) {
        btn.classList.add('pk-done'); btn.disabled = true;
        btn.innerHTML = _svg('check', 15, 15, '#fff') + ' Saved (Demo)';
        this._emit('confirm', { modelKey: this.modelKey, timestamp: new Date().toISOString() });
        var self2 = this;
        setTimeout(function () { self2._closeModal(); self2._updateTriggerDone(); }, 1400);
        return;
      }

      var self = this;
      this._upload()
        .then(function () {
          var zone = self._zone();
          var canvas = self.template.canvas || { width: 1, height: 1 };
          return fetch(self.apiUrl + '/v1/confirm', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-PreviewKit-Key': self.apiKey
            },
            body: JSON.stringify({
              uploadId: self.uploadId,
              modelKey: self.modelKey,
              templateKey: self.templateKey,
              scale: self.imageScale,
              offsetX: self.imageOffsetX,
              offsetY: self.imageOffsetY,
              offsetXPct: zone.w ? self.imageOffsetX / zone.w : 0,
              offsetYPct: zone.h ? self.imageOffsetY / zone.h : 0,
              zoneX: zone.x,
              zoneY: zone.y,
              zoneW: zone.w,
              zoneH: zone.h,
              zoneXPct: zone.x / canvas.width,
              zoneYPct: zone.y / canvas.height,
              zoneWPct: zone.w / canvas.width,
              zoneHPct: zone.h / canvas.height
            })
          });
        })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (e) { throw e; });
          return r.json();
        })
        .then(function (d) {
          btn.classList.add('pk-done');
          btn.innerHTML = '✔ Design Confirmed';
          self._emit('confirm', d);

          setTimeout(function () {
            self._closeModal();
            self._updateTriggerDone();
          }, 1200);
        })
        .catch(function (e) {
          console.error(e);
          btn.disabled = false;
          btn.innerHTML = self._ctaHTML();
        });
    },

    /* ─────────────────────────────────────────────────────────────────────────
       LAYOUTS
    ───────────────────────────────────────────────────────────────────────── */
    _setupLayouts: function () {
      var self = this;
      var pills = this._modal.querySelectorAll('.pk-lpill');
      pills.forEach(function (p) {
        p.addEventListener('click', function () {
          self.selectedLayout = p.dataset.layout;
          self.imageOffsetX = 0; self.imageOffsetY = 0;
          pills.forEach(function (x) { x.classList.remove('pk-on'); });
          p.classList.add('pk-on');
          self._render();
        });
      });
    },

    /* ─────────────────────────────────────────────────────────────────────────
       RENDER
    ───────────────────────────────────────────────────────────────────────── */
    _render: function () {
      var ctx = this.ctx, t = this.template;
      if (!ctx) return;
      ctx.clearRect(0, 0, t.canvas.width, t.canvas.height);
      if (t.type === 'overlay') { this._renderOverlay(ctx, t); }
      else if (t.type === 'fallback_image') { this._renderFallbackImage(ctx, t); }
      else { this._renderProgrammatic(ctx, t); }
      this._drawTrigger();
    },

    /* Universal phone-back image fallback: case image is the canvas; user photo
       is drawn ON TOP, clipped to the photo zone (white case body region). */
    /* Phone-bounds rect on the canvas — i.e. the region the cropped image fills.
       In fallback mode we resize the canvas to match the phone-bounds aspect, so
       the cropped image fills the entire canvas: rect = {0,0,cw,ch}. */
    _imgRect: function () {
      var t = this.template;
      if (!t) return null;
      return { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height };
    },

    _renderFallbackImage: function (ctx, t) {
      var cw = t.canvas.width, ch = t.canvas.height;
      ctx.clearRect(0, 0, cw, ch);

      // 1. Draw user photo (or placeholder) UNDER the case image, clipped to the photo zone
      var z = this._zone();
      if (this.userImage) { this._drawImg(ctx, z); }
      else { this._placeholder(ctx, z, true); }

      // 2. Draw the transparent case image ON TOP, cropped to the phone-bounds rect
      //    inside the natural image so it fills the canvas with no margin.
      if (this.fallbackImage) {
        var img = this.fallbackImage;
        var pb = FALLBACK_PHONE_BOUNDS_IMG;
        var sx = pb.xPctImg * img.width;
        var sy = pb.yPctImg * img.height;
        var sw = pb.wPctImg * img.width;
        var sh = pb.hPctImg * img.height;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
      } else if (t.overlayUrl && !this._fallbackLoad) {
        this._fallbackLoad = true;
        var self = this, im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = function () { self.fallbackImage = im; self._fallbackLoad = false; self._render(); };
        im.onerror = function () { self._fallbackLoad = false; console.warn('PreviewKit: fallback image failed to load'); };
        im.src = t.overlayUrl;
      }
    },

    _renderOverlay: function (ctx, t) {
      var cw = t.canvas.width, ch = t.canvas.height;
      // Transparent canvas — themed .pk-shell background shows through
      // (white in light theme, slate-900 in dark) so the modal feels consistent.
      ctx.clearRect(0, 0, cw, ch);
      var z = this._zone();
      if (this.userImage) { this._drawImg(ctx, z); }
      else { this._placeholder(ctx, z, true); }
      if (this.overlayImage) {
        ctx.drawImage(this.overlayImage, 0, 0, cw, ch);
      } else if (t.overlayUrl && !this._overlayLoad) {
        this._overlayLoad = true;
        var self = this, img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () { self.overlayImage = img; self._overlayLoad = false; self._render(); };
        img.onerror = function () { self._overlayLoad = false; };
        img.src = t.overlayUrl;
      }
    },

    _renderProgrammatic: function (ctx, t) {
      // Transparent canvas — themed .pk-shell background shows through.
      ctx.clearRect(0, 0, t.canvas.width, t.canvas.height);
      this._drawCase(ctx, t);
      var z = this._zone();
      if (this.userImage) { this._drawImg(ctx, z); }
      else { this._placeholder(ctx, z, false); }
      if (t.camera) this._drawCamera(ctx, t.camera);
      if (t.buttons && t.phoneCase) this._drawButtons(ctx, t.phoneCase, t.buttons);
      if (t.port && t.phoneCase) this._drawPort(ctx, t.phoneCase, t.port);
    },

    _drawImg: function (ctx, z) {
      var img = this.userImage;
      var bs = Math.max(z.w / img.width, z.h / img.height);
      var rs = bs * this.imageScale;
      var dw = img.width * rs, dh = img.height * rs;
      ctx.save();
      ctx.beginPath();
      // Round-clip when the zone provides a corner radius (e.g. fallback_image
      // full_back) so photo corners follow the phone case curvature.
      if (z.radius && z.radius > 0) {
        ctx.roundRect(z.x, z.y, z.w, z.h, z.radius);
      } else {
        ctx.rect(z.x, z.y, z.w, z.h);
      }
      ctx.clip();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img,
        z.x + z.w / 2 - dw / 2 + this.imageOffsetX,
        z.y + z.h / 2 - dh / 2 + this.imageOffsetY, dw, dh);
      ctx.restore();
    },

    _placeholder: function (ctx, z, forOverlay) {
      // Placeholder always sits on top of a light case body (programmatic case
      // is white-filled; fallback_image PNG is white case body; vendor overlays
      // typically use light photo zones). Use slate tints — visible in BOTH
      // light and dark modal themes since the underlying surface is light.
      ctx.save();
      ctx.fillStyle = 'rgba(15,23,42,0.025)';
      ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.setLineDash([9, 7]);
      ctx.strokeStyle = 'rgba(15,23,42,0.18)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(z.x + 1, z.y + 1, z.w - 2, z.h - 2);
      ctx.setLineDash([]);
      var cx = z.x + z.w / 2, cy = z.y + z.h / 2;
      ctx.fillStyle = 'rgba(15,23,42,0.14)';
      ctx.fillRect(cx - 14, cy - 2, 28, 4); ctx.fillRect(cx - 2, cy - 14, 4, 28);
      ctx.fillStyle = 'rgba(15,23,42,0.45)';
      ctx.font = '400 11px -apple-system,system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Upload your photo', cx, cy + 26);
      ctx.restore();
    },

    _drawCase: function (ctx, t) {
      var p = t.phoneCase; if (!p) return;
      var x = p.x, y = p.y, w = p.width, h = p.height, r = p.radius;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.14)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
      ctx.fillStyle = p.caseColor || '#fff'; ctx.fill();
      ctx.restore();
      var g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, 'rgba(255,255,255,0.5)');
      g.addColorStop(0.4, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.04)');
      ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = g; ctx.fill();
      // Outer case border
      ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
      ctx.strokeStyle = p.borderColor || 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 1; ctx.stroke();

      // ── Visible bezel: darker rounded ring inside the case outline ──
      var bezelInset = 3.5;
      var bezelW = 3;
      var bx = x + bezelInset, by = y + bezelInset;
      var bw = w - bezelInset * 2, bh = h - bezelInset * 2;
      var br = Math.max(0, r - bezelInset);
      ctx.save();
      var bg = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      bg.addColorStop(0, 'rgba(40,40,48,0.85)');
      bg.addColorStop(0.5, 'rgba(70,70,80,0.65)');
      bg.addColorStop(1, 'rgba(20,20,26,0.9)');
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, br);
      ctx.strokeStyle = bg;
      ctx.lineWidth = bezelW;
      ctx.stroke();
      ctx.restore();
    },

    _drawCamera: function (ctx, cam) {
      if (!cam) return;

      // ✅ FIRST: handle Samsung-style cameras
      if (cam.type === 'individual_lenses') {
        this._drawIndividualLenses(ctx, cam);
        return;
      }

      // ✅ THEN: handle island-based cameras (iPhone)
      var isle = cam.island;
      var lenses = cam.lenses || [];

      if (!isle && !lenses.length) return;

      if (isle) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 10;

        ctx.beginPath();
        ctx.roundRect(isle.x, isle.y, isle.width, isle.height, isle.radius);
        ctx.fillStyle = isle.color || '#1a1a1a';
        ctx.fill();

        ctx.restore();
      }

      lenses.forEach(function (l) {
        ctx.beginPath();
        ctx.arc(l.cx, l.cy, l.outerRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#222';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(l.cx, l.cy, l.innerRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#080808';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(
          l.cx - l.innerRadius * 0.3,
          l.cy - l.innerRadius * 0.3,
          l.innerRadius * 0.25,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fill();
      });

      if (cam.flash) {
        var f = cam.flash;
        ctx.beginPath();
        ctx.arc(f.cx, f.cy, f.radius, 0, Math.PI * 2);

        var fg = ctx.createRadialGradient(f.cx, f.cy, 0, f.cx, f.cy, f.radius);
        fg.addColorStop(0, '#ffe066');
        fg.addColorStop(1, '#d08000');

        ctx.fillStyle = fg;
        ctx.fill();
      }
    },

    _drawButtons: function (ctx, pc, btns) {
      btns.forEach(function (b) {
        var thickness = Math.max(b.thickness || 5, 5);
        var x = b.side === 'left' ? pc.x - thickness + 1 : pc.x + pc.width - 1;
        var y = pc.y + b.offset;
        var rad = b.radius || Math.min(thickness, b.length) / 2;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = b.side === 'left' ? -1 : 1;
        ctx.beginPath(); ctx.roundRect(x, y, thickness, b.length, rad);
        ctx.fillStyle = '#1a1a1a';
        ctx.fill();
        ctx.restore();
        // Subtle highlight along the outer edge for metallic feel
        ctx.beginPath();
        ctx.roundRect(x, y, thickness, b.length, rad);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      });
    },

    _drawPort: function (ctx, pc, pt) {
      ctx.beginPath();
      ctx.roundRect(pc.x + (pc.width - pt.width) / 2, pc.y + pc.height - pt.height / 2,
        pt.width, pt.height, pt.radius || 3);
      ctx.fillStyle = '#2a2a2a'; ctx.fill();
    },
    _drawIndividualLenses: function (ctx, cam) {
      const caseBox = this.template.phoneCase;

      const baseX = caseBox.x + caseBox.width * 0.06;
      const baseY = caseBox.y + caseBox.height * 0.05;

      const spacingX = caseBox.width * 0.18;
      const spacingY = caseBox.height * 0.12;

      const radiusOuter = caseBox.width * 0.06;
      const radiusInner = radiusOuter * 0.65;

      const positions = [
        { x: baseX, y: baseY },
        { x: baseX + spacingX, y: baseY - spacingY * 0.1 },
        { x: baseX, y: baseY + spacingY },
        { x: baseX + spacingX, y: baseY + spacingY * 1.2 }
      ];

      positions.slice(0, cam.count).forEach(p => {

        // outer ring
        ctx.beginPath();
        ctx.arc(p.x, p.y, radiusOuter, 0, Math.PI * 2);
        ctx.fillStyle = '#111';
        ctx.fill();

        // inner lens
        ctx.beginPath();
        ctx.arc(p.x, p.y, radiusInner, 0, Math.PI * 2);
        ctx.fillStyle = '#000';
        ctx.fill();

        // highlight
        ctx.beginPath();
        ctx.arc(p.x - radiusInner * 0.3, p.y - radiusInner * 0.3, radiusInner * 0.25, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fill();
      });

      // flash (optional)
      ctx.beginPath();
      ctx.arc(baseX + spacingX * 1.2, baseY + spacingY * 0.5, radiusInner * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffcc00';
      ctx.fill();
    }

  };

  /* ─── SVG helpers ─────────────────────────────────────────────────────────── */
  function _svg(name, w, h, col) {
    var paths = {
      'move':
        '<polyline points="5,9 2,12 5,15"/><polyline points="9,5 12,2 15,5"/>' +
        '<polyline points="15,19 12,22 9,19"/><polyline points="19,9 22,12 19,15"/>' +
        '<line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>',
      'check': '<polyline points="20 6 9 17 4 12"/>',
      'alert':
        '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>' +
        '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    };
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 24 24" fill="none" stroke="' + (col || 'currentColor') +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">' +
      (paths[name] || '') + '</svg>';
  }

  function _svgWand() {
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">' +
      '<path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/>' +
      '<path d="M17.8 11.8L19 13"/><path d="M15 9h.01"/><path d="M17.8 6.2L19 5"/>' +
      '<path d="m3 21 9-9"/><path d="M12.2 6.2L11 5"/>' +
      '</svg>';
  }

  function _svgUpload() {
    return '<svg class="pk-upload-icon" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>' +
      '<polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>' +
      '</svg>';
  }

  function _svgLayoutFull() {
    return '<svg width="30" height="38" viewBox="0 0 30 38" fill="none">' +
      '<rect x="1" y="1" width="28" height="36" rx="6" stroke="#d4d4dc" stroke-width="1.5"/>' +
      '<rect x="3" y="3" width="24" height="32" rx="3" fill="#6366f1" fill-opacity="0.15"/>' +
      '<rect x="3" y="3" width="24" height="32" rx="3" stroke="#6366f1" stroke-width="1"/>' +
      '</svg>';
  }
  function _svgLayoutCenter() {
    return '<svg width="30" height="38" viewBox="0 0 30 38" fill="none">' +
      '<rect x="1" y="1" width="28" height="36" rx="6" stroke="#d4d4dc" stroke-width="1.5"/>' +
      '<rect x="7" y="9" width="16" height="20" rx="3" fill="#6366f1" fill-opacity="0.15"/>' +
      '<rect x="7" y="9" width="16" height="20" rx="3" stroke="#6366f1" stroke-width="1"/>' +
      '</svg>';
  }
  function _svgLayoutSkip() {
    return '<svg width="30" height="38" viewBox="0 0 30 38" fill="none">' +
      '<rect x="1" y="1" width="28" height="36" rx="6" stroke="#d4d4dc" stroke-width="1.5"/>' +
      '<rect x="9" y="3" width="10" height="6" rx="2" fill="#1a1a1a" fill-opacity="0.5"/>' +
      '<rect x="3" y="13" width="24" height="22" rx="3" fill="#6366f1" fill-opacity="0.15"/>' +
      '<rect x="3" y="13" width="24" height="22" rx="3" stroke="#6366f1" stroke-width="1"/>' +
      '</svg>';
  }

  function _lpill(id, lbl, icon, active) {
    return '<div class="pk-lpill' + (active ? ' pk-on' : '') + '" data-layout="' + id + '">' +
      icon + '<span class="pk-lpill-lbl">' + lbl + '</span></div>';
  }

  function _esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function _dist2(e) {
    var dx = e.touches[0].clientX - e.touches[1].clientX;
    var dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function _debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  /* ─── Global facade ───────────────────────────────────────────────────────── */
  var _w = null;
  root.PreviewKit = {
    version: SDK_VERSION,
    init: function (cfg) { _w = new Widget(cfg); _w.init(); return this; },
    on: function (ev, fn) { if (_w) _w.on(ev, fn); return this; },
    reset: function () { if (_w) _w.reset(); return this; },
    confirm: function () { if (_w) _w._confirm(); return this; },
    open: function () { if (_w) _w._openModal(); return this; },
    close: function () { if (_w) _w._closeModal(); return this; }
  };

}(window));
