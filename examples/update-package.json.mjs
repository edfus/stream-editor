import { join } from "path";
import { streamEdit } from "../src/index.mjs";
import { root_directory } from "./helpers/__dirname.mjs";
import { processFiles } from "./helpers/process-files.mjs";

const replacement = ["\"README.md\"", "\"package.json\""];

Promise.all(
  ["./build"]
  .map(folder => join(root_directory, folder))
  .map(
    async folder => await processFiles(
      folder,
      filename => {
        if(!/dump.*|\.tmp/.test(filename))
          replacement.push(`"${decode(filename)}"`);
      }
    )
  ))
  .then(() => {
    return streamEdit({
        file: join(root_directory, "./package.json"),
        replace: [
          {
            search: /"files":\s*\[((.|\n)*?)\],?/,
            replacement: `\n    ${replacement.join(",\n    ")}\n  `
          },
          {
            search: /("version":\s*")(.+?)",?/,
            replacement: (match, prefix, pr_version) => {
              let nums = pr_version.split(".").map(n => Number(n));

              nums.reduceRight((carry, current_num, index) => {
                current_num += carry;
                if(current_num >= 10 && index === 2) { // in case 9.9.9 -> 9.0.0
                  nums[index] = String(0);
                  return 1;
                } else {
                  nums[index] = String(current_num);
                  return 0;
                }
              }, 1); // increment 1 each time

              console.info(`\tversion ${pr_version} -> ${nums.join(".")} ✔`);

              return match.replace(
                prefix.concat(pr_version),
                prefix.concat(nums.join("."))
              );
            },
            isFullReplacement: true
          }
        ],
        separator: null // null: execute matching on the whole file
    });
  });

function decode (filename) {
  const str = filename.replace(root_directory, "").replace(/\\/g, "/");
  if(str[0] === "/")
    return str.slice(1, str.length);
  else return str;
}