import { CARD_BLOCK_FIELDS } from "../../shared/enums.js";
import type { FieldPlanCell } from "../common/field-plan.js";
import type { RowField } from "../common/row-field-preference.js";

/** A field a card draws full width on its own: the title, the description and the sub-task blocks. */
export type CardBlockField = (typeof CARD_BLOCK_FIELDS)[number];

/** One stretch of a card: a row of chips, or a block standing alone. */
export type CardSection =
  | { kind: "chips"; cells: readonly FieldPlanCell[] }
  | { kind: "block"; field: CardBlockField };

const BLOCKS = new Set<RowField>(CARD_BLOCK_FIELDS);

const isBlock = (field: RowField): field is CardBlockField => BLOCKS.has(field);

/**
 * The card body in the Display menu's order: each block where it is listed,
 * chips that follow each other gathered into one row — a block between them
 * splits them in two, the title too. A block has no placeholder, so an empty
 * one draws nothing and splits nothing.
 */
export function cardSections(cells: readonly FieldPlanCell[]): CardSection[] {
  return cells.reduce<CardSection[]>((sections, cell) => {
    if (isBlock(cell.field)) {
      return cell.mode === "value" ? [...sections, { kind: "block", field: cell.field }] : sections;
    }
    const last = sections.at(-1);
    return last?.kind === "chips"
      ? [...sections.slice(0, -1), { kind: "chips", cells: [...last.cells, cell] }]
      : [...sections, { kind: "chips", cells: [cell] }];
  }, []);
}
