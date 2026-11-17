// CHARACTERIZATION-ТЕСТЫ: src/sdk/yandex.js — адаптер SDK Яндекса.
// В Node нет window/YaGames — фиксируем standalone-поведение и разводку колбэков.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importSdkAdapter } from './helpers/globals.mjs';

const { YandexSDK } = await importSdkAdapter();

describe('YandexSDK.init: без window/YaGames — standalone', () => {
    it('init возвращает false и пишет info в консоль', async () => {
        const infos = [];
        const realInfo = console.info;
        console.info = (...a) => infos.push(a.join(' '));
        try {
            assert.equal(await YandexSDK.init(), false);
        } finally {
            console.info = realInfo;
        }
        assert.equal(YandexSDK.available, false);
        assert.equal(infos.length, 1);
        assert.equal(infos[0], '[YandexSDK] SDK не обнаружен — работа в standalone-режиме (localStorage).');
    });
});

describe('YandexSDK: save/load/gameplay/adv без SDK', () => {
    it('save -> false, load -> null (SDK недоступен)', async () => {
        assert.equal(await YandexSDK.save({ ore: 1 }), false);
        assert.equal(await YandexSDK.load(), null);
    });
    it('gameplayStart/gameplayStop — no-op без бросков', () => {
        YandexSDK.gameplayStart();
        YandexSDK.gameplayStop();
    });
    it('showFullscreenAdv без SDK сразу зовёт onClose(false); onError не зовётся', () => {
        let onCloseArg = 'не звали',
            onError = 'не звали',
            onOpen = 'не звали';
        YandexSDK.showFullscreenAdv({
            onClose: (wasShown) => {
                onCloseArg = wasShown;
            },
            onError: () => {
                onError = 'звали';
            },
            onOpen: () => {
                onOpen = 'звали';
            }
        });
        assert.equal(onCloseArg, false);
        assert.equal(onError, 'не звали');
        assert.equal(onOpen, 'не звали');
        // вообще без колбэков — тоже безопасно
        YandexSDK.showFullscreenAdv();
    });
    it('с фейковым SDK: колбэки пробрасываются в порядке контракта', async () => {
        const order = [];
        YandexSDK.available = true;
        YandexSDK.sdk = {
            features: { GameplayAPI: { start: () => order.push('start'), stop: () => order.push('stop') } },
            adv: {
                showFullscreenAdv: ({ callbacks }) => {
                    callbacks.onOpen();
                    callbacks.onClose(true);
                    callbacks.onError(new Error('net'));
                }
            }
        };
        YandexSDK.showFullscreenAdv({
            onOpen: () => order.push('cb:open'),
            onClose: (w) => order.push(`cb:close:${w}`),
            onError: () => order.push('cb:error')
        });
        assert.deepEqual(order, ['cb:open', 'cb:close:true', 'cb:error']);
        // gameplay API пробрасывается только при available
        YandexSDK.gameplayStart();
        YandexSDK.gameplayStop();
        assert.deepEqual(order, ['cb:open', 'cb:close:true', 'cb:error', 'start', 'stop']);
        // игрок не авторизован: save/load всё равно false/null (player null)
        assert.equal(await YandexSDK.save({}), false);
        assert.equal(await YandexSDK.load(), null);
        YandexSDK.available = false;
        YandexSDK.sdk = null;
    });
});
