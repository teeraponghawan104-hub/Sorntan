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

const cachedImagesMap = new Map<string, Promise<HTMLImageElement>>();
const cachedSharpenedLogoMap = new Map<string, Promise<HTMLCanvasElement>>();
const cachedPngBase64Map = new Map<string, Promise<string>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const existing = cachedImagesMap.get(src);
  if (existing) return existing;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    if (typeof Image === "undefined") {
      reject(new Error("Image API is not available in this environment"));
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => {
      cachedImagesMap.delete(src);
      reject(e);
    };
    img.src = src;
  });

  cachedImagesMap.set(src, promise);
  return promise;
}

/**
 * อัปสเกลและปรับความคมชัดของโลโก้โรงเรียน/สพฐ. ด้วย Unsharp Mask + ลบจุดรบกวนพื้นหลัง JPEG (Mosquito Noise)
 * เพื่อให้เวลาวาดลงบน Canvas ความละเอียดสูง (Ultra HD / 4K) หรือส่งออกเป็น PNG / PDF / Word โลโก้จะคมกริบและพื้นหลังขาวสะอาด
 */
async function loadSharpenedLogoCanvas(
  src: string,
  fallbackDataUrl?: string,
  targetHeight = 420
): Promise<HTMLCanvasElement> {
  const cacheKey = `${src}::${targetHeight}`;
  const existing = cachedSharpenedLogoMap.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const img = await loadImage(src).catch(() => {
      if (fallbackDataUrl) return loadImage(fallbackDataUrl);
      throw new Error("Failed to load logo image");
    });

    const natW = img.naturalWidth || 200;
    const natH = img.naturalHeight || 200;
    const h = Math.max(targetHeight, natH);
    const w = Math.max(1, Math.round((natW / natH) * h));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);

    try {
      const imgData = ctx.getImageData(0, 0, w, h);
      const srcPx = imgData.data;
      const outData = ctx.createImageData(w, h);
      const dstPx = outData.data;

      // 1. ลบคราบพื้นหลังสีเทาอ่อน/จุดรบกวนจากการบีบอัด JPEG รอบๆ ตราสัญลักษณ์ให้เป็นสีขาวบริสุทธิ์
      const cleaned = new Uint8ClampedArray(srcPx.length);
      for (let i = 0; i < srcPx.length; i += 4) {
        const r = srcPx[i];
        const g = srcPx[i + 1];
        const b = srcPx[i + 2];
        const a = srcPx[i + 3];
        if (a < 18) {
          cleaned[i] = 255;
          cleaned[i + 1] = 255;
          cleaned[i + 2] = 255;
          cleaned[i + 3] = 0;
          continue;
        }
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const spread = maxC - minC;
        if (r >= 240 && g >= 240 && b >= 240 && spread <= 16) {
          cleaned[i] = 255;
          cleaned[i + 1] = 255;
          cleaned[i + 2] = 255;
          cleaned[i + 3] = 255;
        } else {
          cleaned[i] = r;
          cleaned[i + 1] = g;
          cleaned[i + 2] = b;
          cleaned[i + 3] = a;
        }
      }

      // 2. Unsharp Mask (3x3 Laplacian Sharpening) เพื่อเร่งความคมของเส้นโลโก้และตัวอักษรในตรา
      const amount = 0.55;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          if (y === 0 || y === h - 1 || x === 0 || x === w - 1) {
            dstPx[idx] = cleaned[idx];
            dstPx[idx + 1] = cleaned[idx + 1];
            dstPx[idx + 2] = cleaned[idx + 2];
            dstPx[idx + 3] = cleaned[idx + 3];
            continue;
          }
          const top = ((y - 1) * w + x) * 4;
          const bottom = ((y + 1) * w + x) * 4;
          const left = (y * w + (x - 1)) * 4;
          const right = (y * w + (x + 1)) * 4;

          for (let c = 0; c < 3; c++) {
            const center = cleaned[idx + c];
            const neighbors =
              (cleaned[top + c] +
                cleaned[bottom + c] +
                cleaned[left + c] +
                cleaned[right + c]) *
              0.25;
            const sharpened = center + (center - neighbors) * amount;
            dstPx[idx + c] = Math.max(0, Math.min(255, Math.round(sharpened)));
          }
          dstPx[idx + 3] = cleaned[idx + 3];
        }
      }

      ctx.putImageData(outData, 0, 0);
    } catch {
      // Fallback to high-smoothing image if pixel manipulation is restricted
    }

    return canvas;
  })();

  promise.catch(() => {
    cachedSharpenedLogoMap.delete(cacheKey);
  });
  cachedSharpenedLogoMap.set(cacheKey, promise);
  return promise;
}

async function loadImageToPngBase64(
  src: string,
  fallbackDataUrl?: string,
  maxDimension = 600
): Promise<string> {
  const cacheKey = `${src}::${maxDimension}`;
  const cached = cachedPngBase64Map.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    if (typeof document !== "undefined") {
      try {
        const sharpenedCanvas = await loadSharpenedLogoCanvas(
          src,
          fallbackDataUrl,
          maxDimension
        );
        const dataUrl = sharpenedCanvas.toDataURL("image/png");
        return dataUrl.split(",")[1] || "";
      } catch {
        // Fallback below
      }
    }
    if (fallbackDataUrl && fallbackDataUrl.includes(",")) {
      return fallbackDataUrl.split(",")[1];
    }
    return "";
  })();

  cachedPngBase64Map.set(cacheKey, promise);
  return promise;
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

let sharedMeasureCtx: CanvasRenderingContext2D | null = null;

function countThaiBaseChars(text: string): number {
  return String(text || "").replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "").length;
}

/**
 * คำนวณขนาดฟอนต์ (หน่วย half-points ของ Word เช่น 32 = 16pt) ให้พอดีกับความกว้างคอลัมน์ในบรรทัดเดียว
 * ใช้ตรรกะเดียวกับ drawFittedCellLine บนพรีวิว Canvas เพื่อให้ตารางในไฟล์ Word ไม่ล้นหรือตัดบรรทัดเพี้ยน
 */
function measureFittedHalfPoints(
  text: string,
  maxWidthPx: number,
  baseFontSizePx = 21.3,
  fontWeight: "400" | "700" = "400"
): number {
  const clean = String(text || "").trim();
  if (!clean) return Math.round((baseFontSizePx / 21.3) * 32);

  // เผื่อระยะปลอดภัย 93% สำหรับการเรนเดอร์ช่องว่างตัวอักษรในโปรแกรม Microsoft Word
  const safeMaxWidthPx = maxWidthPx * 0.93;

  if (typeof document !== "undefined") {
    try {
      if (!sharedMeasureCtx) {
        const c = document.createElement("canvas");
        sharedMeasureCtx = c.getContext("2d");
      }
      if (sharedMeasureCtx) {
        let fontSize = baseFontSizePx;
        sharedMeasureCtx.font = `${fontWeight} ${fontSize}px ${TH_SARABUN_FONT_STACK}`;
        while (fontSize > 11.5 && sharedMeasureCtx.measureText(clean).width > safeMaxWidthPx) {
          fontSize -= 0.5;
          sharedMeasureCtx.font = `${fontWeight} ${fontSize}px ${TH_SARABUN_FONT_STACK}`;
        }
        return Math.max(18, Math.round((fontSize / 21.3) * 32));
      }
    } catch {
      // Fallback below
    }
  }

  const baseCount = countThaiBaseChars(clean);
  const avgGlyphPxAt16pt = fontWeight === "700" ? 8.8 : 8.2;
  let fontSize = baseFontSizePx;
  while (
    fontSize > 11.5 &&
    baseCount * avgGlyphPxAt16pt * (fontSize / 21.3) > safeMaxWidthPx
  ) {
    fontSize -= 0.5;
  }
  return Math.max(18, Math.round((fontSize / 21.3) * 32));
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

export interface DocumentSignatories {
  plannerName: string;
  plannerPosition: string;
  approverName: string;
  approverPosition: string;
}

export const DEFAULT_DOCUMENT_SIGNATORIES: DocumentSignatories = {
  plannerName: "นายธีระพงษ์ หาวัน",
  plannerPosition: "งานการจัดการเรียนการสอน",
  approverName: "นายสุทธิศักดิ์ เกตษา",
  approverPosition: "ผู้ช่วยผู้อำนวยการโรงเรียนวรคุณอุปถัมภ์",
};

let runtimeSignatories: DocumentSignatories = { ...DEFAULT_DOCUMENT_SIGNATORIES };

export function setRuntimeDocumentSignatories(
  next?: Partial<DocumentSignatories> | null
): DocumentSignatories {
  runtimeSignatories = {
    plannerName:
      String(next?.plannerName || "").trim() ||
      DEFAULT_DOCUMENT_SIGNATORIES.plannerName,
    plannerPosition:
      String(next?.plannerPosition || "").trim() ||
      DEFAULT_DOCUMENT_SIGNATORIES.plannerPosition,
    approverName:
      String(next?.approverName || "").trim() ||
      DEFAULT_DOCUMENT_SIGNATORIES.approverName,
    approverPosition:
      String(next?.approverPosition || "").trim() ||
      DEFAULT_DOCUMENT_SIGNATORIES.approverPosition,
  };
  return runtimeSignatories;
}

export function getRuntimeDocumentSignatories(): DocumentSignatories {
  return runtimeSignatories;
}

function formatParenSignatoryName(name: string): string {
  const clean = String(name || "").trim();
  if (!clean) return "()";
  if (clean.startsWith("(") && clean.endsWith(")")) return clean;
  return `(${clean})`;
}

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
  isLastPage: boolean,
  scale = 3.5
): Promise<HTMLCanvasElement> {
  await ensureSarabunFontLoaded();

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
  canvas.width = Math.round(pageWidth * scale);
  canvas.height = Math.round(pageHeight * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("ไม่สามารถสร้าง Canvas 2D สำหรับวาดเอกสารได้");
  }

  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // พื้นหลังกระดาษขาวบริสุทธิ์
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pageWidth, pageHeight);
  ctx.textBaseline = "alphabetic";

  // 1. วาดโลโก้ซ้าย (ตราโรงเรียนวรคุณอุปถัมภ์) และโลโก้ขวา (ตราหมายเลข 1) ด้วยระบบปรับความคมชัดสูง (Unsharp Mask + ลบคราบ JPEG)
  // จัดระยะห่างขนาบหัวกระดาษให้สมดุลพองาม (โลโก้ซ้าย -195px และโลโก้ขวา +204px จากกึ่งกลางหน้ากระดาษ ช่องไฟขนาบตัวหนังสือสมมาตรซ้าย-ขวา)
  try {
    const leftLogoCanvas = await loadSharpenedLogoCanvas(
      LEFT_SCHOOL_LOGO_URL,
      SCHOOL_LOGO,
      460
    );
    const leftLogoH = 92;
    const leftLogoW = (leftLogoCanvas.width / leftLogoCanvas.height) * leftLogoH;
    const leftCenterX = pageWidth / 2 - 195;
    ctx.drawImage(
      leftLogoCanvas,
      leftCenterX - leftLogoW / 2,
      headerTopY - 2,
      leftLogoW,
      leftLogoH
    );
  } catch {
    // Skip if left logo fails
  }

  try {
    const rightLogoCanvas = await loadSharpenedLogoCanvas(
      RIGHT_OBEC_LOGO_URL,
      undefined,
      420
    );
    const rightLogoH = 84;
    const rightLogoW = (rightLogoCanvas.width / rightLogoCanvas.height) * rightLogoH;
    const rightCenterX = pageWidth / 2 + 204;
    ctx.drawImage(
      rightLogoCanvas,
      rightCenterX - rightLogoW / 2,
      headerTopY + 2,
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
    headerTopY + 42,
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
    headerTopY + 86,
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
    const rowNote = (row.note || noteStr).trim() || noteStr;

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
      rowNote,
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

    // กล่องซ้าย: ผู้จัดสอนแทน
    const sig = getRuntimeDocumentSignatories();
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
      formatParenSignatoryName(sig.plannerName),
      leftCenterX,
      sigBoxY + 62,
      leftBoxW - 20,
      cellFontSize,
      "400",
      fontStack
    );
    drawFittedCellLine(
      ctx,
      sig.plannerPosition,
      leftCenterX,
      sigBoxY + 92,
      leftBoxW - 20,
      cellFontSize,
      "400",
      fontStack
    );

    // กล่องขวา: หัวหน้ากลุ่มบริหารวิชาการ
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
      formatParenSignatoryName(sig.approverName),
      rightCenterX,
      sigBoxY + 62,
      rightBoxW - 20,
      cellFontSize,
      "400",
      fontStack
    );
    drawFittedCellLine(
      ctx,
      sig.approverPosition,
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
  rows: SubstituteRow[],
  scale = 3.5
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
      isLast,
      scale
    );
    canvases.push(canvas);
    startRowIdx += pageRows.length;
  }

  return canvases;
}

/**
 * วาดหน้าแรกของแบบบันทึกการจัดสอนแทน (สำหรับการแสดงผลพรีวิวหรือการส่งออกความละเอียดสูง)
 */
export async function renderPaperToCanvas(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[],
  scale = 3.5
): Promise<HTMLCanvasElement> {
  const canvases = await renderPaperPagesToCanvases(
    absentTeacher,
    dateStr,
    reason,
    rows,
    scale
  );
  return (
    canvases[0] ||
    (await renderPaperPageCanvas(
      absentTeacher,
      dateStr,
      reason,
      rows,
      0,
      0,
      1,
      true,
      scale
    ))
  );
}

export interface SubstituteSheetData {
  absentTeacher: TeacherRecord;
  dateStr: string;
  reason: string;
  rows: SubstituteRow[];
}

/**
 * สร้างเนื้อหา Word XML สำหรับแบบบันทึกการจัดสอนแทน
 * - กำหนดฟอนต์ TH SarabunPSK / TH Sarabun New ขนาด 16pt มาตรฐานเอกสารราชการไทย
 * - หัวกระดาษ 5 คอลัมน์จัดตำแหน่งโลโก้ซ้าย-ขวาขนาบหัวเรื่องตรงตามพรีวิวเป๊ะ
 * - ตาราง 10 คอลัมน์ความกว้างคงที่ 15200 dxa พร้อมคำนวณขนาดฟอนต์อัตโนมัติในช่องที่ข้อความยาวเพื่อไม่ให้ล้นหรือตัดบรรทัดเพี้ยน
 * - ส่วนลงนาม 2 กล่องตีกรอบสี่เหลี่ยมด้านล่าง (5 คอลัมน์สมบูรณ์ตามมาตรฐาน OpenXML) ตรงตามรูปพรีวิว 100%
 */
function buildDocxSheetBodyXml(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[],
  docPrIdBase: number = 1,
  hasRightLogo: boolean = true
): string {
  // ชื่อฟอนต์มาตรฐานราชการไทยใน Windows/Office คือ "TH SarabunPSK" (และเชื่อม altName ไปยัง "TH Sarabun New" ใน fontTable.xml)
  const FN =
    '<w:rFonts w:ascii="TH SarabunPSK" w:hAnsi="TH SarabunPSK" w:cs="TH SarabunPSK" w:eastAsia="TH SarabunPSK"/>';

  const P = (
    t: string,
    o: {
      a?: number;
      bBefore?: number;
      c?: boolean | number;
      j?: string;
      b?: boolean | number;
      z?: number;
      line?: number;
      lineRule?: "auto" | "exact" | "atLeast";
      indLeft?: number;
    } = {}
  ) =>
    `<w:p><w:pPr><w:spacing w:before="${o.bBefore ?? 0}" w:after="${o.a ?? 0}" w:line="${
      o.line ?? 240
    }" w:lineRule="${o.lineRule ?? "auto"}"/>${
      o.indLeft ? `<w:ind w:left="${o.indLeft}"/>` : ""
    }<w:jc w:val="${o.c ? "center" : o.j || "left"}"/></w:pPr><w:r><w:rPr>${FN}${
      o.b ? "<w:b/><w:bCs/>" : ""
    }<w:sz w:val="${o.z || 32}"/><w:szCs w:val="${o.z || 32}"/></w:rPr><w:t xml:space="preserve">${escapeXml(
      t
    )}</w:t></w:r></w:p>`;

  const spacerP = (heightDxa: number) =>
    P("", { bBefore: 0, a: 0, line: heightDxa, lineRule: "exact", z: 4 });

  const inlineImageXml = (rId: string, docId: number, cx: number, cy: number, name: string) =>
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docId}" name="${name}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

  // สัดส่วนคอลัมน์ตรงกับพรีวิว Canvas 100%: [40, 210, 195, 60, 68, 100, 80, 88, 92, 94] px (รวม 1027px -> 15200 dxa)
  const colWidthsPx = [40, 210, 195, 60, 68, 100, 80, 88, 92, 94];
  const W = [592, 3108, 2886, 888, 1006, 1480, 1184, 1302, 1362, 1392];
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
    const maxWidthPx = isHeader
      ? colWidthsPx[i] - 8
      : isLeftAligned
        ? colWidthsPx[i] - 18
        : colWidthsPx[i] - 10;
    const fittedZ = measureFittedHalfPoints(
      t,
      maxWidthPx,
      21.3,
      isHeader ? "700" : "400"
    );

    return `<w:tc><w:tcPr><w:tcW w:w="${W[i]}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${P(
      t,
      {
        c: !isLeftAligned,
        b: isHeader,
        a: 0,
        bBefore: 0,
        z: fittedZ,
        indLeft: isLeftAligned ? 90 : 0,
      }
    )}</w:tc>`;
  };

  const bd = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((s) => `<w:${s} w:val="single" w:sz="6" w:space="0" w:color="000000"/>`)
    .join("");

  const noneTblBorders = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((s) => `<w:${s} w:val="none" w:sz="0" w:space="0" w:color="auto"/>`)
    .join("");

  const shortDateStr = formatShortThaiDate(dateStr);
  const noteStr = (reason || "ไปราชการ").trim() || "ไปราชการ";

  const chunks = chunkSubstituteRows(rows);
  const monthYearTitle = formatThaiMonthYearHeader(dateStr);

  const pageBreakXml = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

  // กล่องลงนาม 2 กล่องตีกรอบสี่เหลี่ยมด้านล่าง (5 คอลัมน์: [858, 4706, 2220, 5950, 1466] = 15200 dxa ตรงตามพิกัดพรีวิว)
  const boxBorders = `<w:tcBorders><w:top w:val="single" w:sz="12" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="12" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="12" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="12" w:space="0" w:color="000000"/></w:tcBorders>`;
  const noBorders = `<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>`;
  const sigWidths = [858, 4706, 2220, 5950, 1466];
  const sigGridXml = `<w:tblGrid>${sigWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;

  const sig = getRuntimeDocumentSignatories();
  const leftSigLine1 = "ลงชื่อ.................................ผู้จัดสอนแทน";
  const leftSigLine2 = formatParenSignatoryName(sig.plannerName);
  const leftSigLine3 = sig.plannerPosition;
  const rightSigLine1 = "ลงชื่อ.................................หัวหน้ากลุ่มบริหารวิชาการ";
  const rightSigLine2 = formatParenSignatoryName(sig.approverName);
  const rightSigLine3 = sig.approverPosition;
  const leftSigZ1 = measureFittedHalfPoints(leftSigLine1, 318 - 20, 21.3, "400");
  const leftSigZ2 = measureFittedHalfPoints(leftSigLine2, 318 - 20, 21.3, "400");
  const leftSigZ3 = measureFittedHalfPoints(leftSigLine3, 318 - 20, 21.3, "400");
  const rightSigZ1 = measureFittedHalfPoints(rightSigLine1, 402 - 20, 21.3, "400");
  const rightSigZ2 = measureFittedHalfPoints(rightSigLine2, 402 - 20, 21.3, "400");
  const rightSigZ3 = measureFittedHalfPoints(
    rightSigLine3,
    402 - 20,
    21.3,
    "400"
  );

  const sigTable = `<w:tbl><w:tblPr><w:tblW w:w="15200" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${noneTblBorders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>${sigGridXml}<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="1500" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${
    sigWidths[0]
  }" w:type="dxa"/>${noBorders}</w:tcPr>${P("", { z: 4 })}</w:tc><w:tc><w:tcPr><w:tcW w:w="${
    sigWidths[1]
  }" w:type="dxa"/>${boxBorders}<w:vAlign w:val="center"/></w:tcPr>${P(leftSigLine1, {
    c: 1,
    bBefore: 20,
    a: 60,
    z: leftSigZ1,
  })}${P(leftSigLine2, { c: 1, bBefore: 0, a: 60, z: leftSigZ2 })}${P(
    leftSigLine3,
    { c: 1, bBefore: 0, a: 20, z: leftSigZ3 }
  )}</w:tc><w:tc><w:tcPr><w:tcW w:w="${
    sigWidths[2]
  }" w:type="dxa"/>${noBorders}</w:tcPr>${P("", { z: 4 })}</w:tc><w:tc><w:tcPr><w:tcW w:w="${
    sigWidths[3]
  }" w:type="dxa"/>${boxBorders}<w:vAlign w:val="center"/></w:tcPr>${P(rightSigLine1, {
    c: 1,
    bBefore: 20,
    a: 60,
    z: rightSigZ1,
  })}${P(rightSigLine2, { c: 1, bBefore: 0, a: 60, z: rightSigZ2 })}${P(
    rightSigLine3,
    { c: 1, bBefore: 0, a: 20, z: rightSigZ3 }
  )}</w:tc><w:tc><w:tcPr><w:tcW w:w="${
    sigWidths[4]
  }" w:type="dxa"/>${noBorders}</w:tcPr>${P("", { z: 4 })}</w:tc></w:tr></w:tbl>`;

  let cumulativeRowOffset = 0;
  const pageXmlParts: string[] = [];

  chunks.forEach((pageChunk, pageIdx) => {
    const isLast = pageIdx === chunks.length - 1;
    const curDocId = docPrIdBase + pageIdx * 10;

    // หัวกระดาษ 5 คอลัมน์ไร้เส้นขอบ: จัดระยะห่างโลโก้ซ้าย (-249px / -3685 dxa จากกึ่งกลาง) และโลโก้ขวา (+266px / +3937 dxa จากกึ่งกลาง) ตามภาพต้นฉบับเป๊ะ
    const leftLogoDrawing = inlineImageXml(
      "rId1",
      curDocId + 1,
      838000,
      876000,
      `logo_left_${pageIdx}.png`
    );
    const rightLogoDrawing = hasRightLogo
      ? inlineImageXml("rId2", curDocId + 2, 805000, 800000, `logo_right_${pageIdx}.png`)
      : P("", { c: 1, z: 4 });

    // 5 คอลัมน์รวม 15200 dxa: คอลัมน์กลาง (4400 dxa) อยู่กึ่งกลางหน้าพอดี (7600 dxa), โลโก้ซ้ายกึ่งกลางที่ 4714 dxa (-195px), โลโก้ขวากึ่งกลางที่ 10619 dxa (+204px)
    const headerWidths = [4028, 1372, 4400, 1638, 3762];
    const headerGridXml = `<w:tblGrid>${headerWidths
      .map((w) => `<w:gridCol w:w="${w}"/>`)
      .join("")}</w:tblGrid>`;

    const rightHeaderSpacerContent =
      chunks.length > 1
        ? P(`(หน้าที่ ${pageIdx + 1}/${chunks.length})`, { j: "right", z: 24, a: 0 })
        : P("", { z: 4 });

    const headerTable = `<w:tbl><w:tblPr><w:tblW w:w="15200" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${noneTblBorders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>${headerGridXml}<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="1360" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${
      headerWidths[0]
    }" w:type="dxa"/>${noBorders}<w:vAlign w:val="top"/></w:tcPr>${P("", {
      z: 4,
    })}</w:tc><w:tc><w:tcPr><w:tcW w:w="${
      headerWidths[1]
    }" w:type="dxa"/>${noBorders}<w:vAlign w:val="center"/></w:tcPr>${leftLogoDrawing}</w:tc><w:tc><w:tcPr><w:tcW w:w="${
      headerWidths[2]
    }" w:type="dxa"/>${noBorders}<w:vAlign w:val="center"/></w:tcPr>${P(
      "แบบบันทึกการจัดสอนแทน",
      { c: 1, b: 1, z: 40, bBefore: 100, a: 160 }
    )}${P(monthYearTitle, { c: 1, b: 1, z: 32, bBefore: 0, a: 0 })}</w:tc><w:tc><w:tcPr><w:tcW w:w="${
      headerWidths[3]
    }" w:type="dxa"/>${noBorders}<w:vAlign w:val="center"/></w:tcPr>${rightLogoDrawing}</w:tc><w:tc><w:tcPr><w:tcW w:w="${
      headerWidths[4]
    }" w:type="dxa"/>${noBorders}<w:vAlign w:val="top"/></w:tcPr>${rightHeaderSpacerContent}</w:tc></w:tr></w:tbl>`;

    const headerRowHeightDxa = pageChunk.length > 10 ? 500 : pageChunk.length > 6 ? 540 : 580;
    const dataRowHeightDxa = pageChunk.length > 10 ? 480 : pageChunk.length > 6 ? 530 : 580;

    // แถวตาราง 10 คอลัมน์
    const tableHeaderRowXml = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/><w:trHeight w:val="${headerRowHeightDxa}" w:hRule="atLeast"/></w:trPr>${H.map(
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
        const rowNote = (row.note || noteStr).trim() || noteStr;
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
          rowNote,
        ];
        return `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${dataRowHeightDxa}" w:hRule="atLeast"/></w:trPr>${vals
          .map((v, i) => C(String(v), i))
          .join("")}</w:tr>`;
      })
      .join("");

    const tb = `<w:tbl><w:tblPr><w:tblW w:w="15200" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${bd}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:left w:w="50" w:type="dxa"/><w:right w:w="50" w:type="dxa"/></w:tblCellMar></w:tblPr>${gridXml}${tableHeaderRowXml}${dataRowsXml}</w:tbl>`;

    let pageXml = headerTable + spacerP(140) + tb;

    // หน้าสุดท้าย: ใส่กล่องลงนาม
    if (isLast) {
      const spacingBeforeSig =
        pageChunk.length > 10 ? 320 : pageChunk.length > 6 ? 520 : 680;
      pageXml += spacerP(spacingBeforeSig) + sigTable;
    }

    pageXmlParts.push(pageXml);
    cumulativeRowOffset += pageChunk.length;
  });

  return pageXmlParts.join(pageBreakXml);
}

async function generateMultiDocxBlob(sheets: SubstituteSheetData[]): Promise<Blob> {
  await ensureSarabunFontLoaded();

  const [leftLogoBase64, rightLogoBase64] = await Promise.all([
    loadImageToPngBase64(LEFT_SCHOOL_LOGO_URL, SCHOOL_LOGO, 600),
    loadImageToPngBase64(RIGHT_OBEC_LOGO_URL, undefined, 600),
  ]);
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
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>'
  );
  z.file(
    "_rels/.rels",
    X +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );

  const relsItems = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo_left.png"/>',
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
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
    "word/styles.xml",
    X +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="TH SarabunPSK" w:hAnsi="TH SarabunPSK" w:cs="TH SarabunPSK" w:eastAsia="TH SarabunPSK"/><w:sz w:val="32"/><w:szCs w:val="32"/><w:lang w:val="en-US" w:eastAsia="th-TH" w:bidi="th-TH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>'
  );
  z.file(
    "word/settings.xml",
    X +
      '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
  );
  z.file(
    "word/fontTable.xml",
    X +
      '<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:font w:name="TH SarabunPSK"><w:altName w:val="TH Sarabun New,TH Sarabun PSK,Sarabun"/><w:charset w:val="DE"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font><w:font w:name="TH Sarabun New"><w:altName w:val="TH SarabunPSK,Sarabun"/><w:charset w:val="DE"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font><w:font w:name="TH Sarabun PSK"><w:altName w:val="TH SarabunPSK,TH Sarabun New"/><w:charset w:val="DE"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font><w:font w:name="Sarabun"><w:charset w:val="DE"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font></w:fonts>'
  );
  z.file("word/media/logo_left.png", leftLogoBase64, { base64: true });
  if (hasRightLogo) {
    z.file("word/media/logo_right.png", rightLogoBase64, { base64: true });
  }

  z.file(
    "word/document.xml",
    X +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ${R} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="500" w:right="720" w:bottom="500" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`
  );

  return z.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
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

  // สำหรับรูปภาพ PNG ใช้ความละเอียด Ultra HD 4K (scale = 3.5 -> 3931 x 2779 px, ~336 DPI)
  // สำหรับ PDF ใช้ความละเอียดสูง 2.8x (3144 x 2223 px) + JPEG 0.95 เพื่อให้คมชัดแต่ขนาดไฟล์เล็กกะทัดรัด (~250-350 KB)
  const targetScale = format === "image" ? 3.5 : 2.8;
  const canvases = await renderPaperPagesToCanvases(
    absentTeacher,
    dateStr,
    reason,
    rows,
    targetScale
  );

  if (format === "image") {
    // ถ้ามีหน้าเดียว ให้ดาวน์โหลดรูปภาพไฟล์เดียวปกติ (PNG ความละเอียดสูง Ultra HD 4K)
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

  // ส่งออก PDF ขนาด A4 แนวนอน (297 x 210 mm) โดยบีบอัดด้วย JPEG คุณภาพสูง (0.95) + PDF stream compression
  // ช่วยลดขนาดไฟล์จาก ~10.7 MB เหลือเพียง ~250-350 KB ต่อหน้า โดยยังคมชัดระดับพิมพ์ใช้งานจริงและสร้างไฟล์เสร็จทันที
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  canvases.forEach((canvas, idx) => {
    if (idx > 0) {
      pdf.addPage("a4", "l");
    }
    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    pdf.addImage(imgData, "JPEG", 0, 0, 297, 210, undefined, "FAST");
  });
  const pdfBlob = pdf.output("blob");
  await triggerBrowserDownload(`${baseFilename}.pdf`, pdfBlob, "application/pdf");
}

/**
 * ดาวน์โหลดรูปภาพเฉพาะหน้าที่เลือก (หน้า 1 หรือ หน้า 2) ความละเอียด Ultra HD 4K (scale = 3.5)
 */
export async function exportSingleSubstitutePageImage(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[],
  pageIndex: number
): Promise<void> {
  const canvases = await renderPaperPagesToCanvases(
    absentTeacher,
    dateStr,
    reason,
    rows,
    3.5
  );
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

  const targetScale = format === "image" ? 3.5 : 2.8;
  const canvases: HTMLCanvasElement[] = [];
  for (const s of sheets) {
    const c = await renderPaperToCanvas(
      s.absentTeacher,
      s.dateStr,
      s.reason,
      s.rows,
      targetScale
    );
    canvases.push(c);
  }

  if (format === "pdf") {
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
      compress: true,
    });
    canvases.forEach((canvas, idx) => {
      if (idx > 0) pdf.addPage("a4", "l");
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pdfWidth = 297;
      const pdfHeight = (pdfWidth * canvas.height) / canvas.width;
      pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight, undefined, "FAST");
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
