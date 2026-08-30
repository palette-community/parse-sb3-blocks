import Sanitizer from '../sanitizer.js';
import { getMenuItemForLocale, getMenuKeyForValue } from '../block-mapping/block-mapping.js';

export default class Menu {
    constructor(id, opcode, content) {
        this.id = id;
        // note: opcode is the opcode of the PARENT block.
        this.opcode = opcode;
        this.content = content;
        // A "special" menu is a fixed option list (effects, directions, ...).
        // Variable/list selectors are dynamic and are not special.
        this.isSpecial = getMenuKeyForValue(opcode, content) !== null;
        this.menuKey = this.isSpecial ? getMenuKeyForValue(opcode, content) : null;
    }

    blockSyntax(locale) {
        return getMenuItemForLocale(locale, this.opcode, this.content);
    }

    toScratchblocks(locale) {
        if (!this.isSpecial) return `[${Sanitizer.sanitize(this.content)} v]`;
        return `[${Sanitizer.sanitize(this.blockSyntax(locale))} v]`;
    }
}
