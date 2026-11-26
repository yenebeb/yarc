# History sync

History sync carries browsing history between a user's computers through a place they choose:
Google Drive, OneDrive or Dropbox (YARC signs in to them), iCloud Drive or any other folder
another app syncs, their own WebDAV server, or directly between computers on the same network.
There is no YARC server, account or telemetry: the maintainers never hold or see anyone's data,
and wherever the files are kept only ever sees encrypted files. Code: `src/main/sync/` (crypto,
log format, engine, the stores, Electron controller), `src/main/history.ts` (merge rules),
`src/shared/sync.ts` (record types and what they expose). Tests: `test/unit/sync.test.ts`,
`test/unit/sync-remote.test.ts`.

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
- **Forgotten password:** it can't be recovered. A device that still syncs has the key saved and
  only asks for the new password when changing it, so the old one isn't needed there. With no such
  device, *Forgot the Password?* in setup starts over: the files of the sync kept there are removed
  (`removeSyncFiles`, `RemoteMirror.clear`) and a new `sync.json` with a new folder ID is written.
  Each device still has its own history and sends it again; the others ask for the new password.
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

## Cloud drives and your own server

Settings → Sync offers, in order: the cloud drives this build has an app registration for
(`availableDrives()`), iCloud Drive when its folder is on this computer (one click: its
`YARC Sync` folder), your own server, any other folder, and nearby computers.

For a cloud drive or a server, YARC keeps a copy of the sync folder in `<userData>/Sync/Remote`
and the engine works on the copy; `remote.ts` moves the encrypted files between the copy and the
store (`RemoteStore`: list, read, write, remove), by the same rules as nearby sync below: a
computer uploads only its own files and `sync.json`, downloads the others' new and changed files,
and drops copies their owner removed. Its own files come back only when the copy was cleared (sync
turned off and on), so its log numbering continues. `sync.json` from the store replaces the copy's
unless the copy holds the same sync after a later password change, not yet uploaded. Each pass:
fetch, then the engine, then upload. Nothing announces changes in a store, so it's checked on
focus (at most every 30 s) and every 5 minutes. What's waiting at quit is written to the copy and
uploaded at the next launch.

| | Where the files go | Access YARC asks for |
| --- | --- | --- |
| Google Drive | The hidden app data folder; each file named by its path | `drive.appdata` (only its own hidden folder), `openid email` to show the account |
| OneDrive | `Apps/YARC` in the user's OneDrive (Microsoft Graph app folder) | `Files.ReadWrite.AppFolder`, `offline_access`, `openid email` |
| Dropbox | `Apps/YARC` in the user's Dropbox (app folder app) | `files.metadata.read`, `files.content.read`, `files.content.write`, `account_info.read` |
| Your own server | `YARC Sync` inside the WebDAV folder the user names | its user name and password (HTTP Basic); `http://` only on the local network |

- **Signing in** (`oauth.ts`) is the installed-app flow (RFC 8252): the sign-in page opens in the
  user's own browser, which returns to `http://localhost:47392/callback` (YARC listens there for
  up to 10 minutes, on IPv4 and IPv6), with PKCE and a random state. The refresh token, or the
  server's password, is saved with the sync key in `Sync/key.json` (the same protection, see
  below); access tokens live in memory only. A revoked sign-in or a refused password locks sync
  until the user signs in again.
- **A cloud drive's own app is a different place.** The Google Drive app's folder can't meet a
  Google Drive sign-in (the app data folder isn't visible), so the folder picker suggests other
  sync apps instead. iCloud Drive has no API for this, so it's folder-only.

## Registering YARC with the cloud drives

The drives are offered only once `src/main/sync/cloud-drives.ts` has YARC's client IDs. They are
public by design (every installed copy carries them). Each registration uses the redirect address
`http://localhost:47392/callback`.

- **Google Drive:** in Google Cloud Console, create a project, enable the Google Drive API,
  configure the OAuth consent screen (external; scopes `openid`, `email`, `.../auth/drive.appdata`,
  all non-sensitive, so no security review), and create an OAuth client of type *Desktop app*. Put
  its client ID and client secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Publish the
  consent screen; while it's in testing, only listed test users can sign in and refresh tokens
  expire after 7 days.
- **OneDrive:** in the Microsoft Entra admin center, register an app for *accounts in any
  organizational directory and personal Microsoft accounts*, add the platform *Mobile and desktop
  applications* with redirect URI `http://localhost`, turn on *Allow public client flows*, and
  add the delegated Graph permissions `Files.ReadWrite.AppFolder`, `offline_access`, `openid`,
  `email`. Put the application (client) ID in `MICROSOFT_CLIENT_ID`. The app's display name names
  the folder (`Apps/<name>`), so call it YARC.
- **Dropbox:** in the Dropbox App Console, create a *Scoped access* app with *App folder* access
  named YARC, tick the four permissions in the table above, add the redirect URI
  `http://localhost:47392/callback`, and allow PKCE (no secret). Put the app key in
  `DROPBOX_APP_KEY`. Until it's approved for production, only 500 users can link it.

## Nearby computers (proof of concept)

`src/main/sync/nearby.ts`. Sync without a cloud folder: computers on the same network copy the
folder between themselves. Each computer keeps a private copy in `<userData>/Sync/Nearby`; the
engine reads and writes it exactly like a cloud folder, so the encryption, the logs and the
merge rules above are unchanged. Only the transport differs.

- **Finding each other:** a UDP multicast beacon (`239.255.89.65:47391`, TTL 1, so it never
  leaves the local network) every 5 s on every IPv4 interface. It carries a group ID (8 bytes of
  an HMAC of the pairing key), a random per-launch ID and a TCP port; nothing readable, and
  nothing that stays the same across launches except the group ID.
- **Pairing key:** scrypt of the password with a fixed salt (`yarc-sync nearby v1`), so a
  computer that doesn't have `sync.json` yet derives the same key. Because of that, an empty
  password is refused for nearby sync.
- **Connection:** the computer with the lower launch ID connects. Both send a fresh X25519 key;
  the connection keys are HKDF(X25519 secret, salt = pairing key, info = both nonces and keys),
  one per direction, AES-256-GCM with a counter nonce. A computer without the password can't
  read or send anything. Limit: someone on the network who actively sits in the middle of a
  connection can try passwords offline against it (a PAKE such as CPace would fix that); a
  passive listener can't.
- **What's copied:** each side sends a list of its files with a content hash, asks for what it
  lacks, and gets it. A computer is the only source for its own logs and profile list; copies of
  another computer's files are dropped when their owner no longer lists them (compaction).
  `sync.json` is taken when this computer has none, or when it's the same sync with a higher
  `generation` (bumped by every password change).
- **Password change:** the computer that changes it keeps listening under the old pairing key
  too, so the others get the new `sync.json`, lock, and ask for the new password.
- **Two separate syncs with one password** (both computers chose "Start a new sync"): they find
  each other, see different folder IDs, and Settings says so; nothing is mixed.
- **Not yet:** syncing over the internet (computers must be on the same network at the same
  time), a third computer relaying while the owner is offline is fine for logs but its deletions
  wait for the owner, and the first-launch prompts: macOS asks for **Local Network** access
  (System Settings → Privacy & Security → Local Network), Windows Defender Firewall asks to allow
  YARC on private networks.

## Turning it off

Settings → Sync → off: this device forgets its saved key and sign-in, cursors and tombstones
(which hold deleted URLs), and deletes its copy of a cloud drive's or server's sync folder.
Local history stays. The synced files are left as they are; delete them (the folder, `Apps/YARC`,
or YARC's data in Google Drive's *Manage apps*) to remove the synced history everywhere it isn't
already merged.
