// Real-project integration test: the original SB3 project must round-trip
// stably through (SB3 -> text -> SB3 -> text) and lose no supported blocks.
//
// Stability here means the *rendered scratchblocks text* is byte-identical
// before and after a parse/serialize cycle. Coordinates, block ids and the
// variable/list/broadcast registries are intentionally regenerated.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toScratchblocks, parseScratchblocks, toSB3 } from '../../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const proj = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'project.json'), 'utf8')
);

const opts = { tab: '    ' };
const locale = 'en';

// Capture unknown-opcode / unknown-block warnings so they fail the test.
const warnings = [];
const origWarn = console.warn;
console.warn = (...a) => warnings.push(a.join(' '));

const targetTexts = [];
for (const target of proj.targets) {
    const blocks = target.blocks || {};
    const comments = target.comments || {};
    const top = Object.keys(blocks).filter(id => blocks[id].topLevel);
    let text = '';
    for (const id of top) {
        text += toScratchblocks(id, blocks, locale, opts, comments) + '\n\n';
    }
    targetTexts.push(text.trim());
}
console.warn = origWarn;

const fullText = targetTexts.filter(Boolean).join('\n\n');

const modelScripts = parseScratchblocks(fullText, { locale, tab: opts.tab });
const sb3 = toSB3(modelScripts);

let back = '';
for (const sid of sb3.scriptStarts) {
    back += toScratchblocks(sid, sb3.blocks, locale, opts, sb3.comments) + '\n\n';
}
back = back.trim();

let failed = false;
if (back !== fullText) {
    failed = true;
    const a = fullText.split('\n');
    const b = back.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
            origWarn(`ROUND TRIP DIVERGED at line ${i}`);
            origWarn('ORIG:', JSON.stringify(a[i]));
            origWarn('BACK:', JSON.stringify(b[i]));
            break;
        }
    }
    origWarn(`orig lines ${a.length}, back lines ${b.length}`);
}

if (warnings.length) {
    failed = true;
    for (const w of warnings.slice(0, 20)) origWarn('WARNING:', w);
}

if (failed) {
    origWarn('FAIL: real-project round trip');
    process.exit(1);
}

origWarn('PASS: real-project round trip (text -> SB3 -> text stable, 0 warnings)');
