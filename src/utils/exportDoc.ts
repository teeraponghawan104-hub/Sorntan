import JSZip from "jszip";
import { jsPDF } from "jspdf";
import { SCHOOL_LOGO } from "../data/logo";
import { DAYS, TeacherRecord } from "../data/teachers";
import { SubstituteRow, formatThaiDate, getDayIndex } from "./scheduler";

const THAI_FONT_SAMPLE =
  "โรงเรียนวรคุณอุปถัมภ์ตารางสอนแทนวิทยาศาสตร์คณิตศาสตร์ภาษาต่างประเทศ0123456789";

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
      // หากผู้ใช้กดยกเลิกหน้าต่างแชร์ ไม่ต้องแจ้งเตือนเป็นข้อผิดพลาด
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
  // ตัดตามช่องว่างระหว่างคำ (เช่น ชื่อ นามสกุล หรือวงเล็บ) เพื่อไม่ให้ฉีกคำภาษาไทยกลางคำ
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
 * สำคัญมาก: ต้องส่งข้อความภาษาไทยเป็นพารามิเตอร์ที่ 2 ของ document.fonts.load()
 * มิฉะนั้น iOS Safari จะโหลดเฉพาะชุดตัวอักษรภาษาอังกฤษ (Latin) แล้วใช้ฟอนต์ระบบวาดภาษาไทยจนเพี้ยน
 */
export async function ensureSarabunFontLoaded(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load("400 14px 'Sarabun'", THAI_FONT_SAMPLE),
      document.fonts.load("600 14px 'Sarabun'", THAI_FONT_SAMPLE),
      document.fonts.load("700 14px 'Sarabun'", THAI_FONT_SAMPLE),
      document.fonts.load("400 17px 'Sarabun'", THAI_SAMPLE_SHORT),
      document.fonts.load("700 18.5px 'Sarabun'", THAI_SAMPLE_SHORT),
      document.fonts.load("700 24px 'Sarabun'", THAI_SAMPLE_SHORT),
    ]);
    await document.fonts.ready;

    // รอให้ WebKit ยืนยันว่าฟอนต์ภาษาไทยพร้อมใช้งานจริง (สูงสุด 1.2 วินาที)
    for (let attempt = 0; attempt < 12; attempt++) {
      if (document.fonts.check("400 14px 'Sarabun'", "โรงเรียนวรคุณอุปถัมภ์")) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch {
    // Proceed if font loading API is restricted
  }
}

const THAI_SAMPLE_SHORT = "โรงเรียนวรคุณอุปถัมภ์ 2569";

/**
 * วาดข้อความ 1 บรรทัดโดยลดขนาดฟอนต์ลงทีละ 0.5px หากกว้างเกินช่อง
 * ห้ามส่งพารามิเตอร์ที่ 4 (maxWidth) เข้า ctx.fillText(text, x, y) เด็ดขาด
 * เพราะ iOS WebKit มีบั๊กบีบสระและวรรณยุกต์ภาษาไทยจนเบี้ยวเมื่อระบุ maxWidth ใน fillText
 */
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

/**
 * วาดใบสอนแทนลงบน HTML5 Canvas 2D โดยตรงด้วยความละเอียดสูง (2x A4 = 1588x2246 px)
 * ออกแบบมาให้เรนเดอร์เหมือนกัน 100% ทั้งบน iOS (Safari / Messenger WebView), Android และ PC
 */
export async function renderPaperToCanvas(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[]
): Promise<HTMLCanvasElement> {
  await ensureSarabunFontLoaded();

  const scale = 2;
  const pageWidth = 794;
  const pageHeight = 1123;

  const canvas = document.createElement("canvas");
  canvas.width = pageWidth * scale;
  canvas.height = pageHeight * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("ไม่สามารถสร้าง Canvas 2D สำหรับวาดเอกสารได้");
  }

  ctx.scale(scale, scale);

  // พื้นหลังสีขาว A4
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pageWidth, pageHeight);

  const marginX = 44;
  const contentWidth = pageWidth - marginX * 2; // 706px
  const fontStack = "'Sarabun', sans-serif";

  // ใช้ textBaseline = "alphabetic" เสมอ เพื่อป้องกันบั๊ก textBaseline="middle" ของ iOS WebKit ที่ทำให้สระไทยลอยหรือจม
  ctx.textBaseline = "alphabetic";

  // 1. วาดตราโรงเรียนตรงกลางด้านบน
  let cursorY = 40;
  try {
    const logoImg = await loadImage(SCHOOL_LOGO);
    const logoH = 86;
    const logoW = (logoImg.naturalWidth / logoImg.naturalHeight) * logoH;
    ctx.drawImage(logoImg, (pageWidth - logoW) / 2, cursorY, logoW, logoH);
    cursorY += logoH + 26;
  } catch {
    cursorY += 90;
  }

  // 2. หัวกระดาษ
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";

  drawFittedCellLine(
    ctx,
    "โรงเรียนวรคุณอุปถัมภ์",
    pageWidth / 2,
    cursorY,
    contentWidth,
    23,
    "700",
    fontStack
  );
  cursorY += 30;

  drawFittedCellLine(
    ctx,
    `ตารางสอนแทน ภาคเรียนที่ 2 ปีการศึกษา 2569 กลุ่ม/ฝ่าย/งาน ${absentTeacher.pdfGroup}`,
    pageWidth / 2,
    cursorY,
    contentWidth,
    18,
    "700",
    fontStack
  );
  cursorY += 34;

  // 3. ข้อมูลครูที่ลาและเหตุผล
  const d = getDayIndex(dateStr);
  const dayLabel = d >= 0 ? DAYS[d] : "-";

  ctx.textAlign = "left";
  drawFittedCellLine(
    ctx,
    `ครูผู้สอน ${absentTeacher.id} ${absentTeacher.n}     วัน${dayLabel}ที่ ${formatThaiDate(
      dateStr
    )}`,
    marginX,
    cursorY,
    contentWidth,
    16.5,
    "400",
    fontStack
  );
  cursorY += 26;

  drawFittedCellLine(
    ctx,
    `ไม่สามารถปฏิบัติการสอนได้เนื่องจาก ${reason || "-"} จึงมอบหมายให้สอนแทนดังนี้`,
    marginX,
    cursorY,
    contentWidth,
    16.5,
    "400",
    fontStack
  );
  cursorY += 18;

  // 4. วาดตาราง 8 คอลัมน์ (ผลรวมความกว้าง = 706px พอดี)
  // [คาบที่ 48, เวลา 100, รหัสวิชา 74, ชั้น 44, ห้องเรียน 68, ผู้สอนแทน 188, กลุ่มสาระ 106, ลายมือชื่อ 78]
  const colWidths = [48, 100, 74, 44, 68, 188, 106, 78];
  const headers = [
    "คาบที่",
    "เวลา",
    "รหัสวิชา",
    "ชั้น",
    "ห้องเรียน",
    "ผู้สอนแทน",
    "กลุ่มสาระ",
    "ลายมือชื่อ",
  ];

  const headerHeight = 38;
  ctx.lineWidth = 1.15;
  ctx.strokeStyle = "#000000";

  // พื้นหลังหัวตาราง
  ctx.fillStyle = "#e8edf7";
  ctx.fillRect(marginX, cursorY, contentWidth, headerHeight);

  // เส้นตารางและข้อความหัวตาราง (คำนวณจุดกึ่งกลางแนวตั้งด้วย alphabetic baseline + 5px)
  let colX = marginX;
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";

  for (let i = 0; i < headers.length; i++) {
    const w = colWidths[i];
    ctx.strokeRect(colX, cursorY, w, headerHeight);
    drawFittedCellLine(
      ctx,
      headers[i],
      colX + w / 2,
      cursorY + headerHeight / 2 + 5,
      w - 8,
      14,
      "700",
      fontStack
    );
    colX += w;
  }
  cursorY += headerHeight;

  // วาดแถวข้อมูลแต่ละคาบ
  for (const row of rows) {
    const cellValues = [
      String(row.p),
      row.tm,
      row.code,
      row.cls,
      row.room,
      row.n,
      row.g,
      "",
    ];

    const cellFontSize = 13.5;
    ctx.font = `400 ${cellFontSize}px ${fontStack}`;

    // เฉพาะคอลัมน์ผู้สอนแทน (index 5) ที่อนุญาตให้ตัดบรรทัดตามเว้นวรรคหากชื่อยาวมาก
    const wrappedCells = cellValues.map((val, idx) =>
      idx === 5 ? wrapCanvasText(ctx, val, colWidths[idx] - 16, false) : [val]
    );
    const maxLines = Math.max(...wrappedCells.map((lines) => lines.length), 1);
    const lineHeight = 20;
    const rowHeight = Math.max(38, maxLines * lineHeight + 16);

    let x = marginX;
    for (let i = 0; i < cellValues.length; i++) {
      const w = colWidths[i];
      ctx.strokeRect(x, cursorY, w, rowHeight);

      const lines = wrappedCells[i];
      const blockHeight = (lines.length - 1) * lineHeight;
      // จุดกึ่งกลางแนวตั้งสำหรับ alphabetic baseline
      const firstLineBaselineY = cursorY + rowHeight / 2 - blockHeight / 2 + 4.8;

      if (i === 5) {
        ctx.textAlign = "left";
        lines.forEach((line, lIdx) => {
          drawFittedCellLine(
            ctx,
            line,
            x + 8,
            firstLineBaselineY + lIdx * lineHeight,
            w - 16,
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

  // 5. ส่วนลงนามด้านล่าง (แบ่ง 3 คอลัมน์เท่าๆ กัน ไม่เบียดกันบน iOS)
  cursorY += 54;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const sigColWidth = contentWidth / 3; // 235.33px ต่อคอลัมน์
  const sigTitles = ["ผู้สอนแทน", "ผู้ช่วยฯฝ่ายวิชาการ", "ผู้อำนวยการ"];

  sigTitles.forEach((title, idx) => {
    const centerX = marginX + sigColWidth * (idx + 0.5);
    drawFittedCellLine(
      ctx,
      "ลงชื่อ........................................",
      centerX,
      cursorY,
      sigColWidth - 16,
      14.5,
      "400",
      fontStack
    );
    drawFittedCellLine(
      ctx,
      "(........................................)",
      centerX + 8,
      cursorY + 25,
      sigColWidth - 16,
      14.5,
      "400",
      fontStack
    );
    drawFittedCellLine(
      ctx,
      title,
      centerX + 4,
      cursorY + 50,
      sigColWidth - 16,
      14.5,
      "400",
      fontStack
    );
  });

  return canvas;
}

/**
 * สร้างไฟล์ Word (.docx) ที่รองรับทั้งการเปิดบน iOS (Pages / QuickLook / Word Mobile) และ PC
 * - กำหนดขนาดฟอนต์มาตรฐานสากล (11pt / 10.5pt สำหรับตาราง) และตั้งค่า <w:noWrap/> ในคอลัมน์สั้น
 *   เพื่อไม่ให้ตัวอักษรล้นหรือตารางพังเมื่อเปิดบน iPhone/iPad ที่ไม่มีฟอนต์ TH Sarabun PSK
 */
export async function generateDocxBlob(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[]
): Promise<Blob> {
  const d = getDayIndex(dateStr);
  const dayLabel = d >= 0 ? DAYS[d] : "-";
  const FN =
    '<w:rFonts w:ascii="Sarabun" w:hAnsi="Sarabun" w:cs="TH Sarabun New" w:eastAsia="Sarabun"/>';

  const P = (
    t: string,
    o: { a?: number; c?: boolean | number; j?: string; b?: boolean | number; z?: number } = {}
  ) =>
    `<w:p><w:pPr><w:spacing w:before="0" w:after="${o.a ?? 40}"/><w:jc w:val="${
      o.c ? "center" : o.j || "left"
    }"/></w:pPr><w:r><w:rPr>${FN}${o.b ? "<w:b/><w:bCs/>" : ""}<w:sz w:val="${
      o.z || 24
    }"/><w:szCs w:val="${o.z || 24}"/></w:rPr><w:t xml:space="preserve">${escapeXml(
      t
    )}</w:t></w:r></w:p>`;

  // ความกว้างรวม 10200 dxa (พอดีกระดาษ A4 แนวตั้ง)
  const W = [700, 1480, 1080, 640, 980, 2680, 1520, 1120];
  const H = [
    "คาบที่",
    "เวลา",
    "รหัสวิชา",
    "ชั้น",
    "ห้องเรียน",
    "ผู้สอนแทน",
    "กลุ่มสาระ",
    "ลายมือชื่อ",
  ];

  const C = (t: string, i: number, b?: boolean | number) => {
    // ห้ามตัดคำตกบรรทัดสำหรับคอลัมน์สั้น (คาบที่, เวลา, รหัสวิชา, ชั้น, ห้องเรียน, กลุ่มสาระ)
    const noWrap = i !== 5 ? "<w:noWrap/>" : "";
    return `<w:tc><w:tcPr><w:tcW w:w="${W[i]}" w:type="dxa"/>${noWrap}${
      b ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EDF7"/>' : ""
    }<w:vAlign w:val="center"/></w:tcPr>${P(t, {
      c: i !== 5,
      b,
      a: 0,
      z: b ? 21 : 20, // 10.5pt สำหรับหัวตาราง, 10pt สำหรับข้อมูลตาราง (ไม่ล้นบน iOS QuickLook / Word Mobile)
    })}</w:tc>`;
  };

  const bd = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
    .join("");

  const tb = `<w:tbl><w:tblPr><w:tblW w:w="10200" w:type="dxa"/><w:tblBorders>${bd}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tr>${H.map(
    (h, i) => C(h, i, 1)
  ).join("")}</w:tr>${rows
    .map(
      (x) =>
        `<w:tr>${[x.p, x.tm, x.code, x.cls, x.room, x.n, x.g, ""]
          .map((v, i) => C(String(v), i))
          .join("")}</w:tr>`
    )
    .join("")}</w:tbl>`;

  const sigCell = (role: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="3400" w:type="dxa"/></w:tcPr>${P(
      "ลงชื่อ........................................",
      { c: 1, a: 20, z: 22 }
    )}${P("(........................................)", {
      c: 1,
      a: 20,
      z: 22,
    })}${P(role, { c: 1, a: 0, z: 22 })}</w:tc>`;

  const sigTable = `<w:tbl><w:tblPr><w:tblW w:w="10200" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tr>${sigCell(
    "ผู้สอนแทน"
  )}${sigCell("ผู้ช่วยฯฝ่ายวิชาการ")}${sigCell("ผู้อำนวยการ")}</w:tr></w:tbl>`;

  const cx = 800000;
  const cy = Math.round((cx * 360) / 346);
  const lg = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="logo"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

  const body =
    lg +
    P("โรงเรียนวรคุณอุปถัมภ์", { c: 1, b: 1, z: 32 }) +
    P(
      `ตารางสอนแทน ภาคเรียนที่ 2 ปีการศึกษา 2569 กลุ่ม/ฝ่าย/งาน ${absentTeacher.pdfGroup}`,
      { c: 1, b: 1, z: 26, a: 140 }
    ) +
    P(
      `ครูผู้สอน ${absentTeacher.id} ${absentTeacher.n}    วัน${dayLabel}ที่ ${formatThaiDate(
        dateStr
      )}`,
      { z: 23 }
    ) +
    P(
      `ไม่สามารถปฏิบัติการสอนได้เนื่องจาก ${reason || "-"} จึงมอบหมายให้สอนแทนดังนี้`,
      { a: 120, z: 23 }
    ) +
    tb +
    P("", { a: 280 }) +
    sigTable;

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
  z.file(
    "word/_rels/document.xml.rels",
    X +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/></Relationships>'
  );
  z.file("word/media/logo.png", SCHOOL_LOGO.split(",")[1], { base64: true });
  z.file(
    "word/document.xml",
    X +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ${R} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr></w:body></w:document>`
  );

  return z.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export async function exportSubstituteDocument(
  format: "word" | "pdf" | "image",
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[],
  _paperElement: HTMLElement | null
): Promise<void> {
  const baseFilename = `ใบสอนแทน_${absentTeacher.id}_${dateStr}`;

  if (format === "word") {
    const blob = await generateDocxBlob(absentTeacher, dateStr, reason, rows);
    await triggerBrowserDownload(
      `${baseFilename}.docx`,
      blob,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    return;
  }

  // วาดลง Canvas 2D โดยตรงเพื่อให้ตารางและตัวอักษรคมชัดสมบูรณ์ ไม่เพี้ยนทุกเครื่อง
  const canvas = await renderPaperToCanvas(absentTeacher, dateStr, reason, rows);

  if (format === "image") {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) throw new Error("ไม่สามารถสร้างไฟล์รูปภาพได้");
    await triggerBrowserDownload(`${baseFilename}.png`, blob, "image/png");
    return;
  }

  const pdf = new jsPDF("p", "mm", "a4");
  const imgData = canvas.toDataURL("image/png");
  const pdfWidth = 210;
  const pdfHeight = (pdfWidth * canvas.height) / canvas.width;
  pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
  const pdfBlob = pdf.output("blob");
  await triggerBrowserDownload(`${baseFilename}.pdf`, pdfBlob, "application/pdf");
}
