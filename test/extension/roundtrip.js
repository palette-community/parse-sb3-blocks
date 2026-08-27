// Extension integration test: a scratch-sandbox style JS extension must
// round-trip stably through (SB3 -> text -> SB3 -> text). Covers command,
// reporter and event blocks, menu fields, and nested boolean inputs.
//
// Run via `npm run test:extension`.

import { toScratchblocks, parseScratchblocks, toSB3, registerExtensionFromSource } from '../../src/index.js';

const EXT_SRC = `
(function (ext) {
  ext.getInfo = function () {
    return {
      id: 'myext', name: 'My Extension', color1: '#ff0000',
      blocks: [
        { opcode: 'myext_hello', blockType: 'command',
          text: 'say [MESSAGE] to [WHO] and wait [WAIT]',
          arguments: { MESSAGE: {type:'string', defaultValue:''}, WHO:{type:'string'}, WAIT:{type:'boolean'} } },
        { opcode: 'myext_add', blockType: 'reporter',
          text: 'add [A] and [B]',
          arguments: { A:{type:'number', defaultValue:0}, B:{type:'number', defaultValue:0} } },
        { opcode: 'myext_when', blockType: 'event',
          text: 'when [WHO] clicks', arguments:{ WHO:{type:'string'} } }
      ],
      menus: { who: ['cat','dog'] }
    };
  };
  Scratch.extensions.register(ext);
})({});
`;

await registerExtensionFromSource(EXT_SRC, { url: 'https://example.com/myext.js' });

const blocks = {
    root: { opcode:'myext_hello', next:null, parent:null, topLevel:true, x:0, y:0,
            inputs: { MESSAGE:[1,[10,'hi']], WAIT:[2,'bool'] }, fields: { WHO:['cat',null] } },
    bool: { opcode:'operator_equals', next:null, parent:'root',
            inputs: { OPERAND1:[1,[10,'x']], OPERAND2:[1,[10,'y']] }, fields:{} },
    rep:  { opcode:'myext_add', next:null, parent:null, topLevel:true, x:0, y:0,
            inputs: { A:[1,[4,'7']], B:[1,[4,'3']] }, fields:{} },
    hat:  { opcode:'myext_when', next:null, parent:null, topLevel:true, x:0, y:0,
            inputs:{}, fields:{ WHO:['dog',null] } },
};

const opts = { tab: '    ' };
const locale = 'en';

const warnings = [];
const origWarn = console.warn;
console.warn = (...a) => warnings.push(a.join(' '));

const t1 = [
    toScratchblocks('root', blocks, locale, opts, {}),
    toScratchblocks('rep', blocks, locale, opts, {}),
    toScratchblocks('hat', blocks, locale, opts, {}),
].join('\n');

const model = parseScratchblocks(t1, { locale, tab: opts.tab });
const sb3 = toSB3(model);

let t2 = '';
for (const sid of sb3.scriptStarts) {
    t2 += toScratchblocks(sid, sb3.blocks, locale, opts, sb3.comments) + '\n';
}
t2 = t2.trim();
console.warn = origWarn;

let failed = false;
if (t2 !== t1.trim()) {
    failed = true;
    const a = t1.trim().split('\n');
    const b = t2.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
            origWarn(`ROUND TRIP DIVERGED at line ${i}`);
            origWarn('ORIG:', JSON.stringify(a[i]));
            origWarn('BACK:', JSON.stringify(b[i]));
            break;
        }
    }
}
if (warnings.length) {
    failed = true;
    for (const w of warnings.slice(0, 20)) origWarn('WARNING:', w);
}

if (failed) {
    origWarn('FAIL: extension round trip');
    process.exit(1);
}

origWarn('PASS: extension round trip (SB3 -> text -> SB3 -> text, 0 warnings)');
