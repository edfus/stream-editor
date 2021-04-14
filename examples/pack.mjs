import { exec, spawn } from "child_process";
import { createReadStream, createWriteStream, copyFile, existsSync, mkdir } from "fs";
import { join, extname, dirname } from "path";
import { updateFileContent } from "../src/index.mjs";
import { root_directory } from "./helpers/__dirname.mjs";

/**
 * config
 */
const destination = join(root_directory, "./build");

const sourcePath = join(root_directory, "./src");
const sources =     [
  "./index.mjs", "./streams.mjs", "./transform.mjs", "./rw-stream/index.mjs",
  "./index.d.ts"
];

const testPath = join(root_directory, "./test");
const tmpTestDestination = join(root_directory, "./test.tmp");
const tests   = [
  "test.mjs", "gbk.txt", "./netflix/domain.yaml", "./netflix/IP.yaml",
  "../examples/helpers/process-files.mjs"
];

const testCommand = "mocha";
const testArgs = [ tmpTestDestination ];

const mjs = {
  from:  ".mjs",
  toCJS: ".js",
  toMJS: ".mjs",
  toCJSTest: ".js",
};

const replacements = { 
  srcReplace: [

  ],
  testReplace: [
    {
      match: matchParentFolderImport(/(src\/(.+?))/),
      replacement: "build/$2",
      full_replacement: false
    },
    {
      match: matchCurrentFolderImport(`((.+?)${mjs.from.replace(".", "\\.")})`),
      replacement: "$2".concat(mjs.toCJSTest),
      full_replacement: false
    },
    {
      match: /\r?\n?const\s+__dirname\s+=\s+dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\);?\r?\n?/,
      replacement: "",
      full_replacement: true
    }
  ],
  commonReplace: [
    {
      match: /^().*(\r?\n)/,
      replacement: `"use strict";$2`,
      full_replacement: false,
      maxTimes: 1
    },
    {
      match: matchImport(`((.+?)${mjs.from.replace(".", "\\.")})`),
      replacement: "$2".concat(mjs.toCJS),
      full_replacement: false
    },
    {
      search: matchDynamicImport(`['"]((.+?)${mjs.from.replace(".", "\\.")})['"]`),
      replacement: "$2".concat(mjs.toCJS),
      full_replacement: false
    },
    // default import
    { 
      search: /import\s+([^{}]+?)\s+from\s*['"](.+?)['"];?/,
      replacement: (wholeMatch, $1, $2) => {
        // debugger;
        return `const ${$1} = require("${$2}");`
      } ,
      full_replacement: true
    },
    // named import with or without renaming
    { 
      search: /import\s+\{\s*(.+?)\s*\}\s+from\s*['"](.+?)['"];?/,
      replacement: (wholeMatch, namedImports, moduleName) => {
        namedImports = namedImports.replace(/\s+as\s+/g, ": ");
        return `const { ${namedImports} } = require("${moduleName}");`;
      },
      full_replacement: true
    },
    // dynamic import
    {
      search: matchDynamicImport("(.+?)"),
      replacement:  (wholeMatch, $1) => {
        // debugger;
        return `require(${$1})`
      },
      full_replacement: true
    },
    // named export
    {
      search: /(export)\s*\{.+?\};?/,
      replacement: "module.exports =",
      full_replacement: false
    },
    // default export
    {
      search: /export\s*default/,
      replacement: "module.exports =",
      full_replacement: true
    }
  ]
};

const then = () => new Promise((resolve, reject) => {
  if(process.argv[2] !== "--version=false") {
    exec(`npm run example/npm`, (err, stdout, stderr) => {
      if(err) return reject(err);
      return resolve(console.info(stdout));
    });
  }
  return resolve();
});

/**
 * main
 */
const inprogressMkdir = {};

(async () => {
  /**
   * transport sources
   */
  await Promise.all(
    sources.map(
      filepath => transport(
        filepath,
        sourcePath,
        destination,
        replacements.srcReplace.concat(replacements.commonReplace)
      )
    )
  );

  /**
   * test common js files
   */
  const tmpDest = tmpTestDestination;

  if(!existsSync(tmpDest)) {
    await new Promise((resolve, reject) => {
      mkdir(tmpDest, { recursive: true }, err => {
        if(err)
          return reject(err);
        return resolve();
      });
    });
  }

  let rmSync;
  try {
    rmSync = (await import("fs")).rmSync;
  } catch (err) {
    ;
  }

  if(typeof rmSync !== "function") {
    rmSync = path => {
      console.error(`Your node version ${process.version} is incapable of fs.rmSync`);
      console.error(`The removal of '${path}' failed`);
    }
  }

  process.once("uncaughtException", err => {
    if(!process.env.NODE_DEBUG) {
      console.info([
        "\x1b[33mtmpTestDestination is auto removed on uncaughtException.",
        "Use environment variable NODE_DEBUG to prevent this.\x1b[0m"
      ].join("\n"))
      rmSync(tmpTestDestination, { recursive: true, force: true });
    }

    throw err;
  });

  process.once("beforeExit", () => {
    return rmSync(tmpTestDestination, { recursive: true });
  });

  await Promise.all(
    tests.map(
      filepath => transport(
        filepath,
        testPath,
        tmpDest,
        replacements.testReplace.concat(replacements.commonReplace),
        true
      )
    )
  );

  await new Promise((resolve, reject) => {
    const child = spawn(testCommand, testArgs, { shell: true, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0)
        return resolve();
      throw new Error(`Running ${testCommand} ${testArgs} returns ${code}`);
     });
  });

  typeof then === "function" && (await then());
})();

function toExtension(filename, extension) {
  return filename.substring(0, filename.length - extname(filename).length).concat(extension);
}

async function transport (filepath, sourcePath, destination, replace, isTest = false) {
  const dir = dirname(join(destination, filepath));

  if(inprogressMkdir[dir]) {
    await inprogressMkdir[dir];
  } else {
    if(!existsSync(dir)) {
      inprogressMkdir[dir] = new Promise((resolve, reject) => {
        mkdir(
          dirname(join(destination, filepath)), err => err ? reject(err) : resolve()
        );
      });
      await inprogressMkdir[dir];
    }
  }

  switch (extname(filepath)) {
    case mjs.from:
      // mjs to common js
      return Promise.all([
        updateFileContent({
          readableStream: createReadStream(join(sourcePath, filepath)),
          writableStream: 
            createWriteStream (
              join (
                destination,
                toExtension(filepath, isTest ? mjs.toCJSTest : mjs.toCJS)
              )
            ),
          replace: replace
        }),

        // copy & rename mjs
        !isTest && new Promise((resolve, reject) => 
          copyFile(
            join(sourcePath, filepath),
            join(destination, toExtension(filepath, mjs.toMJS)),
            err => err ? reject(err) : resolve()
          )
        )
      ]);
    default:
      // just copy
      return new Promise((resolve, reject) => 
        copyFile(
          join(sourcePath, filepath),
          join(destination, filepath),
          err => err ? reject(err) : resolve()
        )
      );
  }
}

function matchImport (addtionalPattern) {
  const parts = /import\s+.+\s+from\s*['"](.+?)['"];?/.source.split("(.+?)");

  return new RegExp([
    parts[0],
    addtionalPattern instanceof RegExp ? addtionalPattern.source : addtionalPattern,
    parts[1]
  ].join(""));
}

function matchDynamicImport (addtionalPattern) {
  const parts = /\(?await import\s*\(\s*(.+?)\s*\)\s*\)?(\s*\.default)?/.source.split("(.+?)");

  return new RegExp([
    parts[0],
    addtionalPattern instanceof RegExp ? addtionalPattern.source : addtionalPattern,
    parts[1]
  ].join(""));
}

function matchCurrentFolderImport (addtionalPattern) {
  const parts = /import\s+.+\s+from\s*['"]\.\/(.+?)['"];?/.source.split("(.+?)");

  return new RegExp([
    parts[0],
    addtionalPattern instanceof RegExp ? addtionalPattern.source : addtionalPattern,
    parts[1]
  ].join(""));
}

function matchParentFolderImport (addtionalPattern) {
  const parts = /import\s+.+\s+from\s*['"]\.\.\/(.+?)['"];?/.source.split("(.+?)");

  return new RegExp([
    parts[0],
    addtionalPattern instanceof RegExp ? addtionalPattern.source : addtionalPattern,
    parts[1]
  ].join(""));
}