export const meta = {
  name: "parallel-dev",
  description: "Упрощённый parallel-dev (редактируется в конструкторе): Plan → impl(sonnet)→review(opus)→validate(haiku) → финальное ревью+тесты. Без динамических групп, непересекаемости и цикла правок — линейный каркас.",
  phases: [
    { title: "Plan" },
    { title: "Build" },
    { title: "Final" },
  ],
}

  phase("Plan")
  await agent(`Ты — планировщик parallel-dev. Разбей задачу на атомарные подзадачи и опиши на каждую тест-спеку вход→ожидаемый выход с краевыми случаями. Верни план текстом для следующих стадий.`, { label: "plan", model: "opus", effort: "high" })

  phase("Build")
  await pipeline([{}],
    (prev) => agent(`Ты — имплементер (sonnet). Реализуй код по плану ниже, держась тест-спек и краевых случаев. Верни список изменённых файлов и краткий итог.

План:
${prev}`, { label: "impl", agentType: "impl-sonnet", model: "sonnet" }),
    (prev) => agent(`Ты — ревьюер (opus, read-only). Проверь результат имплементера против плана и тест-спек. Диф достань сам (git diff / чтение файлов). Верни вердикт SATISFIED или список конкретных правок.

Результат имплементера:
${prev}`, { label: "review", agentType: "review-opus", model: "opus" }),
    (prev) => agent(`Ты — тестировщик (haiku). Прогони тесты по тест-спекам и верни pass/fail без интерпретаций.

Итог ревью:
${prev}`, { label: "validate", agentType: "validate-haiku", model: "haiku" }),
  )

  phase("Final")
  await parallel([
    () => agent(`Ты — ревьюер (opus). Посмотри задачу целиком: стыки, контракты, интеграция. Верни вердикт.`, { label: "final-review", agentType: "review-opus", model: "opus" }),
    () => agent(`Ты — тестировщик (haiku). Прогони сквозные/интеграционные тесты по всей задаче. Верни pass/fail.`, { label: "final-tests", agentType: "validate-haiku", model: "haiku" }),
  ])

/* @composer-workflow
{
  "name": "parallel-dev",
  "description": "Упрощённый parallel-dev (редактируется в конструкторе): Plan → impl(sonnet)→review(opus)→validate(haiku) → финальное ревью+тесты. Без динамических групп, непересекаемости и цикла правок — линейный каркас.",
  "phases": [
    {
      "title": "Plan",
      "mode": "single",
      "repeatBudget": null,
      "steps": [
        {
          "type": "agent",
          "label": "plan",
          "prompt": "Ты — планировщик parallel-dev. Разбей задачу на атомарные подзадачи и опиши на каждую тест-спеку вход→ожидаемый выход с краевыми случаями. Верни план текстом для следующих стадий.",
          "model": "opus",
          "provider": "",
          "effort": "high",
          "agentType": "",
          "schema": ""
        }
      ]
    },
    {
      "title": "Build",
      "mode": "pipeline",
      "repeatBudget": null,
      "steps": [
        {
          "type": "agent",
          "label": "impl",
          "prompt": "Ты — имплементер (sonnet). Реализуй код по плану ниже, держась тест-спек и краевых случаев. Верни список изменённых файлов и краткий итог.\n\nПлан:\n{{prev}}",
          "model": "sonnet",
          "provider": "",
          "effort": "",
          "agentType": "impl-sonnet",
          "schema": ""
        },
        {
          "type": "agent",
          "label": "review",
          "prompt": "Ты — ревьюер (opus, read-only). Проверь результат имплементера против плана и тест-спек. Диф достань сам (git diff / чтение файлов). Верни вердикт SATISFIED или список конкретных правок.\n\nРезультат имплементера:\n{{prev}}",
          "model": "opus",
          "provider": "",
          "effort": "",
          "agentType": "review-opus",
          "schema": ""
        },
        {
          "type": "agent",
          "label": "validate",
          "prompt": "Ты — тестировщик (haiku). Прогони тесты по тест-спекам и верни pass/fail без интерпретаций.\n\nИтог ревью:\n{{prev}}",
          "model": "haiku",
          "provider": "",
          "effort": "",
          "agentType": "validate-haiku",
          "schema": ""
        }
      ]
    },
    {
      "title": "Final",
      "mode": "parallel",
      "repeatBudget": null,
      "steps": [
        {
          "type": "agent",
          "label": "final-review",
          "prompt": "Ты — ревьюер (opus). Посмотри задачу целиком: стыки, контракты, интеграция. Верни вердикт.",
          "model": "opus",
          "provider": "",
          "effort": "",
          "agentType": "review-opus",
          "schema": ""
        },
        {
          "type": "agent",
          "label": "final-tests",
          "prompt": "Ты — тестировщик (haiku). Прогони сквозные/интеграционные тесты по всей задаче. Верни pass/fail.",
          "model": "haiku",
          "provider": "",
          "effort": "",
          "agentType": "validate-haiku",
          "schema": ""
        }
      ]
    }
  ]
}
*/
