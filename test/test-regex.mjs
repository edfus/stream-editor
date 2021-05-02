import { strictEqual } from "node:assert";
import { Duplex } from "stream";
import { sed } from "../src/index.mjs";

class Teleporter extends Duplex {
  _write(chunk, enc, cb) {
    return cb(null, this.buffer.push(chunk));
  }

  _final(cb) {
    return cb(null, this.resolve(Buffer.concat(this.buffer)));
  }

  async teleport (chunk) {
    this.buffer = [];
    return new Promise(resolve => {
      this.resolve = resolve;
      this.push(chunk);
      this.push(null);
    });
  }
}

class Replacer {
  constructor (options) {
    this.options = options;
  }

  async _replace(str) {
    const teleporter = new Teleporter();
    
    return new Promise((resolve, reject) => {
      sed({
        from: teleporter,
        to: teleporter,
        ...this.options
      }).catch(reject)
  
      return resolve(
        teleporter.teleport(str).then(result => result.toString())
      );
    })
  }

  replace = str => this._replace(str);
}

describe("Normalize & Replace", () => {
  it("can handle sticky regular expression", async () => {
    const stickyMatch = /s+/iy;

    const { replace } = new Replacer({
      match: stickyMatch,
      replacement: ""
    });

    strictEqual(
      await replace("sSs_s_sS_Ss"),
      "_s_sS_Ss"
    );
  });

  it("can handle string match with special characters", async () => {
    const str = `Abfdb\///\\*55&*^&24#$|{[{]\`~~\`.gh</?'>}2';"\dfb`;

    const { replace } = new Replacer({
      match: str,
      replacement: "nil"
    });

    strictEqual(
      await replace(str),
      "nil"
    );
  });

  it("can handle partial replacement with placeholders", async () => {
    const { replace } = new Replacer({
      replace: [
        {
          match: /import\s+.+\s+from\s*['"]\.\.\/((.+?)\.m?js)['"];?/,
          replacement: "build/$2.cjs",
          isFullReplacement: false
        },
        {
          match: /import\s+.+\s+from\s*['"]\.\/((.+?)\.m?js)['"];?/,
          replacement: "$2.cjs",
          isFullReplacement: false
        }
      ]
    });

    strictEqual(
      await replace(`import ProxyTunnel from "../index.mjs";`),
      `import ProxyTunnel from "../build/index.cjs";`
    );

    strictEqual(
      await replace(`import { createProxyServer } from "./helpers/helpers.mjs";`),
      `import { createProxyServer } from "./helpers/helpers.cjs";`
    );

    const irrelevant = `
      import { strictEqual } from "assert";
      import { request as request_https } from "https";
      import { request as request_http } from "http";
    `;

    strictEqual(
      await replace(irrelevant),
      irrelevant
    );
  });

  it("can handle non-capture-group parenthesized pattern: Assertions", async () => {
    const { replace } = new Replacer({
      match: /(?<=im-a-capture-group)(, wh(.+?)) are you/,
      replacement: ". Wh$2",
      isFullReplacement: false
    });

    strictEqual(
      await replace(`im-a-capture-group, who are you`),
      `im-a-capture-group. Who are you`
    );

    strictEqual(
      await replace(`im-a-capture-group, where are you`),
      `im-a-capture-group. Where are you`
    );

    const { replace: replace_$2 } = new Replacer({
      match: /(?<!Is T)(im-a(-capture-group))/,
      replacement: "we-are$2s",
      isFullReplacement: false
    });

    strictEqual(
      await replace_$2(`im-a-capture-group`),
      `we-are-capture-groups`
    );

    strictEqual(
      await replace_$2(`Is Tim-a-capture-group`),
      `Is Tim-a-capture-group`
    );

    const { replace: replace_$and } = new Replacer({
      match: /Is T(?!im-a-capture-group) (ok)\?/,
      replacement: "(k|$1|$&k)",
      isFullReplacement: false
    });

    strictEqual(
      await replace_$and(`Is T ok?`),
      `Is T (k|ok|okk)?`
    );

    strictEqual(
      await replace_$and(`Is Tim-a-capture-group ok?`),
      `Is Tim-a-capture-group ok?`
    );

    const { replace: replace_lookbehind } = new Replacer({
      match: /Is T(?=enshi).+()/,
      replacement: " Yes, it is.",
      isFullReplacement: false
    });

    strictEqual(
      await replace_lookbehind(`Is Tenshi a girl name?`),
      `Is Tenshi a girl name? Yes, it is.`
    );

    strictEqual(
      await replace_lookbehind(`Is The eldest daughter there?`),
      `Is The eldest daughter there?`
    );
  });

  it("can handle non-capture-group parenthesized pattern: Round brackets", async () => {
    const { replace } = new Replacer({
      match: /22\(abdfgbafdb\)u2e2(1342)/,
      replacement: "gggggggggggggg",
      isFullReplacement: false
    });

    strictEqual(
      await replace(`im-a-c22(abdfgbafdb)u2e21342`),
      `im-a-c22(abdfgbafdb)u2e2gggggggggggggg`
    );
  });

  it("can handle pattern starts with a capture group", async () => {
    const { replace } = new Replacer({
      match: /(abdfgbafdb)u2e2(1342)/,
      replacement: "gggggggggggggg",
      isFullReplacement: false
    });

    strictEqual(
      await replace(`abdfgbafdbu2e21342`),
      `ggggggggggggggu2e21342`
    );
  });

  it("can handle partial replacement but without capture groups", async () => {
    const { replace } = new Replacer({
      match: /ge \w+$/,
      replacement: "g dino",
      isFullReplacement: false
    });

    strictEqual(
      await replace("huge dinosaur"),
      "huge dinosaur".replace(/ge \w+$/, "g dino")
    );
  });

  it("can await replace partially with function", async () => {
    const { replace: replace_str } = new Replacer({
      match: /^().*(\r?\n)/,
      replacement: `"use strict";$2 $&`,
      isFullReplacement: false,
      maxTimes: 1
    });

    const { replace: replace_func } = new Replacer({
      match: /^().*(\r?\n)/,
      replacement: ($and, $1, $2, offset) => {
        strictEqual($and, "");
        strictEqual($and, $1);
        strictEqual(offset, 0);
        return `"use strict";${$2} ${$and}`;
      },
      isFullReplacement: false,
      maxTimes: 1
    });

    const toMatch = "//NO\TE: wow\nWhat a funky!\n";
    strictEqual(
      await replace_str(toMatch),
      await replace_func(toMatch)
    );

    const { replace: replace_str_m } = new Replacer({
      match: /^\w{3}logue: ((Pleasure to see you), (invisible friend)!(.*$))/,
      replacement: `"$2"... whoever you are.$4 - $3.`,
      isFullReplacement: false,
      maxTimes: 1
    });

    const { replace: replace_func_m } = new Replacer({
      match: /^\w{3}logue: ((Pleasure to see you), (invisible friend)!(.*$))/,
      replacement: ($and, $1, $2, $3, $4, offset) => {
        strictEqual($and, $1);
        strictEqual(offset, 10);
        return `"${$2}"... whoever you are.${$4} - ${$3}.`;
      },
      isFullReplacement: false,
      maxTimes: 1
    });

    const toMatch1 = "prologue: Pleasure to see you, invisible friend! Give in to nonsense, there's nothing to fight!";
    const result1  = `prologue: "Pleasure to see you"... whoever you are. Give in to nonsense, there's nothing to fight! - invisible friend.`;
    strictEqual(
      await replace_str_m(toMatch1),
      result1
    );

    strictEqual(
      await replace_func_m(toMatch1),
      result1
    );
  });

  it("recognize $\\d{1,3} $& $` $' and check validity (throw warnings)", async () => {
    const { replace: replace_f } = new Replacer({
      match: /\w+$/,
      replacement: "($`!)$&$$$'$999",
      isFullReplacement: false
      // but should be treated as a full isFullReplacement
    });

    strictEqual(
      await replace_f("huge dinosaur"),
      "huge dinosaur".replace(/\w+$/, "($`!)$&$$$'$999")
    );

    const { replace: replace_f2 } = new Replacer({
      match: /\w+$/,
      replacement: "($'$`!)$&$$$'",
      isFullReplacement: false
      // but should be treated as a full isFullReplacement
    });

    strictEqual(
      await replace_f2("huge dinosaur"),
      "huge dinosaur".replace(/\w+$/, "($'$`!)$&$$$'")
    );

    const { replace: replace_p } = new Replacer({
      match: /huge (dino)saur/,
      replacement: "($`!???) $&$$",
      isFullReplacement: false
    });

    strictEqual(
      await replace_p("Attention!!! huge dinosaur goes brrrr!!!"),
      "Attention!!! huge (huge !???) dino$saur goes brrrr!!!"
    );

    const { replace: replace_p2 } = new Replacer({
      match: /huge (dino)saur/,
      replacement: "$$$&$$($'!???)$4 ",
      isFullReplacement: false
    });

    strictEqual(
      await replace_p2("Attention!!! huge dinosaur goes brrrr!!!"),
      "Attention!!! huge $dino$(saur!???)$4 saur goes brrrr!!!"
    );
  });
});