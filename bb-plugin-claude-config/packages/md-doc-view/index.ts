// Публичный вход пакета: презентационный компонент MD Opener и его типы. Обёртка
// KasimovEditor — внутренняя деталь, наружу не реэкспортируется (потребитель
// работает через MdDocView и инъекцию эффектов).
export { MdDocView } from "./MdDocView";
export type {
  MdDocViewProps,
  LoadedDoc,
  SaveResult,
} from "./MdDocView";
