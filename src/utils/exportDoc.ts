import JSZip from "jszip";
import { jsPDF } from "jspdf";
import { SCHOOL_LOGO } from "../data/logo";
import { TeacherRecord } from "../data/teachers";
import {
  SubstituteRow,
  formatClassLevelLabel,
  formatCleanSubstituteName,
  formatShortThaiDate,
  formatThaiMonthYearHeader,
  getSubjectNameFromCourse,
} from "./scheduler";

export const LEFT_SCHOOL_LOGO_URL =
  "/assets/aistudio/___________________________1__5adb99dd.png";
export const RIGHT_OBEC_LOGO_URL = "/assets/aistudio/______2_edcf2277.jpg";

const THAI_FONT_SAMPLE =
  "แบบบันทึกการจัดสอนแทนประจำเดือนพฤษภาคมพฤศจิกายนโรงเรียนวรคุณอุปถัมภ์0123456789";
const THAI_SAMPLE_SHORT = "แบบบันทึกการจัดสอนแทน พ.ศ. 2569";

function escapeXml(str: string): string {
  return String(str).replace(/[&<>'"]/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}

function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

async function triggerBrowserDownload(
  filename: string,
  blob: Blob,
  mimeType: string
): Promise<void> {
  const win = window as unknown as {
    claude?: {
      use?: (
        cap: string
      ) => Promise<{ save: (opts: { filename: string; data: Blob }) => Promise<void> }>;
    };
  };
  if (win.claude?.use) {
    try {
      const dl = await win.claude.use("downloads");
      if (dl) {
        await dl.save({ filename, data: blob });
        return;
      }
    } catch {
      // Fall back to standard browser download
    }
  }

  // บน iOS (โดยเฉพาะเปิดผ่านแอป Messenger / LINE / Safari) รองรับ Web Share API สำหรับบันทึกหรือแชร์ไฟล์โดยตรง
  if (isIOSDevice() && typeof navigator !== "undefined" && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: mimeType });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: filename,
        });
        return;
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

async function loadImageToPngBase64(src: string, fallbackDataUrl?: string): Promise<string> {
  try {
    const img = await loadImage(src);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || 300;
    c.height = img.naturalHeight || 300;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      const dataUrl = c.toDataURL("image/png");
      return dataUrl.split(",")[1] || "";
    }
  } catch {
    // Fallback below
  }
  if (fallbackDataUrl && fallbackDataUrl.includes(",")) {
    return fallbackDataUrl.split(",")[1];
  }
  return "";
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  allowCharSplit = false
): string[] {
  const str = String(text || "").trim();
  if (!str || ctx.measureText(str).width <= maxWidth) {
    return [str];
  }
  const words = str.split(/\s+/);
  if (words.length > 1) {
    const lines: string[] = [];
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const testLine = current + " " + words[i];
      if (ctx.measureText(testLine).width <= maxWidth) {
        current = testLine;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
    return lines;
  }
  if (!allowCharSplit) {
    return [str];
  }
  const lines: string[] = [];
  let current = "";
  for (const ch of str) {
    if (ctx.measureText(current + ch).width <= maxWidth) {
      current += ch;
    } else {
      if (current) lines.push(current);
      current = ch;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [str];
}

/**
 * บังคับโหลดชุดตัวอักษรภาษาไทย (Thai Unicode Subset) ของฟอนต์ Sarabun บน iOS Safari / WebKit
 */
export async function ensureSarabunFontLoaded(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load("400 15px 'Sarabun'", THAI_FONT_SAMPLE),
      document.fonts.load("600 15px 'Sarabun'", THAI_FONT_SAMPLE),
      document.fonts.load("700 15px 'Sarabun'", THAI_FONT_SAMPLE),
      document.fonts.load("700 19px 'Sarabun'", THAI_SAMPLE_SHORT),
      document.fonts.load("700 20px 'Sarabun'", THAI_SAMPLE_SHORT),
    ]);
    await document.fonts.ready;

    for (let attempt = 0; attempt < 12; attempt++) {
      if (document.fonts.check("400 15px 'Sarabun'", "แบบบันทึกการจัดสอนแทน")) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch {
    // Proceed if font loading API is restricted
  }
}

function drawFittedCellLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  baseFontSize: number,
  fontWeight: "400" | "700",
  fontStack: string
): void {
  let fontSize = baseFontSize;
  ctx.font = `${fontWeight} ${fontSize}px ${fontStack}`;
  while (fontSize > 9.5 && ctx.measureText(text).width > maxWidth) {
    fontSize -= 0.5;
    ctx.font = `${fontWeight} ${fontSize}px ${fontStack}`;
  }
  ctx.fillText(text, x, y);
}

function resolveRowAbsentTeacherName(row: SubstituteRow, absentTeacher: TeacherRecord): string {
  const fromRow = String(row.absentTeacherName || "").trim();
  if (fromRow) {
    return fromRow.replace(/^\d{3}\s+/, "").trim();
  }
  const fromHeader = String(absentTeacher.n || "").trim();
  const firstSegment = fromHeader.split(",")[0] || fromHeader;
  return firstSegment.replace(/^\d{3}\s+/, "").trim();
}

/**
 * วาดแบบบันทึกการจัดสอนแทนลงบน HTML5 Canvas 2D ความละเอียดสูง (รูปแบบตามภาพที่ 1 เป๊ะ 100%)
 * - แนวนอน (A4 Landscape: 1123 x 794 px ที่ 1x หรือ 2246 x 1588 px ที่ 2x)
 * - โลโก้ซ้าย: ตราโรงเรียนวรคุณอุปถัมภ์ (/assets/aistudio/___________________________1__5adb99dd.png)
 * - หัวกระดาษตรงกลาง:
 *     แบบบันทึกการจัดสอนแทน
 *     ประจำเดือน <เดือนไทย> พ.ศ. <ปี พ.ศ.>
 * - โลโก้ขวา: ตราองค์กร/สพฐ. หมายเลข 1 (/assets/aistudio/______2_edcf2277.jpg)
 * - ตาราง 10 คอลัมน์: ที่ | ชื่อ-สกุล ผู้สอนแทน | สอนแทน | คาบที่ | ห้อง | วิชา | รหัสวิชา | วันที่ | ลงชื่อ | หมายเหตุ
 * - กล่องลงนาม 2 กล่องตีกรอบสี่เหลี่ยมด้านล่าง:
 *     กล่องซ้าย: (นายรณสิทธิ์ ประดับศรี) งานการจัดการเรียนการสอน
 *     กล่องขวา: (นายสุทธิศักดิ์ เกตษา) ผู้ช่วยผู้อำนวยการโรงเรียนวรคุณอุปถัมภ์
 */
export async function renderPaperToCanvas(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[]
): Promise<HTMLCanvasElement> {
  await ensureSarabunFontLoaded();

  const scale = 2;
  const pageWidth = 1123; // A4 Landscape width
  const marginX = 48;
  const contentWidth = pageWidth - marginX * 2; // 1027px
  const fontStack = "'Sarabun', sans-serif";

  // ความกว้างทั้ง 10 คอลัมน์ รวม = 1027px
  // [ที่ 38, ชื่อ-สกุล ผู้สอนแทน 214, สอนแทน 195, คาบที่ 60, ห้อง 68, วิชา 100, รหัสวิชา 78, วันที่ 88, ลงชื่อ 92, หมายเหตุ 94]
  const colWidths = [38, 214, 195, 60, 68, 100, 78, 88, 92, 94];
  const headers = [
    "ที่",
    "ชื่อ-สกุล ผู้สอนแทน",
    "สอนแทน",
    "คาบที่",
    "ห้อง",
    "วิชา",
    "รหัสวิชา",
    "วันที่",
    "ลงชื่อ",
    "หมายเหตุ",
  ];

  const isCompactMode = rows.length > 9;
  const cellFontSize = isCompactMode ? 14 : 15;
  const lineHeight = isCompactMode ? 19 : 21;
  const minRowHeight = isCompactMode ? 35 : 40;
  const headerHeight = 40;

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");

  let estimatedTableRowsHeight = 0;
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const subDisplay = row.subName || formatCleanSubstituteName(row.n);
    const absentDisplay = resolveRowAbsentTeacherName(row, absentTeacher);
    let maxLines = 1;
    if (measureCtx) {
      measureCtx.font = `400 ${cellFontSize}px ${fontStack}`;
      const subLines = wrapCanvasText(measureCtx, subDisplay, colWidths[1] - 18, false);
      const absLines = wrapCanvasText(measureCtx, absentDisplay, colWidths[2] - 18, false);
      maxLines = Math.max(subLines.length, absLines.length, 1);
    }
    estimatedTableRowsHeight += Math.max(
      minRowHeight,
      maxLines * lineHeight + (isCompactMode ? 12 : 16)
    );
  }

  const headerTopY = 36;
  const tableStartY = headerTopY + 114;
  const gapBeforeSigBoxes = isCompactMode ? 48 : 66;
  const sigBoxHeight = 110;
  const bottomMargin = 48;

  const estimatedTotalHeight =
    tableStartY +
    headerHeight +
    estimatedTableRowsHeight +
    gapBeforeSigBoxes +
    sigBoxHeight +
    bottomMargin;

  const pageHeight = Math.max(794, estimatedTotalHeight);

  const canvas = document.createElement("canvas");
  canvas.width = pageWidth * scale;
  canvas.height = pageHeight * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("ไม่สามารถสร้าง Canvas 2D สำหรับวาดเอกสารได้");
  }

  ctx.scale(scale, scale);

  // พื้นหลังสีขาว
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pageWidth, pageHeight);
  ctx.textBaseline = "alphabetic";

  // 1. วาดโลโก้ด้านซ้าย (ตราโรงเรียนวรคุณอุปถัมภ์) และโลโก้ด้านขวา (หมายเลข 1 สพฐ.)
  try {
    const leftLogoImg = await loadImage(LEFT_SCHOOL_LOGO_URL).catch(() =>
      loadImage(SCHOOL_LOGO)
    );
    const leftLogoH = 98;
    const leftLogoW = (leftLogoImg.naturalWidth / leftLogoImg.naturalHeight) * leftLogoH;
    const leftCenterX = marginX + 258;
    ctx.drawImage(
      leftLogoImg,
      leftCenterX - leftLogoW / 2,
      headerTopY - 4,
      leftLogoW,
      leftLogoH
    );
  } catch {
    // Skip if logo fails
  }

  try {
    const rightLogoImg = await loadImage(RIGHT_OBEC_LOGO_URL);
    const rightLogoH = 90;
    const rightLogoW = (rightLogoImg.naturalWidth / rightLogoImg.naturalHeight) * rightLogoH;
    const rightCenterX = pageWidth - marginX - 252;
    ctx.drawImage(
      rightLogoImg,
      rightCenterX - rightLogoW / 2,
      headerTopY,
      rightLogoW,
      rightLogoH
    );
  } catch {
    // Skip if right logo fails
  }

  // 2. วาดหัวกระดาษตรงกลาง 2 บรรทัด
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";

  drawFittedCellLine(
    ctx,
    "แบบบันทึกการจัดสอนแทน",
    pageWidth / 2,
    headerTopY + 38,
    420,
    20,
    "700",
    fontStack
  );

  const monthYearTitle = formatThaiMonthYearHeader(dateStr);
  drawFittedCellLine(
    ctx,
    monthYearTitle,
    pageWidth / 2,
    headerTopY + 86,
    460,
    19,
    "700",
    fontStack
  );

  // 3. วาดตาราง 10 คอลัมน์ (เส้นขอบสีดำคมชัด พื้นหลังสีขาวตามภาพที่ 1)
  let cursorY = tableStartY;
  ctx.lineWidth = 1.15;
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#000000";

  let colX = marginX;
  for (let i = 0; i < headers.length; i++) {
    const w = colWidths[i];
    ctx.strokeRect(colX, cursorY, w, headerHeight);
    ctx.textAlign = "center";
    drawFittedCellLine(
      ctx,
      headers[i],
      colX + w / 2,
      cursorY + headerHeight / 2 + 5.5,
      w - 8,
      15.5,
      "700",
      fontStack
    );
    colX += w;
  }
  cursorY += headerHeight;

  const shortDateStr = formatShortThaiDate(dateStr);
  const noteStr = (reason || "ไปราชการ").trim() || "ไปราชการ";

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const subDisplay = row.subName || formatCleanSubstituteName(row.n);
    const absentDisplay = resolveRowAbsentTeacherName(row, absentTeacher);
    const roomClassDisplay = row.classRoomLabel || formatClassLevelLabel(row.cls);
    const subjectDisplay =
      row.subjectName || getSubjectNameFromCourse(row.code, absentTeacher.g);
    const rowShortDate = row.shortDate || shortDateStr;

    const cellValues = [
      String(rowIdx + 1),
      subDisplay,
      absentDisplay,
      String(row.p),
      roomClassDisplay,
      subjectDisplay,
      row.code,
      rowShortDate,
      "",
      noteStr,
    ];

    ctx.font = `400 ${cellFontSize}px ${fontStack}`;

    const wrappedCells = cellValues.map((val, idx) =>
      idx === 1 || idx === 2
        ? wrapCanvasText(ctx, val, colWidths[idx] - 18, false)
        : [val]
    );
    const maxLines = Math.max(...wrappedCells.map((lines) => lines.length), 1);
    const rowHeight = Math.max(
      minRowHeight,
      maxLines * lineHeight + (isCompactMode ? 12 : 16)
    );

    let x = marginX;
    for (let i = 0; i < cellValues.length; i++) {
      const w = colWidths[i];
      ctx.strokeRect(x, cursorY, w, rowHeight);

      const lines = wrappedCells[i];
      const blockHeight = (lines.length - 1) * lineHeight;
      const firstLineBaselineY = cursorY + rowHeight / 2 - blockHeight / 2 + 5.2;

      // คอลัมน์ที่ 2 (ชื่อ-สกุล ผู้สอนแทน) และคอลัมน์ที่ 3 (สอนแทน) จัดชิดซ้ายตามภาพตัวอย่าง
      if (i === 1 || i === 2) {
        ctx.textAlign = "left";
        lines.forEach((line, lIdx) => {
          drawFittedCellLine(
            ctx,
            line,
            x + 10,
            firstLineBaselineY + lIdx * lineHeight,
            w - 18,
            cellFontSize,
            "400",
            fontStack
          );
        });
      } else {
        ctx.textAlign = "center";
        lines.forEach((line, lIdx) => {
          drawFittedCellLine(
            ctx,
            line,
            x + w / 2,
            firstLineBaselineY + lIdx * lineHeight,
            w - 10,
            cellFontSize,
            "400",
            fontStack
          );
        });
      }

      x += w;
    }

    cursorY += rowHeight;
  }

  // 4. วาดกล่องลงนาม 2 กล่องตีกรอบสี่เหลี่ยมด้านล่าง (ตามภาพที่ 1 เป๊ะ)
  cursorY += gapBeforeSigBoxes;
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";

  // กล่องซ้าย: ผู้จัดสอนแทน (นายรณสิทธิ์ ประดับศรี)
  const leftBoxX = marginX + 58;
  const leftBoxW = 308;
  ctx.strokeRect(leftBoxX, cursorY, leftBoxW, sigBoxHeight);

  const leftCenterX = leftBoxX + leftBoxW / 2;
  drawFittedCellLine(
    ctx,
    "ลงชื่อ.................................ผู้จัดสอนแทน",
    leftCenterX,
    cursorY + 30,
    leftBoxW - 20,
    15,
    "400",
    fontStack
  );
  drawFittedCellLine(
    ctx,
    "(นายธีระพงษ์ หาวัน)",
    leftCenterX,
    cursorY + 62,
    leftBoxW - 20,
    15,
    "400",
    fontStack
  );
  drawFittedCellLine(
    ctx,
    "งานการจัดการเรียนการสอน",
    leftCenterX,
    cursorY + 93,
    leftBoxW - 20,
    15,
    "400",
    fontStack
  );

  // กล่องขวา: หัวหน้ากลุ่มบริหารวิชาการ (นายสุทธิศักดิ์ เกตษา)
  const rightBoxX = marginX + 536;
  const rightBoxW = 392;
  ctx.strokeRect(rightBoxX, cursorY, rightBoxW, sigBoxHeight);

  const rightCenterX = rightBoxX + rightBoxW / 2;
  drawFittedCellLine(
    ctx,
    "ลงชื่อ.................................หัวหน้ากลุ่มบริหารวิชาการ",
    rightCenterX,
    cursorY + 30,
    rightBoxW - 20,
    15,
    "400",
    fontStack
  );
  drawFittedCellLine(
    ctx,
    "(นายสุทธิศักดิ์ เกตษา)",
    rightCenterX,
    cursorY + 62,
    rightBoxW - 20,
    15,
    "400",
    fontStack
  );
  drawFittedCellLine(
    ctx,
    "ผู้ช่วยผู้อำนวยการโรงเรียนวรคุณอุปถัมภ์",
    rightCenterX,
    cursorY + 93,
    rightBoxW - 20,
    15,
    "400",
    fontStack
  );

  return canvas;
}

export interface SubstituteSheetData {
  absentTeacher: TeacherRecord;
  dateStr: string;
  reason: string;
  rows: SubstituteRow[];
}

function buildDocxSheetBodyXml(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[],
  docPrIdBase: number = 1,
  hasRightLogo: boolean = true
): string {
  const FN =
    '<w:rFonts w:ascii="Sarabun" w:hAnsi="Sarabun" w:cs="TH Sarabun New" w:eastAsia="Sarabun"/>';

  const P = (
    t: string,
    o: { a?: number; bBefore?: number; c?: boolean | number; j?: string; b?: boolean | number; z?: number } = {}
  ) =>
    `<w:p><w:pPr><w:spacing w:before="${o.bBefore ?? 0}" w:after="${o.a ?? 40}"/><w:jc w:val="${
      o.c ? "center" : o.j || "left"
    }"/></w:pPr><w:r><w:rPr>${FN}${o.b ? "<w:b/><w:bCs/>" : ""}<w:sz w:val="${
      o.z || 22
    }"/><w:szCs w:val="${o.z || 22}"/></w:rPr><w:t xml:space="preserve">${escapeXml(
      t
    )}</w:t></w:r></w:p>`;

  const inlineImageXml = (rId: string, docId: number, cx: number, cy: number, name: string) =>
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docId}" name="${name}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

  // หัวกระดาษ 3 คอลัมน์ไร้เส้นขอบ: [โลโก้ซ้าย | แบบบันทึกการจัดสอนแทน + ประจำเดือน ... | โลโก้ขวา]
  const leftLogoDrawing = inlineImageXml("rId1", docPrIdBase, 680000, 720000, "logo_left.png");
  const rightLogoDrawing = hasRightLogo
    ? inlineImageXml("rId2", docPrIdBase + 100, 680000, 680000, "logo_right.png")
    : P("", { c: 1 });

  const monthYearTitle = formatThaiMonthYearHeader(dateStr);
  const headerTable = `<w:tbl><w:tblPr><w:tblW w:w="14800" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tr><w:tc><w:tcPr><w:tcW w:w="4200" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${leftLogoDrawing}</w:tc><w:tc><w:tcPr><w:tcW w:w="6400" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${P(
    "แบบบันทึกการจัดสอนแทน",
    { c: 1, b: 1, z: 28, a: 120 }
  )}${P(monthYearTitle, { c: 1, b: 1, z: 26, a: 40 })}</w:tc><w:tc><w:tcPr><w:tcW w:w="4200" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${rightLogoDrawing}</w:tc></w:tr></w:tbl>`;

  // ตาราง 10 คอลัมน์ (ความกว้างรวม 14800 dxa สำหรับ A4 แนวนอน)
  const W = [560, 3080, 2800, 860, 980, 1440, 1140, 1280, 1320, 1340];
  const H = [
    "ที่",
    "ชื่อ-สกุล ผู้สอนแทน",
    "สอนแทน",
    "คาบที่",
    "ห้อง",
    "วิชา",
    "รหัสวิชา",
    "วันที่",
    "ลงชื่อ",
    "หมายเหตุ",
  ];

  const C = (t: string, i: number, isHeader?: boolean | number) => {
    const isLeftAligned = !isHeader && (i === 1 || i === 2);
    const noWrap = i !== 1 && i !== 2 ? "<w:noWrap/>" : "";
    return `<w:tc><w:tcPr><w:tcW w:w="${W[i]}" w:type="dxa"/>${noWrap}<w:vAlign w:val="center"/></w:tcPr>${P(
      t,
      {
        c: !isLeftAligned,
        b: isHeader,
        a: 0,
        z: isHeader ? 22 : 21,
      }
    )}</w:tc>`;
  };

  const bd = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((s) => `<w:${s} w:val="single" w:sz="6" w:space="0" w:color="000000"/>`)
    .join("");

  const shortDateStr = formatShortThaiDate(dateStr);
  const noteStr = (reason || "ไปราชการ").trim() || "ไปราชการ";

  const tb = `<w:tbl><w:tblPr><w:tblW w:w="14800" w:type="dxa"/><w:tblBorders>${bd}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tr>${H.map(
    (h, i) => C(h, i, 1)
  ).join("")}</w:tr>${rows
    .map((row, idx) => {
      const subDisplay = row.subName || formatCleanSubstituteName(row.n);
      const absentDisplay = resolveRowAbsentTeacherName(row, absentTeacher);
      const roomClassDisplay = row.classRoomLabel || formatClassLevelLabel(row.cls);
      const subjectDisplay =
        row.subjectName || getSubjectNameFromCourse(row.code, absentTeacher.g);
      const rowShortDate = row.shortDate || shortDateStr;
      const vals = [
        String(idx + 1),
        subDisplay,
        absentDisplay,
        String(row.p),
        roomClassDisplay,
        subjectDisplay,
        row.code,
        rowShortDate,
        "",
        noteStr,
      ];
      return `<w:tr>${vals.map((v, i) => C(String(v), i)).join("")}</w:tr>`;
    })
    .join("")}</w:tbl>`;

  const boxBorders = `<w:tcBorders><w:top w:val="single" w:sz="10" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="10" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="10" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="10" w:space="0" w:color="000000"/></w:tcBorders>`;
  const noBorders = `<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>`;

  const sigTable = `<w:tbl><w:tblPr><w:tblW w:w="14800" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="120" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tr><w:tc><w:tcPr><w:tcW w:w="900" w:type="dxa"/>${noBorders}</w:tcPr>${P(
    ""
  )}</w:tc><w:tc><w:tcPr><w:tcW w:w="4800" w:type="dxa"/>${boxBorders}<w:vAlign w:val="center"/></w:tcPr>${P(
    "ลงชื่อ.................................ผู้จัดสอนแทน",
    { c: 1, a: 80, z: 22 }
  )}${P("(นายธีระพงษ์ หาวัน)", { c: 1, a: 80, z: 22 })}${P(
    "งานการจัดการเรียนการสอน",
    { c: 1, a: 0, z: 22 }
  )}</w:tc><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>${noBorders}</w:tcPr>${P(
    ""
  )}</w:tc><w:tc><w:tcPr><w:tcW w:w="5800" w:type="dxa"/>${boxBorders}<w:vAlign w:val="center"/></w:tcPr>${P(
    "ลงชื่อ.................................หัวหน้ากลุ่มบริหารวิชาการ",
    { c: 1, a: 80, z: 22 }
  )}${P("(นายสุทธิศักดิ์ เกตษา)", { c: 1, a: 80, z: 22 })}${P(
    "ผู้ช่วยผู้อำนวยการโรงเรียนวรคุณอุปถัมภ์",
    { c: 1, a: 0, z: 22 }
  )}</w:tc><w:tc><w:tcPr><w:tcW w:w="900" w:type="dxa"/>${noBorders}</w:tcPr>${P(
    ""
  )}</w:tc></w:tr></w:tbl>`;

  return headerTable + P("", { a: 120 }) + tb + P("", { a: 360 }) + sigTable;
}

async function generateMultiDocxBlob(sheets: SubstituteSheetData[]): Promise<Blob> {
  const leftLogoBase64 = await loadImageToPngBase64(LEFT_SCHOOL_LOGO_URL, SCHOOL_LOGO);
  const rightLogoBase64 = await loadImageToPngBase64(RIGHT_OBEC_LOGO_URL);
  const hasRightLogo = Boolean(rightLogoBase64);

  const pageBreakXml = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const body = sheets
    .map((sheet, idx) =>
      buildDocxSheetBodyXml(
        sheet.absentTeacher,
        sheet.dateStr,
        sheet.reason,
        sheet.rows,
        idx + 1,
        hasRightLogo
      )
    )
    .join(pageBreakXml);

  const z = new JSZip();
  const R =
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  z.file(
    "[Content_Types].xml",
    X +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  z.file(
    "_rels/.rels",
    X +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );

  const relsItems = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo_left.png"/>',
  ];
  if (hasRightLogo) {
    relsItems.push(
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo_right.png"/>'
    );
  }

  z.file(
    "word/_rels/document.xml.rels",
    X +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsItems.join(
        ""
      )}</Relationships>`
  );
  z.file("word/media/logo_left.png", leftLogoBase64, { base64: true });
  if (hasRightLogo) {
    z.file("word/media/logo_right.png", rightLogoBase64, { base64: true });
  }

  z.file(
    "word/document.xml",
    X +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ${R} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`
  );

  return z.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export async function generateDocxBlob(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[]
): Promise<Blob> {
  return generateMultiDocxBlob([{ absentTeacher, dateStr, reason, rows }]);
}

export async function exportSubstituteDocument(
  format: "word" | "pdf" | "image",
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[],
  _paperElement: HTMLElement | null
): Promise<void> {
  const matchedIds = String(absentTeacher.n || "").match(/\b\d{3}\b/g);
  const idPart =
    matchedIds && matchedIds.length > 1
      ? matchedIds.join("-")
      : String(absentTeacher.id);
  const baseFilename = `แบบบันทึกการจัดสอนแทน_${idPart}_${dateStr}`;

  if (format === "word") {
    const blob = await generateDocxBlob(absentTeacher, dateStr, reason, rows);
    await triggerBrowserDownload(
      `${baseFilename}.docx`,
      blob,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    return;
  }

  const canvas = await renderPaperToCanvas(absentTeacher, dateStr, reason, rows);

  if (format === "image") {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) throw new Error("ไม่สามารถสร้างไฟล์รูปภาพได้");
    await triggerBrowserDownload(`${baseFilename}.png`, blob, "image/png");
    return;
  }

  const pdf = new jsPDF("l", "mm", "a4");
  const imgData = canvas.toDataURL("image/png");
  const pdfWidth = 297;
  const pdfHeight = (pdfWidth * canvas.height) / canvas.width;
  pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
  const pdfBlob = pdf.output("blob");
  await triggerBrowserDownload(`${baseFilename}.pdf`, pdfBlob, "application/pdf");
}

export async function exportMultipleSubstituteDocuments(
  format: "word" | "pdf" | "image",
  sheets: SubstituteSheetData[],
  dateStr: string
): Promise<void> {
  if (sheets.length === 0) return;
  if (sheets.length === 1) {
    const s = sheets[0];
    return exportSubstituteDocument(
      format,
      s.absentTeacher,
      s.dateStr,
      s.reason,
      s.rows,
      null
    );
  }

  const idsLabel = sheets.map((s) => s.absentTeacher.id).join("-");
  const baseFilename = `แบบบันทึกการจัดสอนแทนรวม_${sheets.length}ท่าน_${idsLabel}_${dateStr}`;

  if (format === "word") {
    const blob = await generateMultiDocxBlob(sheets);
    await triggerBrowserDownload(
      `${baseFilename}.docx`,
      blob,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    return;
  }

  const canvases: HTMLCanvasElement[] = [];
  for (const s of sheets) {
    const c = await renderPaperToCanvas(s.absentTeacher, s.dateStr, s.reason, s.rows);
    canvases.push(c);
  }

  if (format === "pdf") {
    const pdf = new jsPDF("l", "mm", "a4");
    canvases.forEach((canvas, idx) => {
      if (idx > 0) pdf.addPage();
      const imgData = canvas.toDataURL("image/png");
      const pdfWidth = 297;
      const pdfHeight = (pdfWidth * canvas.height) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
    });
    const pdfBlob = pdf.output("blob");
    await triggerBrowserDownload(`${baseFilename}.pdf`, pdfBlob, "application/pdf");
    return;
  }

  const gap = 24;
  const totalWidth = Math.max(...canvases.map((c) => c.width));
  const totalHeight =
    canvases.reduce((acc, c) => acc + c.height, 0) + gap * (canvases.length - 1);

  const combinedCanvas = document.createElement("canvas");
  combinedCanvas.width = totalWidth;
  combinedCanvas.height = totalHeight;
  const ctx = combinedCanvas.getContext("2d");
  if (!ctx) throw new Error("ไม่สามารถสร้าง Canvas รวมรูปภาพได้");

  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  let yOffset = 0;
  for (const c of canvases) {
    ctx.drawImage(c, 0, yOffset);
    yOffset += c.height + gap;
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    combinedCanvas.toBlob(resolve, "image/png")
  );
  if (!blob) throw new Error("ไม่สามารถสร้างไฟล์รูปภาพได้");
  await triggerBrowserDownload(`${baseFilename}.png`, blob, "image/png");
}
