import { fstat } from "fs";
import rw from "rw-stream";
import { Transform, pipeline } from "stream";
import { StringDecoder } from 'string_decoder';

async function process_stream(
  readStream,
  writeStream,
  { separator, callback, encoding, truncate }
) {

  let buffer = '';
  const decoder = new StringDecoder(encoding);

  const kNuked = Symbol("nuked");

  const transformStream = (
    new Transform({
      // decodeStrings: false, // Accept string input rather than Buffers //TODO
      transform(chunk, whatever, cb) {
        chunk = decoder.write(chunk);

        const parts = chunk.split(separator);
        buffer = buffer.concat(parts[0]);

        if (parts.length === 1) {
          if(this.maxLength && buffer.length > this.maxLength) //NOTE
            return cb(
              new Error(
                "Maximum buffer length reached: ..."
                    .concat(buffer.slice(buffer.length - 90, buffer.length))
              )
            )
          return cb();
        }

        // length > 1
        parts[0] = buffer;

        for (let i = 0; i < parts.length - 1; i++) {
          if (this.push(callback(parts[i], false), encoding) === false) {
            /**
             * push will return false when highWaterMark reached, signaling that
             * additional chunks of data can't be pushed.
             * ...but as Node.js will buffer any excess internally, and our output 
             * data are in small amounts, there won't be any actual differences when
             * no handling logic written out.
             * 
             * It might be the reason why Node didn't provide something like the drain 
             * event for Writables in Transform Stream.
             * 
             * https://github.com/nodejs/help/issues/1791
             * 
             * https://github.com/nodejs/node/blob/040a27ae5f586305ee52d188e3654563f28e99ce/lib/internal/streams/pipeline.js#L132
             */
            if (this.destroyed || this[kNuked]) {
              buffer = "";
              decoder.end();
              return cb();
            }
          }
        }

        buffer = parts[parts.length - 1];
        return cb();
      },
      flush(cb) { // outro
        return cb(
          null,
          callback(buffer.concat(decoder.end()), true)
        )
      }
    })
  );

  if (callback.with_limit) {
    let nuked = false;
    callback._nuke_ = () => {
      if (nuked)
        return Symbol.for("nuked");
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
            return cb(null, buffer.concat(decoder.end()));
          };
          push_func.apply(this, arguments);
          this.push = push_func.bind(this);
          return true;
        }

        // to truncate ↓
        if (!this[kNuked]) {
          this[kNuked] = true;
          this.end(); // close the writable side
          push_func.apply(this, arguments); // push the last data
          push_func.call(this, null); // it's the end

          readStream.push(null);
          // starts from v14.0.0 , The pipeline will wait for the 'close' event
          // so marking the end of the readStream manually is required.
          
          return false;
        } else {
          // strictEqual(null, arguments[0]);
          // strictEqual(1, arguments.length);
          // https://github.com/nodejs/node/blob/51b43675067fafaad0abd7d4f62a6a5097db5044/lib/internal/streams/transform.js#L159
          return push_func.apply(this, arguments);
        }
      }
    }.bind(transformStream);
  }

  return new Promise((resolve, reject) => {
    pipeline (
      readStream,
      transformStream,
      writeStream,
      err => err ? reject(err) : resolve()
    );
  });
  /**
   * v14.0.0
   * The pipeline(..., cb) will wait for the 'close' event before invoking the callback.
   * The implementation tries to detect legacy streams and only apply this behavior to streams which are expected to emit 'close'.
   */

  /**
   * https://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options
   * https://nodejs.org/api/fs.html#fs_fs_createwritestream_path_options
   * By default, the stream will not emit a 'close' event after it has been destroyed.
   * This is the opposite of the default for other Readable streams.
   * Set the emitClose option to true to change this behavior.
   */

  /**
   * BUT IN PRACTICE, pipeline in v15.5.0 can handle file system streams well.
   * well, contradictory sentences.
   * 
   * https://github.com/nodejs/node/blob/040a27ae5f586305ee52d188e3654563f28e99ce/lib/internal/streams/pipeline.js
   */
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