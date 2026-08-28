export const meta = {
  name: 'parallel-dev',
  description:
    'Параллельная разработка: планировщик бьёт задачу на непересекающиеся по файлам группы, каждая группа гонит конвейер impl(sonnet)→review(opus)→validate(haiku) с циклом правок; финал — ревью стыков и сквозные тесты. Бюджет — настоящий потолок движка Workflow.',
  phases: [
    { title: 'Plan' },
    { title: 'Build' },
    { title: 'Final' },
  ],
}

// parallel-dev как Claude-Code-workflow (движок Workflow, ~/.claude/workflows/).
// Вторая реализация BP-27: тот же замысел, что и slash-команда /parallel-dev, но с
// НАСТОЯЩИМ бюджетом (глобальный `budget`), реальным параллелизмом (parallel/pipeline)
// и структурными ответами субагентов через `schema`. Роли зашиты инлайн + `model:` на
// каждый agent(), поэтому workflow самодостаточен и не зависит от .claude/agents/*.md.
//
// Вызов:  args = "<текст задачи>"  ИЛИ  args = { task: "...", maxGroups?: 4, maxFixRounds?: 3 }
// Бюджет: задаётся директивой сессии "+200k"; тут он читается из глобального `budget`.

// ---- разбор аргументов ----
const task = (typeof args === 'string' ? args : args?.task ?? '').trim()
if (!task) throw new Error('parallel-dev: передай задачу через args — строкой или { task: "..." }')
const MAX_GROUPS = Math.max(1, Math.min(4, (typeof args === 'object' && args?.maxGroups) || 4))
const MAX_FIX_ROUNDS = Math.max(1, (typeof args === 'object' && args?.maxFixRounds) || 3)

// ---- схемы структурных ответов (валидируются на слое tool-call, ретрай при несоответствии) ----
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['groups', 'crossCuttingSpecs'],
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'subtasks', 'files', 'testSpecs'],
        properties: {
          id: { type: 'string' },
          subtasks: { type: 'array', items: { type: 'string' } },
          files: { type: 'array', items: { type: 'string' }, description: 'все файлы/области, которые группа тронет' },
          testSpecs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['subtask', 'input', 'expected'],
              properties: {
                subtask: { type: 'string' },
                input: { type: 'string' },
                expected: { type: 'string' },
              },
            },
          },
          runCmd: { type: 'string', description: 'команда прогона тестов группы, если известна' },
        },
      },
    },
    crossCuttingSpecs: {
      type: 'array',
      description: 'сквозные/интеграционные спеки на стыки групп',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['input', 'expected'],
        properties: { input: { type: 'string' }, expected: { type: 'string' } },
      },
    },
    integrationRunCmd: { type: 'string' },
  },
}
const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'files', 'did'],
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    files: { type: 'array', items: { type: 'string' } },
    did: { type: 'string' },
    notes: { type: 'string' },
    blocked: { type: 'string' },
  },
}
const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'findings', 'scopeOk'],
  properties: {
    verdict: { type: 'string', enum: ['SATISFIED', 'CHANGES_REQUIRED'] },
    findings: { type: 'array', items: { type: 'string' }, description: 'каждый пункт — действие для имплементера' },
    scopeOk: { type: 'boolean', description: 'не вышел ли имплементер за карту файлов группы' },
  },
}
const VALIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['result', 'ran', 'failures'],
  properties: {
    result: { type: 'string', enum: ['pass', 'fail'] },
    ran: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } },
  },
}

// ---- бюджетный сторож ----
// В движке Workflow бюджет — жёсткий: agent() кидает при исчерпании. Заранее не порождаем
// новых субагентов, если запаса явно мало, чтобы доложить, а не упасть на полуслове.
const BUDGET_FLOOR = 40_000
function budgetOk() {
  return !budget.total || budget.remaining() > BUDGET_FLOOR
}

// ---- проверка непересекаемости групп (кодом, не агентом) ----
// Сливаем любые две группы, делящие хоть один файл (union-find), затем, если групп всё ещё
// больше MAX_GROUPS, доливаем самые мелкие в самые крупные. Возвращаем непересекающиеся группы.
function disjointGroups(rawGroups) {
  const groups = (rawGroups || []).filter((g) => g && Array.isArray(g.files))
  const parent = groups.map((_, i) => i)
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  const norm = (f) => String(f).trim().replace(/^\.\//, '')
  const owner = new Map() // файл → индекс первой группы, что его заявила
  groups.forEach((g, i) => {
    for (const f of g.files) {
      const key = norm(f)
      if (owner.has(key)) union(i, owner.get(key))
      else owner.set(key, i)
    }
  })
  // собрать кластеры
  const clusters = new Map()
  groups.forEach((_, i) => {
    const r = find(i)
    if (!clusters.has(r)) clusters.set(r, [])
    clusters.get(r).push(i)
  })
  let merged = [...clusters.values()].map((idxs, n) => mergeGroups(groups, idxs, n))
  // добить до потолка по числу групп
  while (merged.length > MAX_GROUPS) {
    merged.sort((a, b) => a.files.length - b.files.length)
    const small = merged.shift()
    merged[0] = mergeGroups([merged[0], small], [0, 1], 0)
  }
  return merged
}
function mergeGroups(all, idxs, n) {
  const parts = idxs.map((i) => all[i])
  const files = [...new Set(parts.flatMap((g) => (g.files || []).map((f) => String(f).trim())))]
  const subtasks = parts.flatMap((g) => g.subtasks || [])
  const testSpecs = parts.flatMap((g) => g.testSpecs || [])
  const runCmd = parts.map((g) => g.runCmd).find(Boolean) || ''
  const id = parts.map((g) => g.id).filter(Boolean).join('+') || `group-${n + 1}`
  return { id, subtasks, files, testSpecs, runCmd }
}

// ---- промпты ролей ----
function groupCard(g) {
  const specs = g.testSpecs.map((s) => `  • [${s.subtask}] вход: ${s.input} → ожидается: ${s.expected}`).join('\n')
  return [
    `Группа: ${g.id}`,
    `Подзадачи:\n${g.subtasks.map((s) => `  - ${s}`).join('\n')}`,
    `Карта файлов (границы группы — только эти файлы):\n${g.files.map((f) => `  - ${f}`).join('\n')}`,
    `Тест-спеки:\n${specs}`,
  ].join('\n\n')
}
function implPrompt(g) {
  return `Ты — имплементер группы parallel-dev (модель sonnet). Реализуй код СТРОГО в пределах карты файлов группы, удовлетворяя каждой тест-спеке, включая краевые случаи. Не трогай файлы вне карты — это ломает непересекаемость с параллельными группами. Читай только нужное.\n\n${groupCard(g)}\n\nВерни структурный итог: что сделано, список изменённых файлов, заметки ревьюеру, статус.`
}
function fixPrompt(g, review) {
  return `Ты — имплементер группы ${g.id} (sonnet). Ревьюер вернул CHANGES_REQUIRED. Закрой КАЖДЫЙ пункт, не трогая ничего сверх него и не выходя за карту файлов группы.\n\n${groupCard(g)}\n\nЗамечания ревьюера:\n${review.findings.map((f) => `  - ${f}`).join('\n')}\n\nВерни обновлённый структурный итог.`
}
function fixTestsPrompt(g, val) {
  return `Ты — имплементер группы ${g.id} (sonnet). Тесты упали. Почини по падениям, не выходя за карту файлов.\n\n${groupCard(g)}\n\nПадения:\n${val.failures.map((f) => `  - ${f}`).join('\n')}\n\nВерни обновлённый структурный итог.`
}
function reviewPrompt(g, impl) {
  return `Ты — ревьюер группы parallel-dev (модель opus, режим read-only). НЕ правь код сам — верни вердикт. Достань изменения сам: git diff по перечисленным файлам, если это git-репозиторий, иначе прочитай файлы. Проверь: реализованы ли все подзадачи, выполнена ли каждая тест-спека (и краевые), не вышел ли имплементер за карту файлов, корректность/изоляция/слои.\n\n${groupCard(g)}\n\nИмплементер сообщил:\n  файлы: ${impl.files.join(', ') || '—'}\n  сделано: ${impl.did}\n  заметки: ${impl.notes || '—'}\n\nВерни вердикт SATISFIED или CHANGES_REQUIRED со списком конкретных действий и scopeOk.`
}
function validatePrompt(g) {
  const specs = g.testSpecs.map((s) => `  • вход: ${s.input} → ожидается: ${s.expected}`).join('\n')
  return `Ты — тестировщик parallel-dev (модель haiku). Прогони тесты и доложи pass/fail без интерпретаций. Ничего не чини. Команда прогона: ${g.runCmd || '(определи по путям группы)'}.\n\nТест-спеки группы ${g.id}:\n${specs}\n\nВерни result pass|fail, что прогнал, и список падений.`
}

// ---- конвейер одной группы: impl → (review ↔ fix ↔ validate) до SATISFIED+pass ----
async function buildGroup(g) {
  let impl = await agent(implPrompt(g), { agentType: 'impl-sonnet', model: 'sonnet', label: `impl:${g.id}`, phase: 'Build', schema: IMPL_SCHEMA })
  if (!impl || impl.status === 'blocked') return { id: g.id, ok: false, reason: impl?.blocked || 'имплементер заблокирован', impl }
  for (let round = 1; round <= MAX_FIX_ROUNDS; round++) {
    if (!budgetOk()) return { id: g.id, ok: false, reason: 'остановлено по бюджету', impl }
    const review = await agent(reviewPrompt(g, impl), { agentType: 'review-opus', model: 'opus', label: `review:${g.id}#${round}`, phase: 'Build', schema: REVIEW_SCHEMA })
    if (!review) return { id: g.id, ok: false, reason: 'ревьюер не ответил', impl }
    if (review.verdict !== 'SATISFIED') {
      impl = await agent(fixPrompt(g, review), { agentType: 'impl-sonnet', model: 'sonnet', label: `fix:${g.id}#${round}`, phase: 'Build', schema: IMPL_SCHEMA }) || impl
      continue
    }
    const val = await agent(validatePrompt(g), { agentType: 'validate-haiku', model: 'haiku', label: `validate:${g.id}#${round}`, phase: 'Build', schema: VALIDATE_SCHEMA })
    if (val && val.result === 'pass') return { id: g.id, ok: true, review, val, impl }
    impl = await agent(fixTestsPrompt(g, val || { failures: ['тестировщик не ответил'] }), { agentType: 'impl-sonnet', model: 'sonnet', label: `fixtests:${g.id}#${round}`, phase: 'Build', schema: IMPL_SCHEMA }) || impl
  }
  return { id: g.id, ok: false, reason: `не сошлось за ${MAX_FIX_ROUNDS} итераций`, impl }
}

// ---- Plan ----
phase('Plan')
const plan = await agent(
  `Ты — планировщик parallel-dev. Разбей задачу на максимально мелкие атомарные подзадачи и собери их в группы так, чтобы карты файлов групп НЕ ПЕРЕСЕКАЛИСЬ (подзадачи, неизбежно трогающие один файл, — в одну группу). Групп не больше ${MAX_GROUPS}. Для каждой подзадачи дай тест-спеку вход→ожидаемый выход с краевыми случаями. Отдельно перечисли сквозные спеки на стыки групп. Где нужно — опиши реальные пути файлов, а не выдуманные.\n\nЗАДАЧА:\n${task}`,
  { label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA, effort: 'high' },
)
if (!plan || !plan.groups?.length) throw new Error('parallel-dev: планировщик не вернул групп')

const groups = disjointGroups(plan.groups)
log(`Групп после проверки непересекаемости: ${groups.length} (из ${plan.groups.length}); бюджет: ${budget.total ? Math.round(budget.total / 1000) + 'k' : 'не задан'}`)

// ---- Build (группы параллельно, каждая своим конвейером) ----
phase('Build')
const built = await parallel(groups.map((g) => () => buildGroup(g)))
const okGroups = built.filter((b) => b && b.ok)
log(`Готово групп: ${okGroups.length}/${groups.length}`)

// ---- Final: сквозное ревью стыков + интеграционные тесты ----
phase('Final')
let finalReview = null
let finalTests = null
if (okGroups.length === groups.length && budgetOk()) {
  const overview = groups.map((g) => `- ${g.id}: ${g.files.join(', ')}`).join('\n')
  finalReview = await agent(
    `Ты — ревьюер parallel-dev (opus, read-only). Посмотри задачу ЦЕЛИКОМ — стыки между группами (контракты, общие типы, интеграция), а не отдельные куски. Достань изменения сам (git diff/чтение файлов).\n\nЗадача:\n${task}\n\nГруппы и их файлы:\n${overview}\n\nВерни вердикт по стыкам.`,
    { label: 'final-review', phase: 'Final', schema: REVIEW_SCHEMA },
  )
  const xSpecs = (plan.crossCuttingSpecs || []).map((s) => `  • вход: ${s.input} → ожидается: ${s.expected}`).join('\n') || '  (сквозных спек не задано — прогони имеющиеся интеграционные тесты)'
  finalTests = await agent(
    `Ты — тестировщик parallel-dev (haiku). Прогони сквозные/интеграционные тесты по всей задаче. Команда: ${plan.integrationRunCmd || '(определи сам)'}. Ничего не чини.\n\nСквозные тест-спеки:\n${xSpecs}\n\nВерни result pass|fail и падения.`,
    { label: 'final-tests', phase: 'Final', schema: VALIDATE_SCHEMA },
  )
} else {
  log(okGroups.length !== groups.length ? 'Финал пропущен: не все группы готовы.' : 'Финал пропущен: исчерпан бюджет.')
}

return {
  task,
  budget: budget.total ? { total: budget.total, spentEst: budget.spent() } : null,
  groups: built,
  finalReview,
  finalTests,
  done: okGroups.length === groups.length && finalReview?.verdict === 'SATISFIED' && finalTests?.result === 'pass',
}
