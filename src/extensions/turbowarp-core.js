// Curated getInfo()-style descriptors for TurboWarp "core" extensions.
//
// These extensions are injected by TurboWarp and frequently do NOT appear in a
// project's `extensions` array, so they cannot be auto-fetched by URL. They are
// registered at load time (see registerBuiltinExtensions) so standard projects
// render real labels instead of dropping the blocks.
//
// To add more, append a descriptor here (or run scripts/extract-extension.mjs
// on the extension source and move it into this list).

const control_while = {
    id: 'control_while',
    name: 'Control While',
    blocks: [
        {
            opcode: 'control_while',
            blockType: 'loop',
            text: 'while [CONDITION]',
            arguments: { CONDITION: { type: 'boolean' } },
        },
    ],
    menus: {},
};

export default [control_while];
