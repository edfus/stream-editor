import { exec } from "child_process";
import { createReadStream, createWriteStream, unlink } from "fs";
import { join, basename, extname, resolve, dirname } from "path";
import { pipeline } from "stream";
import { updateFileContent } from "../src/index.mjs";
import { root_directory } from "./helpers/__dirname.mjs";

const source = join(root_directory, "./src");
const destination = join(root_directory, "./build");
const validation = join(root_directory, "./test");

(async () => {
  await Promise.all(
    ["./index.mjs", "./streams.mjs", "./transform.mjs", "./rw-stream/index.mjs"].map(
      async filepath => {
        // es module
        await new Promise((resolve, reject) => 
          pipeline(
            createReadStream(join(source, filepath)),
            createWriteStream(join(destination, filepath)),
            err => err ? reject(err) : resolve()
          )
        );
        // common js
        return updateFileContent({
          readStream: createReadStream(join(source, filepath)),
          writeStream: 
            createWriteStream (
              join (
                destination,
                (
                  dirname(filepath).startsWith(".")
                    ? dirname(filepath).concat("/")
                    : dirname(filepath)
                ).concat(
                  basename(filepath).replace(extname(filepath), "").concat(".js")
                )
              )
            ),
          replace: [
            {
              search: `import { process_stream, rw_stream } from "./streams.mjs";`,
              replacement: 
              `const streams = require("./streams.js");\n`
              + `const { process_stream, rw_stream } = streams;`
            },
            {
              search: `import rw from "./rw-stream/index.mjs";`,
              replacement:
              `const rw = require("./rw-stream/index.js");`
            },
            {
              search: `import { PassThrough, Readable, Writable } from "stream";`,
              replacement: 
              `const stream = require("stream");\n`
              + `const { PassThrough, Readable, Writable } = stream;`
            },
            {
              search: `import { Transform, NukableTransform } from "./transform.mjs";`,
              replacement: 
              `const _$_ = require("./transform.js");\n`
              + `const { Transform, NukableTransform } = _$_;`
            },
            {
              search: `import { Transform as Node_Transform } from "stream";`,
              replacement:
              `const Node_Transform = require("stream").Transform;`
            },
            {
              search: `import { promises as fsp } from "fs";`,
              replacement:
              `const fsp = require("fs").promises;`
            },
            {
              search: `import { Readable, Writable } from "stream";`,
              replacement: 
              `const stream = require("stream");\n`
              + `const { Readable, Writable } = stream;`
            },
            { // import default
              search: /import\s+([^{}]+?)\s+from\s*['"](.+?)['"];?/,
              replacement: "const $1 = require(\"$2\");",
              full_replacement: true
            },
            { // destructuring a single property without renaming.
              search: /import\s+\{\s*([^,]+?)\s*\}\s+from\s*['"](.+?)['"];?/,
              replacement: "const $1 = require(\"$2\").$1;",
              full_replacement: true
            },
            { // dynamic import
              search: /\(await import\((.+?)\)\)/,
              replacement: "require($1)",
              full_replacement: true
            },
            {
              search: /(export)\s*\{.+?\};?/,
              replacement: "module.exports =",
              full_replacement: false
            },
            {
              search: /export\s*default/,
              replacement: "module.exports =",
              full_replacement: true
            }
          ]
        })
      }
    )
  );

  await Promise.all(
    ["./test.mjs"].map(
      filename => {
        const temp_dst = join (
          validation,
          basename(filename).replace(extname(filename), "").concat(".tmp.mjs")
        );
  
        process.once("beforeExit", () => {
          return new Promise((resolve, reject) => 
            unlink(temp_dst, err => err ? reject(err) : resolve())
          )
        });
  
        return updateFileContent({ // .js
          readStream: createReadStream(join(validation, filename)),
          writeStream: 
            createWriteStream (temp_dst),
          replace: [
            {
              search: `import { updateFileContent, updateFiles } from "../src/index.mjs";`,
              replacement: 
              `import _$ from "../build/index.js";\n`
              + `const { updateFileContent, updateFiles } = _$;`
            }
          ]
        })
        .then(() => new Promise((resolve, reject) => {
            exec(`mocha ${temp_dst}`, (err, stdout, stderr) => {
              if(err) return reject(err);
              return resolve(console.info(stdout));
            })
          })
        )
        .then(() => new Promise((resolve, reject) => {
            exec(`npm run example/npm`, (err, stdout, stderr) => {
              if(err) return reject(err);
              return resolve(console.info(stdout));
            });
          })
        )
      }
    )
  );
})()
