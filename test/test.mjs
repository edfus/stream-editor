import { streamEdit } from "../src/index.mjs";
import assert, { strictEqual } from "assert";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { StringDecoder } from "string_decoder";
import { PassThrough, Readable, Writable } from "stream";
import { createReadStream, createWriteStream, existsSync, promises as fsp } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

process.env.NODE_DISABLE_COLORS = 1;

describe("Stream edit", () => {
  const char_map = "dbdbdbThisIsADumbTestbbbsms".split("");
  const dump$ = [
    "-dumplings", "-limitations",
    "-truncate-self",
    "-empty"
  ];
  const dump_ = [
    "-truncate-pipe",
    "-premature"
  ];

  it("should check arguments", async () => {
    await assert.rejects(
      () => streamEdit({
        file: "",
        search: /(.|\n)*/,
        replacement: () => "",
        limit: 88
      }),
      {
        name: "TypeError",
        message: /^stream-editor: streamOptions.file '' is invalid./
      }
    );

    await assert.rejects(
      () => streamEdit({
        from: [],
        to: {},
        search: /(.|\n)*/,
        replacement: () => ""
      }),
      {
        name: "TypeError",
        message: /^stream-editor: streamOptions\.\(sources\|writableStream\) is invalid.\n/
      }
    );

    await assert.rejects(
      () => streamEdit({
        file: "./",
        match: /(.|\n)*/,
        replacement: () => "",
        limit: 88
      }),
      /EISDIR: illegal operation on a directory/
    );

    await assert.rejects(
      () => streamEdit({
        file: "./",
        replace: [
          {
            search: /((.|\n)*)/,
            replacement: "$1"
          },
          {
            match: /[a-z]{5}.{5}/i,
            replacement: "-"
          },
        ],
        join: {},
        limit: 88
      }),
      {
        name: "TypeError",
        message: "stream-editor: replaceOptions.join '[object Object]' is invalid."
      }
    );

    await assert.rejects(
      () => streamEdit({
        file: "./",
        readStart: -1,
        writeStart: 9090,
        replace: [],
        limit: 88
      }),
      {
        name: "RangeError",
        message: "Read index MUST come before write index."
      }
    );

    await assert.rejects(
      () => streamEdit({
        file: "./",
        readStart: -1,
        writeStart: -200,
        replace: [],
        limit: 88
      }),
      {
        name: "RangeError",
        message: "Negative value is passed as a file operation start index."
      }
    );

    await assert.rejects(
      () => streamEdit({
        file: "./",
        replace: [
          {
            search: "dfabdf",
          }
        ]
      }),
      {
        name: "TypeError",
        message: "stream-editor: in replaceOptions: (search|match) 'dfabdf' is neither RegExp nor string OR replacement 'undefined' is neither Function nor string."
      }
    );

    await assert.rejects(
      () => streamEdit({
        file: "./",
        replace: [
          {
            search: "dfabdf",
          }
        ]
      }),
      {
        name: "TypeError",
        message: "stream-editor: in replaceOptions: (search|match) 'dfabdf' is neither RegExp nor string OR replacement 'undefined' is neither Function nor string."
      }
    );

    await assert.rejects(
      () => streamEdit({
        file: "./",
        postProcessing: ""
      }),
      {
        name: "TypeError",
        message: `stream-editor: non-function '' passed as replaceOptions.postProcessing`
      }
    );

    await assert.rejects(
      () => streamEdit({
        from: {},
        to: ""
      }),
      {
        name: "Error",
        message: /^stream-editor: incorrect streamOptions.\n/
      }
    );

    await assert.rejects(
      () => streamEdit({
        readableStreams: [new Readable(), "", Symbol("fdab")],
        to: new Writable()
      }),
      {
        name: "TypeError",
        message: /^stream-editor: streamOptions\.\(sources\|writableStream\) is invalid.\n/
      }
    );

    await assert.rejects(
      () => streamEdit({
        readableStream: new Readable(),
        to: [new Readable()]
      }),
      {
        name: "TypeError",
        message: /^stream-editor: streamOptions\.\(readableStream\|destinations\) is invalid.\n/
      }
    );

    await assert.rejects(
      () => streamEdit({
        files: [{}],
      }),
      {
        name: "TypeError",
        message: "stream-editor: streamOptions.files '[object Object]' is invalid."
      }
    );

    await assert.rejects(
      () => streamEdit({
        from: {},
        to: {}
      }),
      {
        name: "TypeError",
        message: /^stream-editor: streamOptions\.\(readableStream\|writableStream\) is invalid.\n/
      }
    );
  });

  it("should warn unknown/unneeded options", async () => {
    return new Promise((resolve, reject) => {
      process.env.FORCE_COLOR = "";
      // hack
      const warn = console.warn;
      console.warn = warning => {
        strictEqual(
          warning,
          `\x1B[33mstream-editor: Received unknown/unneeded options: readableStream.\x1B[0m`
        );
        console.warn = warn;
        return resolve();
      }
      
      streamEdit({
        readableStream: new Readable(),
        from: new Readable({
          read() {
            this.push(null);
          }
        }),
        to: new Writable({
          write(_1, _2, cb){
            return cb();
          }
        })
      }).then(reject, reject);

      process.env.FORCE_COLOR = 0;
    });
  });

  it("should respect FORCE_COLOR, NO_COLOR, NODE_DISABLE_COLORS", async () => {
    const ansiSniffer = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/;
    process.env.FORCE_COLOR = "";

    await assert.rejects(
      () => streamEdit({
        from: {},
        to: {}
      }),
      {
        name: "TypeError",
        message: ansiSniffer
      }
    );

    process.env.FORCE_COLOR = 0;
  });

  it("should pipe one Readable to multiple dumps", async () => {
    let counter = 0;

    await streamEdit({
      readableStream: new Readable({
        highWaterMark: 100,
        read(size) {
          for (let i = 0; i < size; i++) {
            this.push(
              Math.random() > .6
                ? char_map[i % char_map.length].toUpperCase()
                : char_map[i % char_map.length].toLowerCase()
            );
          }
          if (++counter > 90) {
            this.push(null);
          } else {
            this.push(",\r\n");
          }
        }
      }),
      writableStreams: dump$.map(id =>
        createWriteStream(join(__dirname, `./dump${id}`))
      ),
      separator: /(?=,\r\n)/,
      match: /dum(b)/i,
      replacement: "pling",
      encoding: "utf-8",
      join: null
    });

    dump$.forEach(id => assert.ok(existsSync(join(__dirname, `./dump${id}`))));
  });

  it("should replace CRLF with LF", async () => {
    await streamEdit({
      files: dump$.map(id => join(__dirname, `./dump${id}`)),
      separator: /\r\n/,
      join: "\n"
    });
    // result checked subsequently by following tests
  });

  it("should have replaced /dum(b)/i to dumpling (while preserving dum's case)", async () => {
    const filepath = join(__dirname, `./dump${dump$[0]}`);

    assert.strictEqual(
      null,
      /dum(b)/i.exec(await fsp.readFile(filepath, "utf-8"))
    );

    return streamEdit({
      file: filepath,
      separator: /,(?=\n)/i,
      search: /(.+?)(dumpling)/i,
      replacement: "$2 ",
      isFullReplacement: true
    });
  });

  it("should have global and local limitations in replacement amount", async () => {
    const filepath = join(__dirname, `./dump${dump$[1]}`);

    await streamEdit({
      file: filepath,
      search: /((.|\n){15})/,
      replacement: "^^^^^^^1^^^^^^^", // 15
      limit: 1,
      join: void 0
    });

    await streamEdit({
      file: filepath,
      replace: [{
        match: /(([^^]){13})/,
        replacement: "%%%%%%2%%%%%%", // 13
        limit: 2
      }],
      limit: 1
    });

    const result = await fsp.readFile(filepath, "utf-8");

    assert.strictEqual(
      "^^^^^^^1^^^^^^^%%%%%%2%%%%%%",
      result.slice(0, 15 + 13)
    );

    assert.ok(
      !result.slice(15 + 13, result.length).includes("%")
    );
  });

  it("should have line buffer maxLength", async () => {
    await assert.rejects(
      () => streamEdit({
        from: new Readable({
          read(size) {
            for (let i = 0; i < size; i++) {
              this.push(String(i));
            }
          }
        }),
        to: new PassThrough(),
        search: /.^/,
        replacement: "",
        separator: null,
        maxLength: 100
      }),
      {
        name: "Error",
        message: "Maximum buffer length 100 reached: ".concat(
          "...111213141516171819202122232425262728293031323334353637383940414243444546474849505152535455"
        )
      }
    );
  });

  it("should edit and combine multiple Readable into one Writable", async () => {
    const folderpath = join(__dirname, "./netflix");
    const resultPath = join(folderpath, "dump-merge-result");

    await streamEdit({
      readableStreams:
        await fsp.readdir(folderpath, { withFileTypes: true })
          .then(dirents =>
            dirents.filter(dirent => {
              if (dirent.isFile() && dirent.name.endsWith(".yaml"))
                return true;
              else return false;
            })
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(({ name }) => createReadStream(join(folderpath, name)))
          )
      ,
      to: createWriteStream(resultPath),
      contentJoin: "\n\n",
      search: "{UPDATE-group-name}",
      replacement: "NETFLIX 🎥",
      separator: /\r?\n/,
      join: "\n",
      limit: 3,
      truncate: true
    });

    strictEqual(
      await fsp.readFile(resultPath, "utf-8"),
      [
        "rules:",
        "  - DOMAIN-SUFFIX,netflix.com,NETFLIX 🎥",
        "  - DOMAIN-SUFFIX,netflix.net,NETFLIX 🎥",
        "  - DOMAIN-SUFFIX,nflxext.com,NETFLIX 🎥"
      ].join("\n").concat("\n")
        .concat(
          "\n\n"
        ).concat(
          [
            "rules:",
            "  - IP-CIDR,23.246.0.0/18,NETFLIX 🎥,no-resolve",
            "  - IP-CIDR,37.77.184.0/21,NETFLIX 🎥,no-resolve",
            "  - IP-CIDR,45.57.0.0/17,NETFLIX 🎥,no-resolve"
          ].join("\n").concat("\n")
        )
    );
  });

  it("has readableObjectMode", async () => {
    const filepath = join(__dirname, `./readable-object-mode.ndjson`);

    await streamEdit({
      file: filepath,
      separator: /\r\n/,
      join: "\n"
    });

    const results = [];

    await streamEdit({
      from: createReadStream(filepath),
      to: new Writable({
        objectMode: true,
        write(chunk, enc, cb) {
          if(typeof chunk === "object")
            results.push(JSON.stringify(chunk));
          return cb();
        }
      }),
      separator: "\n",
      readableObjectMode: true,
      postProcessing(part) {
        if(part.length)
          return JSON.parse(part);
        return part;
      }
    });

    strictEqual(
      results.join("\n"),
      await fsp.readFile(filepath, "utf-8")
    );
  });

  describe("truncation & limitation", () => {
    it("truncating the rest when limitations reached", async () => {
      const filepath = join(__dirname, `./dump${dump$[1]}`);

      // search string with limit
      await streamEdit({
        file: filepath,
        replace: [{
          search: "%%",
          replacement: "---3---%%", // 7
          limit: 2
        }],
        limit: 1,
        truncate: true
      });

      const result = await fsp.readFile(filepath, "utf-8");

      assert.strictEqual(
        "^^^^^^^1^^^^^^^---3---%%%%%%2%%%%%%",
        result.slice(0, 15 + 13 + 7)
      );

      assert.ok(/,\r?\n$/.test(result));

      assert.ok(
        !result.slice(15 + 13 + 7, result.length).includes("%")
      );
    });

    it("not: self rw-stream", async () => {
      const filepath = join(__dirname, `./dump${dump$[2]}`);

      strictEqual(
        ((await fsp.readFile(filepath, "utf-8")).match(/\n/g) || []).length,
        90
      );

      await streamEdit({
        file: filepath,
        separator: /,/,
        search: /(.|\n)+/,
        // must + rather than * otherwise '' will be captured too
        replacement: () => "", // full replacement
        isFullReplacement: true,
        limit: 88,
        // totally there are 91 lines,
        // 90 of them are preceded by \n, except the first one
        truncate: false
      });

      const result = await fsp.readFile(filepath, "utf-8");

      assert.strictEqual(
        91 - 88,
        (result.match(/\n/g) || []).length
      );

      await fsp.writeFile(
        filepath,
        `Checked✅: ${91 - 88} lines prefixed with \\n left\n`.concat(result)
      );
    });

    it("not: piping stream", async () => {
      const filepath = join(__dirname, `./dump${dump_[0]}`);

      let counter = 0;
      await streamEdit({
        from: new Readable({
          highWaterMark: 20,
          read(size) {
            counter++;
            if (counter === 10) {
              return this.push("==SEALED==\n");
            }
            if (counter === 15) {
              this.push("==END==");
              return this.push(null);
            }
            for (let i = 0; i < size; i++) {
              this.push(`${Math.random()} `);
            }
            this.push(",\n");
          }
        }),
        to: createWriteStream(filepath),
        separator: /,\n/,
        join: part => part === "" ? "" : part.concat(",\n"),
        search: /.+/,
        replacement: () => "",
        limit: 9,
        truncate: false
      });

      strictEqual(
        (await fsp.readFile(filepath, "utf-8")).slice(0, 11),
        "==SEALED==\n",
      );
    });
  });

  describe("transcoding", () => {
    before(function () {
      const hasFullICU = (() => {
        try {
          const january = new Date(9e8);
          const spanish = new Intl.DateTimeFormat('es', { month: 'long' });
          return spanish.format(january) === 'enero';
        } catch (err) {
          return false;
        }
      })();

      if (!hasFullICU) {
        console.info('\x1b[36m%s\x1b[0m', "    # this is only available for Node embedded the entire ICU (full-icu)");
        return this.skip();
      }
    });

    const fileSourcePath = join(__dirname, "./gbk.txt");

    it("gbk to utf8 buffer", async () => {
      const filepath = join(__dirname, "./dump-utf8.txt");
      await streamEdit({
        from: createReadStream(fileSourcePath),
        to: createWriteStream(filepath),
        decodeBuffers: "gbk"
      });

      assert.ok(
        /^★　魔法与红梦/.test(await fsp.readFile(filepath, "utf-8"))
      );
    });

    it("gbk to hex with HWM", async () => {
      const fileHandler = await fsp.open(fileSourcePath, "r");
      const resultPath = join(__dirname, "./dump-hex.txt");

      await streamEdit({
        from: new Readable({
          highWaterMark: 3,
          async read(size) {
            try {
              const chunk = Buffer.alloc(size);
              const { bytesRead } = await fileHandler.read(chunk, 0, size, null);

              return (
                bytesRead === 0
                  ? this.push(null)
                  : this.push(chunk.slice(0, bytesRead))
              );
            } catch (err) {
              this.destroy(err);
            }
          }
        }).once("error", fileHandler.close)
          .once("end", fileHandler.close),
        to: createWriteStream(resultPath),
        decodeBuffers: "gbk",
        encoding: "hex"
      });

      const result = await fsp.readFile(resultPath, "utf8");

      const should_be_hex = "e29885e38080e9ad94e6b3";
      const should_be_str = "★　魔法与红梦化成的存在　???　雾雨魔理沙";

      assert.strictEqual(
        should_be_hex,
        result.slice(0, should_be_hex.length)
      );

      assert.strictEqual(
        should_be_str,
        new StringDecoder("utf-8")
          .write(Buffer.from(result, "hex"))
          .slice(0, should_be_str.length)
      );
    });
  });

  describe("error handling", () => {
    it("destroys streams properly when one of them closed prematurely", async () => {
      // streams by themselves can only propagate errors up but not down.
      const writableStream =
        createWriteStream(join(__dirname, `./dump${dump_[1]}`))
        // .once("error", () => logs.push("Event: writableStream errored"))
        // see https://github.com/edfus/stream-editor/runs/1641959273
        ;

      const logs = [];

      writableStream.destroy = new Proxy(writableStream.destroy, {
        apply(target, thisArg, argumentsList) {
          logs.push("Proxy: writableStream.destroy.apply");

          return target.apply(thisArg, argumentsList);
        }
      });

      let counter = 0;
      try {
        await streamEdit({
          from: new Readable({
            highWaterMark: 5,
            read(size) {
              for (let i = 0; i < size; i++) {
                if (++counter > 10) {
                  logs.push("I will destroy the Readable now");
                  this.destroy();
                  process.nextTick(() => writableStream.destroyed && logs.push(`nextTick: writableStream.destroyed: true`));
                  return;
                } else {
                  this.push(`${Math.random()},\n`);
                }
              }
            }
          }).once("close", () => logs.push("Event: readableStream closed")),
          to: writableStream,
          separator: /,/,
          join: "$",
          search: /(.$)/,
          replacement: "",
          disablePlaceholders: true
        });
      } catch (err) {
        logs.push(`catch: Error ${err.message}`);
      } finally {
        assert.strictEqual(
          logs.join(" -> "),
          [
            "I will destroy the Readable now",
            "Event: readableStream closed",
            "Proxy: writableStream.destroy.apply",
            "nextTick: writableStream.destroyed: true",
            // "Event: writableStream errored",
            "catch: Error Premature close"
          ].join(" -> ")
        );
      }
    });

    it("destroys streams properly if errors occurred during initialization", async () => {
      const writableStream = createWriteStream(join(__dirname, `./dump${dump_[1]}`));
  
      const logs = [];
  
      writableStream.destroy = new Proxy(writableStream.destroy, {
        apply(target, thisArg, argumentsList) {
          logs.push("Proxy: writableStream.destroy.apply");
  
          return target.apply(thisArg, argumentsList);
        }
      });
  
      try {
        await streamEdit({
          from: new Readable({
            highWaterMark: 5,
            read(size) {
              this.push("honk honk");
            }
          }).once("close", () => logs.push("Event: readableStream closed")),
          to: writableStream,
          truncate: true,
          limit: 1,
          separator: /honk/,
          join: "honking intensifies",
          search: /$./,
          replacement: "$`",
          disablePlaceholders: true,
          encoding: "A super evil text."
        });
      } catch (err) {
        logs.push(`catch: Error ${err.message}`);
      } finally {
        assert.strictEqual(
          logs.join(" -> "),
          [
            "Proxy: writableStream.destroy.apply",
            "Event: readableStream closed",
            "catch: Error Unknown encoding: A super evil text."
          ].join(" -> ")
        );
      }
    });

    it("multiple streams: can correctly propagate errors emitted by readableStreams", async () => {
      await assert.rejects(
        () => streamEdit({
          readableStreams: new Array(10).fill(
            new Readable({
              highWaterMark: 6,
              read(size) {
                this.push("Afbdfbdbbdfb".repeat(6));
                this.destroy(new Error("o"));
                this.push(null);
              }
            }).setMaxListeners(50)
          ),
          writableStream: new Writable({
            write(chunk, enc, cb) {
              return cb();
            }
          })
        }),
        {
          name: "Error",
          message: "o"
        }
      );
    });

    it("multiple streams: can handle prematurely destroyed readableStreams", async () => {
      await assert.rejects(
        () => streamEdit({
          readableStreams: new Array(10).fill(
            new Readable({
              highWaterMark: 6,
              read(size) {
                this.push("Afbdfbdbbdfb".repeat(6));
                return this.destroy();
                /**
                 * It's recommended that one should always return
                 * right after invoking Stream#destroy.
                 * DON'T DO THIS👇
                 */
                // this.push(null);
              }
            }).setMaxListeners(50)
          ),
          writableStream: new Writable({
            write(chunk, enc, cb) {
              return cb();
            }
          })
        }),
        {
          name: "Error",
          message: "Premature close"
        }
      );
    });

    it("multiple streams: can correctly propagate errors emitted by writableStream", async () => {
      await assert.rejects(
        () => streamEdit({
          readableStreams: new Array(10).fill(
            new Readable({
              highWaterMark: 6,
              read(size) {
                this.push("Afbdfbdbbdfb".repeat(6));
                this.push(null);
              }
            }).setMaxListeners(50)
          ),
          writableStream: new Writable({
            write(chunk, enc, cb) {
              return cb(new Error("o"));
            }
          })
        }),
        {
          name: "Error",
          message: "o"
        }
      );
    });

    it("multiple streams: can correctly propagate errors emitted by writableStreams", async () => {
      await assert.rejects(
        () => streamEdit({
          readableStream: new Readable({
            highWaterMark: 6,
            read(size) {
              this.push("Afbdfbdbbdfb".repeat(6));
              this.push(null);
            }
          })
          ,
          writableStreams: new Array(10).fill(
            new Writable({
              write(chunk, enc, cb) {
                return cb(new Error("o"));
              }
            }).setMaxListeners(50)
          )
        }),
        {
          name: "Error",
          message: "o"
        }
      );
    });

    it("multiple streams: can handle prematurely destroyed writableStreams", async () => {
      await assert.rejects(
        () => streamEdit({
          readableStream: new Readable({
            highWaterMark: 6,
            read(size) {
              this.push("Afbdfbdbbdfb".repeat(6));
              this.push(null);
            }
          })
          ,
          writableStreams: new Array(10).fill(
            new Writable({
              write(chunk, enc, cb) {
                this.destroy();
                return cb();
              }
            }).setMaxListeners(50)
          )
        }),
        {
          name: "Error",
          message: "Premature close"
        }
      );
    });

    it("multiple streams: can handle prematurely ended writableStreams", async () => {
      await assert.rejects(
        () => streamEdit({
          readableStream: new Readable({
            highWaterMark: 6,
            read(size) {
              this.push("Afbdfbdbbdfb".repeat(6));
              this.push(null);
            }
          })
          ,
          writableStreams: new Array(10).fill(
            new Writable({
              write(chunk, enc, cb) {
                this.end();
                return cb();
              }
            }).setMaxListeners(50)
          )
        }),
        {
          name: "Error",
          message: "Premature close"
        }
      );
    });
  });

  describe("corner cases", () => {
    it("can handle empty content", async () => {
      const filepath = join(__dirname, `./dump${dump$[3]}`);
      await streamEdit({
        file: filepath,
        separator: /,/,
        search: /(.|\n)+/,
        replacement: () => "",
        isFullReplacement: true,
        limit: 88,
        truncate: true
      });

      strictEqual(
        '',
        await fsp.readFile(filepath, "utf-8")
      );
    });

    it("can handle non-string in regular expression split result", async () => {
      await streamEdit({
        readableStream: new Readable({
          highWaterMark: 5,
          read(size) {
            this.push("cirno gaming".repeat(5));
            this.push(null);
          }
        }),
        writableStream: new Writable({
          write(chunk, enc, cb) {
            return cb();
          }
        }),
        separator: /(?=([^,\n]+(,\n)?|(,\n)))/,
        search: /.*/i,
        replacement: "$`",
        disablePlaceholders: true
      });
    });
  });

  describe("try-on", () => {
    it("can handle files larger than 16KiB", async () => {
      const processFiles = (
        (await import("../examples/helpers/process-files.mjs")).processFiles
      );

      await resolveNodeDependencies(
        "/node_modules/three/build/three.module.js",
        "three"
      );

      async function resolveNodeDependencies(from, to) {
        const handler = async file => {
          if (/\.tmp$/.test(file))
            return;

          const options = {
            file,
            search: new RegExp(
              `${/\s*from\s*['"]/.source}(${from.replace(/\//g, "\/")})${/['"]/.source}`,
              "g"
            ),
            replacement: to,
            disablePlaceholders: true
          };

          await fsp.readFile(file, "utf-8")
            .then(result =>
              fsp.writeFile(file.concat(".tmp"),
                result.replace(
                  options.search,
                  to
                )
              )
            );

          await streamEdit(options);

          await fsp.readFile(file, "utf-8")
            .then(async result => {
              const should_be = await fsp.readFile(file.concat(".tmp"), "utf-8");
              assert.strictEqual(
                should_be,
                result
              );
            });
        };

        if (!existsSync(join(__dirname, "./dump/")))
          return;
        await processFiles(join(__dirname, "./dump/"), handler);
      }
    });
  });
});

