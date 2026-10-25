#!/bin/zsh
# Capture an overheating episode: thermal probe CSV every 5 s, top processes every 15 s,
# plus full snapshots at start and end. Usage: hot-capture.sh [minutes] [label]
set -u
ROOT=${0:A:h:h}
PROBE=$ROOT/target/release/thermal-probe
MINUTES=${1:-10}
LABEL=${2:-hot}
OUT=$ROOT/measurements/$(date +%Y-%m-%d-%H%M)-$LABEL
mkdir -p $OUT

snapshot() {
  {
    echo "=== $(date '+%Y-%m-%d %H:%M:%S')"
    $PROBE
    echo; echo "=== power"; pmset -g batt
    echo; echo "=== load"; uptime
    echo; echo "=== swap"; sysctl vm.swapusage
    echo; echo "=== top cpu"; top -l 2 -s 2 -o cpu -n 20 -stats pid,command,cpu,mem,threads | tail -n 21
    echo; echo "=== memory by app (MB, RSS sum)"
    ps -Ao rss=,comm= | awk '{r=$1; $1=""; c=$0; if (c ~ /\.app\//) {sub(/.*\/Applications\//,"",c); sub(/\.app\/.*/,"",c)} else {n=split(c,a,"/"); c=a[n]} m[c]+=r} END{for(x in m) printf "%7.0f  %s\n", m[x]/1024, x}' | sort -rn | head -20
    echo; echo "=== LLM / invisible-assistant processes"
    ps -Ao pid,%cpu,rss,etime,args | grep -i -E 'qwen|ollama|llama|mlx|lm.?studio|invisible-assistant|gguf' | grep -v grep | cut -c1-250
  } > $OUT/$1.txt 2>&1
}

echo "capturing $MINUTES min into $OUT"
snapshot start
$PROBE --sensors > $OUT/sensors-start.txt
$PROBE --watch 5 --csv > $OUT/probe.csv &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT INT TERM
END=$((SECONDS + MINUTES * 60))
while [ $SECONDS -lt $END ]; do
  { echo "=== $(date +%H:%M:%S)"; top -l 2 -s 2 -o cpu -n 8 -stats pid,command,cpu,mem | tail -n 9; } >> $OUT/top.txt
  sleep 13
done
kill $PID 2>/dev/null
$PROBE --sensors > $OUT/sensors-end.txt
snapshot end
echo "done: $OUT"
