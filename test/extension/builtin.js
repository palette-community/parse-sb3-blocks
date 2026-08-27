// Built-in and TurboWarp-core extension test: built-in extensions (pen/music)
// resolve from the bundled block metadata, TurboWarp core extensions
// (control_while) are registered without needing a URL, and bare extension IDs
// in project.extensions must NOT trigger spurious URL-fetch failures.

import { projectToSnippets } from '../../src/index.js';

const EXT = `(function (e) {
  e.getInfo = function () {
    return { id:'myext', name:'E', blocks:[
      { opcode:'myext_hello', blockType:'command', text:'say [M]', arguments:{M:{type:'string'}} }
    ], menus:{} };
  };
  Scratch.extensions.register(e);
})({});`;
const fakeFetch = async () => ({
    ok: true, status: 200, statusText: 'OK', text: async () => EXT,
});

const project = {
    targets: [{
        isStage: false,
        name: 'Sprite1',
        blocks: {
            w: { opcode:'control_while', next:null, parent:null, topLevel:true, x:0, y:0,
                 inputs:{ CONDITION:[1,[11,true]], SUBSTACK:[2,'b'] }, fields:{} },
            b: { opcode:'operator_not', next:null, parent:'w',
                 inputs:{ OPERAND:[1,[11,false]] }, fields:{} },
            p: { opcode:'pen_setPenColorToColor', next:null, parent:null, topLevel:true, x:0, y:0,
                 inputs:{ COLOR:[1,[9,'#135b8d']] }, fields:{} },
            e: { opcode:'myext_hello', next:null, parent:null, topLevel:true, x:0, y:0,
                 inputs:{ M:[1,[10,'hi']] }, fields:{} },
        },
        comments: {},
    }],
    // bare IDs (pen/music) and a TurboWarp core id (control_while) must be
    // resolved from bundled metadata, not fetched; only the URL is fetched.
    extensions: ['pen', 'music', 'control_while', 'https://example.com/myext.js'],
};

const warnings = [];
const origWarn = console.warn;
console.warn = (...a) => warnings.push(a.join(' '));

const out = await projectToSnippets(project, { locale: 'en', fetch: fakeFetch });
console.warn = origWarn;

const sprite = out.targets.Sprite1;
const all = [...sprite.scripts, ...sprite.orphans];
let failed = false;

if (!all.some(s => s.includes('while'))) {
    failed = true; origWarn('control_while (TW core) not rendered');
}
if (!all.some(s => s.includes('set pen color'))) {
    failed = true; origWarn('pen (built-in) not rendered');
}
if (!all.some(s => s.includes('say'))) {
    failed = true; origWarn('myext_hello (URL) not rendered');
}
const bad = warnings.filter(w =>
    /Failed to parse URL|Could not load extension (pen|music|control_while)/.test(w));
if (bad.length) {
    failed = true;
    for (const w of bad) origWarn('BAD WARN:', w);
}

if (failed) {
    origWarn('FAIL: built-in / TurboWarp-core extension test');
    process.exit(1);
}
origWarn('PASS: built-in and TurboWarp-core extensions render (no spurious fetch warnings)');
