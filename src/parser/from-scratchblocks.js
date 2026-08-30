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
import Sanitizer from '../sanitizer.js';
import { getMessageForLocale, getOptsForLocale } from '../block-mapping/block-mapping.js';
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
                if (line[j] === '\\' && j + 1 < line.length) {
                    j++;
                    continue;
                }
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
            // `(<expr>)::custom` mid-expression: absorb the `::custom` suffix
            // into this token so a procedures_call used as a vanilla block's
            // input is recognised as a single expression token (matching the
            // template's `{X}` / `{Y}` placeholders). The raw `line` is
            // untouched, so the statement-level `::custom$` check below
            // (for top-level procedure calls) still fires when appropriate.
            const customMatch = /^::\s*custom\b/.exec(line.slice(j));
            if (customMatch) {
                tokens[tokens.length - 1].isCustom = true;
                j += customMatch[0].length;
            }
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
    if (lt.length === template.length) {
        const map = {};
        for (let i = 0; i < lt.length; i++) {
            const l = lt[i];
            const t = template[i];
            if (t.type === 'text') {
                if (l.type !== 'text') return null;
                if (unescape(l.value).trim() !== unescape(t.value).trim()) return null;
            } else {
                if (l.type === 'text') return null;
                map[t.key] = l;
            }
        }
        return map;
    }
    if (lt.length > template.length) return null;
    // lt.length < template.length: allow the trailing template placeholders to
    // match empty (e.g. `round ()` => a reporter whose numeric input is blank).
    for (let i = lt.length; i < template.length; i++) {
        if (template[i].type !== 'placeholder') return null;
    }
    const map = {};
    for (let i = 0; i < lt.length; i++) {
        const l = lt[i];
        const t = template[i];
        if (t.type === 'text') {
            if (l.type !== 'text') return null;
            if (unescape(l.value).trim() !== unescape(t.value).trim()) return null;
        } else {
            if (l.type === 'text') return null;
            map[t.key] = l;
        }
    }
    for (let i = lt.length; i < template.length; i++) {
        map[template[i].key] = { type: 'text', kind: 'reporter', value: '' };
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
        let template = tokenizeTemplate(msg);
        // Some English translations drop their placeholders (e.g. CONTROL_STOP
        // => "stop"). Fall back to the canonical defaultMessage so the reverse
        // parser can still capture inputs. Forward emits placeholder-shaped
        // syntax, so this keeps round-trips lossless.
        if (!template.some(t => t.type === 'placeholder') && info.defaultMessage) {
            const dmTpl = tokenizeTemplate(Sanitizer.labelSanitize(info.defaultMessage));
            if (dmTpl.some(t => t.type === 'placeholder')) template = dmTpl;
        }
        const type = info.type || BLOCK;
        const cand = { opcode, type, template };
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
        // Stack of parameter-name sets for the procedures currently being
        // parsed, so expression parsing can tell a procedure parameter
        // (`(n :: custom)`) apart from a custom-block call (`(block :: custom)`).
        this.paramStack = [];
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
        // `(<inner>)::custom` absorbed by the tokenizer marks a custom-block
        // call used as an input. Strip the outer parens and parse the inner
        // as a procedures_call.
        if (token.isCustom) {
            const m = /^[(<\[]([\s\S]*)[)\]>]$/.exec(token.value);
            const inner = m ? m[1] : token.value;
            const { proc, args } = this.parseProcCall(inner);
            return new ProcedureCall(null, proc, args);
        }
        const raw = token.value;
        const inner = raw.slice(1, -1);
        if (token.kind === 'menu') {
            // [value v] -> menu; [value] -> string/color input
            const m = /^([\s\S]*?)\s+v$/.exec(inner);
            if (m) return new Menu(null, null, unescape(m[1]));
            if (COLOR_RE.test(inner)) return new ColorPickerInput(unescape(inner));
            return new StringInput(unescape(inner));
        }
        if (token.kind === 'boolean') {
            if (inner.trim() === '') return new EmptyBooleanInput();
            const varMatch = /(.+?)::\s*variables$/.exec(inner);
            if (varMatch) return new Variable(null, unescape(varMatch[1]), 'variables', BOOLEAN_BLOCK);
            let work = inner;
            let options = null;
            const optTail = /^(.*?)::\s*([\w-]+)(?:\s+([\w-]+))?$/.exec(inner);
            if (optTail && optTail[2] !== 'variables' && optTail[2] !== 'list') {
                work = optTail[1];
                options = { category: optTail[2], type: optTail[3] };
            }
            if (options && options.category === 'custom') {
                if (this.isCurrentParam(work)) {
                    const blk = new Block(null, 'argument_reporter_boolean', {});
                    blk.fields = { VALUE: [unescape(work), null] };
                    return blk;
                }
                const { proc, args } = this.parseProcCall(work);
                return new ProcedureCall(null, proc, args);
            }
            const block = this.matchBlock(work, this.candidates.expr, options);
            if (block) {
                if (options) block._options = options;
                return block;
            }
            return new Variable(null, unescape(work), options ? options.category : null, BOOLEAN_BLOCK);
        }
        // reporter
        const listMatch = /(.+?)::\s*list$/.exec(inner);
        if (listMatch) return new Variable(null, unescape(listMatch[1]), 'list', REPORTER_BLOCK);
        const varMatch = /(.+?)::\s*variables$/.exec(inner);
        if (varMatch) return new Variable(null, unescape(varMatch[1]), 'variables', REPORTER_BLOCK);
        // Strip a trailing ::category / ::type option (e.g. `length of [x v]::data`)
        // without consuming the `::variables` / `::list` variable forms above.
        let work = inner;
        let options = null;
        const optTail = /^(.*?)::\s*([\w-]+)(?:\s+([\w-]+))?$/.exec(inner);
        if (optTail && optTail[2] !== 'variables' && optTail[2] !== 'list') {
            work = optTail[1];
            options = { category: optTail[2], type: optTail[3] };
        }
        if (options && options.category === 'custom') {
            if (this.isCurrentParam(work)) {
                const blk = new Block(null, 'argument_reporter_string_number', {});
                blk.fields = { VALUE: [unescape(work), null] };
                return blk;
            }
            const { proc, args } = this.parseProcCall(work);
            return new ProcedureCall(null, proc, args);
        }
        if (NUMBER_RE.test(work)) return new NumberInput(work);
        const block = this.matchBlock(work, this.candidates.expr, options);
        if (block) {
            if (options) block._options = options;
            return block;
        }
        return new Variable(null, unescape(work), options ? options.category : null, REPORTER_BLOCK);
    }

    isCurrentParam(name) {
        const stack = this.paramStack;
        return stack.length > 0 && stack[stack.length - 1].has(String(name).trim());
    }

    // Match an inner string against reporter/boolean block templates.
    matchBlock(inner, candidates, options) {
        const tokens = tokenizeLine(inner).filter(t => t.type !== 'comment');
        let matches = [];
        for (const cand of candidates) {
            const map = matchTokens(tokens, cand.template);
            if (!map) continue;
            matches.push({ cand, map });
        }
        if (!matches.length) return null;
        // Use a trailing ::category hint to disambiguate identical-looking templates
        // (e.g. `length of [x v]::data` vs `length of [x v]::operators`).
        if (options && options.category) {
            const filtered = matches.filter(m => {
                const o = getOptsForLocale(this.opts.locale, m.cand.opcode);
                return o && o.category === options.category;
            });
            if (filtered.length) matches = filtered;
        }
        const { cand, map } = matches[0];
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
        // A standalone comment line (scratchblocks `//` or an escaped `\//`). It
        // must be treated as a comment, never as a block — otherwise a comment
        // whose text happens to end with `::custom` / `::ext` would be misread
        // as a procedure call / extension block and break the round-trip.
        if (/^\\?\/\//.test(line)) {
            // Exception: a line that *also* ends with `::<category>` is a
            // procedure/extension block whose name literally begins with `//`
            // (an escaped comment marker), not a comment. Let it fall through so
            // the procedure/extension branches parse it correctly.
            if (!/::\s*[\w-]+\s*$/.test(line)) {
                this.pos++;
                return { __comment: line.replace(/^\\?\/\//, '').trim() };
            }
            // Drop only the leading escape char; the `//` itself belongs to the
            // block name (`\// foo` is scratchblocks' escaped `// foo`).
            line = line.replace(/^\\/, '');
        }
        // Calls to a procedure literally named `//` (proccode `// %s`) render as
        // `// [arg]::custom`, which scratchblocks would otherwise read as a comment.
        // Reconstruct the call explicitly: name `// %s`, single string argument.
        const commentProc = line.match(/^\/\/\s*\[([\s\S]*?)\]::\s*custom$/);
        if (commentProc) {
            // The captured arg is raw scratchblocks-escaped text; unescape
            // it before handing to StringInput, which will re-sanitize on
            // serialize. Without this, `\` in the value is double-escaped
            // and the round-trip diverges.
            const block = new ProcedureCall(null, '// %s', [new StringInput(unescape(commentProc[1]))]);
            block.comment = comment;
            this.pos++;
            return block;
        }
        // Procedure definition.
        if (line.startsWith('define ')) {
            const proc = line.slice(6).trim();
            const block = new Definition(null, proc);
            block.comment = comment;
            this.pos++;
            // Track this procedure's parameter names so that references to them
            // inside the body parse as `argument_reporter` (not variables/calls).
            const argNames = [...proc.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean);
            this.paramStack.push(new Set(argNames));
            // Consume the indented function body so it stays attached to the
            // definition (otherwise it would parse as detached top-level blocks).
            const body = [];
            while (this.pos < this.lines.length) {
                const rawLine = this.lines[this.pos];
                if (rawLine.trim() === '') { this.pos++; continue; }
                const lvl = this.indentOf(rawLine);
                if (lvl <= baseIndent) break;
                const stmt = this.parseStatement(baseIndent + 1);
                if (!stmt) continue;
                if (stmt.__comment !== undefined) {
                    if (body.length) body[body.length - 1].comment = stmt.__comment;
                    else block.comment = block.comment || stmt.__comment;
                    continue;
                }
                body.push(stmt);
            }
            this.paramStack.pop();
            block.body = body;
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
        // Strip trailing block options (::category / ::type). These may be glued
        // to the final word (e.g. "key pressed::event") or a separate token.
        let options = {};
        const last = tokens[tokens.length - 1];
        if (last && last.type === 'text') {
            const optMatch = /^::\s*([\w-]+)(?:\s+([\w-]+))?$/.exec(last.value.trim());
            if (optMatch) {
                options = { category: optMatch[1], type: optMatch[2] };
                tokens = tokens.slice(0, -1);
            } else {
                const tailMatch = /^(.*?)::\s*([\w-]+)(?:\s+([\w-]+))?$/.exec(last.value.trim());
                if (tailMatch) {
                    options = { category: tailMatch[2], type: tailMatch[3] };
                    last.value = tailMatch[1];
                }
            }
        }
        // A lone reporter/boolean expression on its own line (a floating reporter,
        // e.g. a top-level extension reporter) isn't a statement, so match it via
        // the expression candidates instead of the statement ones.
        if (tokens.length === 1) {
            const t = tokens[0];
            if (t.kind === 'reporter' || t.kind === 'boolean') {
                const block = this.parseExpr(t);
                block.comment = comment;
                this.pos++;
                return block;
            }
        }
        const matched = this.matchStatement(tokens);
        if (!matched) {
            // Unknown statement: warn and skip its whole subtree (mirrors parseScript,
            // which drops the unknown block and everything parented to it).
            console.warn('Unknown scratchblocks statement:', line);
            this.pos++;
            while (this.pos < this.lines.length) {
                const l = this.lines[this.pos];
                if (l.trim() === '') {
                    this.pos++;
                    continue;
                }
                if (this.indentOf(l) > baseIndent) {
                    this.pos++;
                    continue;
                }
                break;
            }
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
        if (cand.type === C_BLOCK) {
            this.consumeSubstack(block, 'SUBSTACK', baseIndent);
            this.expectLine('end');
        } else if (cand.type === E_BLOCK) {
            this.consumeSubstack(block, 'SUBSTACK', baseIndent);
            this.expectLine('else');
            this.consumeSubstack(block, 'SUBSTACK2', baseIndent);
            this.expectLine('end');
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
            if (!stmt) continue;
            if (stmt.__comment !== undefined) {
                if (blocks.length) blocks[blocks.length - 1].comment = stmt.__comment;
                continue;
            }
            blocks.push(stmt);
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
            if (!stmt) continue;
            if (stmt.__comment !== undefined) {
                if (blocks.length) blocks[blocks.length - 1].comment = stmt.__comment;
                continue;
            }
            blocks.push(stmt);
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
        // In scratchblocks, indentation only nests C/E substacks; a hat's body
        // (and any other `next` continuation) sits at the SAME indent as the hat.
        // So we first collect the whole flat top-level stack in order (each
        // top-level statement is parsed on its own; C/E blocks and `define`
        // consume their indented bodies internally), then split it into scripts
        // at every hat / `define` / floating reporter.
        const top = [];
        while (this.pos < this.lines.length) {
            const line = this.nextNonBlank();
            if (line === null) break;
            const base = this.indentOf(line);
            if (base > 0) {
                // A stray indented line with no enclosing block: skip it.
                this.pos++;
                continue;
            }
            const stmt = this.parseStatement(0);
            if (!stmt) continue;
            top.push(stmt);
        }
        const scripts = [];
        let current = null;
        // A `define` consumes its body internally, so it cannot have a trailing
        // top-level continuation; the next statement must start a fresh script.
        let currentClosed = false;
        for (const conn of top) {
            if (conn.__comment !== undefined) {
                if (current) {
                    const lb = current[current.length - 1];
                    if (lb) lb.comment = conn.__comment;
                }
                continue;
            }
            const info = (conn.opcode && allBlocks[conn.opcode]) || {};
            // A hat starts a new script. Only `event_when*` opcodes are hats;
            // `event_broadcast` / `event_broadcast_menu` are plain statements
            // and must continue the current script's `next` chain.
            const isHat = info.isHat ||
                (conn.opcode && /^event_when/.test(conn.opcode));
            const isReporter = info.type === REPORTER_BLOCK || info.type === BOOLEAN_BLOCK;
            const isStarter = conn instanceof Definition || isHat || isReporter;
            if (!current || currentClosed || isStarter) {
                current = [conn];
                scripts.push(current);
                currentClosed = conn instanceof Definition;
            } else {
                current.push(conn);
            }
        }
        return scripts;
    }
}

const parseScratchblocks = (text, opts) => {
    const parser = new Parser(text, opts);
    return parser.parse();
};

export default parseScratchblocks;
