import allBlocks, { allMenus } from './block-mapping/all-blocks.js';
import Sanitizer from './sanitizer.js';
import {
    BLOCK,
    BOOLEAN_BLOCK,
    C_BLOCK,
    REPORTER_BLOCK,
} from './block-mapping/block-enum.js';
import { parseExtension } from 'scratch-sandbox';

// extensionId -> source URL, populated when an extension is registered with a
// known URL. Used to re-emit a project's `extensions` array on serialization so
// a generated SB3 can be re-parsed (and its extensions auto-loaded) later.
const extensionUrls = Object.create(null);
// extensionId -> source URL, recorded by the CALLER when it supplies a source
// (the parser itself never downloads anything; reading JS / fetching URLs is
// the caller's responsibility). Used to re-emit a project's `extensions` array
// on serialization so a generated SB3 carries its extension provenance.

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
// `opts.url` records the source URL so the reverse path can re-emit it.
export const compileExtensionInfo = (info, opts = {}) => {
    const id = info.id;
    const url = opts.url || null;
    const blocks = [];
    for (const b of info.blocks || []) {
        if (b.blockType === 'label' || b.blockType === 'button') continue;
        // TurboWarp extensions declare opcodes RELATIVE to the extension id
        // (e.g. `get`); the VM prefixes them at runtime (`<id>_get`). Prefix
        // unless the opcode is already fully qualified with this id.
        if (!b.opcode) continue;
        const opcode = b.opcode.startsWith(`${id}_`) ? b.opcode : `${id}_${b.opcode}`;
        const argEntries = Object.entries(b.arguments || {});
        const argNames = argEntries.map(([name]) => name);
        const template = convertTemplate(b.text || b.blockText || opcode, argNames);
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
            opcode,
            extensionId: id,
            isHat: b.blockType === 'hat' || b.blockType === 'event',
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
        url,
        color1: info.color1 || null,
        menus: info.menus || {},
        blocks,
    };
};

// Register a compiled meta into the global allBlocks / allMenus tables so both
// the forward (SB3 -> text) and reverse (text -> SB3) parsers pick it up.
export const registerExtensionMeta = meta => {
    if (meta.url) extensionUrls[meta.id] = meta.url;
    for (const b of meta.blocks) {
        if (Object.prototype.hasOwnProperty.call(allBlocks, b.opcode)) {
            console.warn(`registerExtension: opcode already defined, skipping ${b.opcode}`);
            continue;
        }
        allBlocks[b.opcode] = {
            defaultMessage: b.template,
            type: b.type,
            extensionId: meta.id,
            isHat: b.isHat,
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
// `opts.url` records the source URL for later re-emission.
export const registerExtensionInfo = (info, opts = {}) => {
    registerExtensionMeta(compileExtensionInfo(info, opts));
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
    registerExtensionInfo(result.info, { url: opts.url });
    return result;
};

// The parser is intentionally I/O-free: it never reads files or downloads URLs.
// The CALLER is responsible for obtaining an extension's JS source (fetching a
// URL, reading an embedded string from the project, etc.) and handing it here
// via `registerExtensionFromSource` / `registerExtensionInfo`. See the project
// README / git-palette for the fetch-and-register orchestration.

// Register TurboWarp "core" extensions (control_while, etc.) that are injected
// by TurboWarp and may not appear in a project's `extensions` array, so they
// cannot be auto-fetched. Idempotent: only runs once per process.
let builtinsRegistered = false;
export const registerBuiltinExtensions = async () => {
    if (builtinsRegistered) return;
    try {
        const mod = await import('./extensions/turbowarp-core.js');
        const infos = mod.default || [];
        for (const info of infos) registerExtensionInfo(info);
    } finally {
        builtinsRegistered = true;
    }
};

// Register the extensions a project needs before it is rendered. This parser is
// I/O-free, so it only handles built-in/core extensions (resolved from bundled
// block metadata / `registerBuiltinExtensions`). Any CUSTOM extension — whether
// its source was loaded from a URL or embedded in the project — must be supplied
// by the CALLER (e.g. git-palette) via `registerExtensionFromSource` /
// `registerExtensionInfo` BEFORE the project is converted. A bare ID in
// `project.extensions` (e.g. "pen", "music", or a custom ID) is NOT a URL and is
// intentionally left to the caller to resolve.

// Local data: URL decoder (parse-sb3-blocks is I/O-free and must not depend
// on extension-git). Supports `data:application/javascript[;charset=…][;base64],…`
// and `data:text/javascript[;charset=…],<percent-encoded or raw>`.
const decodeDataUrl = url => {
    const m = url.match(/^data:(?:application|text)\/javascript(?:;([^,]*))?,(.*)$/s);
    if (!m) return null;
    const meta = m[1] || '';
    const payload = m[2];
    try {
        if (/base64/i.test(meta)) return Buffer.from(payload, 'base64').toString('utf8');
        return decodeURIComponent(payload);
    } catch {
        return null;
    }
};
// Track URLs already auto-fetched+registered in this process so repeated
// passes (e.g. forward then re-emit + re-parse) don't emit duplicate-opcode
// warnings. The caller can clear this with `resetAutoRegistered()` between
// independent sessions if needed.
const autoRegistered = new Set();
export const resetAutoRegistered = () => autoRegistered.clear();

export const registerExtensionsFromProject = async (project, opts = {}) => {
    await registerBuiltinExtensions();
    // Auto-fetch and register any custom extensions the project references.
    // An entry in `project.extensions` can be either a bare id (resolved by
    // builtins above or left to the caller as unresolved) or a URL — the
    // latter case lets a project carry its extension source inline so the
    // forward render doesn't drop the extension's blocks. The optional
    // `opts.fetch(url)` (and a built-in data: URL fallback) is used to obtain
    // the source; the caller may pre-register via `registerExtensionFromSource`
    // to skip the fetch.
    const fetchUrl = opts.fetch;
    const need = new Set();
    const urls = new Map(); // id -> url
    for (const entry of project.extensions || []) {
        if (typeof entry !== 'string') continue;
        if (/^(https?|data):/i.test(entry)) {
            // Bare URL in the extensions array: synthesise an id from the URL.
            const id = 'ext_' + entry.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
            urls.set(id, entry);
            need.add(id);
        }
    }
    for (const [id, url] of Object.entries(project.extensionURLs || {})) {
        if (typeof url === 'string' && url) {
            urls.set(id, url);
            need.add(id);
        }
    }
    for (const id of need) {
        const url = urls.get(id);
        let source = null;
        if (/^data:/i.test(url)) {
            source = decodeDataUrl(url);
        } else if (typeof fetchUrl === 'function') {
            try {
                const res = await fetchUrl(url);
                if (res && res.ok !== false && typeof res.text === 'function') {
                    source = await res.text();
                }
            } catch {
                /* swallow; extension stays unregistered */
            }
        }
        if (source) {
            if (autoRegistered.has(url)) continue;
            autoRegistered.add(url);
            try {
                await registerExtensionFromSource(source, { ...opts, url });
            } catch {
                /* swallow; a single failed extension shouldn't break the project */
            }
        }
    }
};

// Collect the source URLs for the extensions used by the given block opcodes,
// for re-emitting a project's `extensions` array on serialization.
export const projectExtensionsForOpcodes = opcodes => {
    const urls = [];
    const seen = new Set();
    for (const op of opcodes) {
        const info = allBlocks[op];
        const id = info && info.extensionId;
        const url = id && extensionUrls[id];
        if (url && !seen.has(url)) {
            seen.add(url);
            urls.push(url);
        }
    }
    return urls;
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
