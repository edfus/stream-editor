import { pipeline } from "stream";
import rw from "./rw-stream/index.mjs";
import { Transform, NukableTransform } from "./transform.mjs";

async function process_stream (
  readableStream,
  writableStream,
  { separator, processFunc, encoding, decodeBuffers, truncate, maxLength }
) {

  let transformStream;

  try {
    if (processFunc.withLimit) {
      transformStream = new NukableTransform({
          separator,
          process: processFunc,
          encoding,
          decodeBuffers,
          withFalloutShelter: !truncate,
          maxLength
      });
  
      let limitReached = false;
      processFunc._cb_limit = () => {
        if (limitReached) {
          return Symbol.for("notified");
        } else {
          limitReached = true;
          transformStream.detonateTheBombNow = true
          // starting from v14.0.0, The pipeline will wait for the 'close' event
          // for non-duplex & non-legacy streams created with the emitClose option.
          // so marking the end of the readableStream manually is required.
          if(truncate)
            readableStream.push(null);
        }
      }
    } else {
      transformStream = new Transform({
        separator,
        process: processFunc,
        encoding,
        decodeBuffers,
        maxLength
      })
    }
  } catch (err) {
    readableStream.destroy();
    transformStream
      && typeof transformStream.destroy === "function"
      && transformStream.destroy();
    writableStream.destroy();
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    pipeline (
      readableStream,
      transformStream,
      writableStream,
      err => err ? reject(err) : resolve(writableStream)
    );
  });
}


async function rw_stream(filepath, options) {
  const { readableStream, writableStream } = await rw(filepath);

  return process_stream(readableStream, writableStream, options)
            .then(() => void 0); // not leaking reference to local writableStream
}

export { rw_stream, process_stream };