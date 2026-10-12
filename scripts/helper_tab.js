// Вставляется во вкладку-помощника https://N.downloader.disk.yandex.ru/ (N = 1..4),
// открытую со страницы Диска через window.__yaExport.helperButtons().
// Получает от вкладки Диска ссылку на превью, скачивает её со «своего» адреса
// (здесь защита CORS не мешает) и сохраняет файл через Chrome.
(() => {
  document.title = 'ПОМОЩНИК — не закрывать';
  document.body.innerHTML = '<h1 style="font-family:sans-serif;color:#f15a3d">Помощник выгрузки фото — НЕ ЗАКРЫВАТЬ</h1>';
  if (window.__yaHelper) return 'already';
  window.__yaHelper = { n: 0, ok: 0 };
  window.addEventListener('message', async e => {
    if (e.origin !== 'https://disk.yandex.ru') return;
    const m = e.data;
    if (!m || m.t !== 'get') return;
    const c = new AbortController();
    const tm = setTimeout(() => c.abort(), 25000);
    let ok = false, err = '';
    try {
      const r = await fetch(m.url, { credentials: 'include', headers: { Accept: 'image/jpeg,image/png,image/*;q=0.5' }, signal: c.signal });
      if (!r.ok) throw new Error('http ' + r.status); // 434/500 — настоящий отказ Яндекса
      const b = await r.blob();
      const u = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = u; a.download = m.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 60000);
      ok = true; window.__yaHelper.ok++;
    } catch (x) {
      err = x.name === 'AbortError' ? 'timeout' : String(x.message);
    } finally { clearTimeout(tm); }
    window.__yaHelper.n++;
    e.source.postMessage({ t: 'res', id: m.id, ok, err }, e.origin);
  });
  if (window.opener) window.opener.postMessage({ t: 'ready', host: location.host }, 'https://disk.yandex.ru');
  return 'helper ready';
})();
