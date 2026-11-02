import JSZip from "jszip";
import { jsPDF } from "jspdf";
import { SCHOOL_LOGO } from "../data/logo";
import { DAYS, TeacherRecord } from "../data/teachers";
import { SubstituteRow, formatThaiDate, getDayIndex } from "./scheduler";

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

async function triggerBrowserDownload(filename: string, blob: Blob): Promise<void> {
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
      // Fall back to standard browser anchor download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
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
  maxWidth: number
): string[] {
  const str = String(text || "");
  if (ctx.measureText(str).width <= maxWidth) {
    return [str];
  }
  // ลองตัดตามช่องว่างก่อน
  const words = str.split(" ");
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
  // กรณีไม่มีช่องว่าง ตัดตามความยาวตัวอักษร
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
 * วาดใบสอนแทนลงบน HTML5 Canvas 2D โดยตรงด้วยความละเอียดสูง (2x A4)
 * เพื่อให้เส้นตาราง คอลัมน์ และสระภาษาไทยคมชัดสมบูรณ์ 100% ไม่เพี้ยนจาก html2canvas
 */
export async function renderPaperToCanvas(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[]
): Promise<HTMLCanvasElement> {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

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

  const marginX = 52;
  const contentWidth = pageWidth - marginX * 2; // 690px
  const fontStack = "'Sarabun', 'TH Sarabun PSK', sans-serif";

  // 1. วาดตราโรงเรียนตรงกลางด้านบน
  let cursorY = 42;
  try {
    const logoImg = await loadImage(SCHOOL_LOGO);
    const logoH = 88;
    const logoW = (logoImg.naturalWidth / logoImg.naturalHeight) * logoH;
    ctx.drawImage(logoImg, (pageWidth - logoW) / 2, cursorY, logoW, logoH);
    cursorY += logoH + 24;
  } catch {
    cursorY += 90;
  }

  // 2. หัวกระดาษ
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  ctx.font = `700 24px ${fontStack}`;
  ctx.fillText("โรงเรียนวรคุณอุปถัมภ์", pageWidth / 2, cursorY);
  cursorY += 30;

  ctx.font = `700 18.5px ${fontStack}`;
  ctx.fillText(
    `ตารางสอนแทน ภาคเรียนที่ 2 ปีการศึกษา 2569 กลุ่ม/ฝ่าย/งาน ${absentTeacher.pdfGroup}`,
    pageWidth / 2,
    cursorY
  );
  cursorY += 36;

  // 3. ข้อมูลครูที่ลาและเหตุผล
  const d = getDayIndex(dateStr);
  const dayLabel = d >= 0 ? DAYS[d] : "-";

  ctx.textAlign = "left";
  ctx.font = `400 17px ${fontStack}`;
  ctx.fillText(
    `ครูผู้สอน ${absentTeacher.id} ${absentTeacher.n}     วัน${dayLabel}ที่ ${formatThaiDate(
      dateStr
    )}`,
    marginX,
    cursorY
  );
  cursorY += 26;

  ctx.fillText(
    `ไม่สามารถปฏิบัติการสอนได้เนื่องจาก ${reason || "-"} จึงมอบหมายให้สอนแทนดังนี้`,
    marginX,
    cursorY
  );
  cursorY += 18;

  // 4. วาดตาราง 8 คอลัมน์ (ผลรวมความกว้าง = 690px พอดี)
  const colWidths = [52, 96, 82, 46, 78, 166, 86, 84];
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
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "#000000";

  // พื้นหลังหัวตาราง
  ctx.fillStyle = "#e8edf7";
  ctx.fillRect(marginX, cursorY, contentWidth, headerHeight);

  // เส้นตารางและข้อความหัวตาราง
  let colX = marginX;
  ctx.font = `700 15.5px ${fontStack}`;
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < headers.length; i++) {
    const w = colWidths[i];
    ctx.strokeRect(colX, cursorY, w, headerHeight);
    ctx.fillText(headers[i], colX + w / 2, cursorY + headerHeight / 2 + 1);
    colX += w;
  }
  cursorY += headerHeight;

  // วาดแถวข้อมูลแต่ละคาบ
  ctx.font = `400 15.5px ${fontStack}`;
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

    // คำนวณการตัดบรรทัดของแต่ละช่อง
    const wrappedCells = cellValues.map((val, idx) =>
      wrapCanvasText(ctx, val, colWidths[idx] - 12)
    );
    const maxLines = Math.max(...wrappedCells.map((lines) => lines.length), 1);
    const rowHeight = Math.max(36, maxLines * 22 + 12);

    let x = marginX;
    for (let i = 0; i < cellValues.length; i++) {
      const w = colWidths[i];
      // วาดกรอบช่องตารางครบทั้ง 4 ด้าน
      ctx.strokeRect(x, cursorY, w, rowHeight);

      const lines = wrappedCells[i];
      const lineHeight = 21;
      const totalTextHeight = lines.length * lineHeight;
      const startY = cursorY + (rowHeight - totalTextHeight) / 2 + lineHeight / 2 + 1;

      if (i === 5) {
        // คอลัมน์ผู้สอนแทน จัดชิดซ้าย
        ctx.textAlign = "left";
        lines.forEach((line, lIdx) => {
          ctx.fillText(line, x + 7, startY + lIdx * lineHeight);
        });
      } else {
        // คอลัมน์อื่น จัดกึ่งกลาง
        ctx.textAlign = "center";
        lines.forEach((line, lIdx) => {
          ctx.fillText(line, x + w / 2, startY + lIdx * lineHeight);
        });
      }

      x += w;
    }

    cursorY += rowHeight;
  }

  // 5. ส่วนลงนามด้านล่าง (จัดแบบฟอร์มราชการมาตรฐาน 3 บรรทัด: ลงชื่อ / วงเล็บชื่อ / ตำแหน่ง)
  cursorY += 54;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `400 15.5px ${fontStack}`;

  const sigPositions = [
    marginX + 106,
    marginX + contentWidth / 2,
    marginX + contentWidth - 106,
  ];
  const sigTitles = [
    "ผู้สอนแทน",
    "ผู้ช่วยฯฝ่ายวิชาการ",
    "ผู้อำนวยการ",
  ];

  sigPositions.forEach((posX, idx) => {
    ctx.fillText("ลงชื่อ................................................", posX, cursorY);
    ctx.fillText("(................................................)", posX + 12, cursorY + 26);
    ctx.fillText(sigTitles[idx], posX + 6, cursorY + 52);
  });

  return canvas;
}

export async function generateDocxBlob(
  absentTeacher: TeacherRecord,
  dateStr: string,
  reason: string,
  rows: SubstituteRow[]
): Promise<Blob> {
  const d = getDayIndex(dateStr);
  const dayLabel = d >= 0 ? DAYS[d] : "-";
  const FN =
    '<w:rFonts w:ascii="TH Sarabun PSK" w:hAnsi="TH Sarabun PSK" w:cs="TH Sarabun PSK"/>';

  const P = (
    t: string,
    o: { a?: number; c?: boolean | number; j?: string; b?: boolean | number; z?: number } = {}
  ) =>
    `<w:p><w:pPr><w:spacing w:before="0" w:after="${o.a ?? 40}"/><w:jc w:val="${
      o.c ? "center" : o.j || "left"
    }"/></w:pPr><w:r><w:rPr>${FN}${o.b ? "<w:b/><w:bCs/>" : ""}<w:sz w:val="${
      o.z || 32
    }"/><w:szCs w:val="${o.z || 32}"/></w:rPr><w:t xml:space="preserve">${escapeXml(
      t
    )}</w:t></w:r></w:p>`;

  const W = [600, 1400, 1150, 650, 1100, 2400, 1100, 1800];
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

  const C = (t: string, i: number, b?: boolean | number) =>
    `<w:tc><w:tcPr><w:tcW w:w="${W[i]}" w:type="dxa"/>${
      b ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EDF7"/>' : ""
    }<w:vAlign w:val="center"/></w:tcPr>${P(t, {
      c: i !== 5,
      b,
      a: 0,
      z: 30,
    })}</w:tc>`;

  const bd = ["top", "left","bottom", "right", "insideH", "insideV"]
    .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
    .join("");

  const tb = `<w:tbl><w:tblPr><w:tblW w:w="10200" w:type="dxa"/><w:tblBorders>${bd}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tr>${H.map(
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
      "ลงชื่อ................................................",
      { c: 1, a: 20, z: 30 }
    )}${P("   (................................................)", {
      c: 1,
      a: 20,
      z: 30,
    })}${P(role, { c: 1, a: 0, z: 30 })}</w:tc>`;

  const sigTable = `<w:tbl><w:tblPr><w:tblW w:w="10200" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tr>${sigCell(
    "ผู้สอนแทน"
  )}${sigCell("ผู้ช่วยฯฝ่ายวิชาการ")}${sigCell("ผู้อำนวยการ")}</w:tr></w:tbl>`;

  const cx = 800000;
  const cy = Math.round((cx * 360) / 346);
  const lg = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="logo"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

  const body =
    lg +
    P("โรงเรียนวรคุณอุปถัมภ์", { c: 1, b: 1, z: 40 }) +
    P(
      `ตารางสอนแทน ภาคเรียนที่ 2 ปีการศึกษา 2569 กลุ่ม/ฝ่าย/งาน ${absentTeacher.pdfGroup}`,
      { c: 1, b: 1, z: 34, a: 160 }
    ) +
    P(
      `ครูผู้สอน ${absentTeacher.id} ${absentTeacher.n}    วัน${dayLabel}ที่ ${formatThaiDate(
        dateStr
      )}`
    ) +
    P(
      `ไม่สามารถปฏิบัติการสอนได้เนื่องจาก ${reason || "-"} จึงมอบหมายให้สอนแทนดังนี้`,
      { a: 120 }
    ) +
    tb +
    P("", { a: 320 }) +
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
    await triggerBrowserDownload(`${baseFilename}.docx`, blob);
    return;
  }

  // วาดลง Canvas 2D โดยตรงเพื่อให้ตารางและตัวอักษรคมชัดสมบูรณ์ ไม่เพี้ยน
  const canvas = await renderPaperToCanvas(absentTeacher, dateStr, reason, rows);

  if (format === "image") {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) throw new Error("ไม่สามารถสร้างไฟล์รูปภาพได้");
    await triggerBrowserDownload(`${baseFilename}.png`, blob);
    return;
  }

  const pdf = new jsPDF("p", "mm", "a4");
  const imgData = canvas.toDataURL("image/png");
  const pdfWidth = 210;
  const pdfHeight = (pdfWidth * canvas.height) / canvas.width;
  pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
  const pdfBlob = pdf.output("blob");
  await triggerBrowserDownload(`${baseFilename}.pdf`, pdfBlob);
}
