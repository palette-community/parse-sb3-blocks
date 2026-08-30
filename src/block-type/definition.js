import { getMessageForLocale } from '../block-mapping/block-mapping.js';
import Stack from '../input/stack.js';

export default class Definition {
    // `argIds` carries the original prototype `inputs` keys (the dynamic
    // argId strings from `mutation.argumentids`). When the definition is
    // round-tripped from a real .sb3, preserving the keys keeps the
    // rebuilt `procedures_prototype.inputs` aligned with any
    // `procedures_call` whose `inputs` are keyed by the same strings.
    constructor(id, proc, body = [], argIds = null) {
        this.id = id;
        this.proc = proc;
        this.body = body;
        this.argIds = argIds;
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
