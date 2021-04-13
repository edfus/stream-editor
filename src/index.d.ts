/// <reference types="node" />

import { Writable, Readable } from "stream";

type GlobalLimit = number;
type LocalLimit = number;

interface BasicReplaceOption {
  replacement: string | ((wholeMatch: string, ...args: string[]) => string);
  full_replacement?: Boolean;
  limit?: LocalLimit;
}

interface SearchAndReplaceOption extends BasicReplaceOption {
  search: string | RegExp;
}

interface MatchAndReplaceOption extends BasicReplaceOption {
  /**
   * Alias for options.search
   */
  match: string | RegExp;
}

interface MultipleReplacementOption {
  limit: GlobalLimit;
  replace: Array<SearchAndReplaceOption | MatchAndReplaceOption>;
}

// An interface can only extend an object type or intersection of object types with statically known members.
type ReplaceOptions = MultipleReplacementOption & MatchAndReplaceOption & SearchAndReplaceOption;

interface BasicOptions extends ReplaceOptions {
  /**
   * It's like "file content".split(options.separator).map(str => str.replace(...))
   *  
   * Default: /(?=\r?\n)/.
   */
  separator?: string | RegExp;
  /**
   * It's like "file content".split(options.separator).join(options.join).
   *  
   * Default: "".
   */
  join?: string | ((part: string) => string) | null;
  /**
   * If specified, then strings will be encoded to buffers using the specified encoding.
   * 
   * Default: null.
   */
  encoding?: BufferEncoding;
  /**
   * Accept a specific character encoding, like utf-8, iso-8859-2, koi8, cp1261, gbk, etc,
   * for decoding the input raw buffer. https://nodejs.org/api/util.html#util_whatwg_supported_encodings
   * 
   * This option only makes sense when no encoding is assigned and stream data are 
   * passed as Buffer objects (that is, haven't done sth like readable.setEncoding('utf8'))
   * 
   * Default: "utf8".
   */
  decodeBuffers?: string;
  /**
   * Truncating the rest or not when limitations reached.
   * 
   * Default: false.
   */
  truncate?: Boolean;
  /**
   * The maximum size of the line buffer. A line buffer is used for buffering 
   * the last incomplete substring when dividing the read chunk (typically 64 kb)
   * by options.separator.
   * 
   * Default: Infinity.
   */
  maxLength?: number;
}

type WritableOrVoid = Writable | void;

// updateFileContent - file

interface UpdateFileOptions extends BasicOptions {
  file: string;
}

// updateFileContent - TransformReadable

interface TransformReadableOptions<T> extends BasicOptions {
  from: Readable;
  to: T;
}

interface TransformReadableOptionsAlias<T> extends BasicOptions {
  readableStream: Readable;
  writableStream: T;
}

/**
 * P.S. TS doesn't support overloading functions with same
 * number of parameters, so a huge union is there 😀
 */
export declare function updateFileContent<T extends WritableOrVoid>(
  options: UpdateFileOptions | TransformReadableOptions<T> | TransformReadableOptionsAlias<T>
): Promise<T>;


// updateFiles - files

interface UpdateFilesOptions extends BasicOptions {
  files: string[];
}

// updateFiles - readables -> writable

interface MultipleReadablesToWritableOptions<T> extends BasicOptions {
  from: Array<Readable>;
  to: T;
  contentJoin: string;
}

interface MultipleReadablesToWritableOptionsAlias<T> extends BasicOptions {
  readableStreams: Array<Readable>;
  writableStream: T;
  contentJoin: string;
}

// updateFiles - readable -> writables

interface ReadableToMultipleWritablesOptions<T> extends BasicOptions {
  from: Readable;
  to: Array<T>;
}

interface ReadableToMultipleWritablesOptionsAlias<T> extends BasicOptions {
  readableStream: Readable;
  writableStreams: Array<T>;
}

/**
 * P.S. TS doesn't support overloading functions with same
 * number of parameters, so a huge union is there 😀
 */
export declare function updateFiles<T extends WritableOrVoid>(
  options: 

    UpdateFilesOptions |
    
    MultipleReadablesToWritableOptionsAlias<T> | MultipleReadablesToWritableOptions<T> |
    
    ReadableToMultipleWritablesOptions<T> | ReadableToMultipleWritablesOptionsAlias<T>
): Promise< T[] | T >;