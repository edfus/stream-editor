declare module "update-file-content" {
    type GlobalLimit = number;
    type LocalLimit = number;

    type SearchAndReplace = {
        replacement: string | ((wholeMatch: string, ...args: string[]) => string);
        full_replacement?: Boolean;
        limit?: LocalLimit;
    } & (
        {
            search: string | RegExp;
        } | {
            /**
             * Alias for options.search
             */
            match: string | RegExp;
        }
    )

    type SearchReplaceOptions = 
        SearchAndReplace | {
            limit: GlobalLimit,
            replace: Array<SearchAndReplace>
        }

    type BasicOptions = SearchReplaceOptions & {
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

    export function updateFileContent(
        options: BasicOptions & (
            {
                file: string
            }
        )
    ) : Promise<void>

    export function updateFileContent<T extends NodeJS.WritableStream> (
        options: BasicOptions & (
            {
                from: NodeJS.ReadableStream;
                to: T;
            } | {
                readStream: NodeJS.ReadableStream;
                writeStream: T;
            }
        )
    ) : Promise<T>

    export function updateFiles (
        options: BasicOptions & (
            {
                files: Array<string>
            }
        )
    ) : Promise<void[]>

    export function updateFiles<T extends NodeJS.WritableStream> (
        options: BasicOptions & { contentJoin: string } & (
            {
                from: NodeJS.ReadableStream[];
                to: T;
            } | {
                readStream: NodeJS.ReadableStream[];
                writeStream: T;
            }
        )
    ) : Promise<T>

    export function updateFiles<T extends NodeJS.WritableStream> (
        options: BasicOptions & (
            {
                from: NodeJS.ReadableStream;
                to: Array<T>;
            } | {
                readStream: NodeJS.ReadableStream;
                writeStream: Array<T>;
            }
        )
    ) : Promise<T[]>
}

// declare namespace NodeJS {
//     // Forward declaration for `NodeJS.EventEmitter` from node.d.ts.
//     // Required by Mocha.Runnable, Mocha.Runner, and Mocha.Suite.
//     // NOTE: Mocha *must not* have a direct dependency on @types/node.
//     // tslint:disable-next-line no-empty-interface
//     interface EventEmitter { }

//     // Augments NodeJS's `global` object when node.d.ts is loaded
//     // tslint:disable-next-line no-empty-interface
//     interface Global extends Mocha.MochaGlobals { }
// }