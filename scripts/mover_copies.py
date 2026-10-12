"""Раскладчик копий: забирает TMP<папка>_<n>__<имя> из папки загрузок Chrome
и переносит в DEST/<относительный путь> по картам TMPMAP_*.json."""
import argparse, json, os, re, shutil, time

ap = argparse.ArgumentParser()
ap.add_argument("--inbox", required=True, help="папка, куда Chrome сохраняет загрузки")
ap.add_argument("--dest", required=True, help="куда раскладывать")
ap.add_argument("--prefix", default="TMP", help="метка временных файлов (как в start(..., {prefix}))")
ap.add_argument("--state-dir", default=None, help="куда класть журнал и служебные карты (по умолчанию — рядом с папкой назначения); задай, если DEST — подпапка архива, чтобы служебное не смешивалось с фото")
args = ap.parse_args()

INBOX, DEST = args.inbox, args.dest
BASE = args.state_dir or os.path.dirname(DEST.rstrip("/"))
MAPS = os.path.join(BASE, "_ya_copies_maps")
LOG = os.path.join(BASE, "ya_copies_mover.log")

P = re.escape(args.prefix)
file_re = re.compile(rf"^({P}\d+_\d+)__")
map_re = re.compile(rf"^{P}MAP_\d+.*\.json$")
mapping = {}
placed = 0


def log(msg):
    with open(LOG, "a") as f:
        f.write(time.strftime("%H:%M:%S ") + msg + "\n")


def load_maps():
    os.makedirs(MAPS, exist_ok=True)
    for fn in os.listdir(INBOX):
        if map_re.match(fn):
            p = os.path.join(INBOX, fn)
            try:
                mapping.update(json.load(open(p)))
                shutil.move(p, os.path.join(MAPS, fn))
            except Exception:
                pass  # ещё пишется


def step():
    global placed
    load_maps()
    n = 0
    for fn in os.listdir(INBOX):
        m = file_re.match(fn)
        if not m or fn.endswith(".crdownload"):
            continue
        rel = mapping.get(m.group(1))
        if rel is None:
            continue
        dst = os.path.join(DEST, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(os.path.join(INBOX, fn), dst)
        n += 1
    placed += n
    if n:
        log(f"[{args.prefix}] placed +{n}, total {placed}")


if __name__ == "__main__":
    os.makedirs(DEST, exist_ok=True)
    while True:
        try:
            step()
        except Exception as e:
            log(f"error {e!r}")
        time.sleep(3)
