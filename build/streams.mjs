import { pipeline } from "stream";
import rw from "./rw-stream/index.mjs";
import { Transform, NukableTransform } from "./transform.mjs";

async function processStreaming (
  readableStream,
  writableStream,
  options
) {

  const { channel, truncate } = options;

  let transformStream;

  try {
    if (channel.withLimit) {
      transformStream = new NukableTransform({
          ...options,
          withFalloutShelter: !truncate
      });
  
      let limitReached = false;
      channel._notifyLimitReached = () => {
        if (limitReached) {
          return Symbol.for("notified");
        } else {
          limitReached = true;
          transformStream.detonateTheBombNow = true;
          // starting from v14.0.0, The pipeline will wait for the 'close' event
          // for non-duplex & non-legacy streams created with the emitClose option.
          // so marking the end of the readableStream manually is required.
          if(truncate)
            readableStream.push(null);
        }
      }
    } else {
      transformStream = new Transform(options);
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


async function rwStreaming(filepath, options) {
  const { readableStream, writableStream } = await rw(
    filepath,
    {
      readStart: options.readStart,
      writeStart: options.writeStart
    }
  );

  return processStreaming(readableStream, writableStream, options)
            .then(() => void 0); // not leaking the reference to local writableStream
}

export { rwStreaming, processStreaming };