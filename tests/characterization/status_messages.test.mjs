// Тексты статус-модалок (docs/dom-phase3/UI_DOM_PHASE3_PLAN.md, 1.1): единственный источник
// для DOM и Phaser-пути; проверяем формулировки, склонения и ветви наград.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    bossRewardBounty,
    bossRewardSpeed,
    dailyDesc,
    dailyStreak,
    offlineBody,
    playerDownBody,
    statusButtons,
    statusTitles
} from '../../src/state/statusMessages.js';

describe('statusMessages: заголовки и кнопки', () => {
    it('четыре статус-окна подписаны как в Phaser', () => {
        assert.deepEqual(statusTitles, {
            offline: 'С возвращением!',
            daily: 'Ежедневная награда',
            'boss-reward': 'Босс повержен!',
            'player-down': 'Ты вырубился!'
        });
        assert.equal(statusButtons.offline, 'Забрать');
        assert.equal(statusButtons.daily, 'Отлично!');
        assert.equal(statusButtons['boss-reward'], 'Забрать');
        assert.equal(statusButtons['player-down'], 'В шахту');
    });
});

describe('statusMessages: офлайн', () => {
    it('пять строк с рудой, фоном, лимитом и учтённым временем', () => {
        const text = offlineBody({
            seconds: 7200,
            reward: 1200,
            tierName: 'Медь',
            ratePct: 28,
            orePerSec: 12,
            capHours: 4,
            counted: 3600
        });
        const lines = text.split('\n');
        assert.equal(lines.length, 5);
        assert.equal(lines[0], 'Пока вас не было (2 ч),');
        assert.equal(lines[1], 'шахтёры добыли 1200 медь');
        assert.equal(lines[2], '');
        assert.equal(lines[3], 'фоновая добыча: 28% · 12 руды/сек');
        assert.equal(lines[4], 'лимит склада: 4 ч · учтено 1 ч');
    });
});

describe('statusMessages: ежедневная', () => {
    it('склонение серии', () => {
        assert.equal(dailyStreak(1), 'Серия: 1 день');
        assert.equal(dailyStreak(3), 'Серия: 3 дня');
        assert.equal(dailyStreak(7), 'Серия: 7 дней');
    });

    it('описание награды и конкретика дня', () => {
        const reward = { desc: 'x2 к скорости' };
        assert.equal(dailyDesc(reward), 'x2 к скорости');
        assert.equal(dailyDesc(reward, { extra: 1234 }), 'x2 к скорости\n+1234 руды');
        assert.equal(dailyDesc(reward, { extra: { name: 'Кирка' } }), 'x2 к скорости\nулучшение: Кирка');
    });
});

describe('statusMessages: награда босса', () => {
    it('баунти и бонус за скорость', () => {
        assert.equal(bossRewardBounty(5000), 'Баунти: +5000 руды');
        assert.equal(bossRewardSpeed({ elapsedSec: 32, speedMult: 1.5 }), 'Время: 0:32 · бонус x1.5');
        assert.equal(bossRewardSpeed({ elapsedSec: 60, speedMult: 1 }), 'Время: 1:00 · бонус x1');
        assert.equal(bossRewardSpeed({}), null);
    });
});

describe('statusMessages: вырубление', () => {
    it('пять строк с ударом и живучестью', () => {
        const lines = playerDownBody({ bossName: 'Медный голем', dmg: 123456789, maxPlayer: 987654321 }).split('\n');
        assert.equal(lines.length, 5);
        assert.equal(lines[0], 'Медный голем отбросил тебя в шахту.');
        assert.equal(lines[2], 'Удар босса: 123M · живучесть: 988M');
        assert.match(lines[4], /^докупи бомбы/);
    });
});
