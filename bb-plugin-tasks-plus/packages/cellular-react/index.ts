export { Kit, type KitProps } from "./Kit";
export { EditField, type EditFieldProps } from "./EditField";
// Фабрики и типы kit — тем же импортом, что и монтажник: потребителю не нужно
// знать про два пакета. Зависимость направлена вниз: react → kit.
export * from "../cellular-kit";
