const process = require("./process.mjs");
const { process_stream, rw_stream } = process;
const PassThrough = require("stream").PassThrough;

async function updateFileContent( options ) {
  let replace = [];
  if(options.search && options.replacement)
    replace.push({
      search: options.search,
      replacement: options.replacement
    });

  if(options.replace && Array.isArray(options.replace))
    replace = replace.concat(options.replace);
  
  replace = replace.map(({search, replacement, full_replacement}) => {
    /**
     * Set the global flag to ensure the search pattern is "stateful",
     * while preserving flags the original search pattern.
     */
    let flags = search.flags;

    if (!flags.includes("g"))
      flags = "g".concat(flags);

    if(full_replacement || /(?<!\\)\$.+/.test(replacement)) {
      return {
        pattern: new RegExp (search.source, flags),
        replacement: replacement
      }
    } else { // Replace the 1st parenthesized substring match with replacement.
      return {
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
  });

  const separator = "separator" in options ? options.separator : /(?=\r?\n)/; // NOTE

  const join = options.join || "";

  const callback = (part, EOF) => {
    replace.forEach(rule => {
      part = part.replace(
        rule.pattern,
        rule.replacement
      );
    });

    return EOF ? part : part.concat(join);
  };

  if(options.file)
    return rw_stream (
        options.file,
        separator,
        callback, 
        options.encoding
      );
  else 
    return process_stream (
        options.readStream || options.from, 
        options.writeStream || options.to,
        separator, 
        callback, 
        options.encoding
      );
}

async function updateFiles ( ) {

}

export { updateFileContent, updateFiles };