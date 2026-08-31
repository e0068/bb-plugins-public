// Плагины, что импортируют React-компоненты из ../packages/* (см.
// packages/md-editor, packages/resizable-pane), тянут "react" из
// node_modules пакета, а не плагина. Vite резолвит голые импорты, поднимаясь
// от файла-импортёра вверх — для файла вне дерева плагина это никогда не
// дотягивается до node_modules самого плагина, и получаются две копии React:
// хуки падают с "Cannot read properties of null (reading 'useState')".
// dedupe заставляет резолвить все три модуля от корня плагина. Нужно только
// в тестах — esbuild на сборке дедупит сам.
export const reactDedupe = ["react", "react-dom", "react/jsx-runtime"];
