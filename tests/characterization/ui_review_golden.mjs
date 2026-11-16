// CHARACTERIZATION-ТЕСТЫ UI: полный прогон scripts/ui-review.mjs как golden.
// Запуск: node tests/characterization/ui_review_golden.mjs  (или npm run test:ui)
// Требует Playwright-браузеры (npx playwright install chromium) и ~2-4 минуты.
//
// Golden-артефакты (tests/characterization/golden/ui/):
//  - run.stdout.txt  — stdout прогона (нормализован: CRLF->LF, таймер бафа -> #:#)
//  - console_errors.txt, layout_audit*.txt — байт-в-байт
//  - *.png — golden-скриншоты, сравнение pixel-diff с допуском (таблица ниже)
//  - exit code == golden exit code (0)
//
// Недетерминизм (замерено на этой машине, см. README):
//  - 02_clicks/03_buys — случайные всплывающие цифры/частицы в кадре: порог 10%
//  - 17_map_open — анимация прибытия в кадре: сравниваются только размеры
//  - 18_map_anim_skip — равномерный сдвиг оттенка: tolerance 16
// Пороги сняты приёмкой двух прогонов на одном коммите; при смене машины/браузера
// перегенерировать golden и переснять пороги.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeText } from './helpers/globals.mjs';
import { decodePng, diffRatio } from './helpers/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const GOLDEN_UI = path.join(HERE, 'golden', 'ui');

// [имя png]: [tolerance канала, максимальная доля различающихся пикселей], null = только размеры
const SHOT_THRESHOLDS = {
    '01_fresh.png': [32, 0.01],
    '02_clicks.png': [32, 0.1],
    '03_buys.png': [32, 0.1],
    '04_list_top.png': [32, 0.01],
    '05_list_scrolled.png': [32, 0.01],
    '05b_list_middle.png': [32, 0.01],
    '06_settings_modal.png': [32, 0.01],
    '07_offline_claimed.png': [32, 0.01],
    '07_offline_modal.png': [32, 0.01],
    '08_unlock_ready.png': [32, 0.01],
    '09_viewport_900.png': [32, 0.01],
    '10_deep_rows.png': [32, 0.01],
    '11_portrait.png': [32, 0.01],
    '12_portrait_modal.png': [32, 0.01],
    '12_settings_daily.png': [32, 0.01],
    '17_map_open.png': null, // недетерминирован пиксельно (FX прибытия в кадре)
    '18_map_anim_skip.png': [16, 0.01],
    '18b_map_closed_instant.png': [32, 0.01],
    '19_boss_fight.png': [32, 0.01],
    '20_boss_reward.png': [32, 0.01],
    '21_craft_open.png': [32, 0.01]
};

const AUDIT_FILES = [
    'layout_audit.txt',
    'layout_audit_seeded.txt',
    'layout_audit_modal.txt',
    'layout_audit_offline.txt',
    'layout_audit_deep.txt',
    'layout_audit_map_open.txt',
    'layout_audit_craft_open.txt',
    'layout_audit_portrait.txt',
    'layout_audit_portrait_modal.txt'
];

// Нормализация stdout: CRLF -> LF; countdown бафа «x2 9:57» -> «x2 #:#»
// (wall-clock таймер — законный недетерминизм прогона).
function normalizeStdout(s) {
    return normalizeText(s).replace(/hud buff "x2 \d+:\d+"/g, 'hud buff "x2 #:#"');
}

// Результат прогона живёт на уровне модуля: его читает и очистка tmp в process.on('exit')
let result;

describe('scripts/ui-review.mjs: полный golden-прогон (медленный)', { timeout: 480000 }, () => {
    it('прогон в песочнице OUT_DIR=tmp и код выхода как в golden', async () => {
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-review-golden-'));
        result = await new Promise((resolve) => {
            const child = spawn(process.execPath, ['scripts/ui-review.mjs'], {
                cwd: ROOT,
                env: { ...process.env, OUT_DIR: outDir },
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let stdout = '',
                stderr = '';
            child.stdout.on('data', (d) => {
                stdout += d;
            });
            child.stderr.on('data', (d) => {
                stderr += d;
            });
            child.on('close', (code) => resolve({ code, stdout, stderr, outDir }));
        });
        result.ok = result.code === 0;
        // golden exit code: 0
        assert.equal(
            result.code,
            0,
            `ui-review завершился с кодом ${result.code}\n--- stderr ---\n${result.stderr}\n--- stdout ---\n${result.stdout}`
        );
    });

    it('txt-артефакты байт-в-байт (console_errors + 9 layout_audit)', (t) => {
        if (!result.ok) {
            t.skip('прогон не удался');
        }

        for (const f of ['console_errors.txt', ...AUDIT_FILES]) {
            const got = normalizeText(fs.readFileSync(path.join(result.outDir, f), 'utf8'));
            const want = normalizeText(fs.readFileSync(path.join(GOLDEN_UI, f), 'utf8'));
            assert.equal(got, want, `файл ${f} отличается от golden`);
        }
    });

    it('stdout как в golden (с нормализацией таймера бафа)', (t) => {
        if (!result.ok) {
            t.skip('прогон не удался');
        }

        assert.equal(
            normalizeStdout(result.stdout),
            normalizeStdout(fs.readFileSync(path.join(GOLDEN_UI, 'run.stdout.txt'), 'utf8'))
        );
    });

    it('скриншоты: pixel-diff в допуске (или размеры для 17_map_open)', (t) => {
        if (!result.ok) {
            t.skip('прогон не удался');
        }

        const shots = Object.keys(SHOT_THRESHOLDS);
        assert.deepEqual(
            fs
                .readdirSync(result.outDir)
                .filter((f) => f.endsWith('.png'))
                .sort(),
            [...shots].sort(),
            'набор скриншотов изменился — обновите SHOT_THRESHOLDS и golden'
        );
        const problems = [];
        for (const shot of shots) {
            const goldenPath = path.join(GOLDEN_UI, shot);
            const gotPath = path.join(result.outDir, shot);
            if (!fs.existsSync(goldenPath)) {
                problems.push(`${shot}: нет golden`);
                continue;
            }

            const A = decodePng(fs.readFileSync(goldenPath));
            const B = decodePng(fs.readFileSync(gotPath));
            if (A.w !== B.w || A.h !== B.h) {
                problems.push(`${shot}: размер ${B.w}x${B.h} != golden ${A.w}x${A.h}`);
                continue;
            }

            const th = SHOT_THRESHOLDS[shot];
            if (!th) {
                continue;
            } // dims-only

            const [tol, maxRatio] = th;
            const ratio = diffRatio(A, B, tol);
            if (ratio > maxRatio) {
                problems.push(
                    `${shot}: diff ${(ratio * 100).toFixed(3)}% > допуск ${(maxRatio * 100).toFixed(1)}% (tol=${tol})`
                );
            }
        }

        assert.deepEqual(problems, []);
    });
});

// Уборка вне тестов: tmp-каталог прогона
process.on('exit', () => {
    if (result && result.outDir) {
        try {
            fs.rmSync(result.outDir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
    }
});
