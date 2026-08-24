import Block from '../block-type/block.js';
import BooleanBlock from '../block-type/boolean-block.js';
import CBlock from '../block-type/c-block.js';
import EBlock from '../block-type/e-block.js';
import ReporterBlock from '../block-type/reporter-block.js';
import Variable from '../block-type/variable.js';
import Definition from '../block-type/definition.js';
import ProcedureCall from '../block-type/procedure-call.js';

import Icon from '../input/icon.js';
import Menu from '../input/menu.js';
import {
    NumberInput,
    StringInput,
    ColorPickerInput,
    EmptyBooleanInput,
} from '../input/input.js';
import Stack from '../input/stack.js';

import allBlocks from '../block-mapping/all-blocks.js';
import { getMessageForLocale } from '../block-mapping/block-mapping.js';
import { BLOCK, BOOLEAN_BLOCK, C_BLOCK, E_BLOCK, REPORTER_BLOCK } from '../block-mapping/block-enum.js';

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

const classForType = type => {
    switch (type) {
        case C_BLOCK:
            return CBlock;
        case E_BLOCK:
            return EBlock;
        case REPORTER_BLOCK:
            return ReporterBlock;
        case BOOLEAN_BLOCK:
            return BooleanBlock;
        default:
            return Block;
    }
};

// Split a message into text/placeholder tokens.
const tokenizeTemplate = msg => {
    const tokens = [];
    let last = 0;
    const re = /\{([A-Z0-9_-]+)\}/g;
    let m;
    while ((m = re.exec(msg))) {
        if (m.index > last) tokens.push({ type: 'text', value: msg.slice(last, m.index) });
        tokens.push({ type: 'placeholder', key: m[1] });
        last = re.lastIndex;
    }
    if (last < msg.length) tokens.push({ type: 'text', value: msg.slice(last) });
    return tokens;
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

// Tokenize a scratchblocks line. Each (...), <...>, [...] or @icon becomes one token.
const tokenizeLine = line => {
    const tokens = [];
    let i = 0;
    let text = '';
    const pushText = () => {
        if (text) {
            tokens.push({ type: 'text', value: text });
            text = '';
        }
    };
    while (i < line.length) {
        const c = line[i];
        if (c === '\\' && i + 1 < line.length && '()[]<>@/'.includes(line[i + 1])) {
            text += line[i + 1];
            i += 2;
            continue;
        }
        if (c === '/' && line[i + 1] === '/') {
            pushText();
            tokens.push({ type: 'comment', value: line.slice(i + 2).trim() });
            break;
        }
        if (c === '(' || c === '<' || c === '[' || c === '@') {
            pushText();
            if (c === '@') {
                let j = i + 1;
                while (j < line.length && /[A-Za-z]/.test(line[j])) j++;
                tokens.push({ type: 'icon', value: line.slice(i + 1, j), kind: 'icon' });
                i = j;
                continue;
            }
            const open = c;
            const close = c === '(' ? ')' : c === '<' ? '>' : ']';
            let depth = 0;
            let j = i;
            for (; j < line.length; j++) {
                if (line[j] === open) depth++;
                else if (line[j] === close) {
                    depth--;
                    if (depth === 0) {
                        j++;
                        break;
                    }
                }
            }
            const inner = line.slice(i, j);
            const kind = c === '(' ? 'reporter' : c === '<' ? 'boolean' : 'menu';
            tokens.push({ type: 'expr', value: inner, kind });
            i = j;
            continue;
        }
        text += c;
        i++;
    }
    pushText();
    return tokens;
};

const matchTokens = (lineTokens, template) => {
    const lt = lineTokens.filter(t => t.type !== 'comment');
    if (lt.length !== template.length) return null;
    const map = {};
    for (let i = 0; i < lt.length; i++) {
        const l = lt[i];
        const t = template[i];
        if (t.type === 'text') {
            if (l.type !== 'text') return null;
            if (l.value.trim() !== t.value.trim()) return null;
        } else {
            if (l.type === 'text') return null;
            map[t.key] = l;
        }
    }
    return map;
};

// Build candidate templates once per locale.
const buildCandidates = locale => {
    const stmt = [];
    const expr = [];
    Object.keys(allBlocks).forEach(opcode => {
        const info = allBlocks[opcode];
        if (info.noTranslation) return;
        const msg = getMessageForLocale(locale, opcode);
        const type = info.type || BLOCK;
        const cand = { opcode, type, template: tokenizeTemplate(msg) };
        if (type === REPORTER_BLOCK || type === BOOLEAN_BLOCK) expr.push(cand);
        else stmt.push(cand);
    });
    return { stmt, expr };
};

class Parser {
    constructor(text, opts) {
        this.opts = Object.assign({ locale: 'en', tab: ' '.repeat(4) }, opts);
        this.lines = text.split('\n');
        this.pos = 0;
        this.candidates = buildCandidates(this.opts.locale);
    }

    indentOf(line) {
        const unit = this.opts.tab;
        let count = 0;
        let i = 0;
        while (line.startsWith(unit, i)) {
            count++;
            i += unit.length;
        }
        return count;
    }

    nextNonBlank() {
        while (this.pos < this.lines.length) {
            const line = this.lines[this.pos];
            if (line.trim() === '') {
                this.pos++;
                continue;
            }
            return line;
        }
        return null;
    }

    // Parse the inline value of an expression token into an Inputtable.
    parseExpr(token) {
        if (token.type === 'icon') return new Icon(token.value);
        const raw = token.value;
        const inner = raw.slice(1, -1);
        if (token.kind === 'menu') {
            // [value v] -> menu; [value] -> string/color input
            const m = /^([\s\S]*?)\s+v\]$/.exec(inner);
            if (m) return new Menu(null, null, unescape(m[1]));
            if (COLOR_RE.test(inner)) return new ColorPickerInput(unescape(inner));
            return new StringInput(unescape(inner));
        }
        if (token.kind === 'boolean') {
            if (inner.trim() === '') return new EmptyBooleanInput();
            const varMatch = /(.+?)::\s*variables$/.exec(inner);
            if (varMatch) return new Variable(null, unescape(varMatch[1]), 'variables', BOOLEAN_BLOCK);
            const block = this.matchBlock(inner, this.candidates.expr);
            if (block) return block;
            return new Variable(null, unescape(inner), null, BOOLEAN_BLOCK);
        }
        // reporter
        const listMatch = /(.+?)::\s*list$/.exec(inner);
        if (listMatch) return new Variable(null, unescape(listMatch[1]), 'list', REPORTER_BLOCK);
        const varMatch = /(.+?)::\s*variables$/.exec(inner);
        if (varMatch) return new Variable(null, unescape(varMatch[1]), 'variables', REPORTER_BLOCK);
        if (NUMBER_RE.test(inner)) return new NumberInput(inner);
        const block = this.matchBlock(inner, this.candidates.expr);
        if (block) return block;
        return new Variable(null, unescape(inner), null, REPORTER_BLOCK);
    }

    // Match an inner string against reporter/boolean block templates.
    matchBlock(inner, candidates) {
        const tokens = tokenizeLine(inner).filter(t => t.type !== 'comment');
        for (const cand of candidates) {
            const map = matchTokens(tokens, cand.template);
            if (!map) continue;
            const inputtables = {};
            Object.keys(map).forEach(key => {
                inputtables[key] = this.parseExpr(map[key]);
            });
            const Cls = classForType(cand.type);
            const block = new Cls(null, cand.opcode, inputtables);
            // Let any menus learn their parent opcode for static/dynamic disambiguation.
            Object.keys(inputtables).forEach(k => {
                if (inputtables[k] instanceof Menu) inputtables[k].opcode = cand.opcode;
            });
            return block;
        }
        return null;
    }

    // Match a statement-level line; returns {cand, map} or null.
    matchStatement(lineTokens) {
        const matches = [];
        for (const cand of this.candidates.stmt) {
            const map = matchTokens(lineTokens, cand.template);
            if (map) matches.push({ cand, map });
        }
        if (!matches.length) return null;
        if (matches.length === 1) return matches[0];
        // Ambiguous: prefer a C/E block when structure indicates else.
        const hasElse = this.looksLikeE();
        for (const m of matches) {
            if (m.cand.type === E_BLOCK && hasElse) return m;
        }
        for (const m of matches) {
            if (m.cand.type !== E_BLOCK) return m;
        }
        return matches[0];
    }

    looksLikeE() {
        // Peek following lines (within this script) for an `else` separator.
        let p = this.pos + 1;
        const base = this.indentOf(this.lines[this.pos]);
        while (p < this.lines.length) {
            const line = this.lines[p];
            if (line.trim() === '') {
                p++;
                continue;
            }
            const lvl = this.indentOf(line);
            if (lvl < base) break;
            if (lvl === base && line.trim() === 'else') return true;
            if (lvl === base) break;
            p++;
        }
        return false;
    }

    parseStatement(baseIndent) {
        const rawLine = this.lines[this.pos];
        let line = rawLine.trim();
        // Trailing comment handling.
        let comment = null;
        const commentIdx = line.indexOf(' // ');
        if (commentIdx !== -1) {
            comment = line.slice(commentIdx + 4).trim();
            line = line.slice(0, commentIdx).trim();
        }
        // Procedure definition.
        if (line.startsWith('define ')) {
            const proc = line.slice(6).trim();
            const block = new Definition(null, proc);
            block.comment = comment;
            this.pos++;
            return block;
        }
        // Procedure call (identified by trailing ::custom).
        if (/::\s*custom$/.test(line)) {
            const procPart = line.replace(/::\s*custom$/, '').trim();
            const { proc, args } = this.parseProcCall(procPart);
            const block = new ProcedureCall(null, proc, args);
            block.comment = comment;
            this.pos++;
            return block;
        }
        // Generic statement.
        let tokens = tokenizeLine(line);
        // Strip trailing block options (::category / ::type).
        let options = {};
        const last = tokens[tokens.length - 1];
        if (last && last.type === 'text') {
            const optMatch = /^::\s*([\w-]+)(?:\s+([\w-]+))?$/.exec(last.value.trim());
            if (optMatch) {
                options = { category: optMatch[1], type: optMatch[2] };
                tokens = tokens.slice(0, -1);
            }
        }
        const matched = this.matchStatement(tokens);
        if (!matched) {
            // Unknown statement: skip line to avoid corrupting the model.
            this.pos++;
            return null;
        }
        const { cand, map } = matched;
        const inputtables = {};
        Object.keys(map).forEach(key => {
            inputtables[key] = this.parseExpr(map[key]);
        });
        Object.keys(inputtables).forEach(k => {
            if (inputtables[k] instanceof Menu) inputtables[k].opcode = cand.opcode;
        });
        const Cls = classForType(cand.type);
        const block = new Cls(null, cand.opcode, inputtables);
        block.comment = comment;
        if (options.category) block._options = options;
        this.pos++;
        if (cand.type === C_BLOCK) this.consumeSubstack(block, 'SUBSTACK', baseIndent);
        else if (cand.type === E_BLOCK) {
            this.consumeSubstack(block, 'SUBSTACK', baseIndent);
            this.expectLine('else');
            this.consumeSubstack(block, 'SUBSTACK2', baseIndent);
        }
        return block;
    }

    expectLine(text) {
        const line = this.lines[this.pos];
        if (line && line.trim() === text) {
            this.pos++;
            return true;
        }
        return false;
    }

    consumeSubstack(block, key, baseIndent) {
        const blocks = [];
        while (this.pos < this.lines.length) {
            const rawLine = this.lines[this.pos];
            if (rawLine.trim() === '') {
                this.pos++;
                continue;
            }
            const lvl = this.indentOf(rawLine);
            if (lvl <= baseIndent) break;
            const stmt = this.parseStatement(baseIndent + 1);
            if (stmt) blocks.push(stmt);
        }
        block.inputtables = block.inputtables || {};
        block.inputtables[key] = new Stack(blocks);
    }

    parseStack(baseIndent) {
        const blocks = [];
        while (this.pos < this.lines.length) {
            const rawLine = this.lines[this.pos];
            if (rawLine.trim() === '') break;
            const lvl = this.indentOf(rawLine);
            if (lvl < baseIndent) break;
            if (lvl > baseIndent) break;
            const stmt = this.parseStatement(baseIndent);
            if (stmt) blocks.push(stmt);
        }
        return blocks;
    }

    parseProcCall(procPart) {
        const tokens = tokenizeLine(procPart).filter(t => t.type !== 'comment');
        const argObj = [];
        let proc = '';
        tokens.forEach(t => {
            if (t.type === 'text') {
                proc += t.value;
            } else if (t.kind === 'boolean') {
                proc += '%b';
                argObj.push(this.parseExpr(t));
            } else {
                proc += '%s';
                argObj.push(this.parseExpr(t));
            }
        });
        return { proc, args: argObj };
    }

    parse() {
        const scripts = [];
        while (this.pos < this.lines.length) {
            const line = this.nextNonBlank();
            if (line === null) break;
            const base = this.indentOf(line);
            const stack = this.parseStack(base);
            if (stack.length) scripts.push(stack);
        }
        return scripts;
    }
}

const parseScratchblocks = (text, opts) => {
    const parser = new Parser(text, opts);
    return parser.parse();
};

export default parseScratchblocks;
