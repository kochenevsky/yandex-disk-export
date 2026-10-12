// Вставляется в вкладку https://disk.yandex.ru/client/... через javascript_tool.
// window.__yaExport.start('/disk/Фотокамера/Мой архив') — обход всех подпапок,
// скачивание XXXL-превью картинок + карты TMPMAP_<n>.json для раскладчика.
(() => {
  const S = { prefix: 'TMP', root: '', folders: 0, done: 0, ok: 0, err: 0, skipped: 0, errs: [], failed: [], stop: false, finished: false, cur: '',
    // Номера пачек уникальны для каждого запуска: раскладчик помнит карты прошлых запусков
    // с той же меткой, и совпадение номеров могло бы отправить файл не в ту папку.
    fno: (Date.now() % 10000000) * 10 };
  const base = { sk: 'x', connection_id: String(Date.now()) };

  async function api(m, p) {
    let j;
    for (let i = 0; i < 3; i++) {
      const r = await fetch('/models-v2?m=' + m, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ ...base, apiMethod: m, requestParams: p }),
      });
      j = await r.json();
      if (j && j.error && j.error.code === 'CKEY') { base.sk = j.error.ckey; continue; }
      break;
    }
    return j;
  }

  // Во время сбоя Яндекс может не ответить и не закрыть запрос — без таймаута выгрузка
  // встаёт навсегда. Поэтому каждый запрос ограничен по времени.
  const FILE_TIMEOUT_MS = 25000;
  const LIST_TIMEOUT_MS = 30000;
  // Таймаут на ВЕСЬ файл, включая чтение тела: передача может зависнуть посреди файла,
  // и если таймер снять сразу после заголовков, поток встанет навсегда.
  async function fetchBlobWithTimeout(url, ms) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { credentials: 'include', signal: c.signal });
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.blob();
    } finally { clearTimeout(t); }
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r({ err: 'timeout' }), ms))]);

  // Список папки приходит страницами по 200, каждая 1–4 с. Таймаут — на КАЖДУЮ страницу
  // (с 3 попытками), а не на весь список: иначе папка с тысячами файлов «пустая».
  async function apiPage(p) {
    for (let a = 0; a < 3; a++) {
      const j = await withTimeout(api('mpfs/resources', p), LIST_TIMEOUT_MS);
      if (!(j && j.err === 'timeout')) return j;
    }
    return { err: 'timeout' };
  }

  async function ls(path) {
    let all = [], off = 0;
    for (;;) {
      const j = await apiPage({ sort: 'name', order: '1', idContext: path, amount: 200, offset: off });
      const res = j.resources || j.result;
      if (!Array.isArray(res)) return { err: j };
      all = all.concat(res);
      if (res.length < 200) break;
      off += 200;
    }
    return all;
  }

  function save(blob, name) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }

  // Вкладки-помощники на N.downloader.disk.yandex.ru: для превью без CORS-заголовка
  // скачивание со страницы Диска падает с «Failed to fetch», а со «своего» адреса — работает.
  // Хранятся на window, чтобы повторная вставка скрипта не теряла уже открытых помощников.
  const helpers = (window.__yaHelpers ||= {}), helperReady = (window.__yaHelperReady ||= {}), pending = (window.__yaPending ||= {});
  const helperErr = {};
  if (!window.__yaMsgHooked) {
    window.__yaMsgHooked = true;
    window.addEventListener('message', e => {
      const m = e.data; if (!m) return;
      if (m.t === 'ready') window.__yaHelperReady[m.host] = true;
      else if (m.t === 'res' && window.__yaPending[m.id]) { window.__yaPending[m.id](m); delete window.__yaPending[m.id]; }
    });
  }
  function viaHelper(url, name) {
    return new Promise(res => {
      const host = new URL(url).host, w = helpers[host];
      if (!w || w.closed) return res({ ok: false, err: 'nohelper ' + host });
      const id = Math.random().toString(36).slice(2);
      const t = setTimeout(() => { delete pending[id]; res({ ok: false, err: 'helper timeout' }); }, 32000);
      pending[id] = m => { clearTimeout(t); res(m); };
      w.postMessage({ t: 'get', id, url, name }, 'https://' + host);
    });
  }

  const isImg = n => /\.(jpe?g|png|gif)$/i.test(n);
  // RAW/HEIC и пр.: Яндекс отдаёт превью в JPEG — сохраняем как <имя>.jpg
  const isExtra = n => /\.(cr2|cr3|nef|arw|dng|heic|heif|tiff?|bmp|webp)$/i.test(n);
  const suffix = n => (isExtra(n) ? '.jpg' : '');
  const norm = p => p.replace(/\/$/, '');

  async function fetchJobs(jobs) {
    let qi = 0;
    const worker = async () => {
      while (qi < jobs.length && !S.stop) {
        const [id, x] = jobs[qi++];
        try {
          const s = (x.meta.sizes || []).find(s => s.name === 'XXXL');
          if (!s) throw new Error('noprev');
          let u = s.url; if (u.startsWith('//')) u = 'https:' + u;
          const nm = id + '__' + x.name + suffix(x.name);
          try {
            save(await fetchBlobWithTimeout(u, FILE_TIMEOUT_MS), nm);
            S.okDirect = (S.okDirect || 0) + 1;
          } catch (e1) {
            const r = await viaHelper(u, nm);
            if (!r.ok) { helperErr[r.err] = (helperErr[r.err] || 0) + 1; throw new Error(r.err || String(e1.message)); }
            S.okHelper = (S.okHelper || 0) + 1;
          }
          S.ok++;
        } catch (e) {
          S.err++; S.errs.push([x.id, e.name === 'AbortError' ? 'timeout' : String(e.message)]); S.failed.push([id, x.id]);
        }
        // Без пауз между файлами: в фоновой вкладке Chrome растягивает таймеры до ~1 мин,
        // и цепочка пауз превращается в остановку. Темп задают сами 4 потока.
        S.done++; S.beat = Date.now();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  async function doFolder(path, fno) {
    S.cur = path;
    const l = await ls(path);
    if (l.err) { S.errs.push(['ls', path]); S.lsFailed = (S.lsFailed || 0) + 1; return []; }
    const self = norm(path);
    const items = l.filter(x => norm(x.id) !== self);
    const dirs = items.filter(x => x.type === 'dir').map(x => x.id);
    if (S.skip && S.skip.has(self.slice(S.root.length + 1))) return dirs;
    const map = {}, jobs = [];
    items.filter(x => x.type === 'file').forEach((x, k) => {
      if (!isImg(x.name) && !isExtra(x.name)) { S.skipped++; return; }
      if (S.skipFiles && S.skipFiles.has(x.id.slice(S.root.length + 1))) { S.already = (S.already || 0) + 1; return; }
      const id = S.prefix + fno + '_' + k;
      map[id] = x.id.slice(S.root.length + 1) + suffix(x.name);
      jobs.push([id, x]);
    });
    if (jobs.length) {
      save(new Blob([JSON.stringify(map)], { type: 'application/json' }), S.prefix + 'MAP_' + fno + '.json');
    }
    await fetchJobs(jobs);
    return dirs;
  }

  // Опись: структура папок, число и названия файлов, размеры — без скачивания.
  const inv = { folders: [], files: [], finished: false, errs: [] };

  window.__yaExport = {
    // Кнопки на странице: по одной на каждый адрес N.downloader.disk.yandex.ru.
    // Нажать каждую (window.open разрешён только по клику), потом в каждую
    // открывшуюся вкладку вставить scripts/helper_tab.js.
    helperButtons(hosts = ['1', '2', '3', '4']) {
      document.getElementById('__yaHelperBox')?.remove();
      const box = document.createElement('div');
      box.id = '__yaHelperBox';
      box.style.cssText = 'position:fixed;top:250px;left:500px;z-index:999999;display:flex;gap:12px';
      hosts.forEach(n => {
        const h = n + '.downloader.disk.yandex.ru';
        const b = document.createElement('button');
        b.textContent = 'HELPER ' + n;
        b.style.cssText = 'padding:18px;font-size:18px;background:#f15a3d;color:#fff';
        b.onclick = () => { helpers[h] = window.open('https://' + h + '/?keep=open', 'yahelper_' + n); };
        box.appendChild(b);
      });
      document.body.appendChild(box);
      return 'нажми ' + hosts.length + ' кнопки';
    },
    // Поле выбора файла для загрузки списка уже скачанного (JSON-массив путей).
    // Claude загружает файл инструментом file_upload (по ref поля с подписью «yadisk have list»).
    haveInput() {
      document.getElementById('__yaHaveInput')?.remove();
      const i = document.createElement('input');
      i.type = 'file'; i.id = '__yaHaveInput'; i.setAttribute('aria-label', 'yadisk have list');
      i.style.cssText = 'position:fixed;top:10px;left:10px;z-index:999999';
      i.onchange = async () => { window.__yaHave = JSON.parse(await i.files[0].text()); i.remove(); };
      document.body.appendChild(i);
      return 'загрузи файл в поле «yadisk have list»';
    },
    helpersStatus() {
      document.getElementById('__yaHelperBox')?.remove();
      return { ready: Object.keys(helperReady), open: Object.entries(helpers).filter(([, w]) => w && !w.closed).map(([h]) => h), helperErr };
    },
    scan(root) {
      root = norm(root);
      inv.folders = []; inv.files = []; inv.errs = []; inv.finished = false;
      (async () => {
        const q = [root];
        while (q.length) {
          const d = q.shift();
          inv.folders.push(d.slice(root.length + 1) || '.');
          const l = await ls(d);
          if (l.err) { inv.errs.push(d); continue; }
          for (const x of l) {
            if (norm(x.id) === norm(d)) continue;
            if (x.type === 'dir') q.push(x.id);
            else inv.files.push({ rel: x.id.slice(root.length + 1), size: +(x.meta && x.meta.size) || 0, mime: x.meta && x.meta.mimetype });
          }
        }
        inv.finished = true;
      })();
      return 'scanning';
    },
    scanStatus() {
      const byExt = {};
      for (const f of inv.files) {
        const e = (f.rel.match(/\.([^./]+)$/) || [, '—'])[1].toLowerCase();
        byExt[e] = byExt[e] || { n: 0, gb: 0 };
        byExt[e].n++; byExt[e].gb += f.size / 1e9;
      }
      for (const e in byExt) byExt[e].gb = +byExt[e].gb.toFixed(2);
      return {
        finished: inv.finished, folders: inv.folders.length, files: inv.files.length,
        gb: +(inv.files.reduce((a, f) => a + f.size, 0) / 1e9).toFixed(1), byExt, errs: inv.errs.length,
      };
    },
    // Сохранить опись файлом (папки + файлы с путями и размерами) в папку загрузок Chrome.
    saveManifest(name = 'yadisk_manifest.json') {
      save(new Blob([JSON.stringify({ folders: inv.folders, files: inv.files })], { type: 'application/json' }), name);
      return name;
    },
    // opts.skip — список папок (пути относительно root, '' = сам root), из которых
    // НЕ качать (уже скачаны), но в их подпапки всё равно заходить. Для продолжения после остановки.
    start(root, opts = {}) {
      S.finished = false; S.stop = false;
      S.root = norm(root);
      S.skip = new Set(opts.skip || []);
      // opts.prefix — своя метка временных файлов, чтобы параллельно или следом выгружать
      // другую папку со своим раскладчиком (mover_copies.py --prefix ...).
      if (opts.prefix) S.prefix = opts.prefix;
      // opts.skipFiles — пути файлов (относительно root, исходные имена), которые уже есть на диске:
      // их не качать. Список готовит scripts/done_files.py, во вкладку — через haveInput().
      S.skipFiles = opts.skipFiles ? new Set(opts.skipFiles) : (window.__yaHave ? new Set(window.__yaHave) : null);
      (async () => {
        const q = [S.root];
        while (q.length && !S.stop) {
          const d = q.shift();
          try { q.push(...await doFolder(d, S.fno++)); } catch (e) { S.errs.push(['folder', d, String(e)]); }
          S.folders++;
        }
        S.finished = true;
      })();
      return 'started';
    },
    // Повтор неудавшихся: заново берёт свежие ссылки по папкам этих файлов.
    retryFailed() {
      const failed = S.failed.splice(0);
      S.errs = []; S.finished = false;
      (async () => {
        const byDir = {};
        for (const [, path] of failed) (byDir[path.slice(0, path.lastIndexOf('/'))] ||= []).push(path);
        for (const [dir, paths] of Object.entries(byDir)) {
          if (S.stop) break;
          const l = await ls(dir);
          if (l.err) continue;
          const want = new Set(paths);
          const fno = S.fno++, map = {}, jobs = [];
          l.filter(x => want.has(x.id)).forEach((x, k) => {
            const id = S.prefix + fno + '_' + k;
            map[id] = x.id.slice(S.root.length + 1) + suffix(x.name);
            jobs.push([id, x]);
          });
          if (!jobs.length) continue;
          save(new Blob([JSON.stringify(map)], { type: 'application/json' }), S.prefix + 'MAP_' + fno + '.json');
              S.err -= jobs.length; S.done -= jobs.length;
          await fetchJobs(jobs);
        }
        S.finished = true;
      })();
      return 'retrying ' + failed.length;
    },
    stop() { S.stop = true; },
    status() {
      const { errs, failed, ...rest } = S;
      return { ...rest, failedCount: failed.length, lastErrs: errs.slice(-3), idleSec: S.beat ? Math.round((Date.now() - S.beat) / 1000) : null };
    },
  };
})();
