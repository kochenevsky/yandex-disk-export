#!/bin/zsh
# Сводка прогресса для Claude Code Monitor: каждая строка вывода = уведомление.
# Использование:
#   progress_monitor.sh "<DEST>" "<INBOX>" [минут_между_сводками=15] [минут_до_тревоги=20]
# Пишет:
#   СВОДКА HH:MM: всего N картинок (+M за период), по папкам: …, ждут раскладки K
#   ВНИМАНИЕ: … — если раскладчик остановился или давно нет новых файлов
DEST="$1"; INBOX="$2"; EVERY="${3:-15}"; STALL="${4:-20}"
LOG="$(dirname "${DEST%/}")/ya_copies_mover.log"
count() { find "$1" -type f ! -name .DS_Store 2>/dev/null | wc -l | tr -d ' '; }

prev=$(count "$DEST"); since="с запуска наблюдения"; last_line=""; quiet=0; tick=0
while true; do
  sleep $((60 - 10#$(date +%S)))   # просыпаемся в начале каждой минуты
  tick=$((tick + 1))
  line=$(tail -1 "$LOG" 2>/dev/null)
  if [ "$line" = "$last_line" ]; then quiet=$((quiet + 1)); else quiet=0; fi
  last_line="$line"
  [ "$quiet" -eq "$STALL" ] && echo "ВНИМАНИЕ $(date +%H:%M): нет новых файлов ${STALL}+ мин (последнее: $line)"
  pgrep -f "python3 .*mover_copies.py" >/dev/null || { [ "$quiet" -eq "$STALL" ] && echo "ВНИМАНИЕ $(date +%H:%M): раскладчик не запущен"; }
  # Сводки привязаны к часам (:00, :15, :30, :45 при EVERY=15), чтобы перезапуск
  # Monitor (он живёт максимум 30 мин) не сдвигал и не пропускал сводку.
  # Номер текущего 15-минутного слота; сводка — при смене слота. Так она не теряется,
  # даже если подсчёт файлов затянулся и проверка проскочила нужную минуту.
  slot=$(( (10#$(date +%H) * 60 + 10#$(date +%M)) / EVERY ))
  if [ -n "$last_slot" ] && [ "$slot" != "$last_slot" ]; then
    now=$(count "$DEST")
    per=""
    for d in "$DEST"/*/; do
      [ -d "$d" ] && per="$per$(basename "$d"): $(count "$d"); "
    done
    staged=$(ls "$INBOX" 2>/dev/null | grep -c -E '^[A-Z]+[0-9]+_[0-9]+__')
    echo "СВОДКА $(date +%H:%M): всего $now картинок (+$((now - prev)) $since); по папкам: ${${per%; }:-—}; ждут раскладки: $staged"
    prev=$now; since="с прошлой сводки"
  fi
  last_slot=$slot
done
