// Вес прод-бандла: gzip всех dist/assets/*.js и *.css единым методом (zlib, уровень 9).
// Нужен, чтобы этапные сравнения были честными: Vite-репорт округляет и считает по-своему,
// а итоговые числа (W2) должны сниматься одним скриптом (ревью фазы 2, nit 3).
//
// Запуск: npm run metrics:gzip [-- --level 9] [--json]
// Требует собранный dist: npm run build.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
const opt = (n, d) => {
    const i = argv.indexOf(`--${n}`);

    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const LEVEL = Math.min(9, Math.max(1, Number(opt('level', 9))));
const DIR = path.resolve('dist/assets');

if (!fs.existsSync(DIR)) {
    console.error('metrics:gzip: нет dist/assets — сначала npm run build');
    process.exit(1);
}

const files = fs
    .readdirSync(DIR)
    .filter((n) => /\.(js|css)$/.test(n))
    .sort();

const rows = files.map((name) => {
    const buf = fs.readFileSync(path.join(DIR, name));
    const gz = zlib.gzipSync(buf, { level: LEVEL }).length;

    return { file: name, raw: buf.length, gzip: gz };
});

const total = rows.reduce((s, r) => s + r.gzip, 0);
const json = {
    method: `zlib gzipSync level ${LEVEL}`,
    dir: path.relative(process.cwd(), DIR),
    files: rows,
    totalGzipBytes: total,
    totalGzipKb: Number((total / 1024).toFixed(2))
};

if (argv.includes('--json')) {
    console.log(JSON.stringify(json, null, 2));
} else {
    console.log(`Вес бандла (${json.method}), ${json.dir}\n`);
    for (const r of rows) {
        console.log(`  ${String((r.gzip / 1024).toFixed(2)).padStart(8)} КБ  ${r.file}`);
    }

    console.log(`\nИтого JS+CSS: ${json.totalGzipKb} КБ gzip (${rows.length} файлов)`);
}
