/*!
 * grapesjs-plugin-manager
 * Менеджер плагинов для GrapesJS:
 *  - кнопка на панели -> модальное окно с табами «Плагины / Установка / Настройки»
 *  - включение/отключение плагинов (состояние хранится в localStorage)
 *  - установка плагина из zip (drag & drop), код хранится в IndexedDB
 *  - редактор localStorage (key=value) для настроек плагинов
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else {
    root.grapesjsPluginManager = factory();
    if (root.grapesjs) root.grapesjs.plugins.add('grapesjs-plugin-manager', root.grapesjsPluginManager);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PLUGIN_ID = 'grapesjs-plugin-manager';

  var DEFAULTS = {
    pluginId: PLUGIN_ID,
    panel: 'options',                // панель, куда добавляется кнопка
    buttonId: 'plugin-manager',
    storageKey: 'gjs-plugin-manager', // префикс собственных ключей менеджера
    jszipUrl: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    settingsFilter: function () { return true; }, // (key) => bool — какие ключи показывать на вкладке настроек
    loadInstalled: true
  };

  var LABELS = {
    title: 'Менеджер плагинов',
    tabPlugins: 'Плагины',
    tabInstall: 'Установка',
    tabSettings: 'Настройки',
    builtin: 'встроенный',
    installed: 'установленный',
    error: 'ошибка',
    off: 'отключён',
    empty: 'Плагины не найдены',
    remove: 'Удалить',
    reloadNote: 'Изменения применятся после перезагрузки редактора.',
    reload: 'Перезагрузить',
    dropHere: 'Перетащите zip-архив плагина сюда',
    orClick: 'или нажмите, чтобы выбрать файл',
    dropHint: 'В архиве: manifest.json (id, name, version, main, global, storagePrefix) и JS-бандл. Без manifest — берётся index.js / первый .js.',
    installOk: 'Установлен',
    installErr: 'Ошибка установки',
    search: 'Фильтр по ключу…',
    key: 'Ключ',
    value: 'Значение',
    add: 'Добавить',
    save: 'Сохранить',
    del: 'Удалить ключ',
    noKeys: 'В localStorage нет подходящих ключей',
    confirmRemove: 'Удалить плагин «%s»?',
    confirmDel: 'Удалить ключ «%s»?'
  };

  // ---------- helpers ----------
  function readJSON(key, def) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; } catch (e) { return def; }
  }
  function idOf(p, i) {
    return typeof p === 'string' ? p : (p && p.name) || ('plugin-' + i);
  }
  function slug(s) {
    return String(s || '').toLowerCase().replace(/\.zip$/, '').replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function h(tag, props) {
    var e = document.createElement(tag);
    var kids = Array.prototype.slice.call(arguments, 2);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'checked' || k === 'value' || k === 'disabled') e[k] = v;
      else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
    });
    (function add(list) {
      list.forEach(function (c) {
        if (c == null || c === false) return;
        if (Array.isArray(c)) return add(c);
        e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
      });
    })(kids);
    return e;
  }

  // ---------- IndexedDB (код установленных плагинов) ----------
  var idb = {
    _db: null,
    open: function () {
      if (!this._db) {
        this._db = new Promise(function (res, rej) {
          var r = indexedDB.open('gjs-plugin-manager', 1);
          r.onupgradeneeded = function () { r.result.createObjectStore('plugins', { keyPath: 'id' }); };
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { rej(r.error); };
        });
      }
      return this._db;
    },
    run: function (mode, fn) {
      return this.open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction('plugins', mode);
          var req = fn(t.objectStore('plugins'));
          t.oncomplete = function () { res(req && req.result); };
          t.onerror = function () { rej(t.error); };
        });
      });
    },
    all: function () { return this.run('readonly', function (s) { return s.getAll(); }); },
    put: function (v) { return this.run('readwrite', function (s) { return s.put(v); }); },
    del: function (id) { return this.run('readwrite', function (s) { return s.delete(id); }); }
  };

  // ---------- zip ----------
  function loadJSZip(url) {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { res(window.JSZip); };
      s.onerror = function () { rej(new Error('Не удалось загрузить JSZip: ' + url)); };
      document.head.appendChild(s);
    });
  }

  function parseZip(file, jszipUrl) {
    return loadJSZip(jszipUrl).then(function (JSZip) { return JSZip.loadAsync(file); }).then(function (zip) {
      var files = Object.keys(zip.files).map(function (n) { return zip.files[n]; })
        .filter(function (f) { return !f.dir && f.name.indexOf('__MACOSX') !== 0; });

      var mf = files.filter(function (f) { return /(^|\/)manifest\.json$/.test(f.name); })[0] ||
               files.filter(function (f) { return /(^|\/)package\.json$/.test(f.name); })[0];

      return (mf ? mf.async('string').then(JSON.parse) : Promise.resolve({})).then(function (m) {
        var base = mf ? mf.name.replace(/[^/]*$/, '') : '';
        var main = m.main || (typeof m.browser === 'string' && m.browser) || m.unpkg || '';
        var mainFile = main && zip.file(base + String(main).replace(/^\.\//, ''));

        if (!mainFile) {
          var js = files.filter(function (f) { return f.name.indexOf(base) === 0 && /\.js$/i.test(f.name); });
          js.sort(function (a, b) {
            var pa = /(^|\/)(index|main|plugin)[^/]*\.js$/i.test(a.name) ? 0 : 1;
            var pb = /(^|\/)(index|main|plugin)[^/]*\.js$/i.test(b.name) ? 0 : 1;
            return pa - pb || a.name.split('/').length - b.name.split('/').length;
          });
          mainFile = js[0];
        }
        if (!mainFile) throw new Error('В архиве нет .js файла');

        return mainFile.async('string').then(function (code) {
          var name = m.name || file.name.replace(/\.zip$/i, '');
          return {
            id: slug(m.id || name),
            name: name,
            version: m.version || '',
            description: m.description || '',
            global: m.global || '',
            storagePrefix: m.storagePrefix || '',
            code: code,
            size: code.length,
            installedAt: Date.now()
          };
        });
      });
    });
  }

  // ---------- выполнение кода плагина ----------
  function runCode(code) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { s.remove(); URL.revokeObjectURL(url); res(); };
      s.onerror = function () { s.remove(); URL.revokeObjectURL(url); rej(new Error('Ошибка выполнения скрипта плагина')); };
      document.head.appendChild(s);
    });
  }

  // Загружает код и возвращает функцию-плагин (editor, opts) => void
  function evaluate(rec) {
    var g = window.grapesjs;
    var regBefore = g ? Object.keys(g.plugins.getAll()) : [];
    var winBefore = {};
    Object.getOwnPropertyNames(window).forEach(function (k) { winBefore[k] = 1; });

    return runCode(rec.code).then(function () {
      var fn = null;
      if (g && g.plugins.get(rec.id)) fn = g.plugins.get(rec.id);
      if (!fn && rec.global) fn = window[rec.global];
      if (!fn && g) {
        var added = Object.keys(g.plugins.getAll()).filter(function (k) { return regBefore.indexOf(k) < 0; });
        if (added.length) fn = g.plugins.get(added[0]);
      }
      if (!fn) {
        Object.getOwnPropertyNames(window).some(function (k) {
          if (winBefore[k]) return false;
          var v; try { v = window[k]; } catch (e) { return false; }
          if (typeof v === 'function' || (v && typeof v.default === 'function')) { fn = v; return true; }
          return false;
        });
      }
      if (fn && typeof fn !== 'function' && typeof fn.default === 'function') fn = fn.default;
      if (typeof fn !== 'function') {
        throw new Error('Плагин не зарегистрировался: используйте grapesjs.plugins.add(id, fn) или укажите "global" в manifest.json');
      }
      return fn;
    });
  }

  // ---------- CSS ----------
  var CSS = [
    '.gjs-pm{min-width:0;font-size:13px}',
    '.gjs-pm-tabs{display:flex;gap:4px;border-bottom:1px solid rgba(255,255,255,.15);margin-bottom:12px}',
    '.gjs-pm-tab{padding:8px 14px;cursor:pointer;opacity:.65;border-bottom:2px solid transparent}',
    '.gjs-pm-tab:hover{opacity:1}',
    '.gjs-pm-tab.active{opacity:1;border-bottom-color:currentColor}',
    '.gjs-pm-pane{max-height:60vh;overflow:auto}',
    '.gjs-pm-banner{display:flex;align-items:center;gap:10px;justify-content:space-between;padding:8px 12px;margin-bottom:10px;border-radius:3px;background:rgba(255,190,0,.18)}',
    '.gjs-pm-row{display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid rgba(255,255,255,.1)}',
    '.gjs-pm-info{flex:1;min-width:0}',
    '.gjs-pm-name{font-weight:600}',
    '.gjs-pm-desc{opacity:.7;font-size:12px;margin-top:2px;word-break:break-word}',
    '.gjs-pm-err{color:#ff7b7b;font-size:12px;margin-top:2px;word-break:break-word}',
    '.gjs-pm-badge{display:inline-block;margin-left:8px;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:400;background:rgba(255,255,255,.15)}',
    '.gjs-pm-badge.err{background:rgba(255,80,80,.35)}',
    '.gjs-pm-btn{padding:5px 10px;border-radius:3px;border:1px solid rgba(255,255,255,.3);background:transparent;color:inherit;cursor:pointer}',
    '.gjs-pm-btn:hover{background:rgba(255,255,255,.12)}',
    '.gjs-pm-switch{position:relative;width:38px;height:20px;flex:none}',
    '.gjs-pm-switch input{opacity:0;width:100%;height:100%;margin:0;position:absolute;cursor:pointer;z-index:1}',
    '.gjs-pm-switch span{position:absolute;inset:0;border-radius:10px;background:rgba(255,255,255,.25);transition:.15s}',
    '.gjs-pm-switch span:before{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}',
    '.gjs-pm-switch input:checked+span{background:#4caf50}',
    '.gjs-pm-switch input:checked+span:before{transform:translateX(18px)}',
    '.gjs-pm-drop{border:2px dashed rgba(255,255,255,.35);border-radius:6px;padding:48px 20px;text-align:center;cursor:pointer;transition:.15s}',
    '.gjs-pm-drop.over{border-color:#4caf50;background:rgba(76,175,80,.12)}',
    '.gjs-pm-drop small{display:block;opacity:.65;margin-top:6px}',
    '.gjs-pm-log{margin-top:12px}',
    '.gjs-pm-log div{padding:4px 0}',
    '.gjs-pm-log .ok{color:#7be08a}',
    '.gjs-pm-log .fail{color:#ff7b7b}',
    '.gjs-pm-hint{opacity:.6;font-size:12px;margin-top:10px}',
    '.gjs-pm-input{width:100%;box-sizing:border-box;padding:5px 8px;border-radius:3px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.2);color:inherit;font:inherit}',
    'textarea.gjs-pm-input{resize:vertical;min-height:30px;font-family:monospace}',
    '.gjs-pm-kv{display:grid;grid-template-columns:minmax(120px,32%) 1fr auto;gap:6px;align-items:start;padding:5px 0}',
    '.gjs-pm-kv .k{font-family:monospace;word-break:break-all;padding-top:6px}',
    '.gjs-pm-kv .acts{display:flex;gap:4px}',
    '.gjs-pm-kv.saved textarea,.gjs-pm-kv.saved input{border-color:#4caf50}',
    '.gjs-pm-add{margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.15)}'
  ].join('');

  // ---------- plugin ----------
  var plugin = function pluginManager(editor, opts) {
    opts = opts || {};
    var o = Object.assign({}, DEFAULTS, opts);
    var L = Object.assign({}, LABELS, opts.labels);
    var cfg = editor.getConfig();

    var KEY_OFF = o.storageKey + ':disabled';
    var KEY_KNOWN = o.storageKey + ':known';
    var off = new Set(readJSON(KEY_OFF, []));
    var saveOff = function () { localStorage.setItem(KEY_OFF, JSON.stringify(Array.from(off))); };
    var needsReload = false;

    // --- встроенные плагины (из config.plugins) ---
    var list = cfg.plugins || [];
    var selfIdx = -1;
    list.forEach(function (p, i) { if (p === plugin || p === o.pluginId) selfIdx = i; });

    var present = {};
    list.forEach(function (p, i) {
      if (i === selfIdx) return;
      var id = idOf(p, i);
      present[id] = true;
      // best-effort: если менеджер стоит первым — «глушим» отключённые плагины прямо в массиве
      if (selfIdx >= 0 && i > selfIdx && off.has(id)) list[i] = function () {};
    });

    var known = readJSON(KEY_KNOWN, []);
    Object.keys(present).forEach(function (id) { if (known.indexOf(id) < 0) known.push(id); });
    localStorage.setItem(KEY_KNOWN, JSON.stringify(known));

    // --- установленные плагины ---
    var installed = [];

    function activate(item) {
      return evaluate(item.rec).then(function (fn) {
        fn(editor, (cfg.pluginsOpts || {})[item.rec.id] || {});
        item.status = 'on';
        item.error = null;
      }).catch(function (e) {
        item.status = 'error';
        item.error = e && e.message || String(e);
        console.error('[plugin-manager] ' + item.rec.id, e);
      });
    }

    function loadInstalled() {
      if (!o.loadInstalled || !window.indexedDB) return Promise.resolve();
      return idb.all().then(function (recs) {
        return (recs || []).reduce(function (chain, rec) {
          return chain.then(function () {
            var item = { rec: rec, status: 'off', error: null };
            installed.push(item);
            if (!off.has(rec.id)) return activate(item);
          });
        }, Promise.resolve());
      }).catch(function (e) { console.error('[plugin-manager] IndexedDB', e); });
    }

    var ready = loadInstalled().then(function () { if (view) view.renderList(); });

    // --- UI ---
    var view = null;

    function style() {
      if (document.getElementById('gjs-pm-style')) return;
      var s = document.createElement('style');
      s.id = 'gjs-pm-style';
      s.textContent = CSS;
      document.head.appendChild(s);
    }

    function switchEl(checked, onChange) {
      var input = h('input', { type: 'checkbox', checked: !!checked, onChange: function () { onChange(input.checked); } });
      return h('label', { class: 'gjs-pm-switch' }, input, h('span'));
    }

    function open() {
      style();
      var banner = h('div', { class: 'gjs-pm-banner', style: 'display:none' },
        h('span', {}, L.reloadNote),
        h('button', { class: 'gjs-pm-btn', onClick: function () { location.reload(); } }, L.reload));
      var listBox = h('div');
      var panes = {};
      var tabs = {};

      function markReload() { needsReload = true; banner.style.display = 'flex'; }
      if (needsReload) banner.style.display = 'flex';

      // --- вкладка «Плагины» ---
      function renderList() {
        listBox.innerHTML = '';
        var rows = [];

        known.forEach(function (id) {
          var isOn = !off.has(id);
          rows.push(h('div', { class: 'gjs-pm-row' },
            h('div', { class: 'gjs-pm-info' },
              h('div', { class: 'gjs-pm-name' }, id, h('span', { class: 'gjs-pm-badge' }, L.builtin))),
            switchEl(isOn, function (v) {
              if (v) off.delete(id); else off.add(id);
              saveOff(); markReload();
            })));
        });

        installed.forEach(function (item) {
          var r = item.rec;
          var isOn = !off.has(r.id);
          var badge = item.status === 'error' ? h('span', { class: 'gjs-pm-badge err' }, L.error)
                                              : h('span', { class: 'gjs-pm-badge' }, L.installed);
          rows.push(h('div', { class: 'gjs-pm-row' },
            h('div', { class: 'gjs-pm-info' },
              h('div', { class: 'gjs-pm-name' }, r.name, r.version ? ' ' + r.version : '', badge),
              r.description && h('div', { class: 'gjs-pm-desc' }, r.description),
              item.error && h('div', { class: 'gjs-pm-err' }, item.error)),
            h('button', {
              class: 'gjs-pm-btn', title: L.remove, onClick: function () {
                if (!confirm(L.confirmRemove.replace('%s', r.name))) return;
                idb.del(r.id).then(function () {
                  installed.splice(installed.indexOf(item), 1);
                  off.delete(r.id); saveOff();
                  if (item.status === 'on') markReload();
                  renderList();
                });
              }
            }, '✕'),
            switchEl(isOn, function (v) {
              if (v) off.delete(r.id); else off.add(r.id);
              saveOff();
              if (v && item.status !== 'on') activate(item).then(renderList);
              else if (!v && item.status === 'on') markReload();
            })));
        });

        if (!rows.length) rows.push(h('div', { class: 'gjs-pm-hint' }, L.empty));
        rows.forEach(function (r) { listBox.appendChild(r); });
      }

      panes.plugins = h('div', { class: 'gjs-pm-pane' }, listBox);

      // --- вкладка «Установка» ---
      var log = h('div', { class: 'gjs-pm-log' });
      var fileInput = h('input', { type: 'file', accept: '.zip,application/zip', multiple: true, style: 'display:none', onChange: function () { handle(fileInput.files); fileInput.value = ''; } });
      var drop = h('div', {
        class: 'gjs-pm-drop',
        onClick: function () { fileInput.click(); },
        onDragover: function (e) { e.preventDefault(); drop.classList.add('over'); },
        onDragleave: function () { drop.classList.remove('over'); },
        onDrop: function (e) { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files); }
      }, h('div', { style: 'font-size:15px' }, L.dropHere), h('small', {}, L.orClick), fileInput);

      function say(ok, text) { log.appendChild(h('div', { class: ok ? 'ok' : 'fail' }, (ok ? '✓ ' : '✕ ') + text)); }

      function handle(files) {
        Array.prototype.slice.call(files).reduce(function (chain, file) {
          return chain.then(function () {
            if (!/\.zip$/i.test(file.name)) return say(false, file.name + ': не zip');
            return parseZip(file, o.jszipUrl).then(function (rec) {
              if (!rec.id) throw new Error('Не удалось определить id плагина');
              var existing = installed.filter(function (i) { return i.rec.id === rec.id; })[0];
              return idb.put(rec).then(function () {
                off.delete(rec.id); saveOff();
                if (existing) {
                  var wasOn = existing.status === 'on';
                  existing.rec = rec;
                  if (wasOn) { markReload(); existing.status = 'on'; return; }
                  return activate(existing);
                }
                var item = { rec: rec, status: 'off', error: null };
                installed.push(item);
                return activate(item);
              }).then(function () {
                var it = installed.filter(function (i) { return i.rec.id === rec.id; })[0];
                if (it && it.status === 'error') say(false, rec.name + ': ' + it.error);
                else say(true, L.installOk + ': ' + rec.name + (rec.version ? ' ' + rec.version : ''));
                renderList();
              });
            }).catch(function (e) { say(false, L.installErr + ' (' + file.name + '): ' + (e.message || e)); });
          });
        }, Promise.resolve());
      }

      panes.install = h('div', { class: 'gjs-pm-pane' }, drop, log, h('div', { class: 'gjs-pm-hint' }, L.dropHint));

      // --- вкладка «Настройки» (localStorage key=value) ---
      var filterInput = h('input', { class: 'gjs-pm-input', placeholder: L.search, onInput: renderKV });
      var kvBox = h('div');
      var newKey = h('input', { class: 'gjs-pm-input', placeholder: L.key });
      var newVal = h('textarea', { class: 'gjs-pm-input', placeholder: L.value, rows: 1 });
      var addBox = h('div', { class: 'gjs-pm-add' },
        h('div', { class: 'gjs-pm-kv' }, newKey, newVal,
          h('button', {
            class: 'gjs-pm-btn', onClick: function () {
              var k = newKey.value.trim();
              if (!k) return;
              localStorage.setItem(k, newVal.value);
              newKey.value = ''; newVal.value = '';
              renderKV();
            }
          }, L.add)));

      function allKeys() {
        var ks = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k.indexOf(o.storageKey) === 0) continue;
          if (o.settingsFilter(k)) ks.push(k);
        }
        return ks.sort();
      }

      function renderKV() {
        kvBox.innerHTML = '';
        var q = filterInput.value.trim().toLowerCase();
        var ks = allKeys().filter(function (k) { return !q || k.toLowerCase().indexOf(q) >= 0; });
        if (!ks.length) return kvBox.appendChild(h('div', { class: 'gjs-pm-hint' }, L.noKeys));
        ks.forEach(function (k) {
          var val = h('textarea', { class: 'gjs-pm-input', rows: 1, value: localStorage.getItem(k) || '' });
          var row = h('div', { class: 'gjs-pm-kv' },
            h('div', { class: 'k' }, k), val,
            h('div', { class: 'acts' },
              h('button', {
                class: 'gjs-pm-btn', title: L.save, onClick: function () {
                  localStorage.setItem(k, val.value);
                  row.classList.add('saved');
                  setTimeout(function () { row.classList.remove('saved'); }, 900);
                }
              }, '✓'),
              h('button', {
                class: 'gjs-pm-btn', title: L.del, onClick: function () {
                  if (!confirm(L.confirmDel.replace('%s', k))) return;
                  localStorage.removeItem(k); renderKV();
                }
              }, '✕')));
          kvBox.appendChild(row);
        });
      }

      panes.settings = h('div', { class: 'gjs-pm-pane' }, addBox, h('div', { style: 'margin-bottom:8px' }, filterInput), kvBox);

      // --- каркас ---
      var order = [['plugins', L.tabPlugins], ['install', L.tabInstall], ['settings', L.tabSettings]];
      var tabBar = h('div', { class: 'gjs-pm-tabs' });
      var body = h('div');

      function show(name) {
        order.forEach(function (t) { tabs[t[0]].classList.toggle('active', t[0] === name); });
        body.innerHTML = '';
        body.appendChild(panes[name]);
        if (name === 'settings') renderKV();
      }
      order.forEach(function (t) {
        tabs[t[0]] = h('div', { class: 'gjs-pm-tab', onClick: function () { show(t[0]); } }, t[1]);
        tabBar.appendChild(tabs[t[0]]);
      });

      var rootEl = h('div', { class: 'gjs-pm' }, banner, tabBar, body);
      view = { renderList: renderList };
      renderList();
      show('plugins');

      editor.Modal.open({ title: L.title, content: rootEl, attributes: { class: 'gjs-pm-modal' } })
        .onceClose(function () { view = null; });
    }

    // --- команда и кнопка ---
    editor.Commands.add('open-plugin-manager', { run: open });

    var ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:block"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>';

    function forPanels(fn) { editor.Panels.getPanels().forEach(fn); }

    function hasButton() {
      var f = false;
      forPanels(function (p) { var b = p.get('buttons'); if (b && b.get(o.buttonId)) f = true; });
      return f;
    }

    // Ищем панель, где реально лежат кнопки тулбара (у тем/пресетов id может отличаться от 'options')
    function findPanelId() {
      var pn = editor.Panels, found = null;
      var own = pn.getPanel(o.panel);
      if (own && own.get('buttons') && own.get('buttons').length) return o.panel;
      forPanels(function (p) {
        var b = p.get('buttons');
        if (!found && b && (b.get('sw-visibility') || b.get('preview') || b.get('undo'))) found = p.id;
      });
      return found || o.panel;
    }

    function mountButton() {
      if (hasButton()) return;
      var pn = editor.Panels, pid = findPanelId();
      if (!pn.getPanel(pid)) pn.addPanel({ id: pid });
      pn.addButton(pid, {
        id: o.buttonId,
        className: 'gjs-pm-btn-icon',
        label: ICON,
        attributes: { title: L.title },
        command: 'open-plugin-manager',
        togglable: false
      });
    }

    // Запасной вариант: плавающая кнопка, если тулбар не отрисовал нашу
    function floatingButton() {
      if (document.querySelector('.gjs-pm-btn-icon, .gjs-pm-float')) return;
      style();
      var b = h('button', {
        class: 'gjs-pm-float', title: L.title, onClick: open,
        style: 'position:fixed;right:12px;bottom:12px;z-index:99999;width:36px;height:36px;padding:8px;border:0;border-radius:50%;background:#d278c9;color:#fff;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)'
      });
      b.innerHTML = ICON;
      document.body.appendChild(b);
    }

    mountButton();
    // пресеты/темы могут пересоздать панели после нас — перепроверяем после load
    editor.on('load', function () {
      mountButton();
      setTimeout(floatingButton, 0);
    });

    editor.PluginManager = {
      open: open,
      ready: ready,
      isDisabled: function (id) { return off.has(id); },
      list: function () {
        return known.map(function (id) { return { id: id, type: 'builtin', enabled: !off.has(id) }; })
          .concat(installed.map(function (i) { return { id: i.rec.id, type: 'installed', enabled: !off.has(i.rec.id), status: i.status }; }));
      }
    };
  };

  /**
   * Надёжный способ отключать встроенные плагины: отфильтровать массив до init.
   *   grapesjs.init({ plugins: grapesjsPluginManager.filter([...]) })
   */
  plugin.filter = function (plugins, storageKey) {
    var off = readJSON((storageKey || DEFAULTS.storageKey) + ':disabled', []);
    return plugins.filter(function (p, i) { return p === plugin || off.indexOf(idOf(p, i)) < 0; });
  };

  return plugin;
});