import { join } from "path";
import updateFileContent from "../src/index.mjs";
import { root_directory } from "./helpers/__dirname.mjs";

updateFileContent({
  file: join(root_directory, "./package.json"),
  search: /"version":\s*"(.+?)",?/,
  replace: "Whatever"
});