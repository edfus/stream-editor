import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(join(fileURLToPath(import.meta.url), '/..'));
const root_directory = join(__dirname, "/..");

export { __dirname, root_directory }