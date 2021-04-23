import { process_stream, rw_stream } from "./streams.mjs";
import { PassThrough, Readable, Writable } from "stream";

let escapeRegEx; // lazy load
const captureGroupPlaceholdersPattern = /(?<!\\)\$([1-9]{1,3}|\&|\`|\')/;
const captureGroupPlaceholdersPatternGlobal = new RegExp(captureGroupPlaceholdersPattern, "g");

// is () and not \( \) nor (?<=x) (?<!x) (?=x) (?!x)
// (?!\?) alone is enough, as /(?/ is an invalid RegExp
const splitToPCGroupsPattern = /(.*?)(?<!\\)\((?!\?)(.*)(?<!\\)\)(.*)/;

const isColorEnabled = (
  "FORCE_COLOR" in process.env
  ? [1, 2, 3, "", true, "1", "2", "3", "true"].includes(process.env.FORCE_COLOR)
  : !(
    process.env.NODE_DISABLE_COLORS == 1 // using == by design
    ||
    "NO_COLOR" in process.env
  )
);

const stdoutIsTTY = process.stdout.isTTY;
const stderrIsTTY = process.stderr.isTTY;

function substituteCaptureGroupPlaceholders(target, $and, ...rest) {
  let i = 0;
  for (; i < rest.length; i++) {
    // offset parameter
    if (typeof rest[i] === "number") {
      break;
    }
  }

  const pArray = rest.slice(0, i);
  const offset = rest[i];
  const string = rest[i + 1];

  let parts;
  return target.replace(
    captureGroupPlaceholdersPatternGlobal,
    $n => {
      const n = $n.replace(/^\$/, "");
      // Bear in mind that this is a partial match
      switch (n) {
        case "&":
          // Inserts the matched substring.
          return $and;
        case "`":
          // Inserts the portion of the string that precedes the matched substring.
          if (!parts) {
            parts = {
              preceded: string.substring(0, offset),
              following: string.substring(offset + $and.length, string.length)
            };
          }

          return parts.preceded;
        case "'":
          // Inserts the portion of the string that follows the matched substring.
          if (!parts) {
            parts = {
              preceded: string.substring(0, offset),
              following: string.substring(offset + $and.length, string.length)
            };
          }

          return parts.following;
        default:
          const i = parseInt(n) - 1;
          // a positive integer less than 100, inserts the nth parenthesized submatch string
          if (typeof i !== "number" || i >= pArray.length || i < 0) {
            const warning = `${$n} is not satisfiable for '${$and}' with PCGs [ ${pArray.join(", ")} ]`;
            if(isColorEnabled && stdoutIsTTY) {
              console.warn(`\x1b[33m${warning}\x1b[0m`);
            } else {
              console.warn(warning);
            }
            return $n; // as a literal
          }
          return pArray[i];
      }
    }
  ).replace(/\$\$/g, "$");
}

function _getReplaceFunc(options) {
  //TODO line
  let replace = [];

  let globalLimit = 0;
  let globalCounter = 0;

  const search = options.search || options.match;

  if (search && "replacement" in options) { // validation resides in replace.map
    replace.push({
      search: search,
      replacement: options.replacement,
      limit: options.limit,      // being a local limit
      maxTimes: options.maxTimes,
      isFullReplacement: options.isFullReplacement,
      disablePlaceholders: options.disablePlaceholders
    });
  } else {
    if (validate(options.limit, 1))
      globalLimit = options.limit;
  }

  if (validate(options.replace, Array)) // validation resides in replace.map
    replace = replace.concat(options.replace);

  let postProcessing;
  if (options.postProcessing !== undefined) {
    if (typeof options.postProcessing !== "function") {
      throw new TypeError(
        `stream-editor: non-function '${
          options.postProcessing
        }' passed as replaceOptions.postProcessing`
      );
    }
    postProcessing = options.postProcessing;
  } else {
    if ("join" in options) {
      const join_option = options.join; // for garbage collection

      let join_func;
      switch (typeof join_option) {
        case "function":
          join_func = options.join;
          break;
        case "string":
          join_func = part => part.concat(join_option);
          break;
        case "undefined":
          join_func = part => part;
          break;
        case "object":
          if (join_option === null) {
            join_func = part => part;
            break;
          }
        /* fall through */
        default: throw new TypeError(
          "stream-editor: replaceOptions.join '"
          + String(options.join)
          + "' is invalid."
        );
      }

      postProcessing = (part, isLastPart) => {
        return isLastPart ? part : join_func(part);
      };
    } else {
      postProcessing = part => part;
    }
  }

  let replaceSet;
  const callback = (part, EOF) => {
    if (typeof part !== "string")
      return ""; // For cases like "Adbfdbdafb".split(/(?=([^,\n]+(,\n)?|(,\n)))/)

    replaceSet.forEach(rule => {
      part = part.replace(
        rule.pattern,
        rule.replacement
      );
    });

    return postProcessing(part, EOF);
  };

  replaceSet = new Set(
    replace.map(({ match, search, replacement, isFullReplacement, limit, maxTimes, disablePlaceholders }) => {
      if (match && !search)
        search = match;

      if (!is(search, RegExp, "") || !is(replacement, Function, ""))
        throw new TypeError([
          "stream-editor: in replaceOptions:",
          `(search|match) '${search}' is neither RegExp nor string`,
          `OR replacement '${replacement}' is neither Function nor string.`
        ].join(" "));

      let rule;

      if (typeof search === "string") {
        /**
         * user who specifying a string search
         * is definitely expecting a isFullReplacement
         */
        isFullReplacement = true;

        if (!escapeRegEx)
          escapeRegEx = new RegExp(
            "(" + "[]\\^$.|?*+(){}".split("").map(c => "\\".concat(c)).join("|") + ")",
            "g"
          );

        search = {
          source: search.replace(escapeRegEx, "\\$1"),
          flags: "g"
        };
      }

      /**
       * Set the global flag to ensure the search pattern is "stateful",
       * while preserving flags the original search pattern.
       */
      let flags = search.flags;

      if (!flags.includes("g"))
        flags = "g".concat(flags);

      if (!isFullReplacement && !splitToPCGroupsPattern.test(search.source))
        isFullReplacement = true;

      if (isFullReplacement) {
        if (typeof replacement === "string") {
          const _replacement = replacement;
          if (!disablePlaceholders && captureGroupPlaceholdersPattern.test(replacement)) {
            replacement = substituteCaptureGroupPlaceholders.bind(void 0, _replacement);
          } else {
            replacement = () => _replacement;
          }
        }

        rule = {
          pattern: new RegExp(search.source, flags),
          replacement: replacement
        };
      } else {
        /**
         * Replace the 1st parenthesized substring match with replacement,
         * and that is a so-called partial replacement.
         */
        const hasPlaceHolder = !disablePlaceholders && captureGroupPlaceholdersPattern.test(replacement);
        const isFunction = typeof replacement === "function";

        const specialTreatmentNeeded = !disablePlaceholders && (hasPlaceHolder || isFunction);

        rule = {
          pattern:
            new RegExp(
              search.source // add parentheses for matching substrings exactly,
                .replace(splitToPCGroupsPattern, "($1)($2)$3"), // greedy
              flags
            ),
          replacement:
            (wholeMatch, precededPart, substrMatch, ...rest) => {
              let _replacement = replacement;
              if (specialTreatmentNeeded) {
                let i = 0;
                for (; i < rest.length; i++) {
                  // offset parameter
                  if (typeof rest[i] === "number") {
                    break;
                  }
                }

                const userDefinedGroups = [substrMatch].concat(rest.slice(0, i));

                if (isFunction) {
                  // partial replacement with a function
                  _replacement = replacement(
                    substrMatch, ...userDefinedGroups, wholeMatch.indexOf(substrMatch), wholeMatch
                  );
                } else {
                  // has capture group placeHolder
                  _replacement = _replacement.replace(
                    captureGroupPlaceholdersPatternGlobal,
                    $n => {
                      const n = $n.replace(/^\$/, "");
                      // Bear in mind that this is a partial match
                      switch (n) {
                        case "&":
                          // Inserts the matched substring.
                          return substrMatch;
                        case "`":
                          // Inserts the portion of the string that precedes the matched substring.
                          return precededPart;
                        case "'":
                          // 	Inserts the portion of the string that follows the matched substring.
                          return wholeMatch.replace(precededPart.concat(substrMatch), "");
                        default:
                          const i = parseInt(n) - 1;
                          // a positive integer less than 100, inserts the nth parenthesized submatch string
                          if (typeof i !== "number" || i >= userDefinedGroups.length || i < 0) {
                            console.warn(
                              `\x1b[33m${$n} is not satisfiable for '${wholeMatch}' with PCGs [ ${userDefinedGroups.join(", ")} ]`
                            );
                            return $n; // as a literal
                          }
                          return userDefinedGroups[i];
                      }
                    }
                  );
                }
              }

              let replacmentWithPrecededPart;
              if (disablePlaceholders) {
                replacmentWithPrecededPart = () => precededPart.concat(_replacement);
              } else {
                replacmentWithPrecededPart = precededPart.concat(_replacement);
              }

              // using precededPart as a hook
              return wholeMatch.replace(
                precededPart.concat(substrMatch),
                replacmentWithPrecededPart
              );
            }
        };
      }

      /**
       * pattern: RegEx,
       * replacement: function
       */

      // limit
      if (limit && validate(limit, 1) || globalLimit) {
        let counter = 0;
        const funcPtr = rule.replacement;

        rule.replacement = function (notify, ...args) {
          if (
            (globalLimit && ++globalCounter >= globalLimit)
            || ++counter >= limit
          )
            /**
             * when ===, notify() but still perform a replacement.
             * when >  , return the whole unmodified match string.
             */
            if (notify() === Symbol.for("notified"))
              return args[0];

          return funcPtr.apply(this, args);
        }.bind(rule, () => callback._cb_limit());

        callback.withLimit = true;
        callback.truncate = options.truncate;
      }

      // max times executed
      if (maxTimes && validate(maxTimes, 1)) {
        let counter = 0;
        const funcPtr = rule.replacement;

        rule.replacement = function () {
          /**
           * when ===, delete itself but still perform a replacement.
           * when >  , return the whole unmodified match string.
           * 
           * This is necessary as there might be multiple rounds of 
           * replacement in a single call to string.replace.
           */
          if (++counter >= maxTimes) {
            if (!replaceSet.has(rule))
              return arguments[0];
            replaceSet.delete(rule);
          }

          return funcPtr.apply(this, arguments);
        };
      }

      return rule;
    })
  );

  return callback;
}

/**
 * handle input
 */

class Options {
  constructor(options) {
    this.options = Object.assign({}, options);
    this.got = Symbol("got");
  }

  _has(name) {
    return name in this.options;
  }

  _get(name) {
    const result = this.options[name];
    if (name in this.options)
      this.options[name] = this.got;
    return result;
  }

  _warnUnknown() {
    const unknownOptions = [];
    for (const prop of Object.keys(this.options)) {
      if (this.options[prop] !== this.got) {
        unknownOptions.push(prop);
      }
    }
    if (unknownOptions.length) {
      console.warn(
        `stream-editor: Received unknown/unneeded options: ${unknownOptions.join(', ')}.`
      );
    }
  }

  has = name => this._has(name);
  get = name => this._get(name);
  warnUnknown = () => this._warnUnknown();
}

function normalizeOptions(options) {
  const { has: hasOption, get: getOption, warnUnknown } = new Options(options);

  const replaceOptions = {
    search: getOption("search") || getOption("match"),
    replacement: getOption("replacement"),
    limit: getOption("limit"),
    maxTimes: getOption("maxTimes"),
    isFullReplacement: getOption("isFullReplacement"),
    disablePlaceholders: getOption("disablePlaceholders"),

    replace: getOption("replace"),

    join: getOption("join"),
    postProcessing: getOption("postProcessing")
  };

  const transformOptions = {
    separator: hasOption("separator") ? getOption("separator") : /(?<=\r?\n)/,
    encoding: getOption("encoding") || null,
    decodeBuffers: getOption("decodeBuffers") || "utf8",
    truncate: Boolean(getOption("truncate")),
    maxLength: getOption("maxLength") || Infinity,
    readStart: getOption("readStart") || 0,
    writeStart: getOption("writeStart") || 0,
    readableObjectMode: Boolean(getOption("readableObjectMode")),

    processFunc: _getReplaceFunc(replaceOptions),

    contentJoin: getOption("contentJoin") || ""
  };

  const from = getOption("from");
  const to = getOption("to");

  let readableStream, writableStream, sources, destinations;
  if (Array.isArray(from)) {
    sources = from;
  } else {
    readableStream = from;
  }

  if (Array.isArray(to)) {
    destinations = to;
  } else {
    writableStream = to;
  }

  const streamOptions = {
    file: getOption("file"),
    files: getOption("files"),

    readableStream: readableStream || getOption("readableStream"),
    writableStream: writableStream || getOption("writableStream"),

    sources: sources || getOption("readableStreams"),
    destinations: destinations || getOption("writableStreams")
  };

  warnUnknown();

  return {
    transformOptions,
    streamOptions,
    replaceOptions
  };
}

/**
 * format output
 */

let inspect;
async function verbose(err, parsedOptions, orinOptions) {
  if (!inspect)
    inspect = (await import("util")).inspect;

  if(typeof parsedOptions !== "object")
    return err;

  const indent = " ".repeat(2);
  const depth  = 1;
  const color  = isColorEnabled && stderrIsTTY;

  err.message = err.message.concat([
    "\nParsed options: {",
    ...Object.entries(parsedOptions).map(([key, value]) => 
      indent.concat(`${key}: ${inspect(value, { depth, color }).replace(/\n/g, `\n${indent}`)}`)
    ),
    "}\n",
    `Original options: ${inspect(orinOptions, { depth, color })}`
  ].join("\n").replace(/\n/g, `\n${indent}`));

  return err;
}

/**
 * main
 */
async function streamEdit (options) {
  if(typeof options !== "object")
    throw new TypeError(`stream-editor: non-object '${options}' is passed as the options.`)
  
  const { transformOptions, streamOptions, replaceOptions } = normalizeOptions(options);

  /**
   * single file input
   */
  if (streamOptions.file !== undefined) {
    if (validate(streamOptions.file, ".")) {
      return rw_stream(
        streamOptions.file,
        transformOptions
      );
    } else {
      throw new TypeError(`stream-editor: streamOptions.file '${streamOptions.file}' is invalid.`);
    }
  }

  /**
   * one-to-one stream pipe input
   */
  if (streamOptions.readableStream && streamOptions.writableStream) {
    const readableStream = streamOptions.readableStream;
    const writableStream = streamOptions.writableStream;

    if (validate(readableStream, Readable) && validate(writableStream, Writable)) {
      return process_stream(
        readableStream,
        writableStream,
        transformOptions
      );
    } else {
      throw await verbose(
        new TypeError(
          "stream-editor: streamOptions.(readableStream|writableStream|from|to) is invalid."
        ),
        { transformOptions, streamOptions },
        options
      );
    }
  }

  if (streamOptions.files) {
    if (validate(streamOptions.files, Array) && validate(...streamOptions.files, ".")) {
      //TODO option for considering files as a single, continuous long stream
      const files = streamOptions.files;
      const promises = [
        rw_stream(
          files[0],
          transformOptions
        )
      ];

      for (let i = 1; i < files.length; i++) {
        transformOptions.processFunc = _getReplaceFunc(replaceOptions);
        promises.push(
          rw_stream(
            files[i],
            transformOptions
          )
        );
      }
      
      return Promise.all(promises); //TODO to allSettled
    } else {
      throw (
        new TypeError(
          `stream-editor: streamOptions.files '${streamOptions.files}' is invalid.`
        )
      );
    }
  }

  /**
   * multiple-to-one stream confluence input
   */
  if (streamOptions.sources && streamOptions.writableStream) {
    const sources = streamOptions.sources;
    const destination = streamOptions.writableStream;
    const contentJoin = transformOptions.contentJoin;
    const encoding = transformOptions.encoding;

    if (validate(sources, Array) && validate(destination, Writable) && validate(...sources, Readable)) {
      const lastIndex = sources.length - 1;

      const resultStreams = [];
      const resultPromises = sources.map(
        (src, i) => {
          const passThrough = new PassThrough();
          const promise = process_stream(
            src,
            passThrough,
            transformOptions
          );

          if(i < lastIndex)
            transformOptions.processFunc = _getReplaceFunc(replaceOptions);

          resultStreams.push(passThrough);
          return promise;
        }
      );

      return new Promise(async (resolve, reject) => {
        const destroy = err => {
          resultStreams.forEach(stream => !stream.destroyed && stream.destroy());
          !destination.destroyed && destination.destroy();
          return reject(err);
        };

        Promise.all(resultPromises).catch(destroy);
        destination.once("error", destroy);

        try {
          await resultStreams.reduce(async (frontWorkDone, resultStream, i) => {
            await frontWorkDone;
            await new Promise((resolve, reject) => {
              if (resultStream.destroyed) {
                return i < lastIndex ? resolve() : destination.end(resolve);
              }

              resultStream
                .once("error", reject)
                .once("end", () => {
                  if (i < lastIndex) {
                    if (destination.destroyed || destination.writableEnded)
                      return resolve();

                    return destination.write(
                      contentJoin, encoding,
                      err => err ? reject(err) : resolve()
                    );
                  } else {
                    destination.end(resolve);
                  }
                })
                .pipe(destination, { end: false })
              ;
            });
          }, void 0); // If initialValue is not provided, reduce() will skip the first index.
        } catch (err) {
          return destroy(err);
        }

        return resolve(destination);
      });
    } else {
      throw await verbose(
        new TypeError(
          "stream-editor: streamOptions.(sources|writableStream) is invalid."
        ),
        { transformOptions, streamOptions },
        options
      );
    }
  }

  /**
   * one-to-multiple stream teeing input
   */
  if (streamOptions.destinations && streamOptions.readableStream) {
    const source = streamOptions.readableStream;
    const destinations = streamOptions.destinations;

    if (validate(source, Readable) && validate(destinations, Array) && validate(...destinations, Writable)) {
      const onError = err => {
        return delegate.destroy(err);
      };

      const checkEnded = () => {
        if (destinations.every(s => s.destroyed || s.writableEnded)) {
          return delegate.destroy();
        }
      };

      // source's possible error events will be handled by pipeline
      destinations.forEach(writableStream => writableStream.once("error", onError));

      const delegate = new Writable({
        async write(chunk, encoding, cb) {
          try {
            await Promise.all(
              destinations.map(writableStream => {
                if (writableStream.destroyed || writableStream.writableEnded)
                  return checkEnded();

                return new Promise((resolve, reject) =>
                  writableStream.write(
                    chunk,
                    encoding,
                    err => err ? reject(err) : resolve()
                  )
                );
              })
            );
          } catch (err) {
            return cb(err);
          }
          return cb();
        },
        destroy(err, cb) {
          destinations.forEach(
            writableStream => !writableStream.destroyed && writableStream.destroy()
          );
          return cb(err);
        },
        autoDestroy: true, // Default: true.
        async final(cb) {
          await Promise.all(
            destinations.map(
              writableStream => new Promise((resolve, reject) => {
                writableStream.end(() => {
                  writableStream.removeListener("error", onError);
                  return resolve();
                });
              })
            )
          );
          return cb();
        }
      });

      return process_stream(
        source,
        delegate,
        transformOptions
      );
    } else {
      throw await verbose(
        new TypeError(
          "stream-editor: streamOptions.(readableStream|destinations) is invalid."
        ),
        { transformOptions, streamOptions },
        options
      );
    }
  }

  /**
   * unrecognized
   */
  const error = await verbose(
    new Error("stream-editor: incorrect streamOptions."),
    { transformOptions, streamOptions, replaceOptions },
    options
  );
  
  error.code = 'EINVAL';
  throw error;
}

function is(toValidate, ...types) {
  return types.some(type => validate(toValidate, type));
}

function validate(...args) {
  const should_be = args.splice(args.length - 1, 1)[0];

  if (should_be === Array)
    return args.every(arg => Array.isArray(arg) && arg.length);

  const type = typeof should_be;
  switch (type) {
    case "function": return args.every(arg => arg instanceof should_be);
    case "object": return args.every(arg => typeof arg === "object" && arg.constructor === should_be.constructor);
    case "string": return args.every(arg => typeof arg === "string" && arg.length >= should_be.length);
    case "number": return args.every(arg => typeof arg === "number" && !isNaN(arg) && arg >= should_be); // comparing NaN with other numbers always returns false, though.
    default: return args.every(arg => typeof arg === type);
  }
}

export { streamEdit, streamEdit as sed };