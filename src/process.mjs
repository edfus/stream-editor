import { fstat } from "fs";
import rw from "rw-stream";
import { Transform } from "stream";
import { StringDecoder } from 'string_decoder';

async function process_stream(
  readStream,
  writeStream,
  { separator, callback, encoding, truncate }
) {
  let buffer = '';
  const decoder = new StringDecoder(encoding);

  const transformStream = (
    new Transform({
      transform(chunk, whatever, cb) {
        chunk = decoder.write(chunk);

        const parts = chunk.split(separator);
        buffer = buffer.concat(parts[0]);

        if (parts.length === 1) {
          return cb();
        }

        // length > 1
        parts[0] = buffer;

        for (let i = 0; i < parts.length - 1; i++) {
          if (this.push(callback(parts[i], false), encoding) === false)
            return cb(); // additional chunks of data can't be pushed
        }

        buffer = parts[parts.length - 1];
        return cb();
      },
      flush(cb) { // outro
        return cb(
          null,
          callback(buffer, true)
        )
      }
    })
  );

  if (callback.with_limit) {
    let nuked = false;
    callback._nuke_ = () => {
      if (nuked)
        return "nuked";
      else nuked = true;
    }

    const push_func = transformStream.push;


    transformStream.push = function () {
      if (!nuked)
        return push_func.apply(this, arguments);
      else {
        if (!truncate) { // preserve the rest
          this._transform =
            (chunk, whatever, cb) => {
              this.push(buffer, encoding);

              this._flush = cb => cb();
              this._transform = (chunk, whatever, cb) => {
                chunk = decoder.write(chunk);
                return cb(null, chunk);
              }

              chunk = decoder.write(chunk);
              return cb(null, chunk);
            };

          this._flush = cb => {
            // flush has been called first, and here comes the end
            // so there is no need for resetting _transform now
            return cb(null, buffer);
          };
          push_func.apply(this, arguments);
          this.push = push_func.bind(this);
          return true;
        }

        if (!this.destroyed) {
          readStream.destroy(); // close that one piping in
          this.end(); // and close the writable side (for not eating readStream's leftover)
          push_func.apply(this, arguments); // push the last data
          this.destroy(); // prevent further pushes, null will be pushed by Node.js
          return false; // Readable.push will return false when additional chunks of data can't be pushed
        } else {
          // strictEqual(null, arguments[0]);
          return push_func.apply(this, arguments);
        }
      }

    }.bind(transformStream);
  }

  return new Promise((resolve, reject) => {
    pipeline(
      readStream,
      transformStream,
      writeStream,
      err => err ? reject(err) : resolve()
    );
  })
}


async function rw_stream(filepath, options) {
  const { fd, readStream, writeStream } = await rw(filepath);

  if (
    await new Promise(
      (resolve, reject) =>
        fstat(fd, (err, status) => err ? reject(err) : resolve(status.isFile()))
    ) // fs.open won't throw a complaint, so it's our duty.
  )
    return process_stream(readStream, writeStream, options);
  else
    throw new Error(`update-file-content: filepath ${filepath} is invalid.`);
}

export { rw_stream, process_stream };