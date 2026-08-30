// Side-effect импорт CSS редактора (`import "../kasimov/kasimov.css"`).
// Сборщик кладёт css в бандл; для typecheck объявляем css-модуль без экспортов.
// Типы самого движка kasimov живут рядом со сборкой:
// packages/kasimov/kasimov.d.ts (подхватываются по относительному импорту).
declare module "*.css";
