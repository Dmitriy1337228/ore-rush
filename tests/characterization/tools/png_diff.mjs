// Разовая диагностика: pixel-diff между прогонами ui-review (выбирает пороги).
// Запуск: node tests/characterization/tools/png_diff.mjs <dirA> <dirB>
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, diffRatio } from '../helpers/png.mjs';

const a = process.argv[2], b = process.argv[3];
for (const f of fs.readdirSync(a).filter((x) => x.endsWith('.png')).sort()) {
    const A = decodePng(fs.readFileSync(path.join(a, f)));
    const B = decodePng(fs.readFileSync(path.join(b, f)));
    const r0 = diffRatio(A, B, 0);
    const r16 = diffRatio(A, B, 16);
    const r32 = diffRatio(A, B, 32);
    console.log(`${f.padEnd(30)} exact=${(r0 * 100).toFixed(3)}% tol16=${(r16 * 100).toFixed(3)}% tol32=${(r32 * 100).toFixed(3)}% ${A.w}x${A.h}`);
}
