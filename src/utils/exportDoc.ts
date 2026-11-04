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

let cachedFontLoadPromise: Promise<void> | null = null;

/**
 * บังคับโหลดฟอนต์ราชการไทย THSarabunNew (Regular 400 & Bold 700) จากไฟล์ในระบบ (/fonts/THSarabunNew.ttf)
 * เพื่อให้การวาดลงบน HTML5 Canvas ทั้งในคอมพิวเตอร์ (Windows/Mac) และโทรศัพท์มือถือ (iOS/Android)
 * มีขนาดตัวอักษร ความหนา และสัดส่วนเหมือนแบบฟอร์มราชการ (รูปที่ 1) เหมือนกันเป๊ะ 100% ทุกอุปกรณ์
 */
export async function ensureSarabunFontLoaded(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;

  if (!cachedFontLoadPromise) {
    cachedFontLoadPromise = (async () => {
      try {
        if (typeof FontFace !== "undefined") {
          const regularFace = new FontFace(
            "THSarabunNewWeb",
            "url(/fonts/THSarabunNew.ttf)",
            { weight: "400", style: "normal" }
          );
          const boldFace = new FontFace(
            "THSarabunNewWeb",
            "url(/fonts/THSarabunNew-Bold.ttf)",
            { weight: "700", style: "normal" }
          );
          const [loadedRegular, loadedBold] = await Promise.all([
            regularFace.load(),
            boldFace.load(),
          ]);
          document.fonts.add(loadedRegular);
          document.fonts.add(loadedBold);
        }

        await Promise.all([
          document.fonts.load("400 21.3px 'THSarabunNewWeb'", THAI_FONT_SAMPLE),
          document.fonts.load("700 21.3px 'THSarabunNewWeb'", THAI_FONT_SAMPLE),
          document.fonts.load("700 26.7px 'THSarabunNewWeb'", THAI_SAMPLE_SHORT),
        ]);
        await document.fonts.ready;

        for (let attempt = 0; attempt < 15; attempt++) {
          if (
            document.fonts.check("400 21.3px 'THSarabunNewWeb'", "แบบบันทึกการจัดสอนแทน") &&
            document.fonts.check("700 26.7px 'THSarabunNewWeb'", "แบบบันทึกการจัดสอนแทน")
          ) {
            break;
          }
          await new Promise((r) => setTimeout(r, 80));
        }
      } catch {
        // Proceed if FontFace API is restricted
      }
    })();
  }

  await cachedFontLoadPromise;
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
 *     กล่องซ้าย: (นายธีระพงษ์ หาวัน) งานการจัดการเรียนการสอน
 *     กล่องขวา: (นายสุทธิศักดิ์ เกตษา) ผู้ช่วยผู้อำนวยการโรงเรียนวรคุณอุปถัมภ์
 */
export const TH_SARABUN_FONT_STACK =
  "'THSarabunNewWeb', 'TH Sarabun PSK', 'THSarabunPSK', 'TH Sarabun New', sans-serif";

/**
 * แบ่งแถวคาบสอนแทนออกเป็นหน้าๆ โดยอิงจากขอบกระดาษ A4 แนวนอน (เอกสารราชการ)
 * - หน้าที่มีกล่องลงนาม (หน้าเดียว หรือหน้าสุดท้าย): บรรจุได้สูงสุด 13 คาบ เพื่อให้เต็มพื้นที่หน้าก่อนตัดหน้าอย่างสวยงาม
 * - หน้าที่ไม่มีกล่องลงนาม (หน้าแรกของเอกสารหลายหน้า): บรรจุได้ถึง 14 คาบ ชิดขอบกระดาษล่าง
 * - หน้าสุดท้าย: ต้องมีคาบสอนเหลืออยู่อย่างน้อย 2 คาบ พร้อมกล่องลงนามท้ายเอกสาร
 */
export function chunkSubstituteRows(
  rows: SubstituteRow[],
  maxSinglePage = 13,
  maxNonFinalPage = 14,
  minFinalPageRows = 2
): SubstituteRow[][] {
  if (rows.length === 0) return [[]];
  if (rows.length <= maxSinglePage) {
    return [rows];
  }

  const pages: SubstituteRow[][] = [];
  let remaining = [...rows];

  while (remaining.length > 0) {
    // ถ้าเป็นหน้าสุดท้ายแล้ว และจำนวนแถวที่เหลือสามารถใส่พร้อมกล่องลงนามได้ (<= maxSinglePage)
    if (pages.length > 0 && remaining.length <= maxSinglePage) {
      pages.push(remaining);
      break;
    }

    // จำนวนแถวที่จะใส่ในหน้านี้ (สูงสุด 14 แถว)
    let take = Math.min(maxNonFinalPage, remaining.length);
    const leftover = remaining.length - take;

    // ถ้าตัดไปแล้ว หน้าสุดท้ายจะเหลือน้อยกว่า minFinalPageRows
    if (leftover > 0 && leftover < minFinalPageRows) {
      take = Math.max(1, remaining.length - minFinalPageRows);
    } else if (leftover > maxSinglePage) {
      // ถ้าแถวที่เหลือยังเกินความจุหน้าสุดท้าย ให้กระจายให้สมดุล
      take = Math.min(maxNonFinalPage, Math.ceil(remaining.length / 2));
    }

    if (take <= 0) {
      take = Math.min(maxNonFinalPage, Math.ceil(remaining.length / 2));
    }

    pages.push(remaining.slice(0, take));
    remaining = remaining.slice(take);
  }

  return pages;
}

/**
 * วาดแบบบันทึกการจัดสอนแทน 1 หน้า (A4 Landscape: 1123 x 794 px)
 * ตัวหนังสือขนาดมาตรฐาน 16pt TH Sarabun PSK (บนจอ 96 DPI คือ 21.3px)
 */
export async function renderPaperPageCanvas(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  pageRows: SubstituteRow[],
  startRowIdx: number,
  pageIndex: number,
  totalPages: number,
  isLastPage: boolean
): Promise<HTMLCanvasElement> {
  await ensureSarabunFontLoaded();

  const scale = 2; // ความละเอียดสูง 2x (2246 x 1588 px)
  const pageWidth = 1123;
  const pageHeight = 794;
  const marginX = 48;
  const fontStack = TH_SARABUN_FONT_STACK;

  // ฟอนต์ขนาด 16pt TH Sarabun PSK (= 21.3px บนจอ 96 DPI)
  const cellFontSize = 21.3;
  const cellLineHeight = 27;

  // ความกว้างทั้ง 10 คอลัมน์ รวม = 1027px (พอดีหน้า A4 แนวนอน)
  // [ที่ 40, ชื่อ-สกุล ผู้สอนแทน 210, สอนแทน 195, คาบที่ 60, ห้อง 68, วิชา 100, รหัสวิชา 80, วันที่ 88, ลงชื่อ 92, หมายเหตุ 94]
  const colWidths = [40, 210, 195, 60, 68, 100, 80, 88, 92, 94];
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

  const headerTopY = 32;
  const tableStartY = 132;
  const headerRowHeight = pageRows.length > 10 ? 36 : pageRows.length > 6 ? 38 : 42;
  const dataRowHeight = pageRows.length > 10 ? 35 : pageRows.length > 6 ? 38 : 42;

  const canvas = document.createElement("canvas");
  canvas.width = pageWidth * scale;
  canvas.height = pageHeight * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("ไม่สามารถสร้าง Canvas 2D สำหรับวาดเอกสารได้");
  }

  ctx.scale(scale, scale);

  // พื้นหลังกระดาษขาว
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pageWidth, pageHeight);
  ctx.textBaseline = "alphabetic";

  // 1. วาดโลโก้ซ้าย (ตราโรงเรียนวรคุณอุปถัมภ์) และโลโก้ขวา (ตราหมายเลข 1)
  try {
    const leftLogoImg = await loadImage(LEFT_SCHOOL_LOGO_URL).catch(() =>
      loadImage(SCHOOL_LOGO)
    );
    const leftLogoH = 88;
    const leftLogoW = (leftLogoImg.naturalWidth / leftLogoImg.naturalHeight) * leftLogoH;
    const leftCenterX = marginX + 258;
    ctx.drawImage(
      leftLogoImg,
      leftCenterX - leftLogoW / 2,
      headerTopY,
      leftLogoW,
      leftLogoH
    );
  } catch {
    // Skip if left logo fails
  }

  try {
    const rightLogoImg = await loadImage(RIGHT_OBEC_LOGO_URL);
    const rightLogoH = 82;
    const rightLogoW = (rightLogoImg.naturalWidth / rightLogoImg.naturalHeight) * rightLogoH;
    const rightCenterX = pageWidth - marginX - 252;
    ctx.drawImage(
      rightLogoImg,
      rightCenterX - rightLogoW / 2,
      headerTopY + 3,
      rightLogoW,
      rightLogoH
    );
  } catch {
    // Skip if right logo fails
  }

  // 2. วาดหัวกระดาษตรงกลาง (ตัวหนังสือ TH Sarabun PSK ตัวหนา)
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";

  // "แบบบันทึกการจัดสอนแทน" ขนาด 20pt (= 26.7px)
  drawFittedCellLine(
    ctx,
    "แบบบันทึกการจัดสอนแทน",
    pageWidth / 2,
    headerTopY + 38,
    440,
    26.7,
    "700",
    fontStack
  );

  // "ประจำเดือน ... พ.ศ. ..." ขนาด 16pt (= 21.3px)
  const monthYearTitle = formatThaiMonthYearHeader(dateStr);
  drawFittedCellLine(
    ctx,
    monthYearTitle,
    pageWidth / 2,
    headerTopY + 80,
    460,
    21.3,
    "700",
    fontStack
  );

  // กรณีมีหลายหน้า แสดงตัวเลขหน้าที่มุมขวาบนเบาๆ
  if (totalPages > 1) {
    ctx.font = `400 16px ${fontStack}`;
    ctx.fillStyle = "#64748b";
    ctx.textAlign = "right";
    ctx.fillText(`(หน้าที่ ${pageIndex + 1}/${totalPages})`, pageWidth - marginX, headerTopY + 16);
    ctx.fillStyle = "#000000";
  }

  // 3. วาดตาราง 10 คอลัมน์ (เส้นขอบสีดำคมชัด ขนาด 16pt TH Sarabun PSK)
  let cursorY = tableStartY;
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#000000";

  // 3.1 หัวตาราง 10 คอลัมน์
  let colX = marginX;
  for (let i = 0; i < headers.length; i++) {
    const w = colWidths[i];
    ctx.strokeRect(colX, cursorY, w, headerRowHeight);
    ctx.textAlign = "center";
    drawFittedCellLine(
      ctx,
      headers[i],
      colX + w / 2,
      cursorY + headerRowHeight / 2 + 7.5,
      w - 8,
      cellFontSize,
      "700",
      fontStack
    );
    colX += w;
  }
  cursorY += headerRowHeight;

  // 3.2 ข้อมูลแถวคาบสอนแทนในหน้านี้
  const shortDateStr = formatShortThaiDate(dateStr);
  const noteStr = (reason || "ไปราชการ").trim() || "ไปราชการ";

  for (let rIdx = 0; rIdx < pageRows.length; rIdx++) {
    const row = pageRows[rIdx];
    const globalRowNumber = startRowIdx + rIdx + 1;
    const subDisplay = row.subName || formatCleanSubstituteName(row.n);
    const absentDisplay = resolveRowAbsentTeacherName(row, absentTeacher);
    const roomClassDisplay = row.classRoomLabel || formatClassLevelLabel(row.cls);
    const subjectDisplay =
      row.subjectName || getSubjectNameFromCourse(row.code, absentTeacher.g);
    const rowShortDate = row.shortDate || shortDateStr;

    const cellValues = [
      String(globalRowNumber),
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

    let x = marginX;
    for (let i = 0; i < cellValues.length; i++) {
      const w = colWidths[i];
      ctx.strokeRect(x, cursorY, w, dataRowHeight);

      const val = cellValues[i];
      const baselineY = cursorY + dataRowHeight / 2 + 7.2;

      // คอลัมน์ที่ 2 (ชื่อ-สกุล ผู้สอนแทน) และคอลัมน์ที่ 3 (สอนแทน) จัดชิดซ้าย
      if (i === 1 || i === 2) {
        ctx.textAlign = "left";
        drawFittedCellLine(
          ctx,
          val,
          x + 10,
          baselineY,
          w - 18,
          cellFontSize,
          "400",
          fontStack
        );
      } else {
        ctx.textAlign = "center";
        drawFittedCellLine(
          ctx,
          val,
          x + w / 2,
          baselineY,
          w - 10,
          cellFontSize,
          "400",
          fontStack
        );
      }

      x += w;
    }

    cursorY += dataRowHeight;
  }

  // 4. วาดกล่องลงนาม 2 กล่องตีกรอบสี่เหลี่ยมด้านล่าง (เฉพาะหน้าสุดท้ายของเอกสาร)
  if (isLastPage) {
    const sigBoxHeight = 104;
    // ปรับตำแหน่ง Y ของกล่องลงนามให้ขยับลงมาเว้นระยะห่างจากตารางสวยงาม
    const idealSigBoxY = cursorY + 54;
    const maxSigBoxY = pageHeight - 36 - sigBoxHeight;
    const sigBoxY = Math.max(Math.min(idealSigBoxY, maxSigBoxY), cursorY + 40);

    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#000000";
    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";

    // กล่องซ้าย: ผู้จัดสอนแทน (นายธีระพงษ์ หาวัน)
    const leftBoxX = marginX + 58;
    const leftBoxW = 318;
    ctx.strokeRect(leftBoxX, sigBoxY, leftBoxW, sigBoxHeight);

    const leftCenterX = leftBoxX + leftBoxW / 2;
    drawFittedCellLine(
      ctx,
      "ลงชื่อ.................................ผู้จัดสอนแทน",
      leftCenterX,
      sigBoxY + 30,
      leftBoxW - 20,
      cellFontSize,
      "400",
      fontStack
    );

    drawFittedCellLine(
      ctx,
      "(นายธีระพงษ์ หาวัน)",
      leftCenterX,
      sigBoxY + 62,
      leftBoxW - 20,
      cellFontSize,
      "400",
      fontStack
    );
    drawFittedCellLine(
      ctx,
      "งานการจัดการเรียนการสอน",
      leftCenterX,
      sigBoxY + 92,
      leftBoxW - 20,
      cellFontSize,
      "400",
      fontStack
    );

    // กล่องขวา: หัวหน้ากลุ่มบริหารวิชาการ (นายสุทธิศักดิ์ เกตษา)
    const rightBoxX = marginX + 526;
    const rightBoxW = 402;
    ctx.strokeRect(rightBoxX, sigBoxY, rightBoxW, sigBoxHeight);

    const rightCenterX = rightBoxX + rightBoxW / 2;
    drawFittedCellLine(
      ctx,
      "ลงชื่อ.................................หัวหน้ากลุ่มบริหารวิชาการ",
      rightCenterX,
      sigBoxY + 30,
      rightBoxW - 20,
      cellFontSize,
      "400",
      fontStack
    );
    drawFittedCellLine(
      ctx,
      "(นายสุทธิศักดิ์ เกตษา)",
      rightCenterX,
      sigBoxY + 62,
      rightBoxW - 20,
      cellFontSize,
      "400",
      fontStack
    );
    drawFittedCellLine(
      ctx,
      "ผู้ช่วยผู้อำนวยการโรงเรียนวรคุณอุปถัมภ์",
      rightCenterX,
      sigBoxY + 92,
      rightBoxW - 20,
      cellFontSize,
      "400",
      fontStack
    );
  }

  return canvas;
}

/**
 * แปลงข้อมูลแถวคาบสอนแทนทั้งหมดให้เป็นชุด Canvas ตามจำนวนหน้า A4 แนวนอน
 * ถ้าคาบเยอะ จะแบ่งออกเป็นหน้าถัดไป ไม่ยัดใส่หน้าเดียว
 */
export async function renderPaperPagesToCanvases(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[]
): Promise<HTMLCanvasElement[]> {
  const chunks = chunkSubstituteRows(rows);
  const canvases: HTMLCanvasElement[] = [];

  let startRowIdx = 0;
  for (let pIdx = 0; pIdx < chunks.length; pIdx++) {
    const pageRows = chunks[pIdx];
    const isLast = pIdx === chunks.length - 1;
    const canvas = await renderPaperPageCanvas(
      absentTeacher,
      dateStr,
      reason,
      pageRows,
      startRowIdx,
      pIdx,
      chunks.length,
      isLast
    );
    canvases.push(canvas);
    startRowIdx += pageRows.length;
  }

  return canvases;
}

/**
 * วาดหน้าแรกของแบบบันทึกการจัดสอนแทน (สำหรับการแสดงผลพรีวิวทั่วไป)
 */
export async function renderPaperToCanvas(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[]
): Promise<HTMLCanvasElement> {
  const canvases = await renderPaperPagesToCanvases(absentTeacher, dateStr, reason, rows);
  return canvases[0] || (await renderPaperPageCanvas(absentTeacher, dateStr, reason, rows, 0, 0, 1, true));
}

export interface SubstituteSheetData {
  absentTeacher: TeacherRecord;
  dateStr: string;
  reason: string;
  rows: SubstituteRow[];
}

/**
 * สร้างเนื้อหา Word XML สำหรับแบบบันทึกการจัดสอนแทน
 * - กำหนดฟอนต์ TH Sarabun PSK ขนาด 16pt มาตรฐานเอกสารราชการไทย
 * - ตาราง 10 คอลัมน์ความกว้างคงที่ 15200 dxa ตามแบบฟอร์มเป๊ะ
 * - ถ้ามีหลายคาบ (> 7 คาบ) จะแบ่งหน้าถัดไปอัตโนมัติด้วย Page Break ไม่ยัดใส่หน้าเดียว
 * - ส่วนลงนาม 2 กล่องตีกรอบสี่เหลี่ยมด้านล่างตรงตามรูปพรีวิว 100%
 */
function buildDocxSheetBodyXml(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[],
  docPrIdBase: number = 1,
  hasRightLogo: boolean = true
): string {
  // ฟอนต์ TH Sarabun PSK ตามที่กำหนด
  const FN =
    '<w:rFonts w:ascii="TH Sarabun PSK" w:hAnsi="TH Sarabun PSK" w:cs="TH Sarabun PSK" w:eastAsia="TH Sarabun PSK"/>';

  // พารากราฟมาตรฐาน กำหนดฟอนต์ TH Sarabun PSK ขนาด 16pt (32 half-points) เป็นค่าเริ่มต้น
  const P = (
    t: string,
    o: { a?: number; bBefore?: number; c?: boolean | number; j?: string; b?: boolean | number; z?: number } = {}
  ) =>
    `<w:p><w:pPr><w:spacing w:before="${o.bBefore ?? 0}" w:after="${o.a ?? 0}" w:line="240" w:lineRule="auto"/><w:jc w:val="${
      o.c ? "center" : o.j || "left"
    }"/></w:pPr><w:r><w:rPr>${FN}${o.b ? "<w:b/><w:bCs/>" : ""}<w:sz w:val="${
      o.z || 32
    }"/><w:szCs w:val="${o.z || 32}"/></w:rPr><w:t xml:space="preserve">${escapeXml(
      t
    )}</w:t></w:r></w:p>`;

  const inlineImageXml = (rId: string, docId: number, cx: number, cy: number, name: string) =>
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docId}" name="${name}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

  // ตาราง 10 คอลัมน์ (ความกว้างรวม 15200 dxa สำหรับ A4 แนวนอน)
  const W = [650, 3000, 2800, 900, 1000, 1550, 1250, 1300, 1350, 1400];
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

  const gridXml = `<w:tblGrid>${W.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;

  const C = (t: string, i: number, isHeader?: boolean | number) => {
    const isLeftAligned = !isHeader && (i === 1 || i === 2);
    const noWrap = i !== 1 && i !== 2 ? "<w:noWrap/>" : "";
    return `<w:tc><w:tcPr><w:tcW w:w="${W[i]}" w:type="dxa"/>${noWrap}<w:vAlign w:val="center"/></w:tcPr>${P(
      t,
      {
        c: !isLeftAligned,
        b: isHeader,
        a: 0,
        z: 32, // ขนาด 16pt TH Sarabun PSK ตามที่กำหนด
      }
    )}</w:tc>`;
  };

  const bd = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((s) => `<w:${s} w:val="single" w:sz="6" w:space="0" w:color="000000"/>`)
    .join("");

  const shortDateStr = formatShortThaiDate(dateStr);
  const noteStr = (reason || "ไปราชการ").trim() || "ไปราชการ";

  // แบ่งแถวออกเป็นหน้าๆ โดยอิงจากขอบกระดาษ A4 แนวนอน
  const chunks = chunkSubstituteRows(rows);
  const monthYearTitle = formatThaiMonthYearHeader(dateStr);

  const pageBreakXml = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

  // กล่องลงนาม 2 กล่องตีกรอบสี่เหลี่ยมด้านล่าง
  const boxBorders = `<w:tcBorders><w:top w:val="single" w:sz="12" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="12" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="12" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="12" w:space="0" w:color="000000"/></w:tcBorders>`;
  const noBorders = `<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>`;
  const sigGridXml = `<w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="5800"/><w:gridCol w:w="1600"/><w:gridCol w:w="5800"/></w:tblGrid>`;

  const sigTable = `<w:tbl><w:tblPr><w:tblW w:w="15200" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="140" w:type="dxa"/><w:bottom w:w="140" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tblCellMar></w:tblPr>${sigGridXml}<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/>${noBorders}</w:tcPr>${P(
    ""
  )}</w:tc><w:tc><w:tcPr><w:tcW w:w="5800" w:type="dxa"/>${boxBorders}<w:vAlign w:val="center"/></w:tcPr>${P(
    "ลงชื่อ.................................ผู้จัดสอนแทน",
    { c: 1, a: 80, z: 32 }
  )}${P("(นายธีระพงษ์ หาวัน)", { c: 1, a: 80, z: 32 })}${P(
    "งานการจัดการเรียนการสอน",
    { c: 1, a: 0, z: 32 }
  )}</w:tc><w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/>${noBorders}</w:tcPr>${P(
    ""
  )}</w:tc><w:tc><w:tcPr><w:tcW w:w="5800" w:type="dxa"/>${boxBorders}<w:vAlign w:val="center"/></w:tcPr>${P(
    "ลงชื่อ.................................หัวหน้ากลุ่มบริหารวิชาการ",
    { c: 1, a: 80, z: 32 }
  )}${P("(นายสุทธิศักดิ์ เกตษา)", { c: 1, a: 80, z: 32 })}${P(
    "ผู้ช่วยผู้อำนวยการโรงเรียนวรคุณอุปถัมภ์",
    { c: 1, a: 0, z: 32 }
  )}</w:tc><w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/>${noBorders}</w:tcPr>${P(
    ""
  )}</w:tc></w:tr></w:tbl>`;

  let cumulativeRowOffset = 0;
  const pageXmlParts: string[] = [];

  chunks.forEach((pageChunk, pageIdx) => {
    const isLast = pageIdx === chunks.length - 1;
    const curDocId = docPrIdBase + pageIdx * 10;

    // หัวกระดาษ 3 คอลัมน์ไร้เส้นขอบ: [โลโก้ซ้าย | แบบบันทึกการจัดสอนแทน + ประจำเดือน ... | โลโก้ขวา]
    const leftLogoDrawing = inlineImageXml("rId1", curDocId + 1, 680000, 720000, `logo_left_${pageIdx}.png`);
    const rightLogoDrawing = hasRightLogo
      ? inlineImageXml("rId2", curDocId + 2, 680000, 680000, `logo_right_${pageIdx}.png`)
      : P("", { c: 1 });

    const headerGridXml = `<w:tblGrid><w:gridCol w:w="3800"/><w:gridCol w:w="7600"/><w:gridCol w:w="3800"/></w:tblGrid>`;

    const headerTable = `<w:tbl><w:tblPr><w:tblW w:w="15200" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>${headerGridXml}<w:tr><w:tc><w:tcPr><w:tcW w:w="3800" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${leftLogoDrawing}</w:tc><w:tc><w:tcPr><w:tcW w:w="7600" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${P(
      "แบบบันทึกการจัดสอนแทน",
      { c: 1, b: 1, z: 40, a: 80 } // ขนาด 20pt ตัวหนา
    )}${P(monthYearTitle, { c: 1, b: 1, z: 32, a: 40 })}</w:tc><w:tc><w:tcPr><w:tcW w:w="3800" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${rightLogoDrawing}</w:tc></w:tr></w:tbl>`;

    const pageIndicator =
      chunks.length > 1
        ? P(`(หน้าที่ ${pageIdx + 1}/${chunks.length})`, { j: "right", z: 24, a: 60 })
        : "";

    // แถวตาราง 10 คอลัมน์
    const tableHeaderRowXml = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${H.map(
      (h, i) => C(h, i, 1)
    ).join("")}</w:tr>`;

    const dataRowsXml = pageChunk
      .map((row, idx) => {
        const globalRowIdx = cumulativeRowOffset + idx + 1;
        const subDisplay = row.subName || formatCleanSubstituteName(row.n);
        const absentDisplay = resolveRowAbsentTeacherName(row, absentTeacher);
        const roomClassDisplay = row.classRoomLabel || formatClassLevelLabel(row.cls);
        const subjectDisplay =
          row.subjectName || getSubjectNameFromCourse(row.code, absentTeacher.g);
        const rowShortDate = row.shortDate || shortDateStr;
        const vals = [
          String(globalRowIdx),
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
        return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${vals.map((v, i) => C(String(v), i)).join("")}</w:tr>`;
      })
      .join("");

    const tb = `<w:tbl><w:tblPr><w:tblW w:w="15200" w:type="dxa"/><w:tblBorders>${bd}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr>${gridXml}${tableHeaderRowXml}${dataRowsXml}</w:tbl>`;

    let pageXml = headerTable + pageIndicator + P("", { a: 80 }) + tb;

    // หน้าสุดท้าย: ใส่กล่องลงนาม
    if (isLast) {
      const spacingBeforeSig =
        pageChunk.length > 10 ? 180 : pageChunk.length > 6 ? 300 : 420;
      pageXml += P("", { a: spacingBeforeSig }) + sigTable;
    }

    pageXmlParts.push(pageXml);
    cumulativeRowOffset += pageChunk.length;
  });

  return pageXmlParts.join(pageBreakXml);
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
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>'
  );
  z.file(
    "_rels/.rels",
    X +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );

  const relsItems = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo_left.png"/>',
    '<Relationship Id="rIdFont" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>',
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
  z.file(
    "word/fontTable.xml",
    X +
      '<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:font w:name="TH Sarabun PSK"><w:altName w:val="TH Sarabun New"/><w:family w:val="swiss"/><w:charset w:val="DE"/></w:font><w:font w:name="TH Sarabun New"><w:family w:val="swiss"/><w:charset w:val="DE"/></w:font><w:font w:name="Sarabun"><w:family w:val="swiss"/></w:font></w:fonts>'
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

  const canvases = await renderPaperPagesToCanvases(absentTeacher, dateStr, reason, rows);

  if (format === "image") {
    // ถ้ามีหน้าเดียว ให้ดาวน์โหลดรูปภาพไฟล์เดียวปกติ
    if (canvases.length <= 1) {
      const primaryCanvas = canvases[0];
      const blob = await new Promise<Blob | null>((resolve) =>
        primaryCanvas.toBlob(resolve, "image/png")
      );
      if (!blob) throw new Error("ไม่สามารถสร้างไฟล์รูปภาพได้");
      await triggerBrowserDownload(`${baseFilename}.png`, blob, "image/png");
      return;
    }

    // กรณีมี 2 หน้าขึ้นไป (หลายตาราง/หลายหน้า) ให้ดาวน์โหลดครบทุกหน้าอัตโนมัติ
    for (let pIdx = 0; pIdx < canvases.length; pIdx++) {
      const pageCanvas = canvases[pIdx];
      const blob = await new Promise<Blob | null>((resolve) =>
        pageCanvas.toBlob(resolve, "image/png")
      );
      if (blob) {
        await triggerBrowserDownload(
          `${baseFilename}_หน้า${pIdx + 1}จาก${canvases.length}.png`,
          blob,
          "image/png"
        );
        // หน่วงเวลา 400ms เพื่อให้เบราว์เซอร์ดาวน์โหลดได้ครบทุกไฟล์โดยไม่บล็อกการดาวน์โหลดต่อเนื่อง
        if (pIdx < canvases.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
    }
    return;
  }

  // ส่งออก PDF ขนาด A4 แนวนอน (297 x 210 mm) หลายหน้าตามจริง ไม่มีการยัดใส่หน้าเดียว
  const pdf = new jsPDF("l", "mm", "a4");
  canvases.forEach((canvas, idx) => {
    if (idx > 0) {
      pdf.addPage("a4", "l");
    }
    const imgData = canvas.toDataURL("image/png");
    pdf.addImage(imgData, "PNG", 0, 0, 297, 210);
  });
  const pdfBlob = pdf.output("blob");
  await triggerBrowserDownload(`${baseFilename}.pdf`, pdfBlob, "application/pdf");
}

/**
 * ดาวน์โหลดรูปภาพเฉพาะหน้าที่เลือก (หน้า 1 หรือ หน้า 2)
 */
export async function exportSingleSubstitutePageImage(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[],
  pageIndex: number
): Promise<void> {
  const canvases = await renderPaperPagesToCanvases(absentTeacher, dateStr, reason, rows);
  const target = canvases[pageIndex] || canvases[0];
  if (!target) return;
  const rawIdStr = absentTeacher.pdfGroup ? absentTeacher.pdfGroup.replace(/\s+/g, "") : "";
  const matchedIds = rawIdStr.match(/\d{3}/g);
  const idPart =
    matchedIds && matchedIds.length > 1
      ? matchedIds.join("-")
      : String(absentTeacher.id);
  const pageLabel = canvases.length > 1 ? `_หน้า${pageIndex + 1}จาก${canvases.length}` : "";
  const baseFilename = `แบบบันทึกการจัดสอนแทน_${idPart}_${dateStr}${pageLabel}.png`;
  const blob = await new Promise<Blob | null>((resolve) =>
    target.toBlob(resolve, "image/png")
  );
  if (!blob) throw new Error("ไม่สามารถสร้างไฟล์รูปภาพได้");
  await triggerBrowserDownload(baseFilename, blob, "image/png");
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
