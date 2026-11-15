// Общие константы состояния: ключи хранилища, версия сейва, единицы времени.
// Лист-модуль: ни от чего не зависит, поэтому безопасен в циклических импортах.

import { SAVE_STORAGE_KEY } from '../sdk-stub.js';

// Ключ сейва принадлежит стабу (основной слот — player.setData/getData);
// SAVE_KEY оставлен как алиас для тестов/DevPanel, чтобы не менять контракт.
export const SAVE_KEY = SAVE_STORAGE_KEY;
export const LAST_EXIT_KEY = 'ore-rush-lastExit';
// Фолбэк старого имени игры (переименование 2026-11-13): офлайн-время игроков
// с прошлым ключом не должно пропасть
export const LEGACY_LAST_EXIT_KEY = 'minecraft-clicker-lastExit';
export const SAVE_VERSION = 5;

// ---------- Единицы времени ----------
export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;
export const DAY_MS = 86400e3;

// ---------- Дефолты и пределы сейва ----------
export const DEFAULT_MUSIC_VOLUME = 0.5;
// Потолок множителя бафа из сейва: защита от подделки/битых данных
export const BUFF_MULT_SAVE_CAP = 1e6;
// Потолок множителя боевой «Робо-рамы» и плоского крита «Точильного камня» из сейва
export const RIG_MULT_SAVE_CAP = 100;
export const OIL_ADD_SAVE_CAP = 0.9;
