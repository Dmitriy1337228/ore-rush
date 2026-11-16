// CHARACTERIZATION-ТЕСТЫ: scripts/balance-sim.mjs — CLI как точка входа.
// Прогон детерминирован (нет Math.random/Date-ветвлений на пути симуляции:
// расчётные матожидания кликов, resetGame на старте каждого режима).
// Golden-файлы перегенерируются ТОЛЬКО при намеренном изменении поведения.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeText } from './helpers/globals.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

function runSim(args) {
    return execFileSync(process.execPath, ['scripts/balance-sim.mjs', ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120000
    });
}

function golden(name) {
    return normalizeText(fs.readFileSync(path.join(HERE, 'golden', name), 'utf8'));
}

describe('scripts/balance-sim.mjs: CLI golden', () => {
    it('дефолтные аргументы (cps 3.5, 60ч): stdout как в golden', () => {
        const out = normalizeText(runSim([]));
        assert.equal(out, golden('balance-sim_default.out'));
    });
    it('аргументы "2 30": stdout как в golden', () => {
        const out = normalizeText(runSim(['2', '30']));
        assert.equal(out, golden('balance-sim_cps2_h30.out'));
    });
    it('код выхода 0 при PASS гейта артефактов (в обоих прогонах)', () => {
        assert.doesNotThrow(() => runSim([]));
    });
});
