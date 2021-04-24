# Stream-Editor

[![npm](https://img.shields.io/npm/v/stream-editor?logo=npm)](https://www.npmjs.com/package/stream-editor)
[![install size](https://packagephobia.com/badge?p=stream-editor)](https://packagephobia.com/result?p=stream-editor)
[![codecov](https://codecov.io/gh/edfus/stream-editor/branch/master/graph/badge.svg)](https://codecov.io/gh/edfus/stream-editor)
[![CI](https://github.com/edfus/stream-editor/actions/workflows/node.js.yml/badge.svg?branch=master)](https://github.com/edfus/stream-editor/actions/workflows/node.js.yml)
[![Node.js Version](https://raw.githubusercontent.com/edfus/storage/master/node-lts-badge.svg)](https://nodejs.org/en/about/releases/)

* [Features](#features)
    * [Partial replacement](#partial-replacement)
    * [Substituting texts within files in streaming fashion](#substituting-texts-within-files-in-streaming-fashion)
    * [Setting limits on Regular Expressions' maximum executed times](#setting-limits-on-regular-expressions-maximum-executed-times)
    * [Transcoding streams or files](#transcoding-streams-or-files)
    * [Piping/teeing/confluencing streams with proper error handling &amp; propagation](#pipingteeingconfluencing-streams-with-proper-error-handling--propagation)
    * [No dependency](#no-dependency)
    * [High coverage tests](#high-coverage-tests)
* [API](#api)
    * [Overview](#overview)
    * [Options for replacement](#options-for-replacement)
    * [Options for stream transform](#options-for-stream-transform)
    * [Options for stream input/output](#options-for-stream-inputoutput)
* [Examples](#examples)

## Features

### Partial replacement

A partial replacement is replacing only the 1st parenthesized capture group substring match with replacement specified, allowing a simpler syntax and a minimum modification.

Take the following snippet converting something like `import x from "../src/x.mjs"` into `import x from "../build/x.mjs"` as an example:

```js
import { sed as updateFileContent } from "stream-editor" ;

updateFileContent({
  file: "index.mjs",
  search: matchParentFolderImport(/(src\/(.+?))/),
  replacement: "build/$2",
  maxTimes: 2
});

function matchImport (addtionalPattern) {
  const parts = /import\s+.+\s+from\s*['"](.+?)['"];?/.source.split("(.+?)");

  return new RegExp([
    parts[0],
    addtionalPattern.source,
    parts[1]
  ].join(""));
}
```

Special replacement patterns (parenthesized capture group placeholders) are well supported in a partial replacement, either for function replacements or string replacements. And all other concepts are designed to keep firmly to their origins in vanilla String.prototype.replace method, though the $& (also the 1st supplied value to replace function) and $1 (the 2nd param passed) always have the same value, supplying the matched substring in 1st PCG.

You can specify a truthy `isFullReplacement` to perform a full replacment instead.

### Substituting texts within files in streaming fashion

This package will create readable and writable streams connected to a single file at the same time, while disallowing any write operations to advance further than the current reading index. This feature is based on [rw-stream](https://github.com/signicode/rw-stream)'s great work.

To accommodate RegEx replacement (which requires intact strings rather than chunks that may begin or end at any position) with streams, this package brings `separator` (default: `/(?<=\r?\n)/`) and `join` (default: `''`) options into use. You should NOT specify separators that may divide text structures targeted by your RegEx searches, which would result in undefined behavior.

Moreover, as the RegEx replacement part in `options` is actually optional, this package can be used to break up streams and reassemble them like [split2](https://github.com/mcollina/split2) does:

```js
// named export sed is an alias for streamEdit
const { streamEdit } = require("stream-editor");

const filepath = join(__dirname, `./file.ndjson`);

/* replace CRLF with LF */
await streamEdit({
  file: filepath,
  separator: "\r\n",
  join: "\n"
});

/* parse ndjson */
await streamEdit({
  from: createReadStream(filepath),
  to: new Writable({
    objectMode: true,
    write(parsedObj, _enc, cb) {
      return (
        doSomething()
          .then(() => cb())
          .catch(cb)
      );
    }
  }),
  separator: "\n",
  readableObjectMode: true,
  postProcessing: part => JSON.parse(part)
});
```

You can specify `null` as the `separator` to completely disable splitting.

### Setting limits on Regular Expressions' maximum executed times

This is achieved by altering all `replacement` into replacement functions and adding layers of proxying on them.

```js
const { sed: updateFiles } = require("stream-editor");

/**
 * add "use strict" plus a compatible line ending
 * to the beginning of every commonjs file.
 */

// maxTimes version
updateFiles({
  files: commonjsFiles,
  match: /^().*(\r?\n)/,
  replacement: `"use strict";$2`,
  maxTimes: 1
});

// limit version
updateFiles({
  files: commonjsFiles,
  replace: [
    {
      match: /^().*(\r?\n)/,
      replacement: `"use strict";$2`,
      /**
       * a local limit,
       * applying restriction on certain match's maximum executed times.
       */
      limit: 1 
    }
  ]
  // a global limit, limit the maximum count of every search's executed times.
  limit: 1 
});
```

Once the limit specified by option `limit` is reached, if option `truncate` is falsy (false by default), underlying transform stream will become a transparent passThrough stream, otherwise the remaining part will be discarded, while `maxTimes` just performs a removal on that search.

### Transcoding streams or files

```js
streamEdit({
  from: createReadStream("gbk.txt"),
  to: createWriteStream("hex.txt"),
  decodeBuffers: "gbk",
  encoding: "hex"
});
```

Option `decodeBuffers` is the specific character encoding, like utf-8, iso-8859-2, koi8, cp1261, gbk, etc for decoding the input raw buffer. Some encodings are only available for Node embedded the entire ICU but the good news is that full-icu has been made the default since v14+ (see <https://github.com/nodejs/node/pull/29522>).

Note that option `decodeBuffers` only makes sense when no encoding is assigned and stream data are passed as buffers. Below are some wrong input examples:

```js
streamEdit({
  from: 
    createReadStream("gbk.txt").setEncoding("utf8"),
  to: createWriteStream("hex.txt"),
  decodeBuffers: "gbk",
  encoding: "hex"
});

streamEdit({
  from: 
    createReadStream("gbk.txt", "utf8"),
  to: createWriteStream("hex.txt"),
  decodeBuffers: "gbk",
  encoding: "hex"
});
```

Option `encoding` is for encoding all processed and joined strings to buffers with according encoding. Following options are supported by Node.js: `ascii`, `utf8`, `utf-8`, `utf16le`, `ucs2`, `ucs-2`, `base64`, `latin1`, `binary`, `hex`.

### Piping/teeing/confluencing streams with proper error handling & propagation

Confluence:
```js
const yamlFiles = await (
  fsp.readdir(folderpath, { withFileTypes: true })
      .then(dirents =>
        dirents
          .filter(dirent => dirent.isFile() && dirent.name.endsWith(".yaml"))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(({ name }) => createReadStream(join(folderpath, name)))
      )
);

streamEdit({
  from: yamlFiles,
  to: createWriteStream(resultPath),
  contentJoin: "\n\n" // join streams
  // the encoding of contentJoin respects the `encoding` option
});
```

Teeing:
```js
streamEdit({
  readableStream: new Readable({
    read(size) {
      // ...
    }
  }),
  writableStreams: new Array(6).fill(0).map((_, i) =>
    createWriteStream(join(resultFolderPath, `./test-source${i}`))
  )
});
```

You can have a look at tests regarding error handling [here](https://github.com/edfus/stream-editor/blob/85665e5a9f53a724dab7a42a2d15301eaafddfc2/test/test.mjs#L578-L846).

### No dependency

stream-editor previously depends on [rw-stream](https://github.com/signicode/rw-stream), but for some historical reasons, I refactored rw-stream and bundled it as a part of this package. See [src/rw-stream](https://github.com/edfus/stream-editor/blob/master/src/rw-stream/index.mjs).

Currently, stream-editor has zero dependency.

### High coverage tests

See <https://github.com/edfus/stream-editor/tree/master/test>.

```plain text

  Normalize & Replace
    √ can handle string match with special characters
    √ can handle partial replacement with placeholders
    √ can handle non-capture-group parenthesized pattern: Assertions
    √ can handle non-capture-group parenthesized pattern: Round brackets
    √ can handle pattern starts with a capture group
    √ can handle partial replacement but without capture groups
    √ can await replace partially with function
    √ recognize $\d{1,3} $& $` $' and check validity (throw warnings)

  Edit streams
    √ should check arguments
    √ should warn unknown/unneeded options
    √ should respect FORCE_COLOR, NO_COLOR, NODE_DISABLE_COLORS
    √ should pipe one Readable to multiple dumps (51ms)
    √ should replace CRLF with LF
    √ should have replaced /dum(b)/i to dumpling (while preserving dum's case)
    √ should have global and local limitations in replacement amount
    √ should have line buffer maxLength
    √ should edit and combine multiple Readable into one Writable
    √ has readableObjectMode
    truncation & limitation
      √ truncating the rest when limitations reached
      √ not: self rw-stream
      √ not: piping stream
    transcoding
      √ gbk to utf8 buffer
      √ gbk to hex with HWM
    error handling
      √ destroys streams properly when one of them closed prematurely
      √ destroys streams properly if errors occurred during initialization
      √ multiple streams: can correctly propagate errors emitted by readableStreams
      √ multiple streams: can handle prematurely destroyed readableStreams
      √ multiple streams: can correctly propagate errors emitted by writableStream
      √ multiple streams: can correctly propagate errors emitted by writableStreams
      √ multiple streams: can handle prematurely destroyed writableStreams
      √ multiple streams: can handle prematurely ended writableStreams
    corner cases
      √ can handle empty content
      √ can handle non-string in regular expression split result
    try-on
      √ can handle files larger than 16KiB


  34 passing (256ms)

```

## API

### Overview

This package has two named function exports: `streamEdit` and `sed` (an alias for `streamEdit`).

`streamEdit` returns a promise that resolves to `void | void[]` for files, a promise that resolves to `Writable[] | Writable` for streams (which keeps output streams' references).

An object input with one or more following options is acceptable to `streamEdit`:

### Options for replacement

| name          | alias | expect                  | safe to ignore | default    |
| :--:          |  :-:  | :-----:                 | :-:      |  :--:      |
| search        | match | `string` \| `RegExp`    | ✔       |  none      |
| replacement   |   x   | `string` \|  `(wholeMatch, ...args) => string`  | ✔  | none |
| limit         |   x   | `number`                | ✔       |  `Infinity`  |
| maxTimes      |   x   | `number`                | ✔       |  `Infinity`  |
| isFullReplacement | x | `boolean`               | ✔       |  `false`     |
| disablePlaceholders |x| `boolean`               | ✔       |  `false`     |
| replace       |   x   | an `Array` of { `search`, `replacement` }        | ✔ | none |
| join          |   x   | `string` \| `(part: string) => string` \| `null` | ✔ | `part => part`  |
| postProcessing|   x   | `(part: string, isLastPart: boolean) => any`     | ✔ | none  |

```ts
type GlobalLimit = number;
type LocalLimit = number;

interface SearchAndReplaceOption {
  /**
   * Correspondence: `String.prototype.replaceAll`'s 1st argument.
   * 
   * Accepts a literal string or a RegExp object.
   * 
   * Will replace all occurrences by converting input into a global RegExp
   * object, which means that the according replacement might be invoked 
   * multiple times for each full match to be replaced.
   * 
   * Every `search` and `replacement` not arranged in pairs is silently
   * discarded in `options`, while in `options.replace` that will result in
   * an error thrown.
   */
  search?: string | RegExp;
  /**
   * Correspondence: String.prototype.replace's 2nd argument.
   * 
   * Replaces the according text for a given match, a string or
   * a function that returns the replacement text can be passed.
   * 
   * Special replacement patterns (parenthesized capture group placeholders)
   * are well supported.
   * 
   * For a partial replacement, $& (also the 1st supplied value to replace
   * function) and $1 (the 2nd param passed) always have the same value,
   * supplying the matched substring in the parenthesized capture group
   * you specified.
   */
  replacement?: string | ((wholeMatch: string, ...args: string[]) => string);
  /**
   * Apply restriction on certain search's maximum executed times.
   * 
   * Upon reaching the limit, if option `truncate` is falsy (false by default),
   * underlying transform stream will become a transparent passThrough stream.
   * 
   * Default: Infinity. 0 is considered as Infinity for this option.
   */
  limit?: LocalLimit;
  /**
   * Observe a certain search's executed times, remove that search right
   * after upper limit reached.
   * 
   * Default: Infinity. 0 is considered as Infinity for this option.
   */
  maxTimes?: number;
  /**
   * Perform a full replacement or not.
   * 
   * A RegExp search without capture groups or a search in string will be
   * treated as a full replacement silently.
   */
  isFullReplacement?: Boolean;
  /**
   * Only valid for a string replacement.
   * 
   * Disable placeholders in replacement or not. Processed result shall be
   * exactly the same as the string replacement if set to true.
   * 
   * Default: false
   */
  disablePlaceholders?: Boolean;
}

interface MultipleReplacementOption {
  /**
   * Apply restriction on the maximum count of every search's executed times.
   * 
   * Upon reaching the limit, if option `truncate` is falsy (false by default),
   * underlying transform stream will become a transparent passThrough stream.
   * 
   * Default: Infinity. 0 is considered as Infinity for this option.
   */
  limit?: GlobalLimit;
  /**
   * Should be an array of { [ "match" | "search" ], "replacement" } pairs.
   * 
   * Possible `search|match` and `replacement` pair in `options` scope will be
   * prepended to `options.replace` array, if both exist.
   */
  replace?: Array<SearchAndReplaceOption | MatchAndReplaceOption>;
}

type ReplaceOptions = MultipleReplacementOption `OR` SearchAndReplaceOption;

interface BasicOptions extends ReplaceOptions {
  /**
   * Correspondence: String.prototype.join's 1nd argument, though a function 
   * is also acceptable.
   * 
   * You can specify a literal string or a function that returns the post-processed
   * part.
   * 
   * Example function for appending a CRLF: part => part.concat("\r\n");
   * 
   * Default: part => part
   */
  join?: string | ((part: string) => string) | null;
  /**
   * A post-processing function that consumes transformed strings and returns a
   * string or a Buffer. This option has higher priority over option `join`.
   * 
   * If readableObjectMode is enabled, any object accepted by Node.js objectMode
   * streams can be returned.
   */
  postProcessing: (part: string, isLastPart: boolean) => any
}
```

### Options for stream transform

| name          | alias | expect                  | safe to ignore | default    |
| :--:          |  :-:  | :-----:                 | :-:      |  :--:            |
| separator     |   x   | `string` \| `RegExp` \| `null`| ✔ |  `/(?<=\r?\n)/`  |
| encoding      |   x   | `string` \| `null`      | ✔       |  `null`      |
| decodeBuffers |   x   | `string`                | ✔       |  `"utf8"`    |
| truncate      |   x   | `boolean`               | ✔       |  `false`     |
| maxLength     |   x   | `number`                | ✔       |  `Infinity`  |
| readableObjectMode| x | `boolean`               | ✔       |  `false`     |

Options that are only available under certain context:
| name          | alias | expect                  | context  | default    |
| :--:          |  :-:  | :-----:                 | :-:      |  :--:            |
| readStart     |   x   | `number`                | file\[s\]|  `0`         |
| writeStart    |   x   | `number`                | file\[s\]|  `0`         |
| contentJoin   |   x   | `string` \| `Buffer`    | readableStreams |  `""` |

```ts
interface BasicOptions extends ReplaceOptions {
  /**
   * Correspondence: String.prototype.split's 1nd argument.
   * 
   * Accepts a literal string or a RegExp object.
   * 
   * Used by underlying transform stream to split upstream data into separate
   * to-be-processed parts.
   * 
   * String.prototype.split will implicitly call `toString` on non-string &
   * non-regex & non-void values.
   * 
   * Specify `null` or `undefined` to process upstream data as a whole.
   * 
   * Default: /(?<=\r?\n)/. Line endings following lines.
   */
  separator?: string | RegExp | null;
  /**
   * Correspondence: encoding of Node.js Buffer.
   * 
   * If specified, then processed and joined strings will be encoded to buffers
   * with that encoding.
   *
   * Node.js currently supportes following options:
   * "ascii" | "utf8" | "utf-8" | "utf16le" | "ucs2" | "ucs-2" | "base64" | "latin1" | "binary" | "hex"
   * Default: null.
   */
  encoding?: BufferEncoding | null;
  /**
   * Correspondence: encodings of WHATWG Encoding Standard TextDecoder.
   * 
   * Accept a specific character encoding, like utf-8, iso-8859-2, koi8, cp1261,
   * gbk, etc for decoding the input raw buffer.
   * 
   * This option only makes sense when no encoding is assigned and stream data are 
   * passed as Buffer objects (that is, haven't done something like
   * readable.setEncoding('utf8'));
   * 
   * Example: streamEdit({
   *    from: createReadStream("gbk.txt"),
   *    to: createWriteStream("utf8.txt"),
   *    decodeBuffers: "gbk"
   * });
   * 
   * Some encodings are only available for Node embedded the entire ICU (full-icu).
   * See https://nodejs.org/api/util.html#util_class_util_textdecoder.
   * 
   * Default: "utf8".
   */
  decodeBuffers?: string;
  /**
   * Truncating the rest or not when limits reached.
   * 
   * Default: false.
   */
  truncate?: Boolean;
  /**
   * The maximum size of the line buffer.
   * 
   * A line buffer is the buffer used for buffering the last incomplete substring
   * when dividing chunks (typically 64 KiB) by options.separator.
   * 
   * Default: Infinity.
   */
  maxLength?: number;
  /**
   * Correspondence: readableObjectMode option of Node.js stream.Transform
   * 
   * Options writableObjectMode and objectMode are not supported.
   * 
   * Default: Infinity.
   */
  readableObjectMode?: boolean;
}

interface UpdateFileOptions extends BasicOptions {
  file: string;
  readStart?: number;
  writeStart?: number;
}

interface UpdateFilesOptions extends BasicOptions {
  files: string[];
  readStart?: number;
  writeStart?: number;
}

interface MultipleReadablesToWritableOptions<T> extends BasicOptions {
  from: Array<Readable>;
  to: T;
  /**
   * Concatenate results of transformed Readables with the input value.
   * Accepts a literal string or a Buffer.
   * option.encoding will be passed along with contentJoin to Writable.write
   * Default: ""
   */
  contentJoin: string | Buffer;
}

interface MultipleReadablesToWritableOptionsAlias<T> extends BasicOptions {
  readableStreams: Array<Readable>;
  writableStream: T;
  contentJoin: string | Buffer;
}
```

### Options for stream input/output

| name           | alias | expect                   | with     | default           |
| :--:           |  :-:  | :-----:                  | :-:      |  :--:   |
| file           |   x   | `string`                 | self     |  none   |
| files          |   x   | an `Array` of `string`   | self     |  none   |
| readableStream | from  | `Readable`               | writableStream\[s\]|  none   |
| writableStream |  to   | `Writable`               | readableStream\[s\]|  none   |
| readableStreams| from  | an `Array` of `Readable` | writableStream     |  none   |
| writableStreams|  to   | an `Array` of `Writable` | readableStream     |  none   |

file:
```ts
interface UpdateFileOptions extends BasicOptions {
  file: string;
  readStart?: number;
  writeStart?: number;
}
function streamEdit(options: UpdateFileOptions): Promise<void>;
```

files:
```ts
interface UpdateFilesOptions extends BasicOptions {
  files: string[];
  readStart?: number;
  writeStart?: number;
}

function streamEdit(options: UpdateFilesOptions): Promise<void[]>;
```

transform Readable:
```ts
interface TransformReadableOptions<T> extends BasicOptions {
  [ from | readableStream ]: Readable;
  [ to   | writableStream ]: T;
}

function streamEdit<T extends Writable>(
  options: TransformReadableOptions<T>
): Promise<T>;
```

readables -> writable:
```ts
interface MultipleReadablesToWritableOptions<T> extends BasicOptions {
  [ from | readableStreams ]: Array<Readable>;
  [ to   | writableStream  ]: T;
  contentJoin: string | Buffer;
}

function streamEdit<T extends Writable>(
  options: MultipleReadablesToWritableOptions<T>
): Promise< T >;
```

readable -> writables
```ts
interface ReadableToMultipleWritablesOptions<T> extends BasicOptions {
  [ from | readableStream  ]: Readable;
  [ to   | writableStreams ]: Array<T>;
}

function streamEdit<T extends Writable>(
  options: ReadableToMultipleWritablesOptions<T>
): Promise< T[]>;
```

For further reading, take a look at [the declaration file](https://github.com/edfus/stream-editor/blob/master/src/index.d.ts).

## Examples

See [./examples](https://github.com/edfus/stream-editor/tree/master/examples) and [esm2cjs](https://github.com/edfus/esm2cjs)