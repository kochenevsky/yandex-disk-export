"""Печатает JSON-список папок, из которых уже что-то разложено (по картам раскладчика).
Использование: python3 done_folders.py "<папка _ya_copies_maps>" [--exclude "<папка>"]"""
import glob, json, os, sys
maps = sys.argv[1]
excl = set(sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == "--exclude")
dirs = set()
for f in glob.glob(os.path.join(maps, "*MAP_*.json")):
    for rel in json.load(open(f)).values():
        dirs.add(os.path.dirname(rel))
print(json.dumps(sorted(dirs - excl), ensure_ascii=False))
