// Вставляется в вкладку https://disk.yandex.ru/client/... через javascript_tool.
// window.__yaExport.start('/disk/Фотокамера/Мой архив') — обход всех подпапок,
// скачивание XXXL-превью картинок + карты TMPMAP_<n>.json для раскладчика.
(() => {
  const S = { root: '', folders: 0, done: 0, ok: 0, err: 0, skipped: 0, errs: [], failed: [], stop: false, finished: false, cur: '', fno: 1 };
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
  const FILE_TIMEOUT_MS = 20000;
  const LIST_TIMEOUT_MS = 30000;
  function fetchWithTimeout(url, ms) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    return fetch(url, { credentials: 'include', signal: c.signal }).finally(() => clearTimeout(t));
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r({ err: 'timeout' }), ms))]);

  async function ls(path) {
    let all = [], off = 0;
    for (;;) {
      const j = await api('mpfs/resources', { sort: 'name', order: '1', idContext: path, amount: 200, offset: off });
      const res = j.resources || j.result || j;
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
          const r = await fetchWithTimeout(u, FILE_TIMEOUT_MS);
          if (!r.ok) throw new Error('http ' + r.status);
          save(await r.blob(), id + '__' + x.name + suffix(x.name));
          S.ok++;
        } catch (e) {
          S.err++; S.errs.push([x.id, e.name === 'AbortError' ? 'timeout' : String(e.message)]); S.failed.push([id, x.id]);
        }
        S.done++;
        await new Promise(r => setTimeout(r, 150));
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  async function doFolder(path, fno) {
    S.cur = path;
    const l = await withTimeout(ls(path), LIST_TIMEOUT_MS);
    if (l.err) { S.errs.push(['ls', path]); return []; }
    const self = norm(path);
    const items = l.filter(x => norm(x.id) !== self);
    const dirs = items.filter(x => x.type === 'dir').map(x => x.id);
    const map = {}, jobs = [];
    items.filter(x => x.type === 'file').forEach((x, k) => {
      if (!isImg(x.name) && !isExtra(x.name)) { S.skipped++; return; }
      const id = 'TMP' + fno + '_' + k;
      map[id] = x.id.slice(S.root.length + 1) + suffix(x.name);
      jobs.push([id, x]);
    });
    if (jobs.length) {
      save(new Blob([JSON.stringify(map)], { type: 'application/json' }), 'TMPMAP_' + fno + '.json');
      await new Promise(r => setTimeout(r, 800));
    }
    await fetchJobs(jobs);
    return dirs;
  }

  // Опись: структура папок, число и названия файлов, размеры — без скачивания.
  const inv = { folders: [], files: [], finished: false, errs: [] };

  window.__yaExport = {
    scan(root) {
      root = norm(root);
      inv.folders = []; inv.files = []; inv.errs = []; inv.finished = false;
      (async () => {
        const q = [root];
        while (q.length) {
          const d = q.shift();
          inv.folders.push(d.slice(root.length + 1) || '.');
          const l = await withTimeout(ls(d), LIST_TIMEOUT_MS);
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
    start(root) {
      S.root = norm(root);
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
          const l = await withTimeout(ls(dir), LIST_TIMEOUT_MS);
          if (l.err) continue;
          const want = new Set(paths);
          const fno = S.fno++, map = {}, jobs = [];
          l.filter(x => want.has(x.id)).forEach((x, k) => {
            const id = 'TMP' + fno + '_' + k;
            map[id] = x.id.slice(S.root.length + 1) + suffix(x.name);
            jobs.push([id, x]);
          });
          if (!jobs.length) continue;
          save(new Blob([JSON.stringify(map)], { type: 'application/json' }), 'TMPMAP_' + fno + '.json');
          await new Promise(r => setTimeout(r, 800));
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
      return { ...rest, failedCount: failed.length, lastErrs: errs.slice(-3) };
    },
  };
})();
