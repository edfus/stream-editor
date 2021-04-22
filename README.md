# Update-File-Content

Utility for executing RegEx replacement on files, powered by stream.

[![npm](https://img.shields.io/npm/v/update-file-content?logo=npm)](https://www.npmjs.com/package/update-file-content)
[![install size](https://packagephobia.com/badge?p=update-file-content)](https://packagephobia.com/result?p=update-file-content)
[![codecov](https://codecov.io/gh/edfus/update-file-content/branch/master/graph/badge.svg)](https://codecov.io/gh/edfus/update-file-content)
[![CI](https://github.com/edfus/update-file-content/actions/workflows/node.js.yml/badge.svg?branch=master)](https://github.com/edfus/update-file-content/actions/workflows/node.js.yml)
[![Node.js Version](https://raw.githubusercontent.com/edfus/storage/master/node-lts-badge.svg)](https://nodejs.org/en/about/releases/)

* [Features](#features)
    * [Partial replacement](#partial-replacement)
    * [Updating content of files in streaming fashion](#updating-content-of-files-in-streaming-fashion)
    * [Setting limits on Regular Expressions' maximum executed times](#setting-limits-on-regular-expressions-maximum-executed-times)
    * [Transcoding streams or files](#transcoding-streams-or-files)
    * [Piping/teeing/confluencing streams with proper error handling &amp; propagation](#pipingteeingconfluencing-streams-with-proper-error-handling--propagation)
    * [No dependency](#no-dependency)
    * [High coverage tests](#high-coverage-tests)
* [API](#api)
    * [Update options](#update-options)
    * [Stream options](#stream-options)
      * [updateFileContent - file](#updatefilecontent---file)
      * [updateFileContent - transform Readable](#updatefilecontent---transform-readable)
      * [updateFiles - files](#updatefiles---files)
      * [updateFiles - readables -&gt; writable](#updatefiles---readables---writable)
      * [updateFiles - readable -&gt; writables](#updatefiles---readable---writables)
* [Examples](#examples)

## Features

### Partial replacement

A partial replacement is replacing only the 1st parenthesized capture group substring match with replacement specified, allowing a simpler syntax and a minimum modification.

Take the following snippet converting something like `import x from "../src/x.mjs"` into `import x from "../build/x.mjs"` as an example:

```js
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

### Updating content of files in streaming fashion.

This package will create readable and writable streams connected to a single file at the same time, while disallowing any write operations to advance further than the current reading index. This feature is based on [rw-stream](https://github.com/signicode/rw-stream)'s great work.

To accommodate RegEx replacement (which requires intact strings rather than chunks that may begin or end at any position) with streams, this package brings `separator` (default: `/(?<=\r?\n)/`) and `join` (default: `''`) options into use. You should NOT specify separators that may divide text structures targeted by your RegEx searches, which would result in undefined behavior.

Moreover, as the RegEx replacement part in `options` is actually optional, this package can be used to break up streams and reassemble them like [split2](https://github.com/mcollina/split2) does:

```js
const filepath = join(__dirname, `./file.ndjson`);

/* replace CRLF with LF */
await updateFileContent({
  file: filepath,
  separator: "\r\n",
  join: "\n"
});

/* parse ndjson */
await updateFileContent({
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
updateFileContent({
  from: createReadStream("gbk.txt"),
  to: createWriteStream("hex.txt"),
  decodeBuffers: "gbk",
  encoding: "hex"
});
```

Option `decodeBuffers` is the specific character encoding, like utf-8, iso-8859-2, koi8, cp1261, gbk, etc for decoding the input raw buffer. Some encodings are only available for Node embedded the entire ICU but the good news is that full-icu has been made the default since v14+ (see <https://github.com/nodejs/node/pull/29522>).

Note that option `decodeBuffers` only makes sense when no encoding is assigned and stream data are passed as buffers. Below are some wrong input examples:

```js
updateFileContent({
  from: 
    createReadStream("gbk.txt").setEncoding("utf8"),
  to: createWriteStream("hex.txt"),
  decodeBuffers: "gbk",
  encoding: "hex"
});

updateFileContent({
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

updateFiles({
  from: yamlFiles,
  to: createWriteStream(resultPath),
  contentJoin: "\n\n" // join streams
  // the encoding of contentJoin respects the `encoding` option
});
```

Teeing:
```js
updateFiles({
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

You can have a look at tests regarding error handling [here](https://github.com/edfus/update-file-content/blob/85665e5a9f53a724dab7a42a2d15301eaafddfc2/test/test.mjs#L578-L846).

### No dependency

update-file-content previously depends on [rw-stream](https://github.com/signicode/rw-stream), but for some historical reasons, I refactored rw-stream and bundled it as a part of this package. See [src/rw-stream](https://github.com/edfus/update-file-content/blob/master/src/rw-stream/index.mjs).

Currently, update-file-content has zero dependency.

### High coverage tests

See <https://github.com/edfus/update-file-content/tree/master/test>.

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

  Update files
    √ should check arguments
    √ should pipe one Readable to multiple dumps (55ms)
    √ should replace CRLF with LF
    √ should have replaced /dum(b)/i to dumpling (while preserving dum's case)
    √ should have global and local limitations in replacement amount
    √ should have line buffer maxLength
    √ should update and combine multiple Readable into one Writable
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
      √ updateFiles: can correctly propagate errors emitted by readableStreams
      √ updateFiles: can handle prematurely destroyed readableStreams
      √ updateFiles: can correctly propagate errors emitted by writableStream
      √ updateFiles: can correctly propagate errors emitted by writableStreams
      √ updateFiles: can handle prematurely destroyed writableStreams
      √ updateFiles: can handle prematurely ended writableStreams
    corner cases
      √ can handle empty content
      √ can handle non-string in regular expression split result
    try-on
      √ can handle files larger than 16KiB


  32 passing (362ms)

```

## API

This package has two named exports: `updateFileContent`, `updateFiles`.

`updateFileContent` returns a promise that resolves to undefined for updating file, or a promise that resolves to `writeStream|to`'s reference for stream transforming.

`updateFiles` returns `Promise<T[] | T>`, where T is a generic extending `WritableOrVoid`;

### Update options:
```ts
type GlobalLimit = number;
type LocalLimit = number;

interface BasicReplaceOption {
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
}

interface SearchAndReplaceOption extends BasicReplaceOption {
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
}

interface MatchAndReplaceOption extends BasicReplaceOption {
  /**
   * Alias for options.search.
   */
  match?: string | RegExp;
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

type ReplaceOptions = MultipleReplacementOption `OR` MatchAndReplaceOption `OR` SearchAndReplaceOption;

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
   * Correspondence: encoding of Node.js Buffer.
   * 
   * If specified, then processed and joined strings will be encoded to buffers
   * with that encoding.
   *
   * Node.js currently supportes following options:
   * "ascii" | "utf8" | "utf-8" | "utf16le" | "ucs2" | "ucs-2" | "base64" | "latin1" | "binary" | "hex"
   * Default: "utf8".
   */
  encoding?: BufferEncoding;
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
   * Example: updateFileContent({
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
### Stream options:

#### updateFileContent - file

```ts
interface UpdateFileOptions extends BasicOptions {
  file: string;
  readStart?: number;
  writeStart?: number;
}
function updateFileContent(options: UpdateFileOptions): Promise<void>;
```

#### updateFileContent - transform Readable

```ts
interface TransformReadableOptions<T> extends BasicOptions {
  from: Readable;
  to: T;
}

interface TransformReadableOptionsAlias<T> extends BasicOptions {
  readableStream: Readable;
  writableStream: T;
}

function updateFileContent<T extends Writable>(
  options: TransformReadableOptions<T> | TransformReadableOptionsAlias<T>
): Promise<T>;
```

#### updateFiles - files

```ts
interface UpdateFilesOptions extends BasicOptions {
  files: string[];
  readStart?: number;
  writeStart?: number;
}

function updateFiles(options: UpdateFilesOptions): Promise<void>;
```

#### updateFiles - readables -> writable

```ts
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

function updateFiles<T extends Writable>(
  options: 
    MultipleReadablesToWritableOptionsAlias<T> | MultipleReadablesToWritableOptions<T>
): Promise< T >;
```

#### updateFiles - readable -> writables

```ts
interface ReadableToMultipleWritablesOptions<T> extends BasicOptions {
  from: Readable;
  to: Array<T>;
}

interface ReadableToMultipleWritablesOptionsAlias<T> extends BasicOptions {
  readableStream: Readable;
  writableStreams: Array<T>;
}

function updateFiles<T extends Writable>(
  options: 
    ReadableToMultipleWritablesOptions<T> | ReadableToMultipleWritablesOptionsAlias<T>
): Promise< T[]>;
```

For further reading, take a look at [the declaration file](https://github.com/edfus/update-file-content/blob/master/src/index.d.ts).

## Examples

See [./examples](https://github.com/edfus/update-file-content/tree/master/examples) and [esm2cjs](https://github.com/edfus/esm2cjs)