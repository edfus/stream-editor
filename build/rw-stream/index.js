//CREDIT: https://github.com/signicode/rw-stream

const { promises: fsp } = require("fs");
const { Readable, Writable } = require("stream");

const { open } = fsp;

module.exports = (async (file, { readStart, writeStart } = {}) => {
  const fd = await open(file, "r+");

  let readIndex = +readStart || 0;
  let writeIndex = +writeStart || 0;

  if(isNaN(readIndex) || isNaN(writeIndex))
    throw new TypeError("Read index or write index is NOT A NUMBER");   

  if (readStart < writeStart) 
    throw new RangeError("Read index MUST come before write index.");

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
    } else { // EOF
      readIndex = Infinity;
    }

    return emitDone(bytesRead);
  }

  const readStream = new Readable({
    async read(size) {
      try {
        const buffer = Buffer.alloc(size);
        const { bytesRead } = await fd.read(buffer, 0, size, readIndex);

        advanceReadPosition(bytesRead);

        if (bytesRead === 0) // EOF
          return this.push(null);

        this.push(buffer.slice(0, bytesRead));
      } catch (err) {
        this.destroy(err);
      }
    }
  }).on("error", fd.close);

  const writeStream = new Writable({
    async write(chunk, encoding, callback) {
      try {
        const toWrite = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        
        if(toWrite.length <= 0)
          return callback();
        
        let totalBytesWritten = 0;

        while (true) { /* eslint-disable-line no-constant-condition */
          const writeLength = Math.min (
            readIndex - (writeIndex + totalBytesWritten), 
            // left available space, will become Infinity
            // once EOF was encountered while reading
            toWrite.length - totalBytesWritten // bytes not written yet
          );

          // when readIndex - (writeIndex + totalBytesWritten) yielded 0
          if (writeLength === 0) {
            await nextReadingDone.promise;
            // if (toWrite.length === totalBytesWritten) 
            //   debugger;
            continue;
          }

          const { bytesWritten } = await fd.write(toWrite, totalBytesWritten, writeLength, writeIndex + totalBytesWritten);
          totalBytesWritten += bytesWritten;
          if (totalBytesWritten === toWrite.length)
            break;
        }

        writeIndex += toWrite.length;

        callback();
      } catch (err) {
        callback(err);
      }
    },
    final(callback) {
      fd.truncate(writeIndex)
        .then(fd.close)
        .then(callback)
        .catch(err => callback(err))
    }
  }).on("error", fd.close);

  return {
    fd,
    readStream,
    writeStream
  };
});
