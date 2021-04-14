"use strict";
const { process_stream, rw_stream } = require("./streams.js");
const { PassThrough, Readable, Writable } = require("stream");

let escapeRegEx; // lazy load
const captureGroupPattern = /(?<!\\)\$([1-9]{1,3}|\&|\`|\')/;
const captureGroupPatternGlobal = new RegExp(captureGroupPattern, "g");

// is () and not \( \) nor (?<=x) (?<!x) (?=x) (?!x)
// (?!\?) alone is enough, as /(?/ is an invalid RegExp
const splitToPCGroupsPattern = /(.*?)(?<!\\)\((?!\?)(.*)(?<!\\)\)(.*)/;

function _getReplaceFunc ( options ) {
  let replace = [];

  let globalLimit = 0;
  let globalCounter = 0;

  const search = options.search || options.match;

  if(search && "replacement" in options) { // validation resides in replace.map
    replace.push({
      search: search,
      replacement: options.replacement,
      limit: options.limit,      // being a local limit
      maxTimes: options.maxTimes,
      full_replacement: options.full_replacement
    });
  } else if(validate(options.limit, 1)) {
    globalLimit = options.limit;
  }

  if(validate(options.replace, Array)) // validation resides in replace.map
    replace = replace.concat(options.replace);

  let join;

  if("join" in options) {
    const join_option = options.join; // for garbage collection

    switch(typeof join_option) {
      case "function": 
        join = options.join;
        break;
      case "string":
        join = part => part.concat(join_option);
        break;
      case "undefined": 
        join = part => part;
        break;
      default: throw new TypeError(
        "update-file-content: options.join '"
        + String(options.join)
        + "' is invalid."
      )
    }
  } else {
    join = part => part;
  }

  let replaceSet;
  const callback = (part, EOF) => {
    if(typeof part !== "string") return ""; // For cases like "Adbfdbdafb".split(/(?=([^,\n]+(,\n)?|(,\n)))/)

    replaceSet.forEach(rule => {
      part = part.replace(
        rule.pattern,
        rule.replacement
      );
    });

    return EOF ? part : join(part);
  };
  
  replaceSet = new Set(
    replace.map(({ match, search, replacement, full_replacement, limit, maxTimes }) => {
      if(match && !search)
        search = match;
  
      if(!is(search, RegExp, "") || !is(replacement, Function, ""))
        throw new TypeError([
          "update-file-content:",
          `(search|match) '${search}' is neither RegExp nor string`,
          `OR replacement '${replacement}' is neither Function nor string`
        ].join(" "));
  
      let rule;
  
      if(typeof search === "string") {
        /**
         * user who specifying a string search
         * is definitely expecting a full_replacement
         */
        full_replacement = true;
  
        if(!escapeRegEx)
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
  
      if(!full_replacement && !splitToPCGroupsPattern.test(search.source))
        full_replacement = true;
  
      if(full_replacement) {
        if(typeof replacement === "string") {
          const temp_str = replacement;
          replacement = () => temp_str;
        }
  
        rule = {
          pattern: new RegExp (search.source, flags),
          replacement: replacement
        }
      } else {
        /**
         * Replace the 1st parenthesized substring match with replacement,
         * and that is a so-called partial replacement.
         */
        const hasPlaceHolder = captureGroupPattern.test(replacement);
        const isFunction     = typeof replacement === "function";

        const specialTreatmentNeeded = hasPlaceHolder || isFunction;

        rule = {
          pattern: 
            new RegExp (
              search.source // add parentheses for matching substrings exactly,
                .replace(splitToPCGroupsPattern, "($1)($2)$3"), // greedy
              flags
            ),
          replacement:
            (wholeMatch, precededPart, substrMatch, ...rest) => {
              let _replacement = replacement;
              if(specialTreatmentNeeded) {
                let i = 0;
                for (; i < rest.length; i++) {
                  // offset parameter
                  if(typeof rest[i] === "number") {
                    break;
                  }
                }

                const userDefinedGroups = [substrMatch].concat(rest.slice(0, i));

                if(isFunction) {
                  // partial replacement with a function
                  _replacement = replacement(
                    substrMatch, ...userDefinedGroups, wholeMatch.indexOf(substrMatch), wholeMatch
                  );
                } else {
                  // has capture group placeHolder
                  _replacement = _replacement.replace(
                    captureGroupPatternGlobal,
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
                          if(typeof i !== "number" || i >= userDefinedGroups.length || i < 0) {
                            console.warn(
                              `\x1b[33m${$n} is not satisfiable for ${wholeMatch} ${userDefinedGroups}`
                            );
                            return $n; // as a literal
                          }
                          return userDefinedGroups[i];
                      }
                    }
                  );
                }
              }

              // using precededPart as a hook
              return wholeMatch.replace(
                precededPart.concat(substrMatch),
                precededPart.concat(_replacement)
              );
            }
        }
      }
  
      /**
       * pattern: RegEx,
       * replacement: function
       */
  
      // limit
      if(limit && validate(limit, 1) || globalLimit) {
        let counter = 0;
        const funcPtr = rule.replacement;
  
        rule.replacement = function (notify, ...args) {
          if(
              ( globalLimit && ++globalCounter >= globalLimit )
              || ++counter >= limit
            )
            /**
             * when ===, notify() but still perform a replacement.
             * when >  , return the whole unmodified match string.
             */
            if(notify() === Symbol.for("notified"))
              return args[0];
  
          return funcPtr.apply(this, args);
        }.bind(rule, () => callback._cb_limit());
  
        callback.withLimit = true;
        callback.truncate = options.truncate;
      }
  
      // max times executed
      if(maxTimes && validate(maxTimes, 1)) {
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
          if(++counter >= maxTimes) {
            if(!replaceSet.has(rule))
              return arguments[0];
            replaceSet.delete(rule);
          }
  
          return funcPtr.apply(this, arguments);
        }
      }
  
      return rule;
    })
  );

  return callback;
}

async function updateFileContent( options ) {
  const replaceFunc = _getReplaceFunc(options);
  const separator = "separator" in options ? options.separator : /(?<=\r?\n)/;
  const encoding = options.encoding || null;
  const decodeBuffers = options.decodeBuffers || "utf8";
  const truncate = "truncate" in options ? options.truncate : false;
  const maxLength = options.maxLength || Infinity;

  if("file" in options) {
    if(validate(options.file, "."))
      return rw_stream (
          options.file,
          {
            separator,
            processFunc: replaceFunc,
            encoding,
            decodeBuffers,
            truncate,
            maxLength
          }
        );
    else throw new TypeError(`updateFileContent: options.file '${options.file}' is invalid.`)
  } else {
    const readableStream = options.readableStream || options.from;
    const writableStream = options.writableStream || options.to;

    if(validate(readableStream, Readable) && validate(writableStream, Writable))
      return process_stream (
        readableStream, 
        writableStream,
        {
          separator, 
          processFunc: replaceFunc, 
          encoding,
          decodeBuffers,
          truncate,
          maxLength
        }
      );
    else throw new TypeError("updateFileContent: options.(readableStream|writableStream|from|to) is invalid.")
  }
}

async function updateFiles ( options ) {
  const separator = "separator" in options ? options.separator : /(?<=\r?\n)/;
  const encoding = options.encoding || null;
  const decodeBuffers = options.decodeBuffers || "utf8";
  const truncate = "truncate" in options ? options.truncate : false;
  const maxLength = options.maxLength || Infinity;

  if(validate(options.files, Array) && validate(...options.files, ".")) {
    return Promise.all(
      options.files.map(file => 
        rw_stream (
          file,
          {
            separator,
            processFunc: _getReplaceFunc(options), 
            encoding,
            decodeBuffers,
            truncate,
            maxLength
          }
        )
      )
    );
  } else {
    const from = options.readableStreams || options.readableStream || options.from;
    const to = options.writableStreams || options.writableStream || options.to;

    if(validate(from, Array) && validate(to, Writable)) {
      const sources = from;
      const destination = to;
      const contentJoin = options.contentJoin || "";

      if(validate(...sources, Readable)) {
        const resultStreams = [];
        
        const resultPromises = sources.map ( //
          src => {
            const passThrough = new PassThrough();
            resultStreams.push(passThrough);
            return process_stream (
              src,
              passThrough,
              {
                separator, 
                processFunc: _getReplaceFunc(options),
                encoding,
                decodeBuffers,
                truncate,
                maxLength
              }
            );
          }
        );

        const lastIndex = resultStreams.length - 1;

        try {
          await resultStreams.reduce(async (frontWorkDone, resultStream, i) => {
            await frontWorkDone;
            await new Promise((resolve, reject) => 
              resultStream
                .once("error", reject)
                .once("end", () => {
                  if(i < lastIndex)  //NOTE: the encoding option
                    destination.write(contentJoin, encoding, resolve);
                  else destination.end(resolve);
                })
                .pipe(destination, { end: false })
            )
          }, void 0);
          // If initialValue is not provided, reduce() will skip the first index.
        } catch (err) {
          resultStreams.forEach(stream => stream.destroy());
          destination.end(() => { throw err });
        }

        return destination;
      } else {
        throw new TypeError("updateFiles: options.(readableStreams|from) is not an instance of Array<Readable>");
      }
    } else if(validate(from, Readable) && validate(to, Array)) {
      const readableStream = from;
      const dests = to;

      if(validate(...dests, Writable)) {
        return process_stream (
          readableStream,
          new Writable({
            async write (chunk, encoding, cb) {
              await Promise.all(
                dests.map(writableStream => 
                  new Promise((resolve, reject) => {
                    writableStream.write(chunk, encoding, resolve)
                  }) // .write should never return false
                )
              );
              return cb();
            },

            destroy (err, cb) {
              dests.forEach(
                writableStream => writableStream.destroy()
              );
              return cb(err);
            },
            autoDestroy: true, // Default: true.

            final (cb) {
              dests.forEach(
                writableStream => writableStream.end()
              );
              return cb();
            }
          }),
          {
            separator, 
            processFunc: _getReplaceFunc(options),
            encoding,
            decodeBuffers,
            truncate,
            maxLength
          }
        ) 
      } else {
        throw new TypeError("updateFiles: options.(writableStreams|to) is not an instance of Array<Writable>");
      }
    }

    const error = new Error (
      "updateFiles: incorrect options.\n"
      + "Receiving: ".concat(
        require("util").inspect(options, false, 0, true)
      )
    );
    error.code = 'EINVAL';
    throw error;
  }
}

function is (toValidate, ...types) {
  return types.some(type => validate(toValidate, type));
}

function validate (...args) {
  const should_be = args.splice(args.length - 1, 1)[0];

  if(should_be === Array)
    return args.every(arg => Array.isArray(arg) && arg.length);

  const type = typeof should_be;
  switch (type) {
    case "function": return args.every(arg => arg instanceof should_be);
    case "object": return args.every(arg => typeof arg === "object" && arg.constructor === should_be.constructor);
    case "string": return args.every(arg => typeof arg === "string" && arg.length >= should_be.length);
    case "number": return args.every(arg => typeof arg === "number" && arg >= should_be);
    default: return args.every(arg => typeof arg === type);
  }
}

module.exports = { updateFileContent, updateFiles };