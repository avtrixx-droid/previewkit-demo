/**
 * PreviewKit SDK v2.1.0
 *
 * Modal-based photo customiser — drag · pinch-zoom · mobile-first
 * Drop-in: renders a single "Customize" CTA button; vendor's product images stay untouched.
 * Works with Shopify / WooCommerce / plain HTML.
 *
 * Usage:
 *   PreviewKit.init({ container:'#pk', templateId:'phonecase_iphone17', apiKey:'pk_live_…' });
 *   PreviewKit.on('confirm', fn);
 */
(function (root) {
  'use strict';

  var SDK_VERSION = '2.1.0';
  var DEFAULT_URL = 'http://localhost:8080';
  var SCALE_MIN   = 1.0;
  var SCALE_MAX   = 4.0;
  var SCALE_STEP  = 0.25;

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
  ].join('');

  function _injectStyles() {
    if (document.getElementById('pk-css-v2')) return;
    var s = document.createElement('style');
    s.id = 'pk-css-v2';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ─── Widget ──────────────────────────────────────────────────────────────── */
  function Widget(cfg) {
    this.config        = cfg;
    this.apiUrl        = (cfg.apiUrl || DEFAULT_URL).replace(/\/$/, '');
    this.apiKey        = cfg.apiKey || null;
    this.template      = null;
    this.canvas        = null;
    this.ctx           = null;
    this.userImage     = null;
    this.userFile      = null;
    this.uploadId      = null;
    this.imageOffsetX  = 0;
    this.imageOffsetY  = 0;
    this.imageScale    = 1.0;
    this._drag         = null;
    this._pinch        = null;
    this.overlayImage  = null;
    this._overlayLoad  = false;
    this.selectedLayout= 'full_back';
    this.listeners     = {};
    this.container     = null;
    this._hintTimer    = null;
    this._backdrop     = null;
    this._modal        = null;
  }

  Widget.prototype = {

    /* ── Public API ── */
    init: function () {
      _injectStyles();
      var self = this;
      var cfg  = this.config;
      var el   = typeof cfg.container === 'string'
        ? document.querySelector(cfg.container)
        : cfg.container;
      if (!el) throw new Error('PreviewKit: container not found: ' + cfg.container);
      this.container = el;
      el.classList.add('pk');

      if (this.apiKey && cfg.templateId) {
        this._loading();
        fetch(this.apiUrl + '/v1/templates/' + cfg.templateId,
              { headers: { 'X-PreviewKit-Key': this.apiKey } })
          .then(function (r) {
            if (!r.ok) return r.json().then(function (e) { return Promise.reject(e); });
            return r.json();
          })
          .then(function (t) {
            self.template = self._norm(t.template || t, t);
            self._mount();
          })
          .catch(function (e) {
            var msg = (e && e.error && e.error.message) || 'Could not load template.';
            el.innerHTML = '<div class="pk-err">&#9888; ' + _esc(msg) + '</div>';
          });
      } else if (cfg.template) {
        this.template = this._norm(cfg.template);
        this._mount();
      } else {
        throw new Error('PreviewKit: provide apiKey+templateId or template.');
      }
    },

    on:    function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; },
    _emit: function (ev, d)  { (this.listeners[ev] || []).forEach(function (f) { f(d); }); },

    reset: function () {
      this.userImage    = null;
      this.userFile     = null;
      this.uploadId     = null;
      this.overlayImage = null;
      this._overlayLoad = false;
      this.imageOffsetX = 0;
      this.imageOffsetY = 0;
      this.imageScale   = 1.0;
      this._drag        = null;
      this._pinch       = null;
      if (!this.canvas || !this._modal) return;
      this._render();
      this._syncZoom();
      var col  = this._modal.querySelector('.pk-preview-col');
      var shell= this._modal.querySelector('.pk-shell');
      if (col)  col.classList.remove('pk-has-img');
      if (shell) shell.classList.remove('pk-can-drag', 'pk-dragging');
      var zone = this._modal.querySelector('.pk-upload');
      if (zone) { zone.classList.remove('pk-filled'); zone.innerHTML = this._uploadHTML(); }
      var warn = this._modal.querySelector('.pk-warn');
      if (warn) warn.classList.remove('pk-show');
      var btn  = this._modal.querySelector('.pk-cta');
      if (btn)  { btn.disabled = true; btn.classList.remove('pk-done'); btn.innerHTML = this._ctaHTML(); }
      this._drawTrigger();
    },

    /* ── Template normalise ── */
    _norm: function (t, api) {
      api = api || {};
      var pc = api.previewConfig || null;
      var cw, ch;
      if (pc && pc.canvasWidth)  { cw = pc.canvasWidth;    ch = pc.canvasHeight; }
      else if (t && t.preview)   { cw = t.preview.canvasWidth; ch = t.preview.canvasHeight; }
      else if (t && t.canvas)    { cw = t.canvas.width;    ch = t.canvas.height; }
      else                       { cw = 360; ch = 600; }
      var base;
      if (t && t.preview) {
        var p = t.preview;
        base = { templateKey: t.templateKey || t.templateId,
          canvas: {width:cw,height:ch}, phoneCase: p.phoneCase, printArea: p.printArea,
          layouts: p.layouts||null, camera: p.camera, buttons: p.buttons,
          port: p.port, constraints: t.constraints||{} };
      } else {
        base = { templateKey: (t&&(t.templateKey||t.templateId))||api.templateKey,
          canvas: {width:cw,height:ch}, phoneCase: t&&t.phoneCase,
          printArea: t&&t.printArea, layouts: (t&&t.layouts)||null,
          camera: t&&t.camera, buttons: t&&t.buttons, port: t&&t.port,
          constraints: (t&&t.constraints)||{} };
      }
      base.type       = api.type       || 'programmatic';
      base.overlayUrl = api.overlayUrl || null;
      base.photoZone  = api.photoZone  || null;
      base.previewConfig = pc;
      return base;
    },

    /* ── Loading placeholder ── */
    _loading: function () {
      this.container.innerHTML =
        '<div class="pk-loading"><div class="pk-loading-ring"></div>Loading&#8230;</div>';
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
      var el   = this.container;

      el.innerHTML =
        '<button class="pk-open-btn">' +
          _svgWand() + 'Customize Your Case' +
        '</button>';

      el.querySelector('.pk-open-btn').addEventListener('click', function () {
        self._openModal();
      });
    },

    /* No-op — trigger has no canvas to redraw */
    _drawTrigger: function () {},

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
      var t    = this.template;

      /* Backdrop */
      var backdrop = document.createElement('div');
      backdrop.className = 'pk pk-backdrop';

      /* Modal panel */
      var modal = document.createElement('div');
      modal.className = 'pk-modal';
      modal.innerHTML = this._modalHTML();
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      this._backdrop = backdrop;
      this._modal    = modal;

      /* Canvas */
      var canvas = modal.querySelector('.pk-canvas');
      canvas.width  = t.canvas.width;
      canvas.height = t.canvas.height;
      this.canvas = canvas;
      this.ctx    = canvas.getContext('2d');
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
      var t         = this.template;
      var isOverlay = t.type === 'overlay';
      var isLive    = !!this.apiKey;

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
          (!isOverlay
            ? '<div>' +
                '<div class="pk-section-label">Print layout</div>' +
                '<div class="pk-layouts">' +
                  _lpill('full_back',   'Full Back',  _svgLayoutFull(),   true) +
                  _lpill('centered',    'Centered',   _svgLayoutCenter(), false) +
                  _lpill('skip_camera', 'No Camera',  _svgLayoutSkip(),   false) +
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
      var t   = this.template;
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
      this.canvas.style.width  = maxW + 'px';
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
      var self  = this;
      var cvs   = this.canvas;
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
          self._drag  = { sx: pt.x, sy: pt.y, ox: self.imageOffsetX, oy: self.imageOffsetY };
          self._pinch = null;
        } else if (e.touches.length === 2) {
          self._drag  = null;
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
      var r  = this.canvas.getBoundingClientRect();
      var sx = this.template.canvas.width  / r.width;
      var sy = this.template.canvas.height / r.height;
      var s  = (e.touches && e.touches[0]) || e;
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
      var mx = Math.max(0, (img.width  * rs - z.w) / 2);
      var my = Math.max(0, (img.height * rs - z.h) / 2);
      this.imageOffsetX = Math.max(-mx, Math.min(mx, this.imageOffsetX));
      this.imageOffsetY = Math.max(-my, Math.min(my, this.imageOffsetY));
    },

    _zone: function () {
      var t = this.template;
      if (t.type === 'overlay' && t.photoZone) {
        var pz = t.photoZone, cw = t.canvas.width, ch = t.canvas.height;
        return { x: Math.round(pz.xPct/100*cw), y: Math.round(pz.yPct/100*ch),
                 w: Math.round(pz.wPct/100*cw), h: Math.round(pz.hPct/100*ch) };
      }
      var pa = this._area();
      return pa ? { x: pa.x, y: pa.y, w: pa.width, h: pa.height }
                : { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height };
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
      var self  = this;
      var minus = this._modal.querySelector('.pk-zm');
      var plus  = this._modal.querySelector('.pk-zp');
      var reset = this._modal.querySelector('.pk-z-reset');
      if (minus) minus.addEventListener('click', function () { self._zoom(self.imageScale - SCALE_STEP); });
      if (plus)  plus.addEventListener('click',  function () { self._zoom(self.imageScale + SCALE_STEP); });
      if (reset) reset.addEventListener('click', function () {
        self.imageOffsetX = 0; self.imageOffsetY = 0; self._zoom(1.0);
      });
    },

    _syncZoom: function () {
      if (!this._modal) return;
      var pct  = (this.imageScale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 100;
      var fill = this._modal.querySelector('.pk-z-fill');
      var lbl  = this._modal.querySelector('.pk-z-lbl');
      var minus= this._modal.querySelector('.pk-zm');
      var plus = this._modal.querySelector('.pk-zp');
      if (fill)  fill.style.width  = pct + '%';
      if (lbl)   lbl.textContent   = this.imageScale.toFixed(1) + '\u00d7';
      if (minus) minus.disabled    = this.imageScale <= SCALE_MIN;
      if (plus)  plus.disabled     = this.imageScale >= SCALE_MAX;
    },

    /* ─────────────────────────────────────────────────────────────────────────
       UPLOAD
    ───────────────────────────────────────────────────────────────────────── */
    _setupUpload: function () {
      var self  = this;
      var zone  = this._modal.querySelector('.pk-upload');
      var input = this._modal.querySelector('.pk-file-inp');
      zone.addEventListener('click',     function () { if (!zone.classList.contains('pk-filled')) input.click(); });
      input.addEventListener('change',   function () { if (input.files[0]) self._process(input.files[0]); });
      zone.addEventListener('dragover',  function (e) { e.preventDefault(); zone.classList.add('pk-drag-over'); });
      zone.addEventListener('dragleave', function ()  { zone.classList.remove('pk-drag-over'); });
      zone.addEventListener('drop',      function (e) {
        e.preventDefault(); zone.classList.remove('pk-drag-over');
        if (e.dataTransfer.files[0]) self._process(e.dataTransfer.files[0]);
      });
    },

    _process: function (file) {
      var self = this;
      if (!['image/jpeg', 'image/png'].includes(file.type)) { alert('Please upload a JPEG or PNG.'); return; }
      if (file.size > 20 * 1024 * 1024)                     { alert('File exceeds 20 MB.'); return; }

      this.userFile     = file;
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

        var col  = self._modal.querySelector('.pk-preview-col');
        var shell= self._modal.querySelector('.pk-shell');
        if (col)  col.classList.add('pk-has-img');
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
        var c    = self.template.constraints || {};
        if (warn) warn.classList.toggle('pk-show',
          img.width  < (c.minRecommendedWidthPx  || 768) ||
          img.height < (c.minRecommendedHeightPx || 1654));

        self._render(); self._syncZoom();

        if (self.apiKey) { self._upload(); }
        else {
          var btn = self._modal.querySelector('.pk-cta');
          if (btn) btn.disabled = false;
        }
        self._emit('upload', { file: file, width: img.width, height: img.height });
      });
    },

    _upload: function () {
      var self = this;
      var btn  = this._modal.querySelector('.pk-cta');
      if (btn) { btn.disabled = true; btn.innerHTML = '<div class="pk-spin"></div> Uploading&#8230;'; }

      var fd = new FormData();
      fd.append('file', this.userFile);
      fd.append('templateKey', this.template.templateKey);

      fetch(this.apiUrl + '/v1/uploads',
            { method: 'POST', headers: { 'X-PreviewKit-Key': this.apiKey }, body: fd })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (e) { return Promise.reject(e); });
          return r.json();
        })
        .then(function (d) {
          self.uploadId = d.uploadId;
          var btn = self._modal.querySelector('.pk-cta');
          if (btn) { btn.disabled = false; btn.innerHTML = self._ctaHTML(); }
        })
        .catch(function (e) {
          console.error('PreviewKit upload failed', e);
          var btn = self._modal.querySelector('.pk-cta');
          if (btn) { btn.disabled = false; btn.innerHTML = self._ctaHTML(); }
        });
    },

    /* ─────────────────────────────────────────────────────────────────────────
       CONFIRM
    ───────────────────────────────────────────────────────────────────────── */
    _confirm: function () {
      var self = this;
      var btn  = this._modal.querySelector('.pk-cta');
      if (!btn || btn.disabled) return;

      if (!this.apiKey) {
        btn.classList.add('pk-done'); btn.disabled = true;
        btn.innerHTML = _svg('check', 15, 15, '#fff') + ' Saved (Demo)';
        this._emit('confirm', { templateId: this.template.templateKey, timestamp: new Date().toISOString() });
        var self2 = this;
        setTimeout(function () { self2._closeModal(); self2._updateTriggerDone(); }, 1400);
        return;
      }

      btn.disabled = true; btn.innerHTML = '<div class="pk-spin"></div> Processing&#8230;';

      fetch(this.apiUrl + '/v1/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-PreviewKit-Key': this.apiKey },
        body: JSON.stringify({
          uploadId: this.uploadId,
          templateKey: this.template.templateKey,
          layout: this.selectedLayout
        })
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (e) { return Promise.reject(e); });
          return r.json();
        })
        .then(function (d) {
          btn.classList.add('pk-done'); btn.disabled = false;
          btn.innerHTML = _svg('check', 15, 15, '#fff') + ' Design Confirmed';
          self._emit('confirm', d);
          setTimeout(function () { self._closeModal(); self._updateTriggerDone(); }, 1400);
        })
        .catch(function (e) {
          console.error('PreviewKit confirm failed', e);
          var msg = (e && e.error && e.error.message) || 'Something went wrong.';
          btn.disabled = false; btn.innerHTML = self._ctaHTML();
          alert(msg);
        });
    },

    /* ─────────────────────────────────────────────────────────────────────────
       LAYOUTS
    ───────────────────────────────────────────────────────────────────────── */
    _setupLayouts: function () {
      var self  = this;
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
      else                       { this._renderProgrammatic(ctx, t); }
      this._drawTrigger();
    },

    _renderOverlay: function (ctx, t) {
      var cw = t.canvas.width, ch = t.canvas.height;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
      var z = this._zone();
      if (this.userImage) { this._drawImg(ctx, z); }
      else                 { this._placeholder(ctx, z, true); }
      if (this.overlayImage) {
        ctx.drawImage(this.overlayImage, 0, 0, cw, ch);
      } else if (t.overlayUrl && !this._overlayLoad) {
        this._overlayLoad = true;
        var self = this, img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = function () { self.overlayImage = img; self._overlayLoad = false; self._render(); };
        img.onerror = function () { self._overlayLoad = false; };
        img.src = t.overlayUrl;
      }
    },

    _renderProgrammatic: function (ctx, t) {
      ctx.fillStyle = '#f0f0f5'; ctx.fillRect(0, 0, t.canvas.width, t.canvas.height);
      this._drawCase(ctx, t);
      var z = this._zone();
      if (this.userImage) { this._drawImg(ctx, z); }
      else                 { this._placeholder(ctx, z, false); }
      if (t.camera)                 this._drawCamera(ctx, t.camera);
      if (t.buttons && t.phoneCase) this._drawButtons(ctx, t.phoneCase, t.buttons);
      if (t.port    && t.phoneCase) this._drawPort(ctx, t.phoneCase, t.port);
    },

    _drawImg: function (ctx, z) {
      var img = this.userImage;
      var bs  = Math.max(z.w / img.width, z.h / img.height);
      var rs  = bs * this.imageScale;
      var dw  = img.width * rs, dh = img.height * rs;
      ctx.save();
      ctx.beginPath(); ctx.rect(z.x, z.y, z.w, z.h); ctx.clip();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img,
        z.x + z.w/2 - dw/2 + this.imageOffsetX,
        z.y + z.h/2 - dh/2 + this.imageOffsetY, dw, dh);
      ctx.restore();
    },

    _placeholder: function (ctx, z, forOverlay) {
      ctx.save();
      ctx.fillStyle   = forOverlay ? 'rgba(99,102,241,0.05)' : 'rgba(0,0,0,0.025)';
      ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.setLineDash([9, 7]);
      ctx.strokeStyle = forOverlay ? 'rgba(99,102,241,0.35)' : 'rgba(0,0,0,0.11)';
      ctx.lineWidth   = 1.5;
      ctx.strokeRect(z.x + 1, z.y + 1, z.w - 2, z.h - 2);
      ctx.setLineDash([]);
      var cx = z.x + z.w/2, cy = z.y + z.h/2;
      ctx.fillStyle = forOverlay ? 'rgba(99,102,241,0.22)' : 'rgba(0,0,0,0.09)';
      ctx.fillRect(cx - 14, cy - 2, 28, 4); ctx.fillRect(cx - 2, cy - 14, 4, 28);
      ctx.fillStyle    = forOverlay ? 'rgba(99,102,241,0.5)' : 'rgba(0,0,0,0.28)';
      ctx.font         = '400 11px -apple-system,system-ui,sans-serif';
      ctx.textAlign    = 'center'; ctx.textBaseline = 'middle';
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
      var g = ctx.createLinearGradient(x, y, x+w, y+h);
      g.addColorStop(0, 'rgba(255,255,255,0.5)');
      g.addColorStop(0.4, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.04)');
      ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
      ctx.strokeStyle = p.borderColor || 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 1; ctx.stroke();
    },

    _drawCamera: function (ctx, cam) {
      var isle = cam.island; if (!isle) return;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.roundRect(isle.x, isle.y, isle.width, isle.height, isle.radius);
      ctx.fillStyle = isle.color || '#1a1a1a'; ctx.fill(); ctx.restore();
      (cam.lenses || []).forEach(function (l) {
        ctx.beginPath(); ctx.arc(l.cx, l.cy, l.outerRadius, 0, Math.PI*2);
        ctx.fillStyle = '#222'; ctx.fill();
        ctx.beginPath(); ctx.arc(l.cx, l.cy, l.innerRadius, 0, Math.PI*2);
        ctx.fillStyle = '#080808'; ctx.fill();
        ctx.beginPath();
        ctx.arc(l.cx - l.innerRadius*0.3, l.cy - l.innerRadius*0.3, l.innerRadius*0.22, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();
      });
      if (cam.flash) {
        var f = cam.flash;
        ctx.beginPath(); ctx.arc(f.cx, f.cy, f.radius, 0, Math.PI*2);
        var fg = ctx.createRadialGradient(f.cx, f.cy, 0, f.cx, f.cy, f.radius);
        fg.addColorStop(0, '#ffe066'); fg.addColorStop(1, '#d08000');
        ctx.fillStyle = fg; ctx.fill();
      }
    },

    _drawButtons: function (ctx, pc, btns) {
      btns.forEach(function (b) {
        var x = b.side === 'left' ? pc.x - b.thickness : pc.x + pc.width;
        ctx.beginPath(); ctx.roundRect(x, pc.y + b.offset, b.thickness, b.length, b.radius || 2);
        ctx.fillStyle = '#c0c0c8'; ctx.fill();
      });
    },

    _drawPort: function (ctx, pc, pt) {
      ctx.beginPath();
      ctx.roundRect(pc.x + (pc.width - pt.width)/2, pc.y + pc.height - pt.height/2,
                    pt.width, pt.height, pt.radius || 3);
      ctx.fillStyle = '#2a2a2a'; ctx.fill();
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
    return Math.sqrt(dx*dx + dy*dy);
  }

  function _debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  /* ─── Global facade ───────────────────────────────────────────────────────── */
  var _w = null;
  root.PreviewKit = {
    version: SDK_VERSION,
    init:    function (cfg) { _w = new Widget(cfg); _w.init(); return this; },
    on:      function (ev, fn) { if (_w) _w.on(ev, fn); return this; },
    reset:   function ()       { if (_w) _w.reset();    return this; },
    confirm: function ()       { if (_w) _w._confirm(); return this; },
    open:    function ()       { if (_w) _w._openModal(); return this; },
    close:   function ()       { if (_w) _w._closeModal(); return this; }
  };

}(window));
