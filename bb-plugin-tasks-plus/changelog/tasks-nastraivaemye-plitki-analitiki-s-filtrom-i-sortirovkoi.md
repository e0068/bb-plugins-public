---
version: 0.1.60
date: 2026-10-02
pr: 628
---

- ru: Плитки аналитики оформлены как карточки задач, настраиваются в боковой панели — тип графика, название, оси, разбивка, переключатель сегмент-контролом, фильтр условиями «поле · = ≠ > < · значение» и сортировка по любому полю, легенда, подписи осей и сетка — двигаются, дублируются, удаляются и добавляются пустой плиткой «Add chart»; набор хранится в плагине и одинаков на всех устройствах
  en: Analytics tiles look like task cards and are set up in a side panel — chart type, title, axes, breakdown, a segmented switch, a filter of “field · = ≠ > < · value” conditions and sort by any field, legend, axis labels and grid — and can be moved, duplicated, deleted and added from the «Add chart» tile; the set is kept by the plugin and is the same on every device
- ru: «Большие цифры» стали плитками аналитики — их можно двигать, настраивать и удалять
  en: The big figures are now analytics tiles you can move, set up and delete
- ru: Start и Due принимают время — `YYYY-MM-DDTHH:mm` в CLI и поле времени в задаче, — и Gantt разводит задачи одного дня по часам
  en: Start and Due take a time — `YYYY-MM-DDTHH:mm` in the CLI and a time field in the task — and the Gantt sets tasks of one day apart by the hour
- ru: Период плитки — «как в шапке» или последние N минут, часов или дней; значение условия по меткам, проектам, исполнителям и другим полям выбирается из списка того, что уже есть на досках
  en: A tile's period is the header's or the last N minutes, hours or days; a condition's value for labels, projects, assignees and other fields is picked from what is already on the boards
- ru: Настройка «Show segment contents» делит плитку на график и список его задач с перетаскиваемой границей; щелчок по сегменту сужает список, щелчок мимо возвращает все задачи
  en: «Show segment contents» splits a tile into the chart and a list of its tasks with a draggable divider; a click on a segment narrows the list, a click beside it brings every task back
- ru: Полосы и кольцо заполняют плитку, подписи и легенда занимают ширину текста, а у полос работают флажки подписей и сетка; проекты и период в шапке аналитики стоят в одну строку, лишние проекты уходят в «+N»
  en: Bars and the ring fill their tile, labels and legends take their text's width, and bars follow the label and grid settings; the analytics header keeps projects and period in one row, the projects that do not fit going under «+N»
- ru: Подписи оси Y стоят в своей колонке слева от графика и сдвигают его, как подписи оси X снизу, — больше не ложатся поверх столбцов и линий
  en: Y axis labels stand in their own column left of the chart and move it aside, as the X labels below do — no longer over the columns and lines
