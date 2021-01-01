import { exec } from "child_process";
import { createReadStream, createWriteStream, unlink } from "fs";
import { join, basename, extname } from "path";
import { updateFileContent } from "../src/index.mjs";
import { root_directory } from "./helpers/__dirname.mjs";

const source = join(root_directory, "./src");
const destination = join(root_directory, "./build");
const validation = join(root_directory, "./test");

["./index.mjs", "./process.mjs"].forEach(
  filename => {
    createReadStream(join(source, filename))
      .pipe(
        createWriteStream(join(destination, filename))
      ); // .mjs

    updateFileContent({ // .js
      readStream: createReadStream(join(source, filename)),
      writeStream: 
        createWriteStream (
          join (
            destination,
            basename(filename).replace(extname(filename), "").concat(".js")
          )
        ),
      replace: [
        { // import default
          search: /import\s+([^{}]+?)\s+from\s*['"](.+?)['"];?/,
          replacement: "const $1 = require(\"$2\");",
          full_replacement: true
        },
        { // destructuring a single property without renaming.
          search: /import\s+\{\s*([^,]+?)(?!\s+as)\s*\}\s+from\s*['"](.+?)['"];?/,
          replacement: "const $1 = require(\"$2\").$1;",
          full_replacement: true
        },
        {
          search: `import { process_stream, rw_stream } from "./process.mjs";`,
          replacement: 
          `const streams = require("./process.js");\n`
          + `const { process_stream, rw_stream } = streams;`
        },
        {
          search: `import { PassThrough, Readable } from "stream";`,
          replacement: 
          `const stream = require("stream");\n`
          + `const { PassThrough, Readable } = stream;`
        },
        {
          search: `import { Transform, pipeline } from "stream";`,
          replacement: 
          `const stream = require("stream");\n`
          + `const { Transform, pipeline } = stream;`
        },
        {
          search: /(export)\s*\{.+?\};?/,
          replacement: "module.exports =",
          full_replacement: false
        }
      ]
    })
  }
);


["./test.mjs"].forEach(
  filename => {
    const temp_dst = join (
      validation,
      basename(filename).replace(extname(filename), "").concat(".tmp.mjs")
    );

    updateFileContent({ // .js
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
    .then(() => new Promise((resolve, reject) => 
      unlink(temp_dst, err => err ? reject(err) : resolve())
    ))
  }
);