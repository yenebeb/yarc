// Nearby sync (proof of concept): computers on the same network copy each other's sync folder
// directly, so no cloud service is needed. Each computer keeps a private copy of the folder; the
// sync engine reads and writes it exactly as it would a cloud folder, and this file only moves the
// already-encrypted files between computers.
//
// Finding each other: every computer sends a small UDP multicast beacon every few seconds,
// carrying a group ID derived from the sync password (so computers with another password ignore
// it, and the beacon reveals nothing readable) and the TCP port it listens on.
//
// Talking: one computer connects to the other. Both send a fresh X25519 public key; the
// connection keys come from that key exchange mixed with a key derived from the sync password, so
// only a computer that knows the password can read or write anything on the connection. Then each
// side sends the list of files it has, asks for the ones it lacks, and sends them on request.
//
// Who may change what: a computer is the only source for its own files (its history logs and its
// profile list). Other computers copy them, and drop the ones their owner no longer lists (after
// compaction). sync.json is only replaced by one from the same sync with a later password change.
//
// No Electron imports, and value imports carry .ts, so unit tests can load it in plain Node.
import { createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { mkdirSync, rmSync, watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { createServer, connect, type Server, type Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_KDF_COST, deriveMasterKey, parseHeader } from './crypto.ts'
import { HEADER_FILE, writeAtomic } from './engine.ts'

/** An organization-local multicast address and port; beacons never leave the local network (TTL 1). */
const BEACON_GROUP = '239.255.89.65'
const BEACON_PORT = 47391
const BEACON_INTERVAL = 5_000
const HANDSHAKE_TIMEOUT = 10_000
/** A first sync can send one big chunk; anything larger than this is not from YARC. */
const MAX_FRAME = 64 * 1024 * 1024
const ID = '[0-9a-f]{16,64}'
const SYNC_PATH = new RegExp(`^(${HEADER_FILE.replace('.', '\\.')}|profiles/${ID}|history/${ID}/${ID}/${ID})$`)
const OWNED_PATH = new RegExp(`^(?:profiles/(${ID})|history/${ID}/(${ID})/${ID})$`)
const ID_NAME = new RegExp(`^${ID}$`)

/**
 * The key both computers derive from the sync password before they've exchanged anything. It
 * can't use sync.json's random salt (a computer that is joining doesn't have sync.json yet), so the
 * salt is fixed, and the same password gives the same key everywhere: that is what lets them meet.
 */
export function derivePairingKey(password: string): Promise<Buffer> {
  return deriveMasterKey(password, { alg: 'scrypt', ...DEFAULT_KDF_COST, salt: Buffer.from('yarc-sync nearby v1').toString('base64') })
}

/** What a beacon carries instead of anything readable: 8 bytes derived from the pairing key. */
function groupId(pairingKey: Buffer): string {
  return createHmac('sha256', pairingKey).update('yarc-sync discovery').digest('hex').slice(0, 16)
}

export interface NearbyOptions {
  /** This computer's private copy of the sync folder. */
  root: string
  deviceId: string
  /** Pairing keys, the current one first. An older one is kept so computers still on the old password learn that it changed. */
  keys: Buffer[]
  /** The number of connected computers changed. */
  onPeers?(count: number): void
  /** Files from another computer landed in the folder. */
  onReceived?(): void
  /** A computer with the same password belongs to a different sync (both started one). */
  onConflict?(message: string): void
}

interface Beacon {
  app: 'yarc-sync'
  v: 1
  /** Group ID: which password. */
  g: string
  /** Random per launch, so beacons can't follow a computer around. */
  i: string
  /** TCP port. */
  p: number
}

interface Hello {
  v: 1
  g: string
  i: string
  /** Random nonce and X25519 public key (SPKI DER), base64. */
  n: string
  k: string
}

interface HeaderInfo {
  folderId: string
  generation: number
}

type Message =
  | { t: 'hello'; device: string; folderId?: string }
  | { t: 'manifest'; files: Record<string, string>; header?: HeaderInfo }
  | { t: 'get'; paths: string[] }
  | { t: 'file'; path: string; data: string }

interface Peer {
  socket: Socket
  instance: string
  device?: string
  send(message: Message): void
  /** Files this computer asked the peer for; anything else it sends is ignored. */
  requested: Set<string>
  /** Messages are handled one at a time, in order. */
  queue: Promise<void>
}

export class NearbySync {
  private readonly instance = randomBytes(8).toString('hex')
  private readonly groups = new Map<string, Buffer>()
  private readonly peers = new Map<string, Peer>()
  private server: Server | undefined
  private listener: UdpSocket | undefined
  private senders = new Map<string, UdpSocket>()
  private port = 0
  private beaconTimer: NodeJS.Timeout | undefined
  private manifestTimer: NodeJS.Timeout | undefined
  private receivedTimer: NodeJS.Timeout | undefined
  private watcher: FSWatcher | undefined
  private hashes = new Map<string, { size: number; mtime: number; hash: string }>()
  private stopped = false

  constructor(private o: NearbyOptions) {
    for (const key of o.keys) this.groups.set(groupId(key), key)
  }

  get peerCount(): number {
    return [...this.peers.values()].filter((p) => p.device).length
  }

  async start(): Promise<void> {
    mkdirSync(this.o.root, { recursive: true })
    this.server = createServer((socket) => this.open(socket))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, () => resolve())
    })
    this.server.on('error', (err) => console.warn('[nearby] server:', err.message))
    this.port = (this.server.address() as { port: number }).port

    const listener = createSocket({ type: 'udp4', reuseAddr: true })
    this.listener = listener
    listener.on('message', (msg, rinfo) => this.onBeacon(msg, rinfo.address))
    listener.on('error', (err) => console.warn('[nearby] beacon listener:', err.message))
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject)
      listener.bind(BEACON_PORT, () => {
        listener.off('error', reject)
        resolve()
      })
    })
    listener.setMulticastLoopback(true)

    try {
      this.watcher = watch(this.o.root, { recursive: true }, (_event, name) => {
        if (String(name ?? '').endsWith('.tmp')) return
        clearTimeout(this.manifestTimer)
        this.manifestTimer = setTimeout(() => this.sendManifests(), 1_000)
      })
      this.watcher.on('error', () => this.watcher?.close())
    } catch (err) {
      console.warn('[nearby] can’t watch the folder:', (err as Error).message)
    }
    this.beacon()
    this.beaconTimer = setInterval(() => this.beacon(), BEACON_INTERVAL)
  }

  stop(): void {
    this.stopped = true
    clearInterval(this.beaconTimer)
    clearTimeout(this.manifestTimer)
    clearTimeout(this.receivedTimer)
    this.watcher?.close()
    for (const p of this.peers.values()) p.socket.destroy()
    this.peers.clear()
    for (const s of this.senders.values()) s.close()
    this.senders.clear()
    this.listener?.close()
    this.server?.close()
  }

  // ---------------------------------------------------------------- finding each other

  /** Sends a beacon per password group on every network interface; follows Wi-Fi changes. */
  private beacon(): void {
    if (this.stopped) return
    this.refreshInterfaces()
    for (const g of this.groups.keys()) {
      const beacon: Beacon = { app: 'yarc-sync', v: 1, g, i: this.instance, p: this.port }
      const data = Buffer.from(JSON.stringify(beacon))
      for (const s of this.senders.values()) s.send(data, BEACON_PORT, BEACON_GROUP, () => {})
    }
  }

  private refreshInterfaces(): void {
    const addresses = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i!.address)
    // With no network, two copies of YARC on one computer can still find each other.
    if (addresses.length === 0) addresses.push('127.0.0.1')
    for (const [address, s] of this.senders) {
      if (addresses.includes(address)) continue
      s.close()
      this.senders.delete(address)
    }
    for (const address of addresses) {
      if (this.senders.has(address)) continue
      try {
        this.listener?.addMembership(BEACON_GROUP, address)
      } catch {
        // Already a member, or the interface can't do multicast.
      }
      const s = createSocket('udp4')
      s.on('error', () => {
        s.close()
        this.senders.delete(address)
      })
      s.bind({ address, port: 0 }, () => {
        try {
          s.setMulticastInterface(address)
          s.setMulticastLoopback(true)
          s.setMulticastTTL(1)
        } catch {}
      })
      this.senders.set(address, s)
    }
  }

  private seen = new Set<string>()

  private onBeacon(msg: Buffer, address: string): void {
    let b: Beacon
    try {
      b = JSON.parse(msg.toString('utf8'))
    } catch {
      return
    }
    if (b.app !== 'yarc-sync' || b.v !== 1 || b.i === this.instance || !this.groups.has(b.g)) return
    if (!/^[0-9a-f]{16}$/.test(b.i) || !Number.isInteger(b.p)) return
    // Answer a computer seen for the first time right away, so it doesn't wait for the next beacon.
    if (!this.seen.has(b.i)) {
      this.seen.add(b.i)
      this.beacon()
    }
    // One connection per pair: the computer with the lower launch ID connects.
    if (this.peers.has(b.i) || this.instance > b.i) return
    const socket = connect({ host: address, port: b.p })
    this.open(socket, { group: b.g, instance: b.i })
  }

  // ---------------------------------------------------------------- the connection

  /** Runs the handshake on a new connection; `dialed` is set when this computer connected. */
  private open(socket: Socket, dialed?: { group: string; instance: string }): void {
    // A reset or refused connection only closes it; 'close' cleans up.
    socket.on('error', () => {})
    socket.setNoDelay(true)
    socket.setKeepAlive(true, 10_000)
    const { publicKey, privateKey } = generateKeyPairSync('x25519')
    const mine = { nonce: randomBytes(32), key: publicKey.export({ type: 'spki', format: 'der' }) }
    const hello = (g: string): Hello => ({ v: 1, g, i: this.instance, n: mine.nonce.toString('base64'), k: mine.key.toString('base64') })
    const writeFrame = (frame: Buffer) => {
      const length = Buffer.alloc(4)
      length.writeUInt32BE(frame.length)
      socket.write(Buffer.concat([length, frame]))
    }
    if (dialed) {
      // Claim the pair now, so a second beacon doesn't open a second connection.
      this.peers.set(dialed.instance, { socket, instance: dialed.instance, send: () => {}, requested: new Set(), queue: Promise.resolve() })
      writeFrame(Buffer.from(JSON.stringify(hello(dialed.group))))
    }
    const timeout = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT)

    let peer: Peer | undefined
    let receive: ((frame: Buffer) => void) | undefined
    const onHello = (frame: Buffer) => {
      clearTimeout(timeout)
      let theirs: Hello
      try {
        theirs = JSON.parse(frame.toString('utf8'))
      } catch {
        return socket.destroy()
      }
      const pairingKey = this.groups.get(theirs.g)
      if (theirs.v !== 1 || !pairingKey || theirs.i === this.instance || (dialed && theirs.i !== dialed.instance)) return socket.destroy()
      if (!dialed) {
        if (this.peers.has(theirs.i)) return socket.destroy()
        writeFrame(Buffer.from(JSON.stringify(hello(theirs.g))))
      }
      const them = { nonce: Buffer.from(theirs.n, 'base64'), key: Buffer.from(theirs.k, 'base64') }
      let shared: Buffer
      try {
        shared = diffieHellman({ privateKey, publicKey: createPublicKey({ key: them.key, format: 'der', type: 'spki' }) })
      } catch {
        return socket.destroy()
      }
      const [first, second] = dialed ? [mine, them] : [them, mine]
      const info = Buffer.concat([Buffer.from('yarc-sync nearby'), first.nonce, second.nonce, first.key, second.key])
      const keys = Buffer.from(hkdfSync('sha256', shared, pairingKey, info, 64))
      const sendKey = dialed ? keys.subarray(0, 32) : keys.subarray(32)
      const receiveKey = dialed ? keys.subarray(32) : keys.subarray(0, 32)
      let sent = 0n
      let received = 0n
      peer = {
        socket,
        instance: theirs.i,
        requested: new Set(),
        queue: Promise.resolve(),
        send: (message) => {
          if (socket.destroyed) return
          const cipher = createCipheriv('aes-256-gcm', sendKey, counterNonce(sent++))
          const body = Buffer.concat([cipher.update(JSON.stringify(message)), cipher.final(), cipher.getAuthTag()])
          writeFrame(body)
        }
      }
      this.peers.set(theirs.i, peer)
      receive = (frame) => {
        let message: Message
        try {
          const decipher = createDecipheriv('aes-256-gcm', receiveKey, counterNonce(received++))
          decipher.setAuthTag(frame.subarray(frame.length - 16))
          message = JSON.parse(Buffer.concat([decipher.update(frame.subarray(0, frame.length - 16)), decipher.final()]).toString('utf8'))
        } catch {
          // Doesn't know the password, or the connection was tampered with.
          return socket.destroy()
        }
        const p = peer!
        p.queue = p.queue.then(() => this.handle(p, message)).catch((err) => console.warn('[nearby]', (err as Error).message))
      }
      void this.greet(peer)
    }

    let buffered = Buffer.alloc(0)
    socket.on('data', (data) => {
      buffered = Buffer.concat([buffered, data as Buffer])
      while (buffered.length >= 4) {
        const length = buffered.readUInt32BE(0)
        if (length > MAX_FRAME) return socket.destroy()
        if (buffered.length < 4 + length) return
        const frame = buffered.subarray(4, 4 + length)
        buffered = buffered.subarray(4 + length)
        if (receive) receive(frame)
        else onHello(frame)
      }
    })
    socket.on('close', () => {
      clearTimeout(timeout)
      const instance = peer?.instance ?? dialed?.instance
      if (instance && this.peers.get(instance)?.socket === socket) this.peers.delete(instance)
      this.o.onPeers?.(this.peerCount)
    })
  }

  private async greet(peer: Peer): Promise<void> {
    const header = await this.localHeader()
    peer.send({ t: 'hello', device: this.o.deviceId, folderId: header?.folderId })
    peer.send(await this.manifest())
  }

  // ---------------------------------------------------------------- exchanging files

  private async handle(peer: Peer, m: Message): Promise<void> {
    switch (m.t) {
      case 'hello': {
        if (!ID_NAME.test(m.device) || m.device === this.o.deviceId) return void peer.socket.destroy()
        const header = await this.localHeader()
        if (header && m.folderId && m.folderId !== header.folderId) {
          this.o.onConflict?.('Another computer on this network uses the same password for a different sync. Turn sync off on one of them and join the other.')
          return void peer.socket.destroy()
        }
        peer.device = m.device
        this.o.onPeers?.(this.peerCount)
        return
      }
      case 'manifest':
        return this.onManifest(peer, m.files, m.header)
      case 'get':
        for (const path of m.paths) {
          if (!SYNC_PATH.test(path)) continue
          try {
            peer.send({ t: 'file', path, data: (await readFile(join(this.o.root, path))).toString('base64') })
          } catch {
            // Gone since the manifest (compacted); the next manifest says so.
          }
        }
        return
      case 'file': {
        if (!peer.requested.delete(m.path) || !SYNC_PATH.test(m.path)) return
        const data = Buffer.from(m.data, 'base64')
        if (m.path === HEADER_FILE) {
          let next: HeaderInfo
          try {
            next = headerInfo(parseHeader(data.toString('utf8')))
          } catch {
            return
          }
          if (!acceptHeader(next, await this.localHeader())) return
        }
        writeAtomic(join(this.o.root, m.path), data)
        clearTimeout(this.receivedTimer)
        this.receivedTimer = setTimeout(() => this.o.onReceived?.(), 500)
        return
      }
    }
  }

  private async onManifest(peer: Peer, files: Record<string, string>, header: HeaderInfo | undefined): Promise<void> {
    if (!peer.device) return
    const local = await this.localFiles()
    const ours = await this.localHeader()
    const wanted: string[] = []
    for (const [path, hash] of Object.entries(files)) {
      if (!SYNC_PATH.test(path) || local.get(path) === hash) continue
      const owner = ownerOf(path)
      if (owner === this.o.deviceId) continue
      if (path === HEADER_FILE) {
        if (header && acceptHeader(header, ours)) wanted.push(path)
      } else if (path.startsWith('profiles/')) {
        if (!local.has(path) || owner === peer.device) wanted.push(path)
      } else if (!local.has(path)) {
        wanted.push(path)
      }
    }
    // The owner no longer has these (it compacted them away): drop them here too.
    for (const path of local.keys()) {
      if (ownerOf(path) === peer.device && !(path in files)) {
        rmSync(join(this.o.root, path), { force: true })
        this.hashes.delete(path)
      }
    }
    if (wanted.length === 0) return
    for (const path of wanted) peer.requested.add(path)
    peer.send({ t: 'get', paths: wanted })
  }

  private async sendManifests(): Promise<void> {
    const ready = [...this.peers.values()].filter((p) => p.device)
    if (ready.length === 0) return
    const manifest = await this.manifest()
    for (const p of ready) p.send(manifest)
  }

  private async manifest(): Promise<Message> {
    const header = await this.localHeader()
    return { t: 'manifest', files: Object.fromEntries(await this.localFiles()), header: header && headerInfo(header) }
  }

  private async localHeader(): Promise<ReturnType<typeof parseHeader> | undefined> {
    try {
      return parseHeader(await readFile(join(this.o.root, HEADER_FILE), 'utf8'))
    } catch {
      return undefined
    }
  }

  /** Every sync file in the folder, with a hash of its content (cached by size and modification time). */
  private async localFiles(): Promise<Map<string, string>> {
    const root = this.o.root
    const paths = [HEADER_FILE, ...(await ids(join(root, 'profiles'))).map((d) => `profiles/${d}`)]
    for (const pk of await ids(join(root, 'history')))
      for (const device of await ids(join(root, 'history', pk)))
        for (const chunk of await ids(join(root, 'history', pk, device))) paths.push(`history/${pk}/${device}/${chunk}`)
    const files = new Map<string, string>()
    for (const path of paths) {
      try {
        const full = join(root, path)
        const s = await stat(full)
        const cached = this.hashes.get(path)
        if (cached && cached.size === s.size && cached.mtime === s.mtimeMs) {
          files.set(path, cached.hash)
          continue
        }
        const hash = createHash('sha256').update(await readFile(full)).digest('hex').slice(0, 32)
        this.hashes.set(path, { size: s.size, mtime: s.mtimeMs, hash })
        files.set(path, hash)
      } catch {
        // Not there (no sync.json yet), or removed meanwhile.
      }
    }
    return files
  }
}

/** A 12-byte GCM nonce from a per-direction message counter: never repeats within a connection. */
function counterNonce(n: bigint): Buffer {
  const nonce = Buffer.alloc(12)
  nonce.writeBigUInt64BE(n, 4)
  return nonce
}

function ownerOf(path: string): string | undefined {
  const m = OWNED_PATH.exec(path)
  return m ? (m[1] ?? m[2]) : undefined
}

function headerInfo(header: ReturnType<typeof parseHeader>): HeaderInfo {
  return { folderId: header.folderId, generation: header.generation ?? 0 }
}

/** sync.json is copied when this computer has none, or when it's the same sync after a later password change. */
function acceptHeader(theirs: HeaderInfo, ours: ReturnType<typeof parseHeader> | undefined): boolean {
  if (!ours) return true
  return theirs.folderId === ours.folderId && theirs.generation > (ours.generation ?? 0)
}

async function ids(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => ID_NAME.test(n))
  } catch {
    return []
  }
}
