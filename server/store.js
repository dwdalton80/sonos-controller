import fs from 'fs'
import path from 'path'

/**
 * JSON file store with serialized read-modify-write.
 * The browser fires several saves at once on startup; without a queue each one
 * reads the old file and the last writer silently drops the others' keys.
 * Writes are atomic (temp file + rename) so readers never see half a file.
 */
export function createStore(file) {
  let chain = Promise.resolve()

  const read = () =>
    fs.promises.readFile(file, 'utf8').then(JSON.parse).catch(() => ({}))

  const write = (patch) => {
    const run = async () => {
      const next = { ...(await read()), ...patch }
      const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`)
      await fs.promises.writeFile(tmp, JSON.stringify(next, null, 2))
      await fs.promises.rename(tmp, file)
    }
    const p = chain.then(run, run)
    chain = p.catch(() => {})   // keep the queue alive after a failure
    return p
  }

  return { read, write }
}
