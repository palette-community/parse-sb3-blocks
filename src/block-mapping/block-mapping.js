import { default as allBlocks, allMenus } from './all-blocks.js';
import translations from './translations.js';
import localeOptions from './options.js';
import { specialMessageMap } from './special-messages.js';
import Sanitizer from '../sanitizer.js';

const _translationKeyToOpcode = {};
Object.keys(allBlocks).forEach(opcode => {
    const entry = allBlocks[opcode];
    if (entry.noTranslation) return;
    const translationKey = entry.translationKey || opcode.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(_translationKeyToOpcode, translationKey)) return;
    _translationKeyToOpcode[translationKey] = opcode;
});

const getOpcodeFromTranslationKey = translationKey => _translationKeyToOpcode[translationKey];

const getTranslationKeyFromValue = (locale, value) => {
    const localeTranslation = translations[locale];
    let candidates = [];
    if (localeTranslation) {
        candidates = Object.keys(localeTranslation).filter(key => localeTranslation[key] === value);
    } else {
        candidates = Object.values(allBlocks).filter(item => item.defaultMessage === value);
    }
    return candidates.length ? candidates[0] : null;
};

const getMessageForLocale = (locale, opcode) => {
    const translationKey = allBlocks[opcode].translationKey || opcode.toUpperCase();
    if (translations[locale] && translations[locale][translationKey]) {
        return Sanitizer.labelSanitize(translations[locale][translationKey]);
    }
    return Sanitizer.labelSanitize(allBlocks[opcode].defaultMessage);
};

const getOptsForLocale = (locale, opcode) => {
    const translationKey = allBlocks[opcode].translationKey || opcode.toUpperCase();
    if (translations[locale] && translations[locale][translationKey]) {
        if (localeOptions[locale] && localeOptions[locale][translationKey]) {
            return {
                category: localeOptions[locale][translationKey],
            };
        }
        return {};
    }
    return allBlocks[opcode].defaultOptions || {};
};

const getSpecialMessage = (locale, key) => {
    if (Object.prototype.hasOwnProperty.call(specialMessageMap, key))
        return getMessageForLocale(locale, specialMessageMap[key]);
};

const isSpecialMenuValue = (opcode, value) =>
    Object.prototype.hasOwnProperty.call(allMenus[opcode] || {}, value);

// Reverse lookup: given a parent opcode and the displayed menu value (which may be
// the translated/lower-cased label), return the canonical menu key used in sb3
// `fields` (e.g. "BRIGHTNESS" for the displayed "brightness"). Returns null when the
// value is not a known special menu option (e.g. it is a dynamic variable/list name).
const getMenuKeyForValue = (opcode, value) => {
    const m = allMenus[opcode] || {};
    if (Object.prototype.hasOwnProperty.call(m, value)) return value;
    const lc = String(value == null ? '' : value).toLowerCase();
    if (!lc) return null;
    for (const k of Object.keys(m)) {
        if (k.toLowerCase() === lc) return k;
        const def = m[k] && m[k].defaultMessage;
        if (def && def.toLowerCase() === lc) return k;
    }
    return null;
};

const getMenuItemForLocale = (locale, opcode, value) => {
    const item = allMenus[opcode] && allMenus[opcode][value];
    if (!item) {
        // Dynamic menu value (sprite / costume / variable name) not present
        // in the static menu map; fall back to the literal value so the
        // forward renderer doesn't crash.
        return Sanitizer.sanitize(String(value == null ? '' : value));
    }
    const translationKey = item.translationKey;
    if (translations[locale] && translations[locale][translationKey]) {
        return Sanitizer.sanitize(translations[locale][translationKey]);
    }
    return Sanitizer.sanitize(item.defaultMessage);
};

export {
    getMessageForLocale,
    getOptsForLocale,
    getSpecialMessage,
    isSpecialMenuValue,
    getMenuKeyForValue,
    getMenuItemForLocale,
    getOpcodeFromTranslationKey,
    getTranslationKeyFromValue,
};
