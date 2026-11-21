// Runs in a utility process (AdBlock.load): parsing the lists peaks at ~150 MB, which V8 would keep in the main process for a minute.
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

async function build(file: string): Promise<void> {
  const engine = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(`${file}.tmp`, engine.serialize())
  await rename(`${file}.tmp`, file)
}

build(process.argv.at(-1)!).then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  }
)
