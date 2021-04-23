/// <reference types="node" />

import { Writable, Readable } from "stream";

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
   * 
   * Correspondence: `String.prototype.replaceAll`'s 1st argument.
   * 
   * Accepts a literal string or a RegExp object.
   * 
   * Will replace all occurrences by converting input into a global RegExp
   * object, which means that the according replacement might be invoked 
   * multiple times for each full match to be replaced.
   * 
   * Every `match` and `replacement` not arranged in pairs is silently
   * discarded in `options`, while in `options.replace` that will result in
   * an error thrown.
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

// An interface can only extend an object type or intersection of object types with statically known members.
type ReplaceOptions = MultipleReplacementOption & MatchAndReplaceOption & SearchAndReplaceOption;

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
  /**
   * A post-processing function that consumes transformed strings and returns a
   * string or a Buffer. This option has higher priority over option `join`.
   * 
   * If readableObjectMode is enabled, any object accepted by Node.js objectMode
   * streams can be returned.
   */
  postProcessing: (part: string, isLastPart: boolean) => any
}

type WritableOrVoid = Writable | void;

// streamEdit - file
interface UpdateFileOptions extends BasicOptions {
  /**
   * Path to the file.
   */
  file: string;
  /**
   * Correspondence: fs.read's 4th argument - position
   * 
   * The location where to begin reading data from the file.
   * 
   * Default: 0
   */
  readStart?: number;
  /**
   * Correspondence: fs.write's 4th argument - position
   * 
   * The offset from the beginning of the file where the substituted data should be written.
   * 
   * writeStart should be smaller or equal to readStart.
   * 
   * Default: 0
   */
  writeStart?: number;
}

// streamEdit - TransformReadable
interface TransformReadableOptions<T> extends BasicOptions {
  /**
   * A Readable stream.
   */
  from: Readable;
  /**
   * A Writable stream.
   */
  to: T;
}

interface TransformReadableOptionsAlias<T> extends BasicOptions {
  /**
   * Alias of `from`.
   */
  readableStream: Readable;
  /**
   * Alias of `to`.
   */
  writableStream: T;
}

// streamEdit - files
interface UpdateFilesOptions extends BasicOptions {
  /**
   * A array of filepaths.
   */
  files: string[];
  /**
   * Correspondence: fs.read's 4th argument - position
   * 
   * The location where to begin reading data from the file.
   * 
   * Applies to all files.
   * 
   * Default: 0
   */
  readStart?: number;
   /**
    * Correspondence: fs.write's 4th argument - position
    * 
    * The offset from the beginning of the file where the substituted data should be written.
    * 
    * Applies to all files.
    * 
    * writeStart should be smaller or equal to readStart.
    * 
    * Default: 0
    */
  writeStart?: number;
}

// streamEdit - readables -> writable

interface MultipleReadablesToWritableOptions<T> extends BasicOptions {
  /**
   * An array of Readable streams.
   */
  from: Array<Readable>;
  /**
   * A Writable stream.
   */
  to: T;
  /**
   * Concatenate results of transformed Readables with the input value.
   * 
   * Accepts a literal string or a Buffer.
   * 
   * Default: ""
   */
  contentJoin: string | Buffer;
}

interface MultipleReadablesToWritableOptionsAlias<T> extends BasicOptions {
  /**
   * Alias of `from`.
   * An array of Readable streams
   */
  readableStreams: Array<Readable>;
  /**
   * Alias of `to`.
   * A Writable stream.
   */
  writableStream: T;
  /**
   * Concatenate results of transformed Readables with the input value.
   * 
   * Accepts a literal string or a Buffer.
   * 
   * option.encoding will be passed along with contentJoin to Writable.write
   * 
   * Default: ""
   */
  contentJoin: string | Buffer;
}

// streamEdit - readable -> writables

interface ReadableToMultipleWritablesOptions<T> extends BasicOptions {
  /**
   * A Readable stream source.
   */
  from: Readable;
  /**
   * An array of Writable streams, preferably being the same type.
   */
  to: Array<T>;
}

interface ReadableToMultipleWritablesOptionsAlias<T> extends BasicOptions {
  /**
   * Alias of `from`.
   * A Readable stream source.
   */
  readableStream: Readable;
  /**
   * Alias of `to`.
   * An array of Writable streams, preferably being the same type.
   */
  writableStreams: Array<T>;
}

/**
 * update files, or transform streams and pipe/tee/combine them here and there.
 * 
 * `from` `to` cannot be arrays at the same time.
 * 
 * P.S. TS doesn't support overloading functions with same
 * number of parameters, so a huge union is there 😀
 */
export declare function streamEdit<T extends WritableOrVoid>(
  options: 

    UpdateFileOptions | TransformReadableOptions<T> | TransformReadableOptionsAlias<T> |

    UpdateFilesOptions |
    
    MultipleReadablesToWritableOptionsAlias<T> | MultipleReadablesToWritableOptions<T> |
    
    ReadableToMultipleWritablesOptions<T> | ReadableToMultipleWritablesOptionsAlias<T>
): Promise< T[] | T >;

type StreamEdit = typeof streamEdit;
export const sed: StreamEdit;