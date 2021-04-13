import { strictEqual } from "node:assert";

describe("Normalize & Replace", () => {
  it("can handle string match with special characters", () => {
    const str = `Abfdb\///\\*55&*^&24#$|{[{]\`~~\`.gh</?'>}2';"\dfb`;
    const replace = getReplaceFunction([
      {
        match: str,
        replacement: "nil"
      }
    ]);

    strictEqual(
      replace(str),
      "nil"
    )
  });

  it("can handle partial replacement with placeholders", () => {
    const replace = getReplaceFunction([
      {
        match: /import\s+.+\s+from\s*['"]\.\.\/((.+?)\.m?js)['"];?/,
        replacement: "build/$2.cjs",
        full_replacement: false
      },
      {
        match: /import\s+.+\s+from\s*['"]\.\/((.+?)\.m?js)['"];?/,
        replacement: "$2.cjs",
        full_replacement: false
      }
    ]);

    strictEqual(
      replace(`import ProxyTunnel from "../index.mjs";`),
      `import ProxyTunnel from "../build/index.cjs";`
    );

    strictEqual(
      replace(`import { createProxyServer } from "./helpers/helpers.mjs";`),
      `import { createProxyServer } from "./helpers/helpers.cjs";`
    );

    const irrelevant = `
      import { strictEqual } from "assert";
      import { request as request_https } from "https";
      import { request as request_http } from "http";
    `;
    strictEqual(
      replace(irrelevant),
      irrelevant
    );
  });

  it("can handle non-capture-group parenthesized pattern: Assertions", () => {
    const replace = getReplaceFunction([
      {
        match: /(?<=im-a-capture-group)(, wh(.+?)) are you/,
        replacement: ". Wh$2",
        full_replacement: false
      }
    ]);
    strictEqual(
      replace(`im-a-capture-group, who are you`),
      `im-a-capture-group. Who are you`
    );
    strictEqual(
      replace(`im-a-capture-group, where are you`),
      `im-a-capture-group. Where are you`
    );
    const irrelevant = `im-a-capture-group, how are you`;
    strictEqual(
      replace(irrelevant),
      irrelevant
    );

    const replace2 = getReplaceFunction([
      {
        match: /(?<!Is T)(im-a(-capture-group))/,
        replacement: "we-are$2s",
        full_replacement: false
      }
    ]);

    strictEqual(
      replace2(`im-a-capture-group`),
      `we-are-capture-groups`
    );

    strictEqual(
      replace2(`Is Tim-a-capture-group`),
      `Is Tim-a-capture-group`
    );

    const replace3 = getReplaceFunction([
      {
        match: /Is T(?!im-a-capture-group) (ok)\?/,
        replacement: "(k|$1|$&k)",
        full_replacement: false
      }
    ]);

    strictEqual(
      replace3(`Is T ok?`),
      `Is T (k|ok|okk)?`
    );

    strictEqual(
      replace3(`Is Tim-a-capture-group ok?`),
      `Is Tim-a-capture-group ok?`
    );

    const replace4 = getReplaceFunction([
      {
        match: /Is T(?=enshi).+()/,
        replacement: " Yes, it is.",
        full_replacement: false
      }
    ]);

    strictEqual(
      replace4(`Is Tenshi a girl name?`),
      `Is Tenshi a girl name? Yes, it is.`
    );

    strictEqual(
      replace4(`Is The eldest daughter there?`),
      `Is The eldest daughter there?`
    );
  });

  it("can handle non-capture-group parenthesized pattern: Round brackets", () => {
    const replace = getReplaceFunction([
      {
        match: /22\(abdfgbafdb\)u2e2(1342)/,
        replacement: "gggggggggggggg",
        full_replacement: false
      }
    ]);
    strictEqual(
      replace(`im-a-c22(abdfgbafdb)u2e21342`),
      `im-a-c22(abdfgbafdb)u2e2gggggggggggggg`
    );
  });

  it("can handle pattern starts with a capture group", () => {
    const replace = getReplaceFunction([
      {
        match: /(abdfgbafdb)u2e2(1342)/,
        replacement: "gggggggggggggg",
        full_replacement: false
      }
    ]);
    strictEqual(
      replace(`abdfgbafdbu2e21342`),
      `ggggggggggggggu2e21342`
    );
  });

  it("can handle partial replacement but without capture groups", () => {
    const replace = getReplaceFunction([
      {
        match: /ge \w+$/,
        replacement: "g dino",
        full_replacement: false
      }
    ]);

    strictEqual(
      replace("huge dinosaur"),
      "huge dinosaur".replace(/ge \w+$/, "g dino")
    );
  });

  it("recognize $& $` $'", () => {
    const replace = getReplaceFunction([
      {
        match: /\w+$/,
        replacement: "($`!)$&$$",
        full_replacement: false
        // but should be treated as a full full_replacement
      }
    ]);

    strictEqual(
      replace("huge dinosaur"),
      "huge dinosaur".replace(/\w+$/, "($`!)$&$$")
    );

    const replace1 = getReplaceFunction([
      {
        match: /huge (dino)saur/,
        replacement: "($`!???) $&$$",
        full_replacement: false
        // but should be treated as a full full_replacement
      }
    ]);

    strictEqual(
      replace1("Attention!!! huge dinosaur goes brrrr!!!"),
      "Attention!!! huge (huge !???) dino$saur goes brrrr!!!"
    );
  });
});

function getReplaceFunction(optionsArray) {
  const captureGroupPattern = /(?<!\\)\$([1-9]{1,3}|\&|\`|\')/;
  const captureGroupPatternGlobal = new RegExp(captureGroupPattern, "g");
  // is () and not \( \) nor (?<=x) (?<!x) (?=x) (?!x)
  // (?!\?) alone is enough, as /(?/ is an invalid RegExp
  const splitToPCGroupsPattern = /(.*?)(?<!\\)\((?!\?)(.*)(?<!\\)\)(.*)/;

  const replace = optionsArray.map(({ match, search, replacement, full_replacement }) => {
    if(match && !search)
      search = match;

    let rule;

    if(typeof search === "string") {
      full_replacement = true; // must be

      const escapeRegEx = new RegExp(
        "(" + "[]\\^$.|?*+(){}".split("").map(c => "\\".concat(c)).join("|") + ")",
        "g"
      );

      search = {
        source: search.replace(escapeRegEx, "\\$1"),
        flags: "g"
      };
      
      /**
       * make sure replacement is a funciton,
       * as user who specifying a string search
       * is definitely expecting a full_replacement
       * with configurable limitation.
       */
      if(typeof replacement === "string") {
        const temp_str = replacement;
        replacement = () => temp_str;
      }
    }
    
    /**
     * Set the global flag to ensure the search pattern is "stateful",
     * while preserving flags the original search pattern.
     */
    let flags = search.flags;

    if (!flags.includes("g"))
      flags = "g".concat(flags);

    if(!splitToPCGroupsPattern.test(search.source))
      full_replacement = true;

    if(full_replacement || typeof replacement === "function") {
      rule = {
        pattern: new RegExp (search.source, flags),
        replacement: replacement
      }
    } else {
      // Replace the 1st parenthesized substring match with replacement.
      
      const hasPlaceHolder = captureGroupPattern.test(replacement);

      rule = {
        pattern: 
          new RegExp (
            search.source // add parentheses for matching substrings exactly,
              .replace(splitToPCGroupsPattern, "($1)($2)$3"), // greedy
            flags
          ),
        replacement: 
          (wholeMatch, prefix, substrMatch, ...rest) => {
            let _replacement = replacement;
            if(hasPlaceHolder) {
              let i = 0;
              for (; i < rest.length; i++) {
                // offset parameter
                if(typeof rest[i] === "number") {
                  break;
                }
              }

              const userDefinedGroups = [substrMatch].concat(rest.slice(0, i));
              
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
                      return prefix;
                    case "'":
                      // 	Inserts the portion of the string that follows the matched substring.
                      return wholeMatch.replace(prefix.concat(substrMatch), "");
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

            // using prefix as a hook
            return wholeMatch.replace(
              prefix.concat(substrMatch),
              prefix.concat(_replacement)
            );
          }
      }
    }

    return rule;
  });

  return part => {
    if(typeof part !== "string") return ""; // For cases like "Adbfdbdafb".split(/(?=([^,\n]+(,\n)?|(,\n)))/)

    replace.forEach(rule => {
      part = part.replace(
        rule.pattern,
        rule.replacement
      );
    });

    return part;
  };
}
