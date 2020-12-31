import { process_stream, rw_stream } from "./process.mjs";
import { PassThrough, Readable } from "stream";
import { WriteStream } from "fs";

function _getReplaceFunc ( options ) {
  let replace = [];

  let global_limit = 0;
  let global_counter = 0;

  if(options.search && "replacement" in options) { // will be validated in replace.map
    replace.push({
      search: options.search,
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
      default: throw new Error(
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
  
  /**/ const _nuke_ = () => callback._nuke_(); /**/

  replace = replace.map(({search, replacement, full_replacement, limit}) => {
    if(!is(search, RegExp, "") || !is(replacement, Function, ""))
      throw new Error("update-file-content: !is(search, RegExp, \"\") || !is(replacement, Function, \"\")");
    
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
  
        rule.replacement = function (_nuke_, ...args) {
          if(
              ( global_limit && ++global_counter >= global_limit )
              || ++counter >= limit
            )
            if(_nuke_() === "nuked")
              return args[0]; // return the whole unmodified match string
  
          return func_ptr.apply(this, args);
        }.bind(rule, _nuke_);
  
        callback.with_limit = true;
        callback.truncate = options.truncate;
      } else {
        throw new Error("update-file-content: received non-function full replacement "
                        + rule.replacement
                        + " while limit being specified");
      }
    }

    return rule;
  });

  return callback;
}

async function updateFileContent( options ) {
  const callback = _getReplaceFunc(options);
  const separator = "separator" in options ? options.separator : /(?=\r?\n)/; // NOTE
  const encoding = options.encoding || "utf8";
  const truncate = "truncate" in options ? options.truncate : false;

  if("file" in options) {
    if(validate(options.file, "."))
      return rw_stream (
          options.file,
          {
            separator,
            callback,
            encoding,
            truncate
          }
        );
    else throw new Error("updateFileContent: options.file is invalid.")
  } else {
    const readStream = options.readStream || options.from;
    const writeStream = options.writeStream || options.to;

    if(validate(readStream, Readable) && validate(writeStream, WriteStream))
      return process_stream (
        readStream, 
        writeStream,
        {
          separator, 
          callback, 
          encoding,
          truncate
        }
      );
    else throw new Error("updateFileContent: options.(readStream|writeStream|from|to) is invalid.")
  }
}

async function updateFiles ( options ) {
  const callback = _getReplaceFunc(options);
  const separator = "separator" in options ? options.separator : /(?=\r?\n)/;
  const encoding = options.encoding || "utf8";
  const truncate = "truncate" in options ? options.truncate : false;

  if(validate(options.files, Array) && validate(...options.files, ".")) {
    return options.file.map(file => 
      rw_stream (
        file,
        {
          separator,
          callback, 
          encoding,
          truncate
        }
      )
    );
  } else {
    const readStream = options.readStream || options.from;
    const dests = options.writeStream || options.to;

    // superset Readable instead of ReadStream
    if(validate(readStream, Readable) && validate(dests, Array)) {
      if(validate(...dests, WriteStream)) {
        return dests.map(writeStream => {
          process_stream (
            readStream.pipe(new PassThrough()), 
            writeStream,
            {
              separator, 
              callback,
              encoding,
              truncate
            }
          )
        });
      } else {
        throw new Error("updateFiles: options.(writeStream|to) is not an instance of Array<WriteStream>");
      }  
    }
      
    throw new Error("updateFiles: incorrect options.");
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

export { updateFileContent, updateFiles };