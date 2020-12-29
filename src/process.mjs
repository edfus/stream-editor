import rw from "rw-stream";
import { Transform } from "stream";
import { StringDecoder } from 'string_decoder';

async function process_stream (readStream, writeStream, separator, callback, encoding = "utf8") {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const decoder = new StringDecoder(encoding);
      
      readStream
          .pipe(
              new Transform({
                  transform (chunk, encoding, cb) {
                      chunk = decoder.write(chunk);

                      const parts = chunk.split(separator);
                      buffer = buffer.concat(parts[0]);

                      if(parts.length === 1) {
                          return cb();
                      }

                      // length > 1
                      this.push(callback(buffer, false));

                      for(let i = 1; i < parts.length - 1; i++) {
                          this.push(callback(parts[i], false));
                      }

                      buffer = parts[parts.length - 1];
                      return cb();
                  },
                  flush (cb) { // outro
                      return cb(
                              null,
                              callback(buffer, true)
                          )
                  }
              })
          )
          .pipe(writeStream)
              .on("finish", resolve)
              .on("error", reject)
    })
}


async function rw_stream (filepath, ...leftParams) {
  const { readStream, writeStream } = await rw(filepath);
  
  return process_stream(readStream, writeStream, ...leftParams);
}

export { rw_stream, process_stream };