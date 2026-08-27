import allBlocks, { allMenus } from './block-mapping/all-blocks.js';
import Sanitizer from './sanitizer.js';
import {
    BLOCK,
    BOOLEAN_BLOCK,
    C_BLOCK,
    REPORTER_BLOCK,
} from './block-mapping/block-enum.js';
import { parseExtension } from 'scratch-sandbox';

// Argument types that surface as a (static or dynamic) menu dropdown.
const MENU_ARG_TYPES = new Set([
    'broadcast',
    'costume',
    'backdrop',
    'sprite',
    'stage',
    'target',
    'variable',
    'list',
    'content',
    'menu',
]);

// Convert a Scratch extension block text into a scratchblocks template.
// Placeholders may appear as `[ARG]`, `%1`, or legacy `%s/%n/%b/%m.x/%d.x`.
// Arg names come from `info.arguments` (insertion order) so the resulting
// `{NAME}` placeholders line up with the SB3 `inputs` keys.
const convertTemplate = (raw, argNames) => {
    let t = raw === null || raw === undefined ? '' : String(raw);
    if (t === '') return '';
    if (/\[[^\]]+]/.test(t)) {
        t = t.replace(/\[(.+?)]/g, (_m, name) => `{${name}}`);
    } else if (/%\d+/.test(t)) {
        t = t.replace(/%(\d+)/g, (_m, n) => `{${argNames[Number(n) - 1] || `ARG${n}`}}`);
    } else if (/%[snbmd]|%m\.|%d\./.test(t)) {
        let i = 0;
        t = t.replace(/%[snbmd]\.?\w*/g, () => `{${argNames[i++] || `ARG${i}`}}`);
    }
    return Sanitizer.labelSanitize(t);
};

const mapBlockType = bt => {
    switch (bt) {
        case 'reporter':
            return REPORTER_BLOCK;
        case 'boolean':
            return BOOLEAN_BLOCK;
        case 'conditional':
        case 'loop':
            return C_BLOCK;
        case 'command':
        case 'hat':
        case 'event':
        default:
            return BLOCK;
    }
};

// Turn a raw `getInfo()` descriptor into a serializable extension meta object.
export const compileExtensionInfo = info => {
    const id = info.id;
    const blocks = [];
    for (const b of info.blocks || []) {
        if (b.blockType === 'label' || b.blockType === 'button') continue;
        const argEntries = Object.entries(b.arguments || {});
        const argNames = argEntries.map(([name]) => name);
        const template = convertTemplate(b.text || b.blockText || b.opcode, argNames);
        const args = argEntries.map(([name, a]) => {
            const isMenu = !!(a && (a.menu || MENU_ARG_TYPES.has(a.type) || a.type === 'menu'));
            return {
                name,
                type: a ? a.type : '',
                menu: a && a.menu ? a.menu : isMenu ? name : undefined,
            };
        });
        const type = mapBlockType(b.blockType);
        const block = {
            opcode: b.opcode,
            type,
            template,
            args,
        };
        if (type === C_BLOCK) block.branchCount = b.branchCount || 1;
        blocks.push(block);
    }
    return {
        id,
        name: info.name,
        color1: info.color1 || null,
        menus: info.menus || {},
        blocks,
    };
};

// Register a compiled meta into the global allBlocks / allMenus tables so both
// the forward (SB3 -> text) and reverse (text -> SB3) parsers pick it up.
export const registerExtensionMeta = meta => {
    for (const b of meta.blocks) {
        if (Object.prototype.hasOwnProperty.call(allBlocks, b.opcode)) {
            console.warn(`registerExtension: opcode already defined, skipping ${b.opcode}`);
            continue;
        }
        allBlocks[b.opcode] = {
            defaultMessage: b.template,
            type: b.type,
            defaultOptions: { category: meta.id },
        };
        for (const a of b.args) {
            if (!a.menu) continue;
            const menuDef = meta.menus[a.menu];
            if (!menuDef) continue;
            const items = Array.isArray(menuDef)
                ? menuDef
                : menuDef.items || [];
            allMenus[b.opcode] = allMenus[b.opcode] || {};
            for (const item of items) {
                const val =
                    typeof item === 'string' ? item : item && (item.value !== null && item.value !== undefined ? item.value : item.text);
                if (val === null || val === undefined) continue;
                allMenus[b.opcode][val] = { defaultMessage: String(val) };
            }
        }
    }
};

// Compile + register directly from a raw getInfo() descriptor.
export const registerExtensionInfo = info => {
    registerExtensionMeta(compileExtensionInfo(info));
};

// Register several descriptors at once.
export const registerExtensions = infos => {
    for (const info of infos) registerExtensionInfo(info);
};

// Parse extension JS source via scratch-sandbox and register the result.
// `opts` is forwarded to scratch-sandbox's parseExtension (url, fetch, ...).
export const registerExtensionFromSource = async (source, opts = {}) => {
    const result = await parseExtension(source, opts);
    if (!result.ok) {
        throw new Error(
            `registerExtensionFromSource failed for ${result.extensionId || '?'}:\n` +
                JSON.stringify(result.errors)
        );
    }
    registerExtensionInfo(result.info);
    return result;
};

// Register all extensions bundled under ./extensions (generated by the
// extractor script). Safe to call even when no extensions are bundled.
export const registerBundledExtensions = async () => {
    try {
        const mod = await import('./extensions/index.js');
        const infos = mod.default || [];
        for (const info of infos) registerExtensionInfo(info);
    } catch (e) {
        if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    }
};
