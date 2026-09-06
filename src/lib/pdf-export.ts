/**
 * Sales-report PDF export (sales-report-spec.md §6).
 *
 * The PDF is a real text/vector document built with jsPDF + jspdf-autotable —
 * the bar chart is drawn as jsPDF vector rectangles and the move-in/move-out
 * lists render in a tabular autotable layout with automatic page breaks. It is
 * generated from the SAME pure data the page shows (computeSalesReport in
 * src/lib/sales-report.ts), so generation never depends on DOM scraping.
 *
 * Destination branching mirrors shareReceiptImage (src/lib/share.ts):
 * - Browser preview: <a download> with a Blob URL.
 * - Tauri desktop: `save_pdf_to_downloads` Rust command → Downloads folder.
 * - Tauri Android: same command → Kotlin PDFSaver plugin (MediaStore.Downloads,
 *   API 29+; runtime WRITE_EXTERNAL_STORAGE request on API 24–28).
 *
 * The existing PNG receipt flow (html-to-image + GallerySaver) stays untouched.
 */

import { isTauri } from "./db";

/** Everything the PDF needs — mirrors what the report page already computed. */
export interface SalesReportPdfData {
  /** Boarding house name (settings `house_name`). */
  houseName: string;
  /** Period label: "August 2026" / "2026". */
  periodLabel: string;
  /** True when the period contains today — prints the "as of today" note. */
  containsToday: boolean;
  /** Net sales for the period (already rounded). */
  total: number;
  /** Bars: week (month mode) or month (year mode), chronological. */
  buckets: { label: string; amount: number }[];
  moveIns: { name: string; date: string; room: string; rate: number }[];
  moveOuts: { name: string; date: string; room: string; rate: number }[];
  occupancy: { occupied: number; total: number; pct: number };
  /** False when total_capacity is 0/unset — prints the hint line. */
  hasCapacity: boolean;
}

const PAGE_W = 595.28; // A4 portrait, pt
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const ACCENT: [number, number, number] = [0, 122, 255];
const NEG_ACCENT: [number, number, number] = [255, 59, 48]; // negative buckets (red)
const GRAY: [number, number, number] = [108, 108, 112];

function peso(n: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Short "Mon DD" date (matches the page's formatShortDay). */
function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Mon DD" + a stable sort key (date ISO) for the PDF table rows. */
function rowFor(e: { name: string; date: string; room: string; rate: number }) {
  return { name: e.name, date: shortDay(e.date), sortKey: e.date, room: `Room ${e.room}`, rate: `${peso(e.rate)}/mo` };
}

/**
 * Build the PDF as a data URL from the same data the page displays. Vector
 * chart + autotable lists, so it stays crisp and paginates cleanly.
 */
export async function generateSalesReportPdf(data: SalesReportPdfData): Promise<string> {
  const [{ jsPDF }, { __createTable, __drawTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  // jspdf-autotable v5: autoTable() returns void, so the final Y (needed to
  // place the next section) comes from __createTable/__drawTable.
  const drawTable = (
    doc: Parameters<typeof __createTable>[0],
    options: Parameters<typeof __createTable>[1]
  ): number => {
    const table = __createTable(doc, options);
    __drawTable(doc, table);
    // autotable v5 types startY as `number | false`; the caller always passes
    // a number, so normalise false to 0.
    return table.finalY ?? (typeof options.startY === "number" ? options.startY : 0);
  };
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const generatedAt = new Date().toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  /* ---- header ---- */
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(data.houseName || "RentEase", MARGIN, 56);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text(`Generated ${generatedAt}`, PAGE_W - MARGIN, 56, { align: "right" });

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("SALES REPORT", MARGIN, 84);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  const periodText = data.containsToday ? `${data.periodLabel} — as of today` : data.periodLabel;
  doc.setTextColor(...GRAY);
  doc.text(periodText, MARGIN, 102);

  /* ---- bar chart (vector rectangles, one per bucket) ---- */
  const chartTop = 126;
  const chartBottom = 236;
  const n = Math.max(1, data.buckets.length);
  const slot = CONTENT_W / n;
  const barW = Math.min(34, slot * 0.55);
  const maxAmt = Math.max(1, ...data.buckets.map((b) => Math.abs(b.amount)));

  // Axis-less bars: a baseline + bars rising from it (negative values dip
  // below the baseline in red).
  const baselineY = chartBottom - 40;
  doc.setDrawColor(200, 200, 205);
  doc.setLineWidth(1);
  doc.line(MARGIN, baselineY, MARGIN + CONTENT_W, baselineY);

  data.buckets.forEach((b, i) => {
    const cx = MARGIN + slot * i + slot / 2;
    const h = (Math.abs(b.amount) / maxAmt) * (chartTop + 12 <= baselineY ? baselineY - (chartTop + 8) : 40);
    const barHeight = Math.max(2, h);
    const y = b.amount >= 0 ? baselineY - barHeight : baselineY;
    doc.setFillColor(...(b.amount >= 0 ? ACCENT : NEG_ACCENT));
    doc.rect(cx - barW / 2, y, barW, Math.max(2, barHeight), "F");
    // Label (bucket label) under the baseline; ₱ value above the bar when it
    // fits the page (small font, skip below ₱0 to avoid label collisions).
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(b.label, cx, baselineY + 12, { align: "center" });
    if (b.amount !== 0 && barHeight >= 24) {
      doc.setFontSize(7);
      doc.setTextColor(0, 0, 0);
      doc.text(peso(b.amount), cx, b.amount >= 0 ? y - 5 : y + barHeight + 12, { align: "center" });
    }
  });

  /* ---- net sales ---- */
  let y = chartBottom + 24;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("Net Sales", MARGIN, y);
  doc.text(peso(data.total), PAGE_W - MARGIN, y, { align: "right" });
  y += 18;

  /* ---- move-ins / move-outs tables ---- */
  const tableRows = (rows: typeof data.moveIns) => rows.map(rowFor).map(({ sortKey, ...r }) => r);
  const head = [["Name", "Date", "Room", "Rate"]];

  const drawList = (title: string, rows: typeof data.moveIns, startY: number) => {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text(title, MARGIN, startY);
    let cursor = startY + 10;
    if (rows.length === 0) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRAY);
      const none = title.startsWith("Move-ins") ? "No move-ins this period." : "No move-outs this period.";
      doc.text(none, MARGIN, cursor + 10);
      return cursor + 24;
    }
    const finalY = drawTable(doc, {
      startY: cursor,
      margin: { left: MARGIN, right: MARGIN },
      head,
      body: tableRows(rows),
      theme: "striped",
      headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: "bold", fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: {
        0: { cellWidth: "auto" },
        1: { cellWidth: 60 },
        2: { cellWidth: 80 },
        3: { cellWidth: 80 },
      },
    });
    return finalY + 18;
  };

  y = drawList("Move-ins", data.moveIns, y);
  y = drawList("Move-outs", data.moveOuts, y);

  /* ---- occupancy ---- */
  if (y + 40 > PAGE_H - MARGIN) {
    doc.addPage();
    y = MARGIN + 20;
  }
  const occY = y;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("Occupancy", MARGIN, occY);
  doc.setFont("helvetica", "normal");
  const occLine = data.hasCapacity
    ? `${data.occupancy.occupied}/${data.occupancy.total} (${data.occupancy.pct}%)`
    : "Set total capacity in Settings to see occupancy";
  doc.text(occLine, PAGE_W - MARGIN, occY, { align: "right" });

  return doc.output("datauristring");
}

export type PdfExportResult = "downloaded" | "saved";

/** Persist a sales-report PDF; throws with a friendly message on failure. */
export async function exportSalesReportPdf(dataUrl: string, filename: string): Promise<PdfExportResult> {
  if (!isTauri()) {
    // Browser preview: Blob URL + <a download> (mirrors share.ts's downloadInBrowser).
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return "downloaded";
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const result = await invoke<string>("save_pdf_to_downloads", {
      base64,
      fileName: filename,
    });
    // Android → "saved-to-downloads"; desktop → "downloaded".
    return result === "downloaded" ? "downloaded" : "saved";
  } catch (e) {
    throw new Error(`Could not export the sales report PDF: ${String(e)}`);
  }
}
