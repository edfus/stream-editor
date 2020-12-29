import assert from "assert";

// pack.mjs
suite("ES6 Module to CommonJS style", () => {

  suite("import default", () => {
    const pattern = /import\s+([^{}]+?)\s+from\s*['"](.+?)['"];?/;
    const replacement = "const $1 = require(\"$2\");";
    
    test("the simplest", () => {
      assert.strictEqual(
        "const fs = require(\"fs\");",
        "import fs from 'fs';".replace(pattern, replacement)
      );
    })
  })

  
  suite("import destructuring", () => {
    const pattern = /import\s+\{\s*(.+?)\s*\}\s+from\s*['"](.+?)['"];?/;
    const replacement = "const $1 = require(\"$2\").$1;";
    
    test("a single property", () => {
      assert.strictEqual(
        "const PassThrough = require(\"stream\").PassThrough;",
        "import { PassThrough } from \"stream\"".replace(pattern, replacement)
      );
    });

    /**
     * below features are not implemented yet
     */
    test("with renaming", () => {
      assert.strictEqual(
        "const Clone = require(\"stream\").PassThrough;",
        "import { PassThrough as Clone } from \"stream\"".replace(pattern, replacement)
      );
    });

    test("with property renaming and default naming", () => {
      assert.strictEqual(
        "const fs = require(\"fs\");\nconst fsp = fs.promises;",
        "import { promises as fsp }, fs from \"fs\"".replace(pattern, replacement)
      );
    });

    test("multiple properties", () => {
      assert.strictEqual(
        "const path = require(\"path\");\nconst join = path.join;\nconst dirname = path.dirname;",
        "import { join, dirname } from \"path\";".replace(pattern, replacement)
      );
    });

    test("with path", () => {
      assert.strictEqual(
        "const fsp = require(\"fs\").promises",
        "import fsp from 'fs/promises';".replace(pattern, replacement)
      );
    });
  })
})