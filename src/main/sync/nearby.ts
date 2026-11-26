import { createCipheriv, createDecipheriv, createHmac, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { mkdirSync, rmSync, watch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, connect, type Server, type Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_KDF_COST, deriveMasterKey, parseHeader } from './crypto.ts'
import { HEADER_FILE, writeAtomic } from './engine.ts'
import { acceptHeader, FolderHashes, headerInfo, ID_NAME, ownerOf, SYNC_PATH, type HeaderInfo } from './paths.ts'

/** An organization-local multicast address and port; beacons never leave the local network (TTL 1). */
const BEACON_GROUP = '239.255.89.65'
const BEACON_PORT = 47391
const BEACON_INTERVAL = 5_000
const HANDSHAKE_TIMEOUT = 10_000
/** A first sync can send one big chunk; anything larger than this is not from YARC. */
const MAX_FRAME = 64 * 1024 * 1024

/** A joining computer has no sync.json yet, so the salt is fixed: the same password gives the same key everywhere. */
export function derivePairingKey(password: string): Promise<Buffer> {
  return deriveMasterKey(password, { alg: 'scrypt', ...DEFAULT_KDF_COST, salt: Buffer.from('yarc-sync nearby v1').toString('base64') })
}

function groupId(pairingKey: Buffer): string {
  return createHmac('sha256', pairingKey).update('yarc-sync discovery').digest('hex').slice(0, 16)
}

export interface NearbyOptions {
  root: string
  deviceId: string
  /** Pairing keys, the current one first. An older one is kept so computers still on the old password learn that it changed. */
  keys: Buffer[]
  onPeers?(count: number): void
  onReceived?(): void
  onConflict?(message: string): void
}

interface Beacon {
  app: 'yarc-sync'
  version: 1
  group: string
  /** Random per launch, so beacons can't follow a computer around. */
  instance: string
  port: number
}

interface Hello {
  version: 1
  group: string
  instance: string
  nonce: string
  key: string
}

type Message =
  | { type: 'hello'; device: string; folderId?: string }
  | { type: 'manifest'; files: Record<string, string>; header?: HeaderInfo }
  | { type: 'get'; paths: string[] }
  | { type: 'file'; path: string; data: string }

interface Peer {
  socket: Socket
  instance: string
  device?: string
  send(message: Message): void
  requested: Set<string>
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
  private readonly hashes: FolderHashes
  private readonly options: NearbyOptions
  private stopped = false

  constructor(options: NearbyOptions) {
    this.options = options
    this.hashes = new FolderHashes(options.root)
    for (const key of options.keys) this.groups.set(groupId(key), key)
  }

  get peerCount(): number {
    return [...this.peers.values()].filter((peer) => peer.device).length
  }

  async start(): Promise<void> {
    mkdirSync(this.options.root, { recursive: true })
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
      this.watcher = watch(this.options.root, { recursive: true }, (_event, name) => {
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
    for (const peer of this.peers.values()) peer.socket.destroy()
    this.peers.clear()
    for (const sender of this.senders.values()) sender.close()
    this.senders.clear()
    this.listener?.close()
    this.server?.close()
  }

  private beacon(): void {
    if (this.stopped) return
    this.refreshInterfaces()
    for (const group of this.groups.keys()) {
      const beacon: Beacon = { app: 'yarc-sync', version: 1, group, instance: this.instance, port: this.port }
      const data = Buffer.from(JSON.stringify(beacon))
      for (const sender of this.senders.values()) sender.send(data, BEACON_PORT, BEACON_GROUP, () => {})
    }
  }

  private refreshInterfaces(): void {
    const addresses = Object.values(networkInterfaces())
      .flat()
      .filter((network) => network && network.family === 'IPv4' && !network.internal)
      .map((network) => network!.address)
    // With no network, two copies of YARC on one computer can still find each other.
    if (addresses.length === 0) addresses.push('127.0.0.1')
    for (const [address, sender] of this.senders) {
      if (addresses.includes(address)) continue
      sender.close()
      this.senders.delete(address)
    }
    for (const address of addresses) {
      if (this.senders.has(address)) continue
      try {
        this.listener?.addMembership(BEACON_GROUP, address)
      } catch {
        // Already a member, or the interface can't do multicast.
      }
      const sender = createSocket('udp4')
      sender.on('error', () => {
        sender.close()
        this.senders.delete(address)
      })
      sender.bind({ address, port: 0 }, () => {
        try {
          sender.setMulticastInterface(address)
          sender.setMulticastLoopback(true)
          sender.setMulticastTTL(1)
        } catch {}
      })
      this.senders.set(address, sender)
    }
  }

  private seen = new Set<string>()

  private onBeacon(packet: Buffer, address: string): void {
    const beacon = parseObject<Beacon>(packet)
    if (!beacon || beacon.app !== 'yarc-sync' || beacon.version !== 1 || beacon.instance === this.instance || typeof beacon.group !== 'string' || !this.groups.has(beacon.group)) return
    if (typeof beacon.instance !== 'string' || !/^[0-9a-f]{16}$/.test(beacon.instance) || !isPort(beacon.port)) return
    // Answer a computer seen for the first time right away, so it doesn't wait for the next beacon.
    if (!this.seen.has(beacon.instance)) {
      this.seen.add(beacon.instance)
      this.beacon()
    }
    // One connection per pair: the computer with the lower launch ID connects.
    if (this.peers.has(beacon.instance) || this.instance > beacon.instance) return
    const socket = connect({ host: address, port: beacon.port })
    this.open(socket, { group: beacon.group, instance: beacon.instance })
  }

  private open(socket: Socket, dialed?: { group: string; instance: string }): void {
    // A reset or refused connection only closes it; 'close' cleans up.
    socket.on('error', () => {})
    socket.setNoDelay(true)
    socket.setKeepAlive(true, 10_000)
    const { publicKey, privateKey } = generateKeyPairSync('x25519')
    const mine = { nonce: randomBytes(32), key: publicKey.export({ type: 'spki', format: 'der' }) }
    const hello = (group: string): Hello => ({ version: 1, group, instance: this.instance, nonce: mine.nonce.toString('base64'), key: mine.key.toString('base64') })
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
      const theirs = parseHello(frame)
      const pairingKey = theirs && this.groups.get(theirs.group)
      if (!theirs || !pairingKey || theirs.instance === this.instance || (dialed && theirs.instance !== dialed.instance)) return socket.destroy()
      if (!dialed) {
        if (this.peers.has(theirs.instance)) return socket.destroy()
        writeFrame(Buffer.from(JSON.stringify(hello(theirs.group))))
      }
      const them = { nonce: Buffer.from(theirs.nonce, 'base64'), key: Buffer.from(theirs.key, 'base64') }
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
        instance: theirs.instance,
        requested: new Set(),
        queue: Promise.resolve(),
        send: (message) => {
          if (socket.destroyed) return
          const cipher = createCipheriv('aes-256-gcm', sendKey, counterNonce(sent++))
          const body = Buffer.concat([cipher.update(JSON.stringify(message)), cipher.final(), cipher.getAuthTag()])
          writeFrame(body)
        }
      }
      this.peers.set(theirs.instance, peer)
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
        const sender = peer!
        sender.queue = sender.queue.then(() => this.handle(sender, message)).catch((err) => console.warn('[nearby]', (err as Error).message))
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
      this.options.onPeers?.(this.peerCount)
    })
  }

  private async greet(peer: Peer): Promise<void> {
    const header = await this.localHeader()
    peer.send({ type: 'hello', device: this.options.deviceId, folderId: header?.folderId })
    peer.send(await this.manifest())
  }

  private async handle(peer: Peer, message: Message): Promise<void> {
    switch (message.type) {
      case 'hello': {
        if (!ID_NAME.test(message.device) || message.device === this.options.deviceId) return void peer.socket.destroy()
        const header = await this.localHeader()
        if (header && message.folderId && message.folderId !== header.folderId) {
          this.options.onConflict?.('Another computer on this network uses the same password for a different sync. Turn sync off on one of them and join the other.')
          return void peer.socket.destroy()
        }
        peer.device = message.device
        this.options.onPeers?.(this.peerCount)
        return
      }
      case 'manifest':
        return this.onManifest(peer, message.files, message.header)
      case 'get':
        for (const path of message.paths) {
          if (!SYNC_PATH.test(path)) continue
          try {
            peer.send({ type: 'file', path, data: (await readFile(join(this.options.root, path))).toString('base64') })
          } catch {
            // Gone since the manifest (compacted); the next manifest says so.
          }
        }
        return
      case 'file': {
        if (!peer.requested.delete(message.path) || !SYNC_PATH.test(message.path)) return
        const data = Buffer.from(message.data, 'base64')
        if (message.path === HEADER_FILE) {
          let next: HeaderInfo
          try {
            next = headerInfo(parseHeader(data.toString('utf8')))
          } catch {
            return
          }
          if (!acceptHeader(next, await this.localHeader())) return
        }
        writeAtomic(join(this.options.root, message.path), data)
        clearTimeout(this.receivedTimer)
        this.receivedTimer = setTimeout(() => this.options.onReceived?.(), 500)
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
      if (owner === this.options.deviceId) continue
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
        rmSync(join(this.options.root, path), { force: true })
        this.hashes.forget(path)
      }
    }
    if (wanted.length === 0) return
    for (const path of wanted) peer.requested.add(path)
    peer.send({ type: 'get', paths: wanted })
  }

  private async sendManifests(): Promise<void> {
    const ready = [...this.peers.values()].filter((peer) => peer.device)
    if (ready.length === 0) return
    const manifest = await this.manifest()
    for (const peer of ready) peer.send(manifest)
  }

  private async manifest(): Promise<Message> {
    const header = await this.localHeader()
    return { type: 'manifest', files: Object.fromEntries(await this.localFiles()), header: header && headerInfo(header) }
  }

  private async localHeader(): Promise<ReturnType<typeof parseHeader> | undefined> {
    try {
      return parseHeader(await readFile(join(this.options.root, HEADER_FILE), 'utf8'))
    } catch {
      return undefined
    }
  }

  private localFiles(): Promise<Map<string, string>> {
    return this.hashes.list()
  }
}

/** Anyone on the network can send a beacon or open a connection: nothing in one is trusted before it's checked. */
function parseObject<Shape>(data: Buffer): Partial<Record<keyof Shape, unknown>> | undefined {
  try {
    const parsed: unknown = JSON.parse(data.toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

function parseHello(frame: Buffer): Hello | undefined {
  const hello = parseObject<Hello>(frame)
  const complete = hello?.version === 1 && [hello.group, hello.instance, hello.nonce, hello.key].every((field) => typeof field === 'string')
  return complete ? (hello as Hello) : undefined
}

function isPort(port: unknown): port is number {
  return Number.isInteger(port) && (port as number) > 0 && (port as number) < 65536
}

/** A 12-byte GCM nonce from a per-direction message counter: never repeats within a connection. */
function counterNonce(counter: bigint): Buffer {
  const nonce = Buffer.alloc(12)
  nonce.writeBigUInt64BE(counter, 4)
  return nonce
}
