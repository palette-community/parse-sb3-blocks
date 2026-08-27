// Auto-load integration test: a project whose `extensions` array lists an
// extension URL must be converted WITHOUT any manual extraction step. The
// extension is fetched (here via a fake fetch) and registered automatically,
// and the generated SB3 re-emits `extensions` so it can be re-parsed in a loop.

import {
    toScratchblocksProject,
    parseScratchblocks,
    toSB3,
} from '../../src/index.js';

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
          arguments: { A:{type:'number', defaultValue:0}, B:{type:'number', defaultValue:0} } }
      ],
      menus: { who: ['cat','dog'] }
    };
  };
  Scratch.extensions.register(ext);
})({});
`;

const fakeFetch = async url => {
    if (url === 'https://example.com/myext.js') {
        return { ok: true, status: 200, statusText: 'OK', text: async () => EXT_SRC };
    }
    throw new Error(`unexpected url ${url}`);
};

const project = {
    targets: [
        {
            isStage: false,
            blocks: {
                root: { opcode:'myext_hello', next:null, parent:null, topLevel:true, x:0, y:0,
                        inputs: { MESSAGE:[1,[10,'hi']], WAIT:[2,'bool'] }, fields: { WHO:['cat',null] } },
                bool: { opcode:'operator_equals', next:null, parent:'root',
                        inputs: { OPERAND1:[1,[10,'x']], OPERAND2:[1,[10,'y']] }, fields:{} },
                rep:  { opcode:'myext_add', next:null, parent:null, topLevel:true, x:0, y:0,
                        inputs: { A:[1,[4,'7']], B:[1,[4,'3']] }, fields:{} },
            },
            comments: {},
        },
    ],
    extensions: ['https://example.com/myext.js'],
};

const opts = { tab: '    ', fetch: fakeFetch, locale: 'en' };

const warnings = [];
const origWarn = console.warn;
console.warn = (...a) => warnings.push(a.join(' '));

const t1 = await toScratchblocksProject(project, opts);

const model = parseScratchblocks(t1, { locale: opts.locale, tab: opts.tab });
const sb3 = toSB3(model);

let failed = false;
if (!sb3.extensions || sb3.extensions.length !== 1 ||
    sb3.extensions[0] !== 'https://example.com/myext.js') {
    failed = true;
    origWarn('extensions not re-emitted:', JSON.stringify(sb3.extensions));
}

const t2 = await toScratchblocksProject(
    { targets: [{ blocks: sb3.blocks, comments: sb3.comments }], extensions: sb3.extensions },
    opts
);
console.warn = origWarn;

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
    origWarn('FAIL: extension auto-load round trip');
    process.exit(1);
}

origWarn('PASS: extension auto-load (project.extensions -> SB3 -> text, 0 warnings)');
