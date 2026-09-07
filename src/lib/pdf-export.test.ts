import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { __createTable, type Table } from "jspdf-autotable";
import { moveListTableOptions } from "./pdf-export";

/** Render a move list through the real production options + autotable (Node, no DOM). */
function render(rows: { name: string; date: string; room: string; rate: number }[]) {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  return __createTable(doc, moveListTableOptions(rows, 60));
}

/** The parsed cell texts of one rendered row (name, date, room, rate). */
function cellTexts(table: Table, section: "head" | "body", rowIndex: number): string[] {
  const row = table[section][rowIndex];
  return table.columns.map((col) => row.cells[String(col.index)].text.join(""));
}

describe("moveListTableOptions — sales report PDF move tables", () => {
  it("renders tenant names and the full row content through the real autotable path", () => {
    const table = render([
      { name: "Juan Dela Cruz", date: "2026-08-27", room: "101", rate: 4500 },
      { name: "Maria Santos", date: "2026-08-30", room: "Room 102", rate: 5500 },
    ]);
    // Regression (sales-report-pdf-names-spec.md §3): object body rows under a
    // string-array head parsed every cell as empty, so the PDF printed
    // Move-ins / Move-outs rows with no tenant data. Rows are now arrays.
    expect(cellTexts(table, "head", 0)).toEqual(["Name", "Date", "Room", "Rate"]);
    expect(table.body).toHaveLength(2);
    expect(cellTexts(table, "body", 0)).toEqual(["Juan Dela Cruz", "Aug 27", "Room 101", "₱4,500/mo"]);
    expect(cellTexts(table, "body", 1)).toEqual(["Maria Santos", "Aug 30", "Room 102", "₱5,500/mo"]);
  });

  it("formats dates as short Mon DD and reuses roomLabel (no 'Room Room 101')", () => {
    // "101" gains one prefix; "Room 101" (already prefixed, free-form stored
    // value) must not be duplicated — same semantics as the report page.
    const table = render([
      { name: "Ben", date: "2026-12-01", room: "Room 101", rate: 2000 },
      { name: "Ana", date: "2026-12-05", room: "Annex B", rate: 3000 },
    ]);
    expect(cellTexts(table, "body", 0)).toEqual(["Ben", "Dec 1", "Room 101", "₱2,000/mo"]);
    expect(cellTexts(table, "body", 1)).toEqual(["Ana", "Dec 5", "Room Annex B", "₱3,000/mo"]);
  });
});
