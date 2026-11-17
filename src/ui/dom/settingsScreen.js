// DOM-форма «Настройки» (docs/UI_DOM_PHASE2_PLAN.md, этап 2): единственная точка записи —
// src/state/settings.js; тексты — src/state/settingsMessages.js; данные — bridge.settingsSnapshot.
// Каркас модалки — modal.js, блокировка — lock.js (общие для форм).
import { html, toNode } from './html.js';
import { modal, modalHost } from './modal.js';
import { setFormOpen, syncBlockLock } from './lock.js';
import { ensureUiRoot } from './root.js';
import { settingsSnapshot } from './bridge.js';
import { rangeInput } from './components.js';
import { doPrestige, resetGame } from '../../state.js';
import { commitSettings, setMusicOn, setMusicVolume, setSoundOn } from '../../state/settings.js';
import {
    prestigeArmed,
    prestigeIdle,
    resetArmed,
    resetIdle,
    resetSectionTitle,
    settingsTitle,
    volumeLabel
} from '../../state/settingsMessages.js';
import { EVENTS, REG } from '../shared/theme.js';
import { playSfx } from '../../sfx.js';

const VOLUME_STEP = 1; // слайдер в процентах: 0..100

export function createDomSettings(scene) {
    let root = document.getElementById('ui-root');
    if (!root) {
        root = ensureUiRoot(scene.game).root;
    }

    const host = modalHost(root);
    const layer = toNode(
        modal({
            kind: 'settings',
            formId: 'settings',
            title: settingsTitle,
            children: html`<div class="dom-settings">
                <div class="dom-block" data-form-id="stats">
                    ${[0, 1, 2, 3, 4].map(() => html`<div class="dom-line" data-line></div>`)}
                </div>
                <div class="dom-toggle-row">
                    <button class="dom-toggle" type="button" data-act="sound" data-form-id="sound">Звук</button>
                    <button class="dom-toggle" type="button" data-act="music" data-form-id="music">Музыка</button>
                </div>
                ${rangeInput({
                    id: 'music-volume',
                    label: volumeLabel,
                    value: 50,
                    min: 0,
                    max: 100,
                    step: VOLUME_STEP,
                    valueText: '50%'
                })}
                <div class="dom-section">${resetSectionTitle}</div>
                <div class="dom-line" data-ref="prestige1"></div>
                <div class="dom-line" data-ref="prestige2"></div>
            </div>`,
            actions: [
                html`<button class="dom-btn" type="button" data-act="prestige" data-form-id="prestige">${prestigeIdle}</button>`,
                html`<button class="dom-btn" type="button" data-act="reset" data-form-id="reset">${resetIdle}</button>`
            ]
        })
    );
    layer.hidden = true;
    host.appendChild(layer);

    const panel = layer.querySelector('[data-dom-modal]');
    const stats = Array.from(layer.querySelectorAll('[data-line]'));
    const soundBtn = layer.querySelector('[data-act="sound"]');
    const musicBtn = layer.querySelector('[data-act="music"]');
    const range = layer.querySelector('[data-range="music-volume"]');
    const volumeValue = layer.querySelector('.dom-range-value');
    const prestigeBtn = layer.querySelector('[data-act="prestige"]');
    const resetBtn = layer.querySelector('[data-act="reset"]');
    const prestigeLines = [
        layer.querySelector('[data-ref="prestige1"]'),
        layer.querySelector('[data-ref="prestige2"]')
    ];

    let open = false;
    let hiddenForOverlay = false;
    let lastSig = '';
    let lastAt = 0;
    let prestigeStep = false;
    let resetStep = false;

    const isBossLocked = () => !!scene.registry.get(REG.bossActive);
    const portrait = () => root.classList.contains('portrait');

    function snapshot() {
        return settingsSnapshot({ bossActive: isBossLocked(), portrait: portrait() });
    }

    function apply(snap) {
        stats.forEach((el, i) => {
            el.textContent = snap.stats[i] || '';
        });
        soundBtn.textContent = snap.labels.sound;
        soundBtn.dataset.on = snap.soundOn ? '1' : '0';
        musicBtn.textContent = snap.labels.music;
        musicBtn.dataset.on = snap.musicOn ? '1' : '0';
        if (document.activeElement !== range) {
            range.value = String(Math.round(snap.musicVolume * 100));
        }

        volumeValue.textContent = snap.volumeText;
        prestigeLines[0].textContent = snap.prestigeLines[0];
        prestigeLines[1].textContent = snap.prestigeLines[1];
        prestigeBtn.textContent = prestigeStep ? prestigeArmed(snap.gain) : prestigeIdle;
        resetBtn.textContent = resetStep ? resetArmed : resetIdle;
        const dimPrestige = isBossLocked() || !snap.canPrestige;
        prestigeBtn.classList.toggle('is-disabled', dimPrestige && !prestigeStep);
        resetBtn.classList.toggle('is-disabled', isBossLocked() && !resetStep);
    }

    function refresh(force = false) {
        const now = Date.now();
        if (!force && now - lastAt < 100) {
            return;
        }

        lastAt = now;
        const snap = snapshot();
        const sig = JSON.stringify(snap);
        if (!force && sig === lastSig) {
            return;
        }

        lastSig = sig;
        apply(snap);
    }

    function show() {
        layer.hidden = false;
        hiddenForOverlay = false;
        open = true;
        setFormOpen(scene, '_settingsOpen', true);
        window.addEventListener('keydown', onKeyDown);
        refresh(true);
    }

    function hide() {
        layer.hidden = true;
        open = false;
        hiddenForOverlay = false;
        prestigeStep = false;
        resetStep = false;
        window.removeEventListener('keydown', onKeyDown);
        setFormOpen(scene, '_settingsOpen', false);
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            scene.closeModal();
        }
    }

    // Клики: тумблеры, престиж, сброс. Скрим (backdrop) намеренно без обработчика —
    // клик по фону игру не закрывает и ничего не меняет (ST9).
    layer.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) {
            return;
        }

        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'sound') {
            const on = setSoundOn(!snapshot().soundOn);
            if (on) {
                playSfx(scene, 'purchase');
            }

            refresh(true);
        } else if (act === 'music') {
            setMusicOn(!snapshot().musicOn);
            scene.game.events.emit(EVENTS.musicChanged);
            refresh(true);
        } else if (act === 'prestige') {
            if (isBossLocked()) {
                return;
            }

            const snap = snapshot();
            if (!snap.canPrestige) {
                return;
            }

            if (!prestigeStep) {
                prestigeStep = true;
                refresh(true);

                return;
            }

            prestigeStep = false;
            const gain = doPrestige();
            scene.afterPrestige?.(gain);
        } else if (act === 'reset') {
            if (isBossLocked()) {
                return;
            }

            if (!resetStep) {
                resetStep = true;
                refresh(true);

                return;
            }

            resetStep = false;
            resetGame();
            scene.afterReset?.();
        }
    });

    // Громкость: применяется на каждый сдвиг, сейв — по окончании жеста.
    range.addEventListener('input', () => {
        const v = setMusicVolume(Number(range.value) / 100);
        volumeValue.textContent = `${Math.round(v * 100)}%`;
        scene.game.events.emit(EVENTS.musicChanged);
    });
    range.addEventListener('change', () => commitSettings());
    range.addEventListener('pointerup', () => commitSettings());

    // Блокировка колеса/тапов по фону: панель событие не глушит, но и не пробрасывает.
    layer.querySelector('[data-dom-backdrop]').addEventListener('pointerdown', (e) => e.preventDefault());

    const api = {
        open() {
            if (open) {
                return;
            }

            show();
        },
        close() {
            if (!open) {
                return;
            }

            hide();
            scene.tryShowDailyModal?.();
        },
        isOpen: () => open,
        hideForOverlays() {
            if (!open || hiddenForOverlay) {
                return;
            }

            layer.hidden = true;
            hiddenForOverlay = true;
        },
        restoreFromOverlay() {
            if (!open || !hiddenForOverlay) {
                return;
            }

            layer.hidden = false;
            hiddenForOverlay = false;
            refresh(true);
        },
        tick() {
            if (!open) {
                return;
            }

            // D3/2.7: Phaser-оверлей (офлайн/дейли/босс/вырубление/карта) временно
            // перекрывает DOM-модалку — прячемся и возвращаемся после его закрытия.
            const overlay = !!(
                scene._offlineOpen ||
                scene._dailyOpen ||
                scene._mapOpen ||
                scene._bossRewardOpen ||
                scene._playerDownOpen
            );
            if (overlay) {
                api.hideForOverlays();
            } else {
                api.restoreFromOverlay();
            }

            if (!hiddenForOverlay) {
                refresh();
            }
        },
        refresh,
        destroy() {
            window.removeEventListener('keydown', onKeyDown);
            layer.remove();
        },
        get panel() {
            return panel;
        }
    };

    if (import.meta.env.DEV) {
        window.__DOM_SETTINGS = api;
    }

    // Первичная отрисовка скрытой панели (аудит и golden видят готовую разметку).
    refresh(true);
    syncBlockLock(scene);

    return api;
}
