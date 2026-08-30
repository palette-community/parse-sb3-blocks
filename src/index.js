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
    registerExtensionsFromProject,
    registerBuiltinExtensions,
    registerBundledExtensions,
} from './extension-registry.js';

// Convert a full SB3 project object to scratchblocks text. Built-in/core
// extensions are registered automatically; CUSTOM extensions (URL-loaded or
// embedded in the project) must be registered by the caller via
// `registerExtensionFromSource` / `registerExtensionInfo` BEFORE this runs. The
// parser performs NO network or file I/O. Returns the concatenated text for all
// targets.
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
// target, and within each target split into `scripts` (connected stacks
// starting at a top-level block that has a `next`) and `orphans` (isolated
// top-level blocks with no `next`). Built-in extensions are registered
// automatically; custom extensions must be pre-registered by the caller.
export const projectToSnippets = async (project, opts = {}) => {
    await registerExtensionsFromProject(project, opts);
    const locale = opts.locale || 'en';
    const renderOpts = { tab: '    ', ...opts };
    const targets = {};
    // Per-target top-level block positions, in the same order the text is
    // emitted (scripts first, then orphans). The reverse path zips these back
    // onto the parsed top-level blocks so round-trips stay lossless.
    const positions = {};
    (project.targets || []).forEach((target, index) => {
        const blocks = target.blocks || {};
        const comments = target.comments || {};
        const scripts = [];
        const orphans = [];
        const pos = [];
        const top = Object.keys(blocks).filter(id => blocks[id] && blocks[id].topLevel);
        for (const id of top) {
            const block = blocks[id];
            const opcode = block.opcode;
            const text = toScratchblocks(id, blocks, locale, renderOpts, comments);
            if (!text || !text.trim()) continue; // unknown opcode: skip, don't emit empty
            const info = allBlocks[opcode] || {};
            const isHat = opcode.startsWith('event_') || info.isHat;
            const isReporter = info.type === REPORTER_BLOCK || info.type === BOOLEAN_BLOCK;
            const isControl = info.type === C_BLOCK || info.type === E_BLOCK;
            const isOrphan = isReporter || (!isHat && !isControl && (block.next === null || block.next === undefined));
            pos.push([Number(block.x) || 0, Number(block.y) || 0]);
            if (isOrphan) {
                orphans.push(text);
            } else {
                scripts.push(text);
            }
        }
        const name = target.name || `target${index}`;
        targets[name] = { isStage: !!target.isStage, scripts, orphans };
        positions[name] = pos;
    });
    return { targets, positions };
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
    registerExtensionsFromProject,
    registerBuiltinExtensions,
    registerBundledExtensions,
};
