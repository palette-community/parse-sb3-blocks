# parse-sb3-blocks

**parse-sb3-blocks** 解析 Scratch 3.0 的积木格式，并将其转换为 [scratchblocks](https://github.com/scratchblocks/scratchblocks) 格式。

[English](README.md) | 中文

> **palette-community 开发者维护的 fork。** 本仓库是 apple502j/parse-sb3-blocks 的一个持续维护分支。我们在原项目的基础上扩展出了**双向解析器**：除了原有的「SB3 JSON → scratchblocks 文本」方向外，还能将 scratchblocks 文本反向解析回 SB3 积木图，从而实现结构无损的往返转换。它被用作 [palette-community/scratch-toolchain](https://github.com/palette-community/scratch-toolchain) 的解析器。

## 用法
### 示例
```js
import {toScratchblocks} from 'parse-sb3-blocks';

const sb3blocks = {
    'ND,(]G?KLIy(IZrd2sl.': {
        opcode: 'event_whenflagclicked',
        ...
    }
};

console.log(toScratchblocks('ND,(]G?KLIy(IZrd2sl.', sb3blocks, 'en', {tabs: ' '.repeat(4)}));
```

### toScratchblocks
**toScratchblocks** 是一个函数，最多接受三到四个参数：

- scriptStart：开始解析的积木 ID。**必须是某个可连接积木（Connectable）的 ID**（包含帽子积木）。
- blocks：序列化后的 SB3 格式（project.json 格式）积木数据。
- locale：使用的语言区域。`en` 始终可用。
- opts：可选。一个对象（见下文）。
- comments：可选。target 的 `comments` 映射（以注释 ID 为键）。传入后，积木注释会以 `// comment` 后缀形式渲染出来。

#### 选项
`opts` 可包含以下属性：

- tabs：C/E 积木缩进所用的制表符。**注意：虽然 parse-sb3-blocks 可以使用非空格/制表符缩进，但 scratchblocks 只接受制表符或空格。** 传入空字符串可去掉缩进。默认为四个空格。
- variableStyle：设为 `none`（默认）时，变量末尾绝不会带 `::variables`；设为 `always` 时总会带 `::variables`；设为 `as-needed` 时，若积木名存在冲突才会带 `::variables`。

### 双向转换
本库支持 SB3 积木图与 scratchblocks 文本格式之间的无损往返。

#### parseScratchblocks
**parseScratchblocks** 将 scratchblocks 文本解析回内部积木模型。它接受文本和一个可选的 `opts` 对象（`locale` 与 `tab`）。其返回值是一个脚本数组，每个脚本是 `Connectable` 实例的数组。以 `// comment` 形式书写的注释会被附加到其后的积木上。

```js
import { parseScratchblocks } from 'parse-sb3-blocks';

const scripts = parseScratchblocks('when @greenFlag clicked\nmove (10) steps', { locale: 'en' });
```

#### toSB3
**toSB3** 将内部模型（即 `parseScratchblocks` 返回的结构）序列化回 SB3 积木字典。它返回 `{ blocks, comments, scriptStarts }`。积木与变量的 ID 会重新生成，`comments` 是以注释 ID 为键的映射（适合合并进 target 的 `comments`）。

```js
import { toSB3 } from 'parse-sb3-blocks';

const { blocks, comments, scriptStarts } = toSB3(scripts);
```

### 工程级转换（自动加载扩展）
这些辅助函数作用于完整的 SB3 工程对象（即解析后的 `project.json`）。它们会自动加载工程顶层 `extensions` 数组中列出的所有 JS 扩展（借助 scratch-sandbox），因此无需任何手动提取步骤。

#### toScratchblocksProject
把每个角色的脚本渲染成一段拼接好的 scratchblocks 文本。

```js
import { toScratchblocksProject } from 'parse-sb3-blocks';

const text = await toScratchblocksProject(project, { locale: 'en' });
```

#### projectToSnippets
返回一个按角色（target）分组的 JSON。在每个角色内部，积木被拆分为 `scripts`（从带有 `next` 的顶层积木开始的连续堆栈，或任何帽子/事件积木）与 `orphans`（没有 `next` 的孤立顶层积木——悬空的报告积木、单独的脱离命令积木）。返回值是纯 JSON，用 `JSON.stringify` 即可得到最终输出。

```js
import { projectToSnippets } from 'parse-sb3-blocks';

const { targets } = await projectToSnippets(project, { locale: 'en' });
// {
//   "Stage":   { "isStage": true,  "scripts": ["when @greenFlag clicked\nmove (10) steps"], "orphans": [] },
//   "Sprite1": { "isStage": false, "scripts": ["when X::myext"], "orphans": ["say [hi]::myext", "((1) + (2))"] }
// }
```

往返性质：`SB3 -> toScratchblocks -> parseScratchblocks -> toSB3 -> toScratchblocks` 能复现原始文本；`text -> parseScratchblocks -> toSB3 -> toScratchblocks` 同样稳定。积木级别的元数据（如坐标、shadow 标记，以及舞台级的变量/列表/广播注册表）会被重新生成而不被保留（这是结构层面的无损，而非逐字节的无损）。

### 内部函数与解析器
本库同时导出了一些解析器内部使用的类。它们不属于公开 API，可能随时变动。

#### Inputtable 与 Connectable
Connectable 是可通过 next-parent 连接到栈式积木的实例，包括：
- Block（栈式、帽子、结束积木）
- CBlock
- EBlock（if-else）
- Definition
- ProcedureCall

Inputtable 可用作参数。注意 `Icon` 严格来说不是参数，但属于 Inputtable。
- Stack（用于 C/E 积木的参数）
- Menu（包含字段菜单与菜单积木）
- Variable（变量报告器与自定义积木参数）
- Icon（greenFlag、turnLeft、turnRight 图标）
- BooleanBlock
- ReporterBlock
- Input 及其子类 NumberInput、StringInput、ColorPickerInput、BroadcastMenuInput、EmptyBooleanInput

Connectable 与 Inputtable 都实现了 `toScratchblocks` 方法，接受 `locale` 与 `opts`，与导出的 `toScratchblocks` 类似。

类名以 “Block” 结尾的实例具有以下属性：
- `id`：积木 ID
- `opcode`：积木 opcode
- `inputtables`：输入键到 Inputtable 的对象

### 积木映射
`block-enum.js` 提供了积木类型的枚举。

`translations.js` 是自动生成的文件，包含全部翻译。`options.js` 同样是自动生成的，记录哪些积木因重名而需要选项。

**仅支持 all-blocks.js 中列出的积木与菜单项。**

#### all-blocks.js
all-blocks.js 默认导出 allBlocks，这是一个以 opcode 为键、对象（见下）为值的对象。

该对象包含以下键与值：
- noTranslation：设为 `true` 时，会被翻译生成器忽略。
- defaultMessage：默认语言（英语）下的文案。
- type：积木类型。默认为 `BlockEnum.BLOCK`。
- defaultOptions：使用 defaultMessage 时该积木的默认选项，用于存在重名的情况。可包含 category 键及其值。
- translationKey：用于 scratch-l10n 的翻译键。默认为 opcode 的大写形式。
- boolArg：必须为布尔值的参数数组。用于为空参数填充 `EmptyBooleanInput`。省略时为空数组。

## 构建
构建需要 Node 16+。运行 `npm run build` 即可生成语言区域文件。

### env
- `mode`：除非设为 `dev`，否则结果会被压缩。添加 `docs` 可更新 demo 所用的 JS 文件。
