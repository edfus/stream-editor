const pipeline = require("stream").pipeline;
const rw = require("./rw-stream/index.js");
const _$_ = require("./transform.js");
const { Transform, NukableTransform } = _$_;

async function process_stream (
  readStream,
  writeStream,
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
          // so marking the end of the readStream manually is required.
          if(truncate)
            readStream.push(null);
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
    readStream.destroy();
    transformStream
      && typeof transformStream.destroy === "function"
      && transformStream.destroy();
    writeStream.destroy();
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    pipeline (
      readStream,
      transformStream,
      writeStream,
      err => err ? reject(err) : resolve(writeStream)
    );
  });
}


async function rw_stream(filepath, options) {
  const { readStream, writeStream } = await rw(filepath);

  return process_stream(readStream, writeStream, options)
            .then(() => void 0); // not leaking reference to local writeStream
}

module.exports = { rw_stream, process_stream };