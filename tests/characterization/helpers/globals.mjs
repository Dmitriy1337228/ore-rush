// РЁРёРј Р±СЂР°СѓР·РµСЂРЅРѕРіРѕ РѕРєСЂСѓР¶РµРЅРёСЏ РґР»СЏ unit-С‚РµСЃС‚РѕРІ src/* РІ Node.
// Р’РђР–РќРћ: РёРјРїРѕСЂС‚РёСЂРѕРІР°С‚СЊ СЌС‚РѕС‚ РјРѕРґСѓР»СЊ РЎРўРђРўРР§Р•РЎРљР РџР•Р Р’Р«Рњ (РґРѕ РґРёРЅР°РјРёС‡РµСЃРєРѕРіРѕ РёРјРїРѕСЂС‚Р°
// src/state.js) вЂ” sdk-stub.js РїСЂРё Р·Р°РіСЂСѓР·РєРµ С‡РёС‚Р°РµС‚ globalThis.localStorage.
// РџСЂРѕРґРѕРІС‹Р№ РєРѕРґ РЅРµ С‚СЂРѕРіР°РµРј: РІСЃРµ РѕР±СЂР°С‰РµРЅРёСЏ Рє localStorage РІ sdk-stub РѕР±С‘СЂРЅСѓС‚С‹ РІ
// try/catch, РЅРѕ С€РёРј РґР°С‘С‚ С‚РµСЃС‚Р°Рј РїРѕР»РЅС‹Р№ РєРѕРЅС‚СЂРѕР»СЊ РЅР°Рґ С…СЂР°РЅРёР»РёС‰РµРј (Р·Р°РїРѕР»РЅРµРЅРёРµ СЃРёРґРѕРІ,
// РёРЅСЃРїРµРєС†РёСЏ JSON СЃРµР№РІР°).

const store = new Map();

globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
        return store.size;
    }
};

// Р”РёРЅР°РјРёС‡РµСЃРєРёР№ РёРјРїРѕСЂС‚ AFTER С€РёРјР°: Сѓ state.js/sdk-stub.js РЅРµС‚ СЃС‚Р°С‚РёРєРё РЅР° Р±СЂР°СѓР·РµСЂ.
export async function importState() {
    return import('../../../src/state.js');
}
export async function importLayout() {
    return import('../../../src/layout.js');
}
export async function importSdkStub() {
    return import('../../../src/sdk-stub.js');
}
export async function importSdkAdapter() {
    return import('../../../src/sdk/yandex.js');
}

// РџРѕРґРјРµРЅР° Math.random РЅР° РґРµС‚РµСЂРјРёРЅРёСЂРѕРІР°РЅРЅСѓСЋ РїРѕСЃР»РµРґРѕРІР°С‚РµР»СЊРЅРѕСЃС‚СЊ; РІРѕР·РІСЂР°С‰Р°РµС‚ restore.
export function stubRandom(values) {
    const real = Math.random;
    let i = 0;
    Math.random = Array.isArray(values) ? () => values[i++ % values.length] : values; // С„СѓРЅРєС†РёСЏ
    return () => {
        Math.random = real;
    };
}

// normalize РґР»СЏ СЃСЂР°РІРЅРµРЅРёСЏ С‚РµРєСЃС‚Р°: BOM (PowerShell Out-File) Рё CRLF -> LF
export function normalizeText(s) {
    return String(s)
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n');
}
