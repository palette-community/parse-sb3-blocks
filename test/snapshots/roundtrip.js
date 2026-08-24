import fs from 'fs';
import path from 'path';
import { test } from '../click.js';
import { toScratchblocks, parseScratchblocks, toSB3 } from '../../src/index.js';

const dirname = path.resolve('test', 'snapshots');
const fixturesDir = path.resolve(dirname, 'fixtures');

fs.readdirSync(fixturesDir)
    .filter(filename => filename.endsWith('.json'))
    .forEach(filename => test(filename, t => {
        const filePath = path.resolve(fixturesDir, filename);
        const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const scripts = Array.isArray(config.scriptStart) ? config.scriptStart : [config.scriptStart];
        const locale = config.locale || 'en';
        const opts = config.opts || {};
        const comments = config.comments || {};
        const snapshotPath = path.resolve(dirname, 'snapshots', filename.replace('.json', '.txt'));
        const expected = fs.readFileSync(snapshotPath, 'utf-8').trim();

        // Forward must still match the committed snapshot (regression guard).
        const forward = scripts
            .map(start => toScratchblocks(start, config.blocks, locale, opts, comments))
            .join('\n\n')
            .trim();
        if (forward !== expected) {
            t.fail(`forward output diverged:\n${forward}`);
            return;
        }

        // Bidirectional: text -> model -> SB3 -> text must be stable.
        const modelScripts = parseScratchblocks(forward, { locale, tab: opts.tab });
        const sb3 = toSB3(modelScripts);
        const back = sb3.scriptStarts
            .map(start => toScratchblocks(start, sb3.blocks, locale, opts, sb3.comments))
            .join('\n\n')
            .trim();
        if (back === forward) {
            t.pass();
        } else {
            t.fail(`round-trip diverged:\n${back}`);
        }
    }));
