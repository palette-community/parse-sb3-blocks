import parseScript from './parse.js';

const toScratchblocks = (scriptStart, blocks, locale, opts, comments) => {
    if (!opts) opts = {};
    opts = Object.assign(
        {
            tab: ' '.repeat(4),
            variableStyle: 'none',
            _stackNum: 0,
        },
        opts
    );
    const parsed = parseScript(scriptStart, blocks, comments);
    return parsed
        .map(block => {
            let rendered = block.toScratchblocks(locale, opts);
            if (block.comment) {
                const nl = rendered.indexOf('\n');
                if (nl === -1) rendered = `${rendered} // ${block.comment}`;
                else rendered = `${rendered.slice(0, nl)} // ${block.comment}${rendered.slice(nl)}`;
            }
            return rendered;
        })
        .join('\n');
};

export default toScratchblocks;
