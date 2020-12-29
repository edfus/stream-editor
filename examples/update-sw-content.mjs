import { join } from 'path';
import updateFileContent from "../src/index.mjs";
import { processFiles } from "./helpers/process-files.mjs"
import { __dirname, root_directory } from "./helpers/__dirname.mjs";

(async () => {
  await updateFileContent({
    file: join(join(__dirname, "./service-worker/service-worker.js")),
    search: /const\s+version\s*=\s*"(.+?)";?/,
    replace: "Whatever"
  });
  console.info("Version number updated.");
  await updateCacheResources();
  console.info("CacheResources updated.");
  await updateDLC();
  console.info("DownloadableContent updated.");
})()


async function updateCacheResources () {
  const replacement = [];

  replacement.push("`/`"); // root

  await processFiles(join(root_directory, "./build/"), filename => {
      replacement.push(
          "`" +
            decode(filename
              .replace(/@((\d+\.)+\d+)/, "@${version}")) // main@3.1.4.js
          + "`"
          );
  });

  return _updateCache("cache-resources.js", `\n  ${replacement.join(",\n  ")}\n`);
}

async function updateDLC () {
  const ignore = /node_modules|\.git/;
  const replacement = [];

  await processFiles(root_directory, filename => {
      if(ignore.test(filename))
          return ;
      else replacement.push(`"${decode(filename)}"`);
  });

  return _updateCache("downloadable.js", `\n  ${replacement.join(",\n  ")}\n`);
}

function decode (filename) {
  return filename.replace(root_directory, "").replace(/\\/g, "/");
}


async function _updateCache(filename, replacement) {
  return updateFileContent({
      file: join(__dirname, "./service-worker/assets/", filename),
      search: /export\s+default\s+\[((.|\n)*?)\];/,
      replace: replacement,
      separator: null
  });
}