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

const toSB3 = scripts => {
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

    const serializeInput = (it, parentId, parentOpcode, key) => {
        if (it instanceof NumberInput) return [1, [4, unescape(it.content)]];
        if (it instanceof StringInput) return [1, [10, unescape(it.content)]];
        if (it instanceof ColorPickerInput) return [1, [9, unescape(it.content)]];
        if (it instanceof Menu) {
            if (it.isSpecial) return null; // emitted as a field instead
            const mId = genId();
            const remap =
                allBlocks[parentOpcode] && allBlocks[parentOpcode].remap && allBlocks[parentOpcode].remap[key];
            const fieldKey = remap || key;
            reg({
                id: mId,
                opcode: menuOpcodeFor(parentOpcode, key),
                next: null,
                parent: parentId,
                inputs: {},
                fields: { [fieldKey]: [it.content, null] },
                shadow: true,
                topLevel: false,
            });
            return [1, mId];
        }
        if (it instanceof Variable) {
            const t = it.category === 'list' ? 13 : 12;
            return [1, [t, it.value]];
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

    const serializeDefinition = (conn, id, topLevel) => {
        const { proccode, argNames } = parseProcSpec(conn.proc);
        const defId = genId();
        const argIds = [];
        argNames.forEach(name => {
            const aId = genId();
            argIds.push(aId);
            reg({
                id: aId,
                opcode: 'argument_reporter_string_number',
                next: null,
                parent: defId,
                inputs: {},
                fields: { VALUE: [name, null] },
                shadow: false,
                topLevel: false,
            });
        });
        const defInputs = {};
        argIds.forEach(aId => {
            defInputs[aId] = [1, aId];
        });
        reg({
            id: defId,
            opcode: 'procedures_definition',
            next: null,
            parent: id,
            inputs: defInputs,
            fields: {},
            shadow: false,
            topLevel: false,
            mutation: {
                tag: 'procedures_definition',
                proccode,
                argumentids: JSON.stringify(argIds),
                argumentnames: JSON.stringify(argNames),
                argumentdefaults: JSON.stringify(argNames.map(() => '')),
                warp: false,
            },
        });
        reg({
            id,
            opcode: 'procedures_definition',
            next: null,
            parent: null,
            inputs: { custom_block: [1, defId] },
            fields: {},
            shadow: false,
            topLevel: !!topLevel,
        });
        if (topLevel) {
            blocks[id].x = 0;
            blocks[id].y = 0;
        }
        if (conn.comment) addComment(id, conn.comment);
        return id;
    };

    const serializeProcCall = (conn, id, topLevel) => {
        const argIds = conn.argObj.map(() => genId());
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
        if (conn instanceof Definition) return serializeDefinition(conn, genId(), topLevel);
        if (conn instanceof ProcedureCall) return serializeProcCall(conn, genId(), topLevel);
        const id = genId();
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
        Object.keys(conn.inputtables).forEach(key => {
            const it = conn.inputtables[key];
            if (key === 'ICON') return;
            if (it instanceof Menu && it.isSpecial) {
                obj.fields[key] = [it.content, null];
                return;
            }
            const enc = serializeInput(it, id, opcode, key);
            if (enc !== null) obj.inputs[key] = enc;
        });
        reg(obj);
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

    return { blocks, comments, scriptStarts };
};

export default toSB3;
