---
version: 0.1.87
date: 2026-10-13T16:47Z
pr: 783
---

- ru: В проекте с базой можно заводить разделы — «+» у проекта или раздела в левой колонке, на любую глубину, — сворачивать их шевроном или переключателем уровней, переименовывать и удалять; у раздела свои поля с типом, включая Select и Tags с вариантами, — «+» в конце таблицы, — а Tags каждого раздела — это лейблы записи, таблица с тем же меню колонок, что у задач, и колонкой Description, поля видны во frontmatter Касимова и справа в карточке, а запись открывается Касимовым или карточкой
  en: A project kept in a database can hold sections — the "+" by a project or a section in the left column, as deep as needed — folded by a chevron or a level switch, renamed and deleted; a section has fields of its own with a type, Select and Tags with options among them — the "+" at the end of its table —, the Tags every section has being the record's labels, a table with the same column menu as tasks and a Description column, fields shown as frontmatter in Kasimov and on the right of the card, and a record opens in Kasimov or in the card
- ru: Картинка снова прикрепляется скрепкой и вставляется из буфера обмена в текст задачи — раньше загрузка падала с «plugin "tasks" is not running»
  en: An image attaches by the paperclip and pastes from the clipboard into a task's text again — the upload used to fail with "plugin "tasks" is not running"
- ru: Картинка, перетащенная внутри текста задачи, переезжает на новое место, а не размножается; загрузка картинки во время набора текста больше не даёт ошибку «Another machine kept changing the task», и картинка удалённого вложения не возвращается в текст
  en: An image dragged within a task's text moves to where it is dropped instead of being copied; uploading an image while the text is being typed no longer fails with "Another machine kept changing the task", and a removed attachment's image no longer comes back into the text
- ru: Лейбл, добавленный в Manage → Labels, появляется в списке сразу, ещё до того как его поставили на задачу, и держит выбранный цвет; смена цвета и имени тоже сохраняется
  en: A label added in Manage → Labels is listed at once, before any task carries it, and keeps the colour picked for it; a new colour or name is kept too
- ru: Правка в карточке задачи или записи — статус, лейблы, Select, дата и другие поля — видна сразу, а сохраняется в фоне; не сохранилась — поле возвращается и показывается причина
  en: A change in a task's or record's card — status, labels, Select, a date and the other fields — shows at once and is saved in the background; if it is not saved, the field goes back and the reason is shown
