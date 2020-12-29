import { createReadStream, createWriteStream } from "fs";
import { join, basename, extname } from "path";
import { updateFileContent } from "../src/index.mjs";
import { root_directory } from "./helpers/__dirname.mjs";

const source = join(root_directory, "./src");
const destination = join(root_directory, "./build");

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
          full_replacement: true // optional
        },
        { // destructuring a single property without renaming.
          search: /import\s+\{\s*(.+?)\s*\}\s+from\s*['"](.+?)['"];?/,
          replacement: "const $1 = require(\"$2\").$1;"
        }
      ]
    })
  }
)

