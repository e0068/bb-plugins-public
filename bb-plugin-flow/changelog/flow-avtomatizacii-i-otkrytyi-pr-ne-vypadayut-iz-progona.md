---
version: 0.6.161
date: 2026-10-13T11:34Z
pr: 788
---

- ru: Коммит, PR и слияние больше не выпадают из прогона, если агент забыл их отметить; при переходе в другой flow тред называет открытый PR прежнего прогона, а агент не перескакивает через незакрытый этап
  en: Commit, PR and merge no longer drop out of the run when the agent forgets to tick them; moving to another flow names the previous run's open PR in the thread, and the agent cannot skip an unfinished stage
