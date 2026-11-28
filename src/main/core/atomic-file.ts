import { closeSync, fsyncSync, openSync, renameSync, writeSync } from 'node:fs'

/** A crash or power cut leaves the old or the new contents; readable only by this user. */
export function writeFileAtomic(file: string, data: string | Buffer): void {
  const tmp = `${file}.tmp`
  const fd = openSync(tmp, 'w', 0o600)
  try {
    writeSync(fd, typeof data === 'string' ? Buffer.from(data) : data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, file)
}
