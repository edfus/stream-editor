const streams = require("./streams.js");
const { process_stream, rw_stream } = streams;
const stream = require("stream");
const { PassThrough, Readable, Writable } = stream;

function _getReplaceFunc ( options ) {
  let replace = [];

  let global_limit = 0;
  let global_counter = 0;

  const search = options.search || options.match;

  if(search && "replacement" in options) { // will be validated in replace.map
    replace.push({
      search: search,
      replacement: options.replacement,
      limit: options.limit
    });
  } else if(validate(options.limit, 1)) {
    global_limit = options.limit;
  }

  if(validate(options.replace, Array)) // will be validated in replace.map
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
        "update-file-content: options.join "
        + String(options.join)
        + " is invalid."
      )
    }
  } else {
    join = part => part;
  }

  const callback = (part, EOF) => {
    if(typeof part !== "string") return ""; // "Adbfdbdafb".split(/(?=([^,\n]+(,\n)?|(,\n)))/)

    replace.forEach(rule => {
      part = part.replace(
        rule.pattern,
        rule.replacement
      );
    });

    return EOF ? part : join(part);
  };
  
  replace = replace.map(({match, search, replacement, full_replacement, limit}) => {
    if(match && !search)
      search = match;

    if(!is(search, RegExp, "") || !is(replacement, Function, ""))
      throw new TypeError("update-file-content: !is(search, RegExp, \"\") || !is(replacement, Function, \"\")");
    
    let rule;

    if(typeof search === "string") {
      full_replacement = true; // must be

      const escapeRegEx = new RegExp(
        "(" + "[]\^$.|?*+(){}".split("").map(c => "\\".concat(c)).join("|") + ")",
        "g"
      );

      search = {
        source: search.replace(escapeRegEx, "\\$1"),
        flags: "g"
      };
      
      if(typeof replacement === "string") {
        const temp_str = replacement;
        replacement = () => temp_str;
      } // make sure replacement is a funciton so that limitation can be applied
    }
    
    /**
     * Set the global flag to ensure the search pattern is "stateful",
     * while preserving flags the original search pattern.
     */
    let flags = search.flags;

    if (!flags.includes("g"))
      flags = "g".concat(flags);

    if(full_replacement || typeof replacement === "function" || /(?<!\\)\$.+/.test(replacement)) {
      rule = {
        pattern: new RegExp (search.source, flags),
        replacement: replacement
      }
    } else { // Replace the 1st parenthesized substring match with replacement.
      rule = {
        pattern: 
          new RegExp (
            search.source // add parentheses for matching substrings exactly,
              .replace(/(.*?)\((.*)\)(.*)/, "($1)($2)$3"),
            flags
          ),
        replacement: 
          (match_whole, prefix, match_substr) => 
            match_whole.replace(
              prefix.concat(match_substr),
              prefix.concat(replacement)
            ) // using prefix as a hook
      }
    }

     // limit
    if(validate(limit, 1) || global_limit) {
      if(typeof rule.replacement === "function") {
        let counter = 0;
        const func_ptr = rule.replacement;
  
        rule.replacement = function (notify, ...args) {
          if(
              ( global_limit && ++global_counter >= global_limit )
              || ++counter >= limit
            )
            if(notify() === Symbol.for("notified"))
              return args[0]; // return the whole unmodified match string
  
          return func_ptr.apply(this, args);
        }.bind(rule, () => callback._cb_limit());
  
        callback.withLimit = true;
        callback.truncate = options.truncate;
      } else {
        throw new TypeError("update-file-content: received non-function full replacement "
                        + rule.replacement
                        + " while limit being specified");
      }
    }

    return rule;
  });

  return callback;
}

async function updateFileContent( options ) {
  const replaceFunc = _getReplaceFunc(options);
  const separator = "separator" in options ? options.separator : /(?=\r?\n)/; // NOTE
  const encoding = options.encoding || null;
  const decodeBuffers = options.decodeBuffers || "utf8";
  const truncate = "truncate" in options ? options.truncate : false;

  if("file" in options) {
    if(validate(options.file, "."))
      return rw_stream (
          options.file,
          {
            separator,
            processFunc: replaceFunc,
            encoding,
            decodeBuffers,
            truncate
          }
        );
    else throw new TypeError("updateFileContent: options.file is invalid.")
  } else {
    const readStream = options.readStream || options.from;
    const writeStream = options.writeStream || options.to;

    if(validate(readStream, Readable) && validate(writeStream, Writable))
      return process_stream (
        readStream, 
        writeStream,
        {
          separator, 
          processFunc: replaceFunc, 
          encoding,
          decodeBuffers,
          truncate
        }
      );
    else throw new TypeError("updateFileContent: options.(readStream|writeStream|from|to) is invalid.")
  }
}

async function updateFiles ( options ) {
  const separator = "separator" in options ? options.separator : /(?=\r?\n)/;
  const encoding = options.encoding || null;
  const decodeBuffers = options.decodeBuffers || "utf8";
  const truncate = "truncate" in options ? options.truncate : false;

  if(validate(options.files, Array) && validate(...options.files, ".")) {
    return Promise.all(
      options.file.map(file => 
        rw_stream (
          file,
          {
            separator,
            processFunc: _getReplaceFunc(options), 
            encoding,
            decodeBuffers,
            truncate
          }
        )
      )
    );
  } else {
    const from = options.readStream || options.from;
    const to = options.writeStream || options.to;

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
                truncate
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
        throw new TypeError("updateFiles: options.(readStream|from) is not an instance of Array<Readable>");
      }
    } else if(validate(from, Readable) && validate(to, Array)) {
      const readStream = from;
      const dests = to;

      if(validate(...dests, Writable)) {
        return process_stream (
          readStream,
          new Writable({
            async write (chunk, encoding, cb) {
              await Promise.all(
                dests.map(writeStream => 
                  new Promise((resolve, reject) => {
                    writeStream.write(chunk, encoding, resolve)
                  }) // .write should never return false
                )
              );
              return cb();
            },

            destroy (err, cb) {
              dests.forEach(
                writeStream => writeStream.destroy()
              );
              return cb(err);
            },
            autoDestroy: true, // Default: true.

            final (cb) {
              dests.forEach(
                writeStream => writeStream.end()
              );
              return cb();
            }
          }),
          {
            separator, 
            processFunc: _getReplaceFunc(options),
            encoding,
            decodeBuffers,
            truncate
          }
        ) 
      } else {
        throw new TypeError("updateFiles: options.(writeStream|to) is not an instance of Array<Writable>");
      }
    }
      
    throw new Error(
      "updateFiles: incorrect options.\n"
      + "Receiving: ".concat(
        (await import("util")).inspect(options, false, 0, true)
      )
    );
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