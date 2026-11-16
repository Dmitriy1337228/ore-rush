// Минимальный PNG-декодер (только то, что нужно для pixel-diff golden-скриншотов):
// bitDepth 8, colorType 6 (RGBA) или 2 (RGB), без interlace. Без внешних зависимостей.
import zlib from 'node:zlib';

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

export function decodePng(buf) {
    if (buf.toString('ascii', 1, 4) !== 'PNG') throw new Error('не PNG');
    let off = 8,
        w = 0,
        h = 0,
        bitDepth = 0,
        colorType = 0;
    const idat = [];
    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            w = data.readUInt32BE(0);
            h = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            if (data[12] !== 0) throw new Error('interlaced PNG не поддерживается');
        } else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
        off += 12 + len;
    }
    if (bitDepth !== 8) throw new Error(`bitDepth ${bitDepth} не поддерживается`);
    if (colorType !== 6 && colorType !== 2) throw new Error(`colorType ${colorType} не поддерживается`);
    const bpp = colorType === 6 ? 4 : 3;
    const stride = w * bpp;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const out = Buffer.alloc(w * h * bpp);
    const zero = Buffer.alloc(stride);
    let p = 0;
    for (let y = 0; y < h; y++) {
        const f = raw[p++];
        const row = raw.subarray(p, p + stride);
        p += stride;
        const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : zero;
        const dst = out.subarray(y * stride, (y + 1) * stride);
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? dst[x - bpp] : 0;
            const b = prev[x];
            const c = x >= bpp ? prev[x - bpp] : 0;
            let v;
            switch (f) {
                case 0:
                    v = row[x];
                    break;
                case 1:
                    v = row[x] + a;
                    break;
                case 2:
                    v = row[x] + b;
                    break;
                case 3:
                    v = row[x] + ((a + b) >> 1);
                    break;
                case 4:
                    v = row[x] + paeth(a, b, c);
                    break;
                default:
                    throw new Error(`filter ${f} не поддерживается`);
            }
            dst[x] = v & 0xff;
        }
    }
    return { w, h, bpp, data: out };
}

// Доля пикселей, различающихся хотя бы одним каналом сильнее tolerance (0..255).
// Разные размеры -> ratio 1 (нарушение golden-геометрии).
export function diffRatio(a, b, tolerance = 0) {
    if (a.w !== b.w || a.h !== b.h) return 1;
    let diff = 0;
    const n = a.w * a.h;
    const A = a.data,
        B = b.data,
        bpp = a.bpp;
    for (let i = 0; i < n; i++) {
        const o = i * bpp;
        for (let ch = 0; ch < bpp; ch++) {
            if (Math.abs(A[o + ch] - B[o + ch]) > tolerance) {
                diff++;
                break;
            }
        }
    }
    return diff / n;
}
