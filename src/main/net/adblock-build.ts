// Runs in a utility process (AdBlock.load): parsing the lists peaks at ~150 MB, which V8 would keep in the main process for a minute.
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// uBlock Origin's own lists, not Ghostery's copies: those lag months behind, and YouTube's fixes change almost daily (a stale one restarts videos on ads).
const UBLOCK = 'https://ublockorigin.github.io/uAssets'
const LISTS = [
  ...['badware', 'filters', 'filters-2020', 'filters-2021', 'filters-2022', 'filters-2023', 'filters-2024', 'filters-2025', 'filters-2026', 'privacy', 'quick-fixes', 'resource-abuse', 'unbreak'].map((name) => `${UBLOCK}/filters/${name}.txt`),
  `${UBLOCK}/thirdparties/easylist.txt`,
  `${UBLOCK}/thirdparties/easyprivacy.txt`,
  'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&mimetype=plaintext'
]

async function build(file: string): Promise<void> {
  const engine = await ElectronBlocker.fromLists(fetch, LISTS)
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
