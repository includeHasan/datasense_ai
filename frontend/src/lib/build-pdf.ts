"use client";

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type ReactECharts from "echarts-for-react";

import { ChartRenderer } from "@/components/chart-renderer";
import type { ChartSpec, GenerateReportResponse } from "@/lib/types";

/**
 * Client-side PDF assembly for generated reports. The backend only ever
 * produces the report's JSON structure (title, narrative, chartSpec, sample
 * rows per section) - see src/reports/builder.ts and POST /reports. The
 * browser already knows how to render every ChartSpec kind via
 * ChartRenderer/echarts-for-react, so PDF rendering (including chart
 * rasterization) happens here instead of duplicating that logic server-side
 * with Puppeteer + a second ECharts option mapper.
 */

// Mirrors the app's "Ledger & Greenbar" identity used elsewhere (chart
// palette in chart-renderer.tsx, report styling that used to live in the
// now-removed src/reports/render.ts).
const PINE = "#2F6B4F";
const INK = "#1B2420";
const MUTED = "#5C6B5F";
const RULE = "#D8E0D3";
const HEADER_FILL: [number, number, number] = [238, 243, 234];

const PAGE_MARGIN = 15;
const PAGE_WIDTH = 210; // A4, mm
const PAGE_HEIGHT = 297;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

const CHART_RASTER_WIDTH = 640;
const CHART_RASTER_HEIGHT = 360;
const CHART_RASTER_TIMEOUT_MS = 2000;
const MAX_TABLE_ROWS = 20;

/**
 * Rasterizes a single ChartSpec to a PNG data URL by mounting an off-screen
 * (far off-viewport) instance of the existing ChartRenderer via
 * `createRoot`, waiting for its underlying `echarts-for-react` instance to
 * mount, then calling `getEchartsInstance().getDataURL()`. This reuses the
 * app's real chart rendering (palette, series shaping, per-kind option
 * building) instead of re-implementing it for PDF export. Returns null for
 * chart kinds with no chart representation (table/kpi) or if rasterization
 * fails/times out.
 */
async function rasterizeChart(spec: ChartSpec): Promise<string | null> {
  if (spec.kind === "table" || spec.kind === "kpi") return null;

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "-10000px";
  container.style.width = `${CHART_RASTER_WIDTH}px`;
  container.style.height = `${CHART_RASTER_HEIGHT}px`;
  container.style.pointerEvents = "none";
  document.body.appendChild(container);

  const root = createRoot(container);

  try {
    return await new Promise<string | null>((resolve) => {
      let settled = false;

      const finish = (result: string | null) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      function handleRef(instance: ReactECharts | null) {
        if (!instance || settled) return;
        // Give ECharts a tick to finish its own internal initialization
        // after the ref callback fires before reading getDataURL().
        setTimeout(() => {
          try {
            const echartsInstance = instance.getEchartsInstance();
            finish(
              echartsInstance.getDataURL({
                type: "png",
                pixelRatio: 2,
                backgroundColor: "#fff",
              }),
            );
          } catch {
            finish(null);
          }
        }, 50);
      }

      root.render(createElement(ChartRenderer, { spec, ref: handleRef }));

      // Safety timeout in case the ref never fires.
      setTimeout(() => finish(null), CHART_RASTER_TIMEOUT_MS);
    });
  } finally {
    root.unmount();
    container.remove();
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "report";
}

/**
 * Assembles a multi-page PDF from a generated report and triggers a browser
 * download. Per section: title, wrapped narrative, the rasterized chart
 * image (if any), and a data table of sample rows (unless the section's
 * chart already is a table).
 */
export async function buildReportPdf(report: GenerateReportResponse): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(INK);
  doc.text(report.title, PAGE_MARGIN, 25);

  doc.setDrawColor(PINE);
  doc.setLineWidth(0.6);
  doc.line(PAGE_MARGIN, 30, PAGE_WIDTH - PAGE_MARGIN, 30);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text(`Generated ${new Date().toLocaleString()}`, PAGE_MARGIN, 36);

  let cursorY = 46;

  function ensureSpace(neededHeight: number): void {
    if (cursorY + neededHeight > PAGE_HEIGHT - PAGE_MARGIN) {
      doc.addPage();
      cursorY = PAGE_MARGIN;
    }
  }

  for (const [index, section] of report.sections.entries()) {
    ensureSpace(16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(PINE);
    doc.text(`${String(index + 1).padStart(2, "0")}  ${section.title}`, PAGE_MARGIN, cursorY);
    cursorY += 4;

    doc.setDrawColor(RULE);
    doc.setLineWidth(0.2);
    doc.line(PAGE_MARGIN, cursorY, PAGE_WIDTH - PAGE_MARGIN, cursorY);
    cursorY += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(INK);
    const narrativeLines = doc.splitTextToSize(section.narrative, CONTENT_WIDTH) as string[];
    for (const line of narrativeLines) {
      ensureSpace(6);
      doc.text(line, PAGE_MARGIN, cursorY);
      cursorY += 5;
    }
    cursorY += 3;

    if (section.chartSpec) {
      const dataUrl = await rasterizeChart(section.chartSpec);
      if (dataUrl) {
        const imgWidth = CONTENT_WIDTH;
        const imgHeight = (imgWidth * CHART_RASTER_HEIGHT) / CHART_RASTER_WIDTH;
        ensureSpace(imgHeight + 6);
        doc.addImage(dataUrl, "PNG", PAGE_MARGIN, cursorY, imgWidth, imgHeight);
        cursorY += imgHeight + 6;
      }
    }

    const isAlreadyTable = section.chartSpec?.kind === "table";
    if (!isAlreadyTable && section.sampleRows.length > 0) {
      const rows = section.sampleRows.slice(0, MAX_TABLE_ROWS);
      const columns = Object.keys(rows[0] ?? {});
      ensureSpace(20);
      autoTable(doc, {
        startY: cursorY,
        head: [columns],
        body: rows.map((row) => columns.map((column) => formatCell(row[column]))),
        margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
        styles: { fontSize: 8, textColor: INK, lineColor: RULE },
        headStyles: { fillColor: HEADER_FILL, textColor: INK },
        theme: "grid",
      });
      const lastAutoTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
      cursorY = (lastAutoTable?.finalY ?? cursorY) + 8;
    } else {
      cursorY += 4;
    }
  }

  doc.save(`${slugify(report.title)}.pdf`);
}
