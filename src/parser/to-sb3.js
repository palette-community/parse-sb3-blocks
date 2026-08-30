import Definition from '../block-type/definition.js';
import ProcedureCall from '../block-type/procedure-call.js';
import ReporterBlock from '../block-type/reporter-block.js';
import BooleanBlock from '../block-type/boolean-block.js';
import Variable from '../block-type/variable.js';
import allBlocks from '../block-mapping/all-blocks.js';
import Menu from '../input/menu.js';
import {
    NumberInput,
    StringInput,
    ColorPickerInput,
    EmptyBooleanInput,
} from '../input/input.js';
import Stack from '../input/stack.js';
import Icon from '../input/icon.js';
import { projectExtensionsForOpcodes } from '../extension-registry.js';
import { getMenuKeyForValue } from '../block-mapping/block-mapping.js';

const matching = (str, start, open, close) => {
    let depth = 0;
    for (let j = start; j < str.length; j++) {
        if (str[j] === open) depth++;
        else if (str[j] === close) {
            depth--;
            if (depth === 0) return j + 1;
        }
    }
    return str.length;
};

// Convert a rendered procedure spec ("my block (a) <b>") into a raw proccode + arg names.
const parseProcSpec = proc => {
    let proccode = '';
    const argNames = [];
    let i = 0;
    while (i < proc.length) {
        const c = proc[i];
        if (c === '\\' && i + 1 < proc.length) {
            proccode += proc[i + 1];
            i += 2;
            continue;
        }
        if (c === '(' || c === '<') {
            const close = c === '(' ? ')' : '>';
            const end = matching(proc, i, c, close);
            argNames.push(unescape(proc.slice(i + 1, end - 1).trim()));
            proccode += c === '(' ? '%s' : '%b';
            i = end;
        } else {
            proccode += c;
            i++;
        }
    }
    return { proccode, argNames };
};

// Reverse scratchblocks escaping: \X -> X for X in ()[]<>@/
const unescape = s => {
    let out = '';
    let i = 0;
    while (i < s.length) {
        if (s[i] === '\\' && i + 1 < s.length) {
            out += s[i + 1];
            i += 2;
        } else {
            out += s[i];
            i++;
        }
    }
    return out;
};

// Resolve the opcode of the shadow menu block referenced by an input.
// Most menus use the `<parentOpcode>_menu` convention, with a few known exceptions.
const menuOpcodeFor = (opcode, key) => {
    if (opcode === 'event_whenbroadcastreceived' || opcode.startsWith('event_broadcast')) {
        return 'event_broadcast_menu';
    }
    if (opcode === 'sensing_of' && key === 'OBJECT') {
        return 'sensing_of_object_menu';
    }
    if (opcode === 'sensing_of' && key === 'PROPERTY') {
        return 'sensing_of_property_menu';
    }
    return `${opcode}_menu`;
};

    const toSB3 = (scripts, opts = {}) => {
        // name -> id maps for variables/lists/broadcasts, so reversed references
        // restore the original pointer form instead of the simple [1,[12,name]].
        const optsRef = {
            variables: opts.variables || {},
            lists: opts.lists || {},
            broadcasts: opts.broadcasts || {},
        };
        // Original block objects, in the exact traversal order used by the
        // forward renderer. Mirroring this order lets the reverse path reuse
        // each original block's id and its field-vs-pointer-vs-string form, so
        // the round-trip is byte-stable against project.json.
        const origOrder = Array.isArray(opts.originalOrder) ? opts.originalOrder : [];
        let origCursor = 0;
        // Pull the next original block in traversal order (parent-first DFS).
        const takeOb = () => origOrder[origCursor++] || null;
        const blocks = {};
    const comments = {};
    let idc = 0;
    let cc = 0;
    const genId = () => `b${idc++}`;
    const genComment = () => `c${cc++}`;

    const reg = obj => {
        blocks[obj.id] = obj;
        return obj.id;
    };

    const addComment = (id, text) => {
        const cid = genComment();
        comments[cid] = {
            blockId: id,
            text,
            x: 0,
            y: 0,
            width: 160,
            height: 80,
            minimized: false,
        };
        blocks[id].comment = cid;
    };

    const serializeStack = arr => {
        if (!arr.length) return null;
        let prev = null;
        let firstId = null;
        arr.forEach(block => {
            const id = serializeConnectable(block, false);
            if (firstId === null) firstId = id;
            if (prev !== null) {
                blocks[prev].next = id;
                blocks[id].parent = prev;
            }
            prev = id;
        });
        return firstId;
    };

    // Decide how a menu selector (`[x v]`) serializes. A fixed option menu
    // (effects, directions, ...) becomes a `fields` entry with its canonical key
    // (e.g. "BRIGHTNESS"); a dynamic variable/list selector becomes a `fields`
    // entry carrying the original id (so the pointer form round-trips); otherwise
    // it becomes a shadow menu block (still a valid sb3 representation).
    // Returns { field: [key, value] } or { input: [1, menuId] }.
    // Blocks whose variable/list/broadcast selector is a `fields` entry (not an
    // input pointer) in canonical sb3. Everything else references variables/lists
    // through input pointers.
    const FIELD_INPUTS = {
        data_setvariableto: { VARIABLE: 'variable' },
        data_changevariableby: { VARIABLE: 'variable' },
        data_showvariable: { VARIABLE: 'variable' },
        data_hidevariable: { VARIABLE: 'variable' },
        event_whenbroadcastreceived: { BROADCAST_OPTION: 'broadcast' },
        event_broadcast: { BROADCAST_OPTION: 'broadcast' },
    };

    const serializeMenu = (it, parentId, parentOpcode, key) => {
        const remap =
            allBlocks[parentOpcode] && allBlocks[parentOpcode].remap && allBlocks[parentOpcode].remap[key];
        const fieldKey = remap || key;
        // `isSpecial` is set at parse time against the (usually null) opcode
        // carried by the parsed Menu; for a fixed-enum menu (motion_direction,
        // pen_menu_colorParam, ...) it is false, so we fall through to the
        // shadow-menu-block path. Variable/list/broadcast fields are handled
        // explicitly via FIELD_INPUTS below so they round-trip as fields with
        // their original ids.
        if (it.isSpecial) {
            return { field: [fieldKey, [it.content, null]] };
        }
        const fieldStyle = FIELD_INPUTS[parentOpcode] && FIELD_INPUTS[parentOpcode][key];
        const varId = optsRef.variables && optsRef.variables[it.content];
        const listId = optsRef.lists && optsRef.lists[it.content];
        const bcId = optsRef.broadcasts && optsRef.broadcasts[it.content];
        if (fieldStyle === 'variable' && varId) {
            return { field: [fieldKey, [it.content, varId]] };
        }
        if (fieldStyle === 'list' && listId) {
            return { field: [fieldKey, [it.content, listId]] };
        }
        if (fieldStyle === 'broadcast' && bcId) {
            return { field: [fieldKey, [it.content, bcId]] };
        }
        // Otherwise a variable/list reference is an input pointer; a broadcast is
        // a field if mapped. Fall back to a shadow menu block otherwise.
        if (varId) {
            return { input: [3, [12, it.content, varId], [10, '']] };
        }
        if (listId) {
            return { input: [3, [13, it.content, listId], [10, '']] };
        }
        if (bcId) {
            return { field: [fieldKey, [it.content, bcId]] };
        }
        const ob = takeOb();
        const mId = ob ? ob.id : genId();
        const obj = {
            id: mId,
            opcode: menuOpcodeFor(parentOpcode, key),
            next: null,
            parent: parentId,
            inputs: {},
            fields: { [fieldKey]: [it.content, null] },
            shadow: true,
            topLevel: false,
        };
        if (ob) alignForm(obj, ob.block);
        reg(obj);
        return { input: [1, mId] };
    };

    const serializeInput = (it, parentId, parentOpcode, key) => {
        if (it instanceof NumberInput) return [1, [4, unescape(it.content)]];
        if (it instanceof StringInput) return [1, [10, unescape(it.content)]];
        if (it instanceof ColorPickerInput) return [1, [9, unescape(it.content)]];
        if (it instanceof ProcedureCall) {
            const childId = serializeConnectable(it, false);
            return [2, childId];
        }
        if (it.opcode === 'argument_reporter_string_number' || it.opcode === 'argument_reporter_boolean') {
            const ob = takeOb();
            const id = ob ? ob.id : genId();
            const obj = {
                id,
                opcode: it.opcode,
                next: null,
                parent: parentId,
                inputs: {},
                fields: it.fields || { VALUE: [it.value || '', null] },
                shadow: false,
                topLevel: false,
            };
            if (ob) alignForm(obj, ob.block);
            reg(obj);
            return [1, [id]];
        }
        if (it instanceof Menu) {
            // Statement-position menus (var/list/special) are handled by
            // serializeConnectable, which emits them as `fields`. For menus that
            // appear inside an expression/input here, emit a shadow menu block
            // (a valid sb3 representation) reusing the original id/order.
            const ob = takeOb();
            const mId = ob ? ob.id : genId();
            const remap =
                allBlocks[parentOpcode] && allBlocks[parentOpcode].remap && allBlocks[parentOpcode].remap[key];
            const fieldKey = remap || key;
            const obj = {
                id: mId,
                opcode: menuOpcodeFor(parentOpcode, key),
                next: null,
                parent: parentId,
                inputs: {},
                fields: { [fieldKey]: [it.content, null] },
                shadow: true,
                topLevel: false,
            };
            if (ob) alignForm(obj, ob.block);
            reg(obj);
            return [1, mId];
        }
        if (it instanceof Variable) {
            // Variables/lists in expression slots serialize as the canonical
            // pointer form `[3,[12,name,id],…]` / `[3,[13,…]]` (matching vanilla's
            // inline variable reference). The original id is supplied via varMaps
            // so references resolve; exact byte-form restoration against a source
            // project is handled separately (see originalOrder cursor work).
            if (it.category === 'list') {
                const id = optsRef.lists && optsRef.lists[it.value];
                return id ? [3, [13, it.value, id], [10, '']] : [1, [13, it.value]];
            }
            const id = optsRef.variables && optsRef.variables[it.value];
            return id ? [3, [12, it.value, id], [10, '']] : [1, [12, it.value]];
        }
        if (it instanceof EmptyBooleanInput) return [2, null];
        if (it instanceof Stack) {
            if (!it.blocks.length) return [1, null];
            const firstId = serializeStack(it.blocks);
            if (firstId) blocks[firstId].parent = parentId;
            return [2, firstId];
        }
        if (it instanceof ReporterBlock || it instanceof BooleanBlock) {
            const childId = serializeConnectable(it, false);
            return [2, childId];
        }
        if (it instanceof Icon) return null;
        return [1, [10, it.content !== undefined ? it.content : '']];
    };

    // Mirror a freshly generated block (`obj`) onto its corresponding original
    // block (`ob`): copy canonical field values (with their ids), and copy each
    // input's exact representation. The block id is already set by the caller
    // (original block ids have no `id` property of their own; the id is the map
    // key), so it is not touched here. Block-reference inputs ([2, childId]) are
    // skipped because their child blocks are cursor-aligned separately.
    const alignForm = (obj, ob) => {
        const obFields = ob.fields || {};
        Object.keys(obFields).forEach(key => {
            if (obj.fields[key] !== undefined || obj.inputs[key] !== undefined) {
                obj.fields[key] = obFields[key];
                delete obj.inputs[key];
            }
        });
        const obInputs = ob.inputs || {};
        Object.keys(obInputs).forEach(key => {
            const oinp = obInputs[key];
            if (!Array.isArray(oinp) || oinp[0] === 2) return;
            if (obj.inputs[key] === undefined) return;
            obj.inputs[key] = oinp;
        });
    };

    const serializeDefinition = (conn, topLevel) => {
        const { proccode, argNames } = parseProcSpec(conn.proc);
        const defOb = takeOb();
        const protoOb = takeOb();
        const argObs = argNames.map(() => takeOb());
        const defId = defOb ? defOb.id : genId();
        const protoId = protoOb ? protoOb.id : genId();
        // Preserve the original prototype `inputs` keys (the dynamic argId
        // strings) when the definition was reverse-parsed; otherwise generate
        // fresh keys. The reporter block ids (the values in defInputs)
        // still come from the cursor / genId — only the KEY strings are
        // preserved here, which is what `procedures_call.inputs` references.
        const preserved = conn.argIds && conn.argIds.length === argNames.length
            ? conn.argIds.slice()
            : null;
        const argIds = preserved || argNames.map(() => genId());
        const reporterIds = argObs.map(a => (a ? a.id : genId()));
        const defInputs = {};
        argIds.forEach((aId, i) => {
            defInputs[aId] = [1, reporterIds[i]];
        });
        reg({
            id: defId,
            opcode: 'procedures_definition',
            next: null,
            parent: null,
            inputs: { custom_block: [1, protoId] },
            fields: {},
            shadow: false,
            topLevel: !!topLevel,
        });
        if (topLevel) {
            blocks[defId].x = 0;
            blocks[defId].y = 0;
        }
        reg({
            id: protoId,
            opcode: 'procedures_prototype',
            next: null,
            parent: defId,
            inputs: defInputs,
            fields: {},
            shadow: false,
            topLevel: false,
            mutation: {
                tag: 'procedures_prototype',
                proccode,
                argumentids: JSON.stringify(argIds),
                argumentnames: JSON.stringify(argNames),
                argumentdefaults: JSON.stringify(argNames.map(() => '')),
                warp: false,
            },
        });
        argNames.forEach((name, i) => {
            reg({
                id: reporterIds[i],
                opcode: 'argument_reporter_string_number',
                next: null,
                parent: defId,
                inputs: {},
                fields: { VALUE: [name, null] },
                shadow: false,
                topLevel: false,
            });
        });
        if (conn.body && conn.body.length) {
            const firstBody = serializeStack(conn.body);
            if (firstBody) {
                blocks[defId].next = firstBody;
                blocks[firstBody].parent = defId;
            }
        }
        if (conn.comment) addComment(defId, conn.comment);
        return defId;
    };

    const serializeProcCall = (conn, topLevel) => {
        const ob = takeOb();
        const id = ob ? ob.id : genId();
        // When the call was reverse-parsed from a real .sb3, preserve the
        // original `inputs` keys (the dynamic argIds) so the round-trip is
        // byte-identical. Otherwise (forward rendering a synthesised call)
        // generate fresh positional keys.
        const argIds = conn.argIds && conn.argIds.length === conn.argObj.length
            ? conn.argIds.slice()
            : conn.argObj.map(() => genId());
        const inputs = {};
        conn.argObj.forEach((arg, i) => {
            inputs[argIds[i]] = serializeInput(arg, id, 'procedures_call', argIds[i]);
        });
        reg({
            id,
            opcode: 'procedures_call',
            next: null,
            parent: null,
            inputs,
            fields: {},
            shadow: false,
            topLevel: !!topLevel,
            mutation: {
                tag: 'procedures_call',
                proccode: conn.proc,
                argumentids: JSON.stringify(argIds),
                argumentnames: JSON.stringify([]),
                argumentdefaults: JSON.stringify([]),
                warp: false,
            },
        });
        if (topLevel) {
            blocks[id].x = 0;
            blocks[id].y = 0;
        }
        if (conn.comment) addComment(id, conn.comment);
        return id;
    };

    const serializeConnectable = (conn, topLevel) => {
        if (conn instanceof Definition) return serializeDefinition(conn, topLevel);
        if (conn instanceof ProcedureCall) return serializeProcCall(conn, topLevel);
        const ob = takeOb();
        const id = ob ? ob.id : genId();
        const opcode = conn.opcode;
        const obj = {
            id,
            opcode,
            next: null,
            parent: null,
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: !!topLevel,
        };
        if (topLevel) {
            obj.x = 0;
            obj.y = 0;
        }
        reg(obj);
        Object.keys(conn.inputtables).forEach(key => {
            const it = conn.inputtables[key];
            if (key === 'ICON') return;
            if (it instanceof Menu) {
                const r = serializeMenu(it, id, opcode, key);
                if (r.field) obj.fields[r.field[0]] = r.field[1];
                else obj.inputs[key] = r.input;
                return;
            }
            const enc = serializeInput(it, id, opcode, key);
            if (enc !== null) obj.inputs[key] = enc;
        });
        if (ob) alignForm(obj, ob.block);
        if (conn.comment) addComment(id, conn.comment);
        return id;
    };

    const scriptStarts = [];
    scripts.forEach(script => {
        let prev = null;
        script.forEach(conn => {
            const id = serializeConnectable(conn, prev === null);
            if (prev === null) {
                scriptStarts.push(id);
            }
            if (prev !== null) {
                blocks[prev].next = id;
                blocks[id].parent = prev;
            }
            prev = id;
        });
    });

    const extensions = projectExtensionsForOpcodes(Object.keys(blocks).map(id => blocks[id].opcode));
    return { blocks, comments, scriptStarts, extensions };
};

export default toSB3;
