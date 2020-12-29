import { promises as fsp } from 'fs';
import { join } from 'path';

async function touchItems_in (directory, { folder: dir_cb, file: file_cb}) {
  return (
      fsp.readdir(directory, {withFileTypes: true})
          .then(results => Promise.all(
            results.map(async dirent_obj => {
                if(dirent_obj.isDirectory()) {
                    return dir_cb(join(directory, dirent_obj.name));
                }
                if(dirent_obj.isFile()) {
                    return file_cb(join(directory, dirent_obj.name));
                }
                return false; 
                // links and devices...
            })
          ))
  )
}

async function processFiles (directory, callback) {
    const handler = {
        folder: dirPath => touchItems_in(dirPath, handler),
        file: file => callback(file)
    }

    return touchItems_in(directory, handler)
}

export { processFiles };