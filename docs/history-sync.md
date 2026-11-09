# History sync

History sync carries browsing history between a user's computers through a folder they already
sync (iCloud Drive, Dropbox, OneDrive). There is no YARC server, account or telemetry: the
maintainers never hold or see anyone's data, and the cloud service only ever carries encrypted
files. Code: `src/main/sync/` (crypto, log format, engine, Electron controller),
`src/main/history.ts` (merge rules), `src/shared/sync.ts` (record types and what they expose).
Tests: `test/unit/sync.test.ts`.

Why not something else: Chrome Sync is closed to other browsers and Google's My Activity has no
write API (`electron-notes.md` section 4); a YARC server would make the project responsible for
user data, which the maintainer refuses.

## Folder layout

The user picks a folder. If it already has `sync.json`, that's the sync folder; if it's empty, it
becomes one; otherwise YARC uses (or creates) `YARC Sync` inside it.

```
sync.json                                 plain JSON: format, random folder ID, scrypt salt and parameters,
                                          a check value, and the keyring (sealed)
profiles/<device>                         sealed: the profiles that device syncs (sync key + name)
history/<profile key>/<device>/<chunk>    sealed, gzipped runs of history records
```

Every name below the top level is a random 128-bit hex ID: device IDs are per installation
(`<userData>/Sync/device.json`), profile keys are per synced profile (`Profile.syncKey` in
`state.json`), chunk names are random. Names that don't look like that (`.DS_Store`, Dropbox
conflict copies, our own `.<id>.tmp` files while writing) are ignored.

Each device writes **only its own files** and never edits a chunk after writing it (compaction
writes a new chunk, then deletes the old ones). Writes go to a temporary name and are renamed into
place. So sync services never see two devices editing one file. The only shared file is
`sync.json`, written when a folder is created and when the password changes.

## Encryption

- **Key derivation:** `scrypt(password NFC-normalized, salt, N=2^17, r=8, p=1)` → 32-byte master
  key (about 0.3 s and 128 MB once per device; parameters are stored in `sync.json`, so they can
  be raised later). HKDF-SHA256 derives two subkeys: the **check value** (stored in `sync.json`;
  a mismatch means a wrong password, so a wrong password is never confused with damaged data) and
  the **keyring key**.
- **Keyring:** random 256-bit data keys, oldest first, sealed with the keyring key. Data is
  sealed with the newest key.
- **Sealing:** AES-256-GCM, a random 96-bit nonce per file. Layout: `version (1) | key id (8) |
  nonce (12) | ciphertext | tag (16)`. The header and the file's place in the folder
  (`history/<profile>/<device>`, `profiles/<device>`) are authenticated, so a file moved to
  another log, cut short or changed in any byte is rejected.
- **Password change:** a new salt and master key, and a **new data key** appended to the
  keyring, which is re-sealed. Old keys stay so other devices' older files remain readable; the
  device that changed the password re-encrypts its own log with the new key. Other devices notice
  that their saved master key no longer matches the check value and ask for the new password.
  Two devices changing the password at the same moment: the last `sync.json` written wins.
- **Empty password:** allowed. Files are still sealed, but the key comes from an empty password,
  so anyone who can open the folder can read them. Settings then lists exactly what is exposed;
  that list is `syncExposure()` in `src/shared/sync.ts`, keyed by record type, so a new kind of
  synced data can't be added without saying what it exposes.
- **Saved key:** each device keeps the master key (never the password) in
  `<userData>/Sync/key.json`, wrapped with Electron's `safeStorage` on Windows (DPAPI) and Linux
  (Secret Service). **Not on macOS:** `safeStorage` uses a "YARC Safe Storage" keychain item, and
  without an Apple Developer ID macOS asks for the login password after every update
  (`electron-notes.md` section 8). There the file is plain (mode 0600), next to `history.sqlite`
  and the cookies, which aren't encrypted either, so it exposes nothing that isn't already there.

## The log

A record is one of (`SyncRecord` in `src/shared/sync.ts`):

| Kind | Fields | Meaning |
| --- | --- | --- |
| `visit` | url, title, time | a page visit |
| `title` | url, title, time | the page's title changed after the visit was sent |
| `delete` | url, time | every visit to `url` at or before `time` is gone |
| `clear` | time | every visit at or before `time` is gone |

A device numbers its records 1, 2, 3, … per profile. A chunk holds the records `first..last`
(gzipped JSON, then sealed). Local changes are sent about 10 seconds after they happen, at most
5,000 records per chunk, and whatever is left when YARC quits.

**Reading:** for every other device, a reader keeps a cursor (the last record applied) in its own
`history.sqlite`, plus the chunk files it has already read. New chunks are decrypted and applied
in order of `first`; one that starts after `cursor + 1` waits for the missing chunk (sync services
don't deliver files in order). A chunk that can't be decrypted yet (still downloading, cut short)
is retried on the next pass. Records and the cursor move in one SQLite transaction.

**Merge rules** (`History.applyRemote`):

- A replayed record (seq at or below the cursor) is skipped, so a visit is never counted twice.
- A visit with the same URL and time as one already stored is skipped: that's the same visit
  sent again (sync was turned off and on with another folder).
- `delete` and `clear` remove matching visits at or before their time and stay as **tombstones**,
  so an older visit arriving later from a device that was offline is removed too.
- **Clock skew:** each history has a clock that is this computer's time but never earlier than
  the newest timestamp merged from another device. So anything done here after seeing another
  device's deletion is stamped after it, even if this computer's clock is behind. Timestamps more
  than 24 hours in the future don't move the clock, so one device with a wrong date can't drag
  the others along (its records still sync).
- Concurrent changes (a visit here and a deletion there, neither device having seen the other)
  are ordered by those timestamps.

**Growth:** history is never pruned, so a log grows with the history it carries, but not beyond
it. Once a device has 16 chunks smaller than 1 MB, it merges them into one, dropping visits that a
deletion or clear removed, deletions older than a later clear, and superseded title changes. The
merged chunk covers the same sequence numbers, so other devices' cursors stay valid.

**Profiles:** `profiles/<device>` lists the profiles a device syncs. When a device joins, each
local profile takes the key of a profile with the same name (case-insensitive) on another device;
one without a match gets a new key and starts its own synced history. The key is kept in
`state.json`, so renaming a profile later doesn't break the link. Each profile has a switch in
Settings → Sync; off stops its sync and forgets its bookkeeping, and on picks up where it was.

**What's not synced:** incognito windows (they are a separate `Browser` whose `Profiles` never
reach the sync code; `History(undefined)` lives in memory), and anything but history.

## When things happen

- At launch, with the saved key; when the folder changes (`fs.watch`, recursive; our own writes
  are ignored); when a YARC window gains focus (at most every 30 s); every 5 minutes as a
  fallback for missed watch events.
- **iCloud Drive** on macOS before 14 replaces evicted files with `.<name>.icloud` placeholders:
  YARC asks for them with `brctl download` and picks them up when they arrive. On newer macOS,
  evicted files are "dataless" and download when read; reads are asynchronous, so a slow
  download doesn't freeze the app.
- If the folder disappears (a drive unplugged, a cloud app signed out), sync pauses and Settings
  says so.

## Turning it off

Settings → Sync → off: this device forgets its saved key, cursors and tombstones (which hold
deleted URLs). Local history stays. The folder is left as it is; delete it to remove the synced
history everywhere it isn't already merged.
