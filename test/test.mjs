import { updateFileContent, updateFiles } from "../src/index.mjs";
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Readable } from "stream";
import { createWriteStream, existsSync, promises as fsp } from "fs";
import assert from "assert";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("update files" ,() => {
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

  it("should pipe one Readable to multiple dumps", async () => {
    let counter = 0;

    await updateFiles({
      readStream: new Readable({
        highWaterMark: 100,
        read (size) {
          for(let i = 0; i < size; i++) {
            this.push( 
                Math.random() > .6
                ? char_map[i % char_map.length].toUpperCase()
                : char_map[i % char_map.length].toLowerCase()
              )
          }
          if(++counter > 90) {
            this.push(null);
          } else {
            this.push(",\n");
          }
        }
      }),
      writeStream: dump$.map(id => 
        createWriteStream(join(__dirname, `./dump${id}`))
      ),
      separator: /(?=,\n)/,
      search: /dum(b)/i,
      replacement: "pling",
      encoding: "utf-8"
    });

    dump$.forEach(id => assert.ok(existsSync(join(__dirname, `./dump${id}`))));
  });

  it("should have replaced /dum(b)/i to dumpling (while preserving dum's case)", async () => {
    await fsp.readFile(join(__dirname, `./dump${dump$[0]}`), "utf-8")
      .then(result => {
        assert.strictEqual(
          null,
          /dum(b)/i.exec(result)
        );
        return updateFileContent({
          file: join(__dirname, `./dump${dump$[0]}`),
          separator: /,(?=\n)/i,
          search: /(.+?)(dumpling)/i,
          replacement: "$2 " // this is a full replacement
        });
      })
  });

  it("should have global and partial limitations in replacement amount", async () => {
    await updateFileContent({
      file: join(__dirname, `./dump${dump$[1]}`),
      search: /((.|\n){15})/,
      replacement: "^^^^^^^1^^^^^^^", // 15
      limit: 1
    });

    await updateFileContent({
      file: join(__dirname, `./dump${dump$[1]}`),
      replace: [{
        search: /(([^^]){13})/,
        replacement: "%%%%%%2%%%%%%", // 13
        limit: 2
      }],
      limit: 1
    });

    await fsp.readFile(join(__dirname, `./dump${dump$[1]}`), "utf-8")
            .then(result => {
              assert.strictEqual(
                "^^^^^^^1^^^^^^^%%%%%%2%%%%%%",
                result.slice(0, 15 + 13)
              );
      
              assert.ok(
                !result.slice(15 + 13, result.length).includes("%")
              );
            })
  });

  it("should check arguments", async () => {
    await assert.rejects(
      () => updateFileContent({
        file: "",
        search: /(.|\n)*/,
        replacement: () => "",
        limit: 88
      }),
      {
        name: "TypeError",
        message: "updateFileContent: options.file is invalid."
      }
    );

    await assert.rejects(
      () => updateFileContent({
        file: "./",
        search: /(.|\n)*/,
        replacement: () => "",
        limit: 88
      }),
      /(^EISDIR)|(filepath \.\/ is invalid\.$)/
    );

    await assert.rejects(
      () => updateFileContent({
        file: "./",
        replace: [
          {
            search: /((.|\n)*)/,
            replacement: "$1"
          },
          {
            search: /[a-z]{5}.{5}/i,
            replacement: "-"
          },
        ],
        join: part => part === "" ? "" : part.concat("\n"),
        limit: 88
      }),
      {
        name: "TypeError",
        message: "update-file-content: received non-function full replacement $1 while limit being specified"
      } 
    );

    await assert.rejects(
      () => updateFileContent({
        file: "./",
        replace: [
          {
            search: /((.|\n)*)/,
            replacement: "$1"
          },
          {
            search: /[a-z]{5}.{5}/i,
            replacement: "-"
          },
        ],
        join: null,
        limit: 88
      }),
      {
        name: "TypeError",
        message: "update-file-content: options.join null is invalid."
      }
    )
  });

  describe("truncation & limitation", () => {
    it("truncating the rest when limitations reached", async () => {
      await updateFileContent({ // search string with limit
        file: join(__dirname, `./dump${dump$[1]}`),
        replace: [{
          search: "%%",
          replacement: "---3---%%", // 7
          limit: 2
        }],
        limit: 1,
        truncate: true
      });
  
      await fsp.readFile(join(__dirname, `./dump${dump$[1]}`), "utf-8")
        .then(result => {
          assert.strictEqual(
            "^^^^^^^1^^^^^^^---3---%%%%%%2%%%%%%",
            result.slice(0, 15 + 13 + 7)
          );
  
          assert.ok(
            result.lastIndexOf(",") === result.length - 1
          );
  
          assert.ok(
            !result.slice(15 + 13 + 7, result.length).includes("%")
          );
        })
    });

    it("not: self rw-stream", async () => {
      await fsp.readFile(join(__dirname, `./dump${dump$[2]}`), "utf-8")
              .then(
                result => assert.strictEqual(
                  90,
                  result.match(/\n/g).length
                )
              )

      await updateFileContent({
        file: join(__dirname, `./dump${dump$[2]}`),
        separator: /,/,
        search: /(.|\n)+/, 
        // must + rather than * otherwise '' will be captured too
        replacement: () => "", // full replacement
        limit: 88, 
        // totally there are 91 lines,
        // 90 of them are prefixed with \n, except the first one
        truncate: false
      });

      await fsp.readFile(join(__dirname, `./dump${dump$[2]}`), "utf-8")
              .then(
                result => { 
                  assert.strictEqual(
                    91 - 88,
                    (result.match(/\n/g) || []).length
                  );

                  fsp.writeFile(
                    join(__dirname, `./dump${dump$[2]}`),
                    `Checked✅: ${91 - 88} lines prefixed with \\n left\n`
                      .concat(result)
                  );
                }
              );
    });

    it("not: piping stream", async () => {
      let counter = 0;
      await updateFileContent({
        from: new Readable({
          highWaterMark: 20,
          read (size) {
            counter++;
            if(counter === 10) {
              return this.push("==SEALED==\n");
            }
            if(counter === 15) {
              this.push("==END==");
              return this.push(null);
            }
            for(let i = 0; i < size; i++) {
              this.push(`${Math.random()} `);
            }
            this.push(",\n");
          }
        }),
        to: createWriteStream(join(__dirname, `./dump${dump_[0]}`)),
        separator: /,\n/,
        join: part => part === "" ? "" : part.concat(",\n"),
        search: /.+/,
        replacement: () => "",
        limit: 9, 
        truncate: false
      });

      await fsp.readFile(join(__dirname, `./dump${dump_[0]}`), "utf-8")
              .then(
                result => assert.strictEqual(
                  "==SEALED==\n",
                  result.slice(0, 11)
                )
              );
    })
  });

  describe("corner cases", () => {
    xit("can handle empty content", async () => { //NOTE: Error: EBADF: bad file descriptor, read
      try {
        await updateFileContent({
          file: join(__dirname, `./dump${dump$[3]}`),
          separator: /,/,
          search: /(.|\n)+/, 
          replacement: () => "", // full replacement
          limit: 88,
          truncate: true
        });
  
        await fsp.readFile(join(__dirname, `./dump${dump$[3]}`), "utf-8")
                  .then(result => assert.strictEqual(
                    '',
                    result
                  ));
      } catch (err) {
        assert.strictEqual(
          "Cannot read property 'then' of undefined",
          err.message
        ); // 
      }
    });
  
    it("can handle premature stream close", async () => {
      // streams by themselves can only propagate errors up but not down.
      const writeStream = 
        createWriteStream(join(__dirname, `./dump${dump_[1]}`))
            // .once("error", () => logs.push("Event: writeStream errored"))
            // .once("close", () => logs.push("Event: writeStream closed"))
            // see https://github.com/edfus/update-file-content/runs/1641959273
      ;
  
      writeStream.destroy = new Proxy(writeStream.destroy, {
        apply (target, thisArg, argumentsList) {
          logs.push("Proxy: writeStream.destroy.apply");
  
          return target.apply(thisArg, argumentsList);
        }
      })
  
      const logs = [];
  
      let counter = 0;
      try {
        await updateFileContent({
          from: new Readable({
            highWaterMark: 5,
            read (size) {
              for(let i = 0; i < size; i++) {
                if(++counter > 10) {
                  logs.push("I will destroy the Readable now");
                  this.destroy();
                  process.nextTick(() => writeStream.destroyed && logs.push(`nextTick: writeStream.destroyed: true`))
                  return ;
                } else {
                  this.push(`${Math.random()},\n`);
                }
              }
            }
          }).once("close", () => logs.push("Event: readStream closed")),
          to: writeStream,
          separator: /,/,
          join: "$",
          search: /.$/,
          replacement: () => ""
        });
      } catch (err) {
        logs.push(`catch: Error ${err.message}`);
      } finally {
        assert.strictEqual(
          [
            "I will destroy the Readable now",
            "Event: readStream closed",
            "Proxy: writeStream.destroy.apply",
            "nextTick: writeStream.destroyed: true",
            // "Event: writeStream errored",
            "catch: Error Premature close"
          ].join(" -> "),
          logs.join(" -> ")
        )
      }
    })
  })

  describe("try-on", () => {
    it("can handle files larger than 16KiB", async () => {
      const processFiles = 
        (await import("../examples/helpers/process-files.mjs")).processFiles
      ;

      await resolveNodeDependencies(
        "/node_modules/three/build/three.module.js",
        "three"
      );

      async function resolveNodeDependencies (from, to) {
        const handler = async file => {
          if(/\.tmp$/.test(file))
            return ;

          const options = {
            file,
            search: new RegExp(
              `${/\s*from\s*['"]/.source}(${from.replace(/\//g, "\/")})${/['"]/.source}`,
              "g"
            ),
            replacement: to
          }
      
          await fsp.readFile(file, "utf-8")
            .then(result => 
              fsp.writeFile(file.concat(".tmp"),
                result.replace (
                  options.search,
                  to
                )
              )
            )
          
          await updateFileContent(options);

          await fsp.readFile(file, "utf-8")
            .then(async result => {
              const should_be = await fsp.readFile(file.concat(".tmp"), "utf-8");
              assert.strictEqual(
                should_be,
                result
              );
            })
        };
        
        if(!existsSync(join(__dirname, "./dump/")))
          return ;
        await processFiles(join(__dirname, "./dump/"), handler);
      }
    });
  });
  
  //TODO: test encoding
});

