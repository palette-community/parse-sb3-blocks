import Sanitizer from '../sanitizer.js';
export default class ProcedureCall {
    // `argIds` is the original SB3 `inputs` keys (from
    // `mutation.argumentids`). When the call is round-tripped from a real
    // .sb3 the keys are preserved; when it's synthesised by the forward
    // renderer they are absent and the serialiser falls back to fresh
    // genIds. Forward text is unaffected (it always emits positional
    // `%s` placeholders); byte-identical round-trip depends on the
    // keys being stable.
    constructor(id, proc, argObj, argIds = null) {
        this.id = id;
        this.proc = proc;
        this.argObj = argObj;
        this.argIds = argIds;
    }

    toScratchblocks(locale, opts) {
        let i = 0;
        const procCode = Sanitizer.labelSanitize(this.proc).replace(/%([sb])/g, () =>
            this.argObj[i++].toScratchblocks(locale, opts)
        );
        return `${procCode}::custom`;
    }
}
