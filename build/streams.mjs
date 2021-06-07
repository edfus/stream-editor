import { pipeline } from "stream";
import rw from "./rw-stream/index.mjs";
import { Transform, NukableTransform } from "./transform.mjs";

async function processStreaming (
  readableStream,
  writableStream,
  options
) {

  const { channel, truncate, abortController } = options;

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

    if(abortController) {
      if(!globalThis.AbortController) {
        throw new Error(
          `stream-editor: incompatible node.js version for transformOptions.abortController`
        );
      }

      if(abortController instanceof globalThis.AbortController) {
        if(abortController.signal.aborted) {
          throw new class AbortError extends Error {}("The operation was aborted.");
        }

        const transformStreamRef = new WeakRef(transformStream);
        const abort = () => {
          const err = new class AbortError extends Error {}("The operation was aborted.");
          const transform = transformStreamRef.deref();
          if(transform) {
            if(typeof transform.destroy === "function") {
              if(!transform.destroyed) {
                transform.destroy(err);
              }
            }
          }
        }

        abortController.signal.addEventListener(
          'abort', abort, { once: true }
        );
      } else {
        throw new TypeError(
          `stream-editor: expected transformOptions.abortController '${abortController}'`
          + `to be an instance of globalThis.AbortController`
        );
      }
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