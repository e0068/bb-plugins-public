#!/bin/sh
# Выбор flow треду с «Автоматически»: один вызов модели без треда. Вход — stdin (правила, flow, сообщение владельца),
# поставщик, модель и effort — FLOW_PROVIDER, FLOW_MODEL, FLOW_EFFORT. Последняя строка вывода — id flow или none.
# Демон bb может не видеть PATH оболочки: места, куда ставят Claude Code и Codex, дописываются.
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.claude/local"
export PATH

# Служебный вывод CLI идёт в stderr и мог бы встать после ответа: он держится в переменной и показывается, только если
# вызов упал. Ответ идёт в stdout мимо неё — через дескриптор 3.
call() {
  { err=$("$@" 2>&1 >&3 3>&-); } 3>&1
  code=$?
  [ "$code" -eq 0 ] || printf '%s\n' "$err" >&2
  exit "$code"
}

case "$FLOW_PROVIDER" in
  claude-code)
    # effort — только из тех, что понимает claude: остальные уровни bb идут без флага, с effort модели по умолчанию.
    case "$FLOW_EFFORT" in
      low|medium|high|xhigh|max) set -- --effort "$FLOW_EFFORT" ;;
      *) set -- ;;
    esac
    call claude -p --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence --model "$FLOW_MODEL" "$@"
    ;;
  codex)
    call codex exec -m "$FLOW_MODEL" -s read-only --skip-git-repo-check ${FLOW_EFFORT:+-c "model_reasoning_effort=$FLOW_EFFORT"} -
    ;;
  *)
    echo "The provider $FLOW_PROVIDER has no one-shot call." >&2
    exit 2
    ;;
esac
