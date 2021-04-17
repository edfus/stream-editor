//CREDIT: https://github.com/signicode/rw-stream

import { strictEqual } from "assert";
import { promises as fsp } from "fs";
import { Readable, Writable } from "stream";

const { open } = fsp;

export default (async (file, { readStart, writeStart } = {}) => {
  let readIndex  = Number(readStart) || 0;  // NaN -> 0
  let writeIndex = Number(writeStart) || 0; // NaN -> 0

  /**
   * verbose type check
   */
  if(typeof readIndex !== "number" || typeof writeIndex !== "number")
    throw new TypeError("Read index or write index is NOT A NUMBER.");   

  if (readStart < writeStart) 
    throw new RangeError("Read index MUST come before write index.");
  
  if (readStart < 0 || writeStart < 0) 
    throw new RangeError("Negative value is passed as a file operation start index.");

  const fd = await open(file, "r+");

  let nextReadingDone = {
    promise: null,
    _emit: () => void 0
  };

  function advanceReadPosition(bytesRead) {
    const emitDone = nextReadingDone._emit;

    if (bytesRead > 0) {
      readIndex += bytesRead;
      nextReadingDone.promise = new Promise (
        emit => nextReadingDone._emit = emit
      );
    } else {
      // EOF
      readIndex = Infinity;
    }

    return emitDone(bytesRead);
  }

  const readableStream = new Readable({
    async read(size) {
      try {
        const buffer = Buffer.alloc(size);
        const { bytesRead } = await fd.read(buffer, 0, size, readIndex);

        advanceReadPosition(bytesRead);

        /**
         * the end-of-file is reached when the number of bytes read is zero
         */
        if (bytesRead === 0)
          return this.push(null);

        this.push(buffer.slice(0, bytesRead));
      } catch (err) {
        this.destroy(err);
      }
    }
  }).once("error", fd.close);

  const writableStream = new Writable({
    async write(chunk, encoding, callback) {
      try {
        /**
         * Switch an existing stream into object mode is possible, though not safe.
         */
        const toWrite = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        
        if(toWrite.length <= 0)
          return callback();
        
        let totalBytesWritten = 0;

        while (totalBytesWritten < toWrite.length) {
          const writeLength = Math.min (
            /**
             * Left available space.
             * readIndex will become Infinity once EOF is reached
             */
            readIndex - (writeIndex + totalBytesWritten), 
            /**
             * length of bytes not written yet
             */
            toWrite.length - totalBytesWritten
          );

          /**
           * A rare case where readIndex - (writeIndex + totalBytesWritten)
           * equals 0. This hardly happen as the read speed is much faster
           * than the write speed.
           */
          if (writeLength === 0) {
            strictEqual(toWrite.length !== totalBytesWritten, true);
            await nextReadingDone.promise;
            continue;
          }

          const { bytesWritten } = await fd.write(toWrite, totalBytesWritten, writeLength, writeIndex + totalBytesWritten);
          totalBytesWritten += bytesWritten;
        }

        writeIndex += toWrite.length;

        return callback();
      } catch (err) {
        return callback(err);
      }
    },
    final(callback) {
      fd.truncate(writeIndex)
        .then(fd.close)
        .then(() => callback(), callback)
    }
  }).once("error", fd.close);

  return {
    fd,
    readableStream,
    writableStream
  };
});
