import { updateFileContent, updateFiles } from "../src/index.mjs";
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Readable } from "stream";
import { createWriteStream, existsSync, promises as fsp } from "fs";
import assert from "assert";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("update files" ,() => {
  const char_map = "dbdbdbThisIsADumbTestbbbsms".split("");
  const dump$ = [1, 2, 3];
  let counter;

  beforeEach(() => counter = 0);

  it("should pipe one Readable to multiple dumps", async () => {
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
          this.push(",\n")
          if(++counter > 90) {
            this.push(null);
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

  it("should have replaced /dum(b)/i to dumpling (while preserve dum's case)", async () => {
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
          result.lastIndexOf(",") === result.length - 1
        );

        assert.ok(
          !result.slice(15 + 13, result.length).includes("%")
        );
      })
  });

  it("should check arguments", async () => {
    try {
      await updateFileContent({
        file: "",
        search: /(.|\n)*/,
        replacement: () => "",
        limit: 88
      });
    } catch (err) {
      assert.strictEqual (
        "updateFileContent: options.file is invalid.",
        err.message
      )
    }

    try {
      await updateFileContent({
        file: "./",
        search: /(.|\n)*/,
        replacement: () => "",
        limit: 88
      });
    } catch (err) {
      assert.strictEqual (
        "update-file-content: filepath ./ is invalid.",
        err.message
      )
    }
  }); 

  it("can handle empty string", async () => {
    await updateFileContent({
      file: join(__dirname, `./dump${dump$[2]}`),
      separator: null,
      search: /(.|\n)*/,
      replacement: () => "", // full replacement
      limit: 88
    });
  }); // currently not available
  
  //TODO: test encoding
})