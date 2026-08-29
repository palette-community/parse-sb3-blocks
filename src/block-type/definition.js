import { getMessageForLocale } from '../block-mapping/block-mapping.js';
import Stack from '../input/stack.js';

export default class Definition {
    constructor(id, proc, body = []) {
        this.id = id;
        this.proc = proc;
        this.body = body;
    }

    toScratchblocks(locale, opts = {}) {
        const head = getMessageForLocale(locale, 'procedures_definition').replace('{PROC}', this.proc);
        if (!this.body || !this.body.length) return head;
        // 函数体作为嵌套栈渲染在 `define` 之下（缩进一级）。
        const stack = new Stack(this.body);
        const inner = stack.toScratchblocks(locale, { ...opts, _stackNum: 1 });
        return `${head}\n${inner}`;
    }
}
