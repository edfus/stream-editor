import rw_stream from "./rw-stream.mjs";

/**
 * Replace the 1st parenthesized substring match with data.replace.
 * Can handle large files well with the magic of rw_stream.
 * @param {Object} data 
 */
async function updateFileContent(data) {
  /**
   * Set the global flag to ensure the search pattern is "stateful",
   * while preserving flags the original search pattern.
   */
  let flags = data.search.flags;

  if(!flags.includes("g"))
      flags = "g".concat(flags);

  const pattern = new RegExp(
      data.search.source // add parentheses for matching substrings exactly,
          .replace(/(.*?)\((.*)\)(.*)/, "($1)($2)$3"),
      flags
  );

  const separator = "separator" in data ? data.separator : /(?=\r?\n)/; // NOTE

  return rw_stream(data.file, separator, (part, EOF) => {
      part = part.replace(
                pattern, 
                (match_whole, prefix, match_substr) => 
                    match_whole.replace (
                            prefix.concat(match_substr),
                            prefix.concat(data.replace)
                        ) // using prefix as a hook
          );

      return EOF ? part : part.concat(data.join || "");
  });
}

export default updateFileContent;