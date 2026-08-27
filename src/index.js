import parseScript from './parser/parse.js';
import toScratchblocks from './parser/to-scratchblocks.js';
import parseScratchblocks from './parser/from-scratchblocks.js';
import toSB3 from './parser/to-sb3.js';

import Block from './block-type/block.js';
import BooleanBlock from './block-type/boolean-block.js';
import CBlock from './block-type/c-block.js';
import EBlock from './block-type/e-block.js';
import ReporterBlock from './block-type/reporter-block.js';
import Variable from './block-type/variable.js';
import Definition from './block-type/definition.js';
import ProcedureCall from './block-type/procedure-call.js';

import Icon from './input/icon.js';
import Menu from './input/menu.js';
import {
    default as Input,
    NumberInput,
    StringInput,
    ColorPickerInput,
    BroadcastMenuInput,
    EmptyBooleanInput,
} from './input/input.js';
import Stack from './input/stack.js';

import allBlocks, { allMenus } from './block-mapping/all-blocks.js';
import {
    BLOCK,
    BOOLEAN_BLOCK,
    C_BLOCK,
    E_BLOCK,
    REPORTER_BLOCK,
} from './block-mapping/block-enum.js';
import {
    compileExtensionInfo,
    registerExtensionMeta,
    registerExtensionInfo,
    registerExtensions,
    registerExtensionFromSource,
    registerExtensionFromUrl,
    registerExtensionsFromProject,
    registerBundledExtensions,
} from './extension-registry.js';

// Convert a full SB3 project object to scratchblocks text. Extensions listed in
// the project's top-level `extensions` array are fetched and registered
// automatically (via scratch-sandbox), so no manual extraction step is needed.
// `opts` is forwarded to the extension loader (e.g. `opts.fetch` for offline
// caches) and to the renderer. Returns the concatenated text for all targets.
export const toScratchblocksProject = async (project, opts = {}) => {
    await registerExtensionsFromProject(project, opts);
    const locale = opts.locale || 'en';
    const renderOpts = { tab: '    ', ...opts };
    const targetTexts = [];
    for (const target of project.targets || []) {
        const blocks = target.blocks || {};
        const comments = target.comments || {};
        const top = Object.keys(blocks).filter(id => blocks[id] && blocks[id].topLevel);
        let text = '';
        for (const id of top) {
            text += toScratchblocks(id, blocks, locale, renderOpts, comments) + '\n\n';
        }
        targetTexts.push(text.trim());
    }
    return targetTexts.filter(Boolean).join('\n\n');
};

// Convert a full SB3 project into a structured JSON: blocks are grouped by
// target (角色), and within each target split into `scripts` (connected stacks
// starting at a top-level block that has a `next`) and `orphans` (isolated
// top-level blocks with no `next` — floating reporters, single detached
// commands, empty hats). Extensions listed in the project's `extensions` array
// are fetched and registered automatically.
export const projectToSnippets = async (project, opts = {}) => {
    await registerExtensionsFromProject(project, opts);
    const locale = opts.locale || 'en';
    const renderOpts = { tab: '    ', ...opts };
    const targets = {};
    (project.targets || []).forEach((target, index) => {
        const blocks = target.blocks || {};
        const comments = target.comments || {};
        const scripts = [];
        const orphans = [];
        const top = Object.keys(blocks).filter(id => blocks[id] && blocks[id].topLevel);
        for (const id of top) {
            const block = blocks[id];
            const opcode = block.opcode;
            const text = toScratchblocks(id, blocks, locale, renderOpts, comments);
            const info = allBlocks[opcode] || {};
            const isHat = opcode.startsWith('event_') || info.isHat;
            const isReporter = info.type === REPORTER_BLOCK || info.type === BOOLEAN_BLOCK;
            const isOrphan = isReporter || ((block.next === null || block.next === undefined) && !isHat);
            if (isOrphan) {
                orphans.push(text);
            } else {
                scripts.push(text);
            }
        }
        const name = target.name || `target${index}`;
        targets[name] = { isStage: !!target.isStage, scripts, orphans };
    });
    return { targets };
};

export {
    toScratchblocks,
    parseScratchblocks,
    toSB3,
    parseScript,
    Block,
    BooleanBlock,
    CBlock,
    Definition,
    EBlock,
    ProcedureCall,
    ReporterBlock,
    Variable,
    Icon,
    Input,
    NumberInput,
    StringInput,
    ColorPickerInput,
    BroadcastMenuInput,
    EmptyBooleanInput,
    Menu,
    Stack,
    allBlocks,
    allMenus,
    BLOCK,
    BOOLEAN_BLOCK,
    C_BLOCK,
    E_BLOCK,
    REPORTER_BLOCK,
    compileExtensionInfo,
    registerExtensionMeta,
    registerExtensionInfo,
    registerExtensions,
    registerExtensionFromSource,
    registerExtensionFromUrl,
    registerExtensionsFromProject,
    registerBundledExtensions,
};
