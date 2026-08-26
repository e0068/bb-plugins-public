# @bb-plugins/resizable-pane

Перетаскиваемая ширина для второй колонки внутри navPanel плагина.

Появился как замена `experimental_fixedTabs`: в bb 0.40.0 navPanel с этой опцией
не монтируется и пункт пропадает из сайдбара (см. задачу BP-53). Содержимое, что
раньше жило фиксированной вкладкой в правой хостовой панели с её разделителем,
переносится второй колонкой внутрь самой панели — а этот пакет возвращает
перетаскиваемую ширину.

## Использование

```tsx
import { ResizeHandle, useResizableWidth } from "../packages/resizable-pane/react";

function Panel({ subPath }: PluginNavPanelProps) {
  const { width, startResize } = useResizableWidth({
    initial: 420,
    min: 320,
    max: 900,
    storageKey: "my-plugin:doc-pane-width",
  });
  const open = /* что-то выбрано */;
  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 flex-1 overflow-y-auto">…основное…</div>
      {open && (
        <>
          <ResizeHandle onPointerDown={startResize} />
          <div style={{ width }} className="h-full min-h-0 shrink-0 overflow-hidden">
            …вторая колонка…
          </div>
        </>
      )}
    </div>
  );
}
```

Ручка на левой стороне правого пана: тянем влево — пан шире. Ширина зажата в
`[min, max]` и (если задан `storageKey`) запоминается в `localStorage`.

Чистая геометрия (`geometry.ts`) отделена от DOM и покрыта тестами
(`geometry.test.ts`).
