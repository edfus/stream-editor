"use strict";
const { PassThrough, Readable, Writable } = require("stream");

const { processStreaming, rwStreaming } = require("./streams.js");
const { verbose, warn, Options, findWithDefault, is, validate } = require("./helpers.js");

let escapeRegEx; // lazy load
const captureGroupPlaceholdersPattern = /(?<!\\)\$([1-9]{1,3}|\&|\`|\')/;
const captureGroupPlaceholdersPatternGlobal = new RegExp(captureGroupPlaceholdersPattern, "g");

// is () and not \( \) nor (?<=x) (?<!x) (?=x) (?!x)
// (?!\?) alone is enough, as /(?/ is an invalid RegExp
const splitToPCGroupsPattern = /(.*?)(?<!\\)\((?!\?)(.*)(?<!\\)\)(.*)/;

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
            warn(`${$n} is not satisfiable for '${$and}' with PCGs [ ${pArray.join(", ")} ]`);
            return $n; // as a literal
          }
          return pArray[i];
      }
    }
  ).replace(/\$\$/g, "$");
}

function getProcessOptions(options) {
  let replace = [];

  let globalLimit = 0;
  let globalCounter = 0;

  const search = options.search || options.match;

  if (search && "replacement" in options) { // validation resides in replace.map
    replace.push({
      search: search,
      replacement: options.replacement,
      limit: options.limit,      // being a local limit
      required: options.required,
      minTimes: options.minTimes,
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
  }

  const defaultOptions = options.defaultOptions || {};

  if (typeof defaultOptions !== "object") {
    throw new TypeError([
      "stream-editor: in replaceOptions:",
      `defaultOptions '${defaultOptions}' should be an object.`
    ].join(" "));
  }

  const beforeCompletionTasks = [];

  if (options.beforeCompletion) {
    if(typeof options.beforeCompletion !== "function") {
      throw new TypeError([
        "stream-editor: in replaceOptions:",
        `beforeCompletion '${options.beforeCompletion}' should be a function.`
      ].join(" "));
    } else {
      beforeCompletionTasks.push(options.beforeCompletion);
    }
  }

  const channel = {
    final: async () => {
      for (const task of beforeCompletionTasks) {
        await task();
      }
    },
    withLimit: false,
    _notifyLimitReached: void 0
  };

  const replaceSet = new Set(
    replace.map(replaceActions => {
      let { match, search, replacement } = replaceActions;
      let {
         isFullReplacement, limit, maxTimes,
         required, minTimes, disablePlaceholders 
        } = findWithDefault(
        replaceActions, defaultOptions,
        "isFullReplacement", "limit", "maxTimes",
        "required", "minTimes", "disablePlaceholders"
      );

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
         * is definitely expecting a full replacement
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
       * Set the global/sticky flag to ensure the search pattern is "stateful",
       * while preserving flags the original search pattern.
       */
      let flags = search.flags;

      if (!flags.includes("g") && !flags.includes("y"))
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
            async (wholeMatch, precededPart, substrMatch, ...rest) => {
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
                  // function as a partial replacement
                  _replacement = await replacement(
                    substrMatch, ...userDefinedGroups, wholeMatch.indexOf(substrMatch), wholeMatch
                  );
                } else {
                  // is string & may have capture group placeHolders
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
                            warn(
                              `${$n} is not satisfiable for '${wholeMatch}' with PCGs [ ${userDefinedGroups.join(", ")} ]`
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
        const subtleReplacement = rule.replacement;

        rule.replacement = function (notify, ...args) {
          if (
            (globalLimit && ++globalCounter >= globalLimit)
            || ++counter >= limit
          )
            /**
             * when ===, notify() but a replacement is still performed.
             * when >  , just return the whole unmodified match string.
             */
            if (notify() === Symbol.for("notified"))
              return args[0];

          return subtleReplacement.apply(this, args);
        }.bind(void 0, () => channel._notifyLimitReached());

        channel.withLimit = true;
      }

      // max times executed
      if (maxTimes && validate(maxTimes, 1)) {
        let counter = 0;
        const subtleReplacement = rule.replacement;

        rule.replacement = function () {
          /**
           * when ===, do the substitution and mark this rule as EOL.
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

          return subtleReplacement.apply(void 0, arguments);
        };
      }

      // minTimes/required
      if (minTimes && validate(minTimes, 1) || required) {
        if(!minTimes) { // required specified
          minTimes = 1;
        }

        let counter = 0;
        const subtleReplacement = rule.replacement;
        const patternSource = rule.pattern.source;

        rule.replacement = function () {
          ++counter;
          return subtleReplacement.apply(void 0, arguments);
        };

        beforeCompletionTasks.push(() => {
          if(counter < minTimes)
            throw new Error(
              `stream-editor: expect chunks to match with the /${
                patternSource
              }/ pattern at least ${minTimes} times, not ${counter} times in actual fact.`
            );
        });
      }

      return rule;
    }) // do not insert a semicolon here
  );

  const processFunc = async (part, EOF) => {
    if (typeof part !== "string") {
      return postProcessing(part); // For cases like "Adbfdbdafb".split(/(?=([^,\n]+(,\n)?|(,\n)))/)
    }
      
    for (const rule of replaceSet) {
      let ret;
      const resultIndices = [];
      const resultPromises = [];

      const { pattern, replacement: asyncReplace } = rule;
      let trapWatchDog_i = -1;

      while ((ret = pattern.exec(part)) !== null) {
        if(trapWatchDog_i === pattern.lastIndex) {
          pattern.lastIndex++;
          continue;
        }

        trapWatchDog_i = pattern.lastIndex;

        const startIndex = ret.index;
        const endIndex = ret.index + ret[0].length;
        const replacedResultPromise = asyncReplace(
          ...ret, ret.index, ret.input, ret.groups
        ); // the sync or async replacement function
        
        resultIndices.push({
          startIndex,
          endIndex
        });
        resultPromises.push(replacedResultPromise);
      }

      const results = await Promise.all(resultPromises);

      let lastIndex = 0;
      let greedySnake = "";
      
      for (let i = 0; i < results.length; i++) {
        greedySnake = greedySnake.concat(
          part.slice(lastIndex, resultIndices[i].startIndex).concat(results[i])
        );
        lastIndex = resultIndices[i].endIndex;
      }

      part = greedySnake.concat(part.slice(lastIndex, part.length));
    }

    return postProcessing(part, EOF);
  };

  return { channel, processFunc };
}

function addProcessOptions(assignee, ...argv) {
  const options = getProcessOptions(...argv);
  return Object.assign(assignee, options);
}

function updateProcessOptions() {
  return addProcessOptions.apply(this, arguments);
}

/**
 * handle input
 */

function normalizeOptions(options) {
  const { has: hasOption, get: getOption, warnUnknown } = new Options(options);

  const replaceOptions = {
    search: getOption("search") || getOption("match"),
    replacement: getOption("replacement"),
    limit: getOption("limit"),
    required: getOption("required"),
    minTimes: getOption("minTimes"),
    maxTimes: getOption("maxTimes"),
    isFullReplacement: getOption("isFullReplacement"),
    disablePlaceholders: getOption("disablePlaceholders"),

    defaultOptions: getOption("defaultOptions"),

    replace: getOption("replace"),

    join: getOption("join"), 
    postProcessing: getOption("postProcessing"),
    beforeCompletion: getOption("beforeCompletion")
  };

  const transformOptions = addProcessOptions({
    separator: hasOption("separator") ? getOption("separator") : /(?<=\r?\n)/,
    encoding: getOption("encoding") || null,
    decodeBuffers: getOption("decodeBuffers") || "utf8",
    truncate: Boolean(getOption("truncate")),
    maxLength: getOption("maxLength") || Infinity,
    readStart: getOption("readStart") || 0,
    writeStart: getOption("writeStart") || 0,
    readableObjectMode: Boolean(getOption("readableObjectMode")),

    contentJoin: getOption("contentJoin") || ""
  }, replaceOptions);

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
      return rwStreaming(
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
      return processStreaming(
        readableStream,
        writableStream,
        transformOptions
      );
    } else {
      throw await verbose(
        new TypeError(
          "stream-editor: streamOptions.(readableStream|writableStream) is invalid."
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
        rwStreaming(
          files[0],
          transformOptions
        )
      ];

      for (let i = 1; i < files.length; i++) {
        updateProcessOptions(transformOptions, replaceOptions);
        promises.push(
          rwStreaming(
            files[i],
            transformOptions
          )
        );
      }
      
      return Promise.all(promises);
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
          const promise = processStreaming(
            src,
            passThrough,
            transformOptions
          );

          if(i < lastIndex)
            updateProcessOptions(transformOptions, replaceOptions);

          resultStreams.push(passThrough);
          return promise;
        }
      );

      return new Promise(async (resolve, reject) => {
        let rootRejectCalled = false;
        const rootReject = reason => {
          rootRejectCalled = true;
          return reject(reason);
        };

        const destroy = err => {
          resultStreams.forEach(stream => !stream.destroyed && stream.destroy());
          !destination.destroyed && destination.destroy();
          return rootReject(err);
        };

        Promise.all(resultPromises).catch(destroy);
        destination.once("error", destroy);

        try {
          await resultStreams.reduce(async (frontWorkDone, resultStream, i) => {
            await frontWorkDone;
            await new Promise((resolve, reject) => {
              if(destination.destroyed || destination.writableEnded) {
                if(destination.writableEnded) {
                  return reject(
                    new Error("stream-editor: destination has been ended prematurely.")
                  );
                }

                // destroyed
                if (rootRejectCalled) {
                  return resolve(); // do nothing
                } else {
                  return reject(
                    new Error("stream-editor: destination has been destroyed brutely.")
                  );
                }
              }

              if (resultStream.destroyed || resultStream.readableEnded) {
                if (i >= lastIndex) {
                  return destination.end(resolve);
                }

                return resolve(); // silently skip
              }

              resultStream
                .once("error", reject)
                .once("end", () => {
                  if (destination.destroyed || destination.writableEnded)
                    return reject(
                      new Error("stream-editor: premature destination close.")
                    );

                  if (i < lastIndex) {
                    return destination.write(
                      contentJoin, encoding,
                      err => err ? reject(err) : resolve()
                    );
                  } else {
                    return destination.end(resolve);
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
      let errored = false;
      const onError = err => {
        errored = true;
        return delegate.destroy(err);
      };

      // source's possible error events will be handled by pipeline
      destinations.forEach(writableStream => writableStream.once("error", onError));

      const delegate = new Writable({
        async write(chunk, encoding, cb) {
          try {
            // Calling the .write() method after calling .destroy() will raise an error.
            await Promise.all(
              destinations.map(writableStream => {
                if(errored) {
                  return Promise.resolve(); // do nothing
                }

                if(writableStream.writableEnded) {
                  throw new Error("stream-editor: a stream destination has been ended prematurely.");
                }

                if (writableStream.destroyed) {
                  throw new Error("stream-editor: a stream destination has been destroyed brutely.");
                }

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
                // end can be called multiple times, if additional chunk of data is to be written
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

      return processStreaming(
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

module.exports = {  sed: streamEdit, streamEdit  };