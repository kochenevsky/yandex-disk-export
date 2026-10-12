"""Список файлов, которые уже лежат в папке назначения, для продолжения выгрузки.
Печатает в файл JSON-массив путей относительно корня выгрузки, с исходными именами
(у RAW/HEIC-копий убирается добавленный .jpg).
Использование: python3 done_files.py "<DEST>" "<out.json>" [подпапка, напр. 2021]"""
import json, os, sys

dest, out = sys.argv[1], sys.argv[2]
sub = sys.argv[3] if len(sys.argv) > 3 else ""
EXTRA = ('.cr2', '.cr3', '.nef', '.arw', '.dng', '.heic', '.heif', '.tif', '.tiff', '.bmp', '.webp')
res = []
for r, _, fs in os.walk(os.path.join(dest, sub)):
    for f in fs:
        if f == '.DS_Store':
            continue
        rel = os.path.relpath(os.path.join(r, f), dest)
        low = rel.lower()
        if low.endswith('.jpg') and low[:-4].endswith(EXTRA):
            rel = rel[:-4]
        res.append(rel)
json.dump(res, open(out, 'w'), ensure_ascii=False)
print(len(res))
