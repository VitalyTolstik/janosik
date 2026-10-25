import { deflateSync } from "node:zlib";
import type { Board } from "@janosik/shared";

/**
 * Deterministic OG preview image (TASK-58, §7.9.6) — a stylised "board
 * header" drawn straight into a PNG, with no headless browser and no image
 * dependency. Text is deliberately absent (rendering a Cyrillic font without
 * a dependency is not worth it): the picture shows the board's *shape* — its
 * columns, how full each one is, its accent brand — which is what a link
 * preview needs at a glance.
 *
 * The encoder is the minimum PNG: one IHDR (8-bit RGBA), one IDAT (zlib via
 * node's own `deflateSync`), one IEND, and a CRC32 for each chunk.
 */

const WIDTH = 1200;
const HEIGHT = 630;

/** Background gradient (top → bottom). */
const BG_TOP = { r: 15, g: 17, b: 23 };
const BG_BOTTOM = { r: 27, g: 29, b: 40 };
const COLUMN_BG = { r: 30, g: 33, b: 44 };
const COLUMN_HEAD = { r: 45, g: 49, b: 66 };
const CARD_BG = { r: 60, g: 66, b: 86 };
const CARD_DONE = { r: 76, g: 120, b: 96 };
const BRAND = { r: 124, g: 58, b: 237 };
const BRAND_SOFT = { r: 158, g: 118, b: 245 };

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** A tiny RGBA canvas with the handful of primitives this picture needs. */
class Canvas {
  private readonly pixels = Buffer.alloc(WIDTH * HEIGHT * 4, 0);

  private set(x: number, y: number, color: Color, alpha = 255): void {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const i = (y * WIDTH + x) * 4;
    const a = alpha / 255;
    const dst = this.pixels;
    dst[i] = Math.round((color.r * a + (dst[i] ?? 0) * (1 - a)) as number);
    dst[i + 1] = Math.round(
      (color.g * a + (dst[i + 1] ?? 0) * (1 - a)) as number,
    );
    dst[i + 2] = Math.round(
      (color.b * a + (dst[i + 2] ?? 0) * (1 - a)) as number,
    );
    dst[i + 3] = 255;
  }

  /** Solid axis-aligned rectangle. */
  rect(x: number, y: number, w: number, h: number, color: Color): void {
    for (let py = y; py < y + h; py += 1) {
      for (let px = x; px < x + w; px += 1) this.set(px, py, color);
    }
  }

  /** Rectangle with the four corners clipped (`r` px) — the soft kanban look. */
  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    color: Color,
  ): void {
    for (let py = y; py < y + h; py += 1) {
      for (let px = x; px < x + w; px += 1) {
        const dx =
          px < x + r ? x + r - px : px >= x + w - r ? px - (x + w - r - 1) : 0;
        const dy =
          py < y + r ? y + r - py : py >= y + h - r ? py - (y + h - r - 1) : 0;
        if (dx * dx + dy * dy > r * r) continue;
        this.set(px, py, color);
      }
    }
  }

  /** Vertical two-stop gradient fill of the whole frame. */
  gradient(top: Color, bottom: Color): void {
    for (let y = 0; y < HEIGHT; y += 1) {
      const t = y / (HEIGHT - 1);
      const color: Color = {
        r: Math.round(top.r + (bottom.r - top.r) * t),
        g: Math.round(top.g + (bottom.g - top.g) * t),
        b: Math.round(top.b + (bottom.b - top.b) * t),
      };
      this.rect(0, y, WIDTH, 1, color);
    }
  }

  toPng(): Buffer {
    const stride = WIDTH * 4;
    const raw = Buffer.alloc((stride + 1) * HEIGHT);
    for (let y = 0; y < HEIGHT; y += 1) {
      raw[y * (stride + 1)] = 0; // filter: none
      this.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(WIDTH, 0);
    ihdr.writeUInt32BE(HEIGHT, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type: RGBA
    ihdr[10] = 0; // deflate
    ihdr[11] = 0; // adaptive filtering
    ihdr[12] = 0; // no interlace
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    return Buffer.concat([
      signature,
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

interface Color {
  r: number;
  g: number;
  b: number;
}

function shade(color: Color, amount: number): Color {
  return {
    r: Math.max(0, Math.min(255, color.r + amount)),
    g: Math.max(0, Math.min(255, color.g + amount)),
    b: Math.max(0, Math.min(255, color.b + amount)),
  };
}

/**
 * Render the preview for a board: an accent header band and up to six
 * columns, each showing a header block plus one bar per card (cards in the
 * last column, i.e. "done", are tinted green). Deterministic — the same
 * board always yields the same bytes (the caller caches it).
 */
export function renderBoardPng(board: Board): Buffer {
  const canvas = new Canvas();
  canvas.gradient(BG_TOP, BG_BOTTOM);

  // Brand band across the top: a soft accent strip plus a solid brand block.
  canvas.rect(0, 0, WIDTH, 8, BRAND);
  canvas.roundRect(48, 40, 64, 64, 16, BRAND);
  canvas.roundRect(56, 48, 48, 48, 12, BRAND_SOFT);

  const columns = board.columns.slice(0, 6);
  const margin = 48;
  const gap = 24;
  const top = 150;
  const height = HEIGHT - top - margin;
  const count = Math.max(columns.length, 1);
  const colWidth = Math.floor((WIDTH - margin * 2 - gap * (count - 1)) / count);

  columns.forEach((column, index) => {
    const x = margin + index * (colWidth + gap);
    canvas.roundRect(x, top, colWidth, height, 18, COLUMN_BG);
    canvas.roundRect(x, top, colWidth, 44, 18, COLUMN_HEAD);
    canvas.rect(x, top + 22, colWidth, 22, COLUMN_HEAD);

    const cards = column.cardIds.slice(0, 9);
    const done = index === columns.length - 1;
    const innerTop = top + 60;
    const cardH = 30;
    cards.forEach((_, cardIndex) => {
      const cy = innerTop + cardIndex * (cardH + 12);
      if (cy + cardH > top + height - 12) return;
      canvas.roundRect(
        x + 14,
        cy,
        colWidth - 28,
        cardH,
        8,
        done ? CARD_DONE : CARD_BG,
      );
      // A short accent "label" chip at the left of each card bar.
      canvas.roundRect(
        x + 22,
        cy + 9,
        Math.min(46, colWidth - 60),
        12,
        6,
        shade(BRAND, (cardIndex % 3) * 8),
      );
    });
  });

  // Footer brand underline.
  canvas.rect(margin, HEIGHT - 26, 120, 6, BRAND);

  return canvas.toPng();
}
