import { join } from 'path';
import { sed } from "../src/index.mjs";
import { root_directory } from "./helpers/__dirname.mjs";

const readme = join(root_directory, "README.md");

export default async function (replacement) {
  return sed({
    file: readme,
    search: /```plain text((.|[\r\n])+?)```/,
    replacement,
    limit: 1,
    disablePlaceholders: true,
    separator: /(?=\r?\n#{3,4})/
  }).then(() => console.info("Update README.md done."));
};