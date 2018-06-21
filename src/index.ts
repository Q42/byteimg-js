import * as sharp from 'sharp'
import * as fs from 'fs'
import * as util from 'util'

const fs_readFile = util.promisify(fs.readFile)
const fs_writeFile = util.promisify(fs.writeFile)

const FORMAT_VERSION = 2

// 0:   format version 
// 1,2: original width
// 3,4: original height
// 5:   small width
// 6:   small height
// 7,8: header length
const prefixLength = 1 + 2 + 2 + 1 + 1 + 2

export interface Prefix {
  formatVersion: number
  originalWidth: number
  originalHeight: number
  smallWidth: number
  smallHeight: number
  headerLength: number
}

export class Byteimg {
  readonly header: Buffer
  readonly body: Buffer

  readonly formatVersion = FORMAT_VERSION
  readonly originalWidth: number
  readonly originalHeight: number
  readonly smallWidth: number
  readonly smallHeight: number

  constructor (
    header: Buffer,
    body: Buffer,
    prefix: Prefix,
  ) {
    this.header = header
    this.body = body
    this.originalWidth = prefix.originalWidth
    this.originalHeight = prefix.originalHeight
    this.smallWidth = prefix.smallWidth
    this.smallHeight = prefix.smallHeight
  }

  toJoined(): Buffer {
    const joined = new Buffer(this.body.length + this.header.length)
    joined.set(this.body, 0)
    joined.set(this.header, this.body.length)

    return joined
  }

  toImage(): Buffer {
    const sizeBuffer = new ArrayBuffer(4)
    const dataView = new DataView(sizeBuffer)
    dataView.setUint16(0, this.smallHeight)
    dataView.setUint16(2, this.smallWidth)
    const sizeArray = new Uint8Array(sizeBuffer)

    const jpeg = new Buffer(this.header.length + this.body.length - prefixLength)
    jpeg.set(this.header, 0)
    jpeg.set(this.body.subarray(prefixLength), this.header.length)

    const indexC0 = jpeg.indexOfBytes(0xFF, 0xC0) // start of frame
    const sizeBegin = indexC0 + 5
    jpeg.set(sizeArray, sizeBegin)

    return jpeg
  }

  async writeJoinedFile(fileOut: string): Promise<void> {
    await fs_writeFile(fileOut, this.toJoined())
  }

  async writeBodyFile(fileOut: string): Promise<void> {
    await fs_writeFile(fileOut, this.body)
  }

  async writeImageFile(fileOut: string): Promise<void> {
    await fs_writeFile(fileOut, this.toImage())
  }
}

export async function fromOriginal(input: string | Buffer): Promise<Byteimg> {
  const inputSharp = sharp(input)
  const {width: originalWidth, height: originalHeight} = await inputSharp.metadata()
  if (!originalWidth || !originalHeight) {
    throw 'fromOriginal: Can\'t extract width/height metadata from input'
  }

  const max = 24 // because this fits 3 JPEG 8x8 blocks
  const ratio = originalWidth > originalHeight ? max / originalWidth : max / originalHeight
  const [smallWidth, smallHeight] = [Math.round(originalWidth * ratio), Math.round(originalHeight * ratio)]

  const jpegBuffer = await inputSharp
    .resize(smallWidth, smallHeight)
    .jpeg({
      quality: 70,
      optimiseCoding: false
    })
    .toBuffer()

  // Find size in JPEG header
  const indexC0 = jpegBuffer.indexOfBytes(0xFF, 0xC0) // start of frame
  const indexDA = jpegBuffer.indexOfBytes(0xFF, 0xDA) // start of scan
  const sizeBegin = indexC0 + 5
  const sizeEnd = sizeBegin + 4

  // Override size in header with all zeroes, so headers for different files are the same
  jpegBuffer.fill(0, sizeBegin, sizeEnd)

  const jpegHeader = jpegBuffer.subarray(0, indexDA)
  const jpegBody = jpegBuffer.subarray(indexDA)

  const prefix: Prefix = {
    formatVersion: FORMAT_VERSION,
    originalWidth,
    originalHeight,
    smallWidth,
    smallHeight,
    headerLength: jpegHeader.length
  }
  const prefixBuffer = new Buffer(prefixLength)
  prefixBuffer.writePrefix(prefix)

  const body = new Uint8Array(prefixBuffer.length + jpegBody.length)
  body.set(prefixBuffer, 0)
  body.set(jpegBody, prefixBuffer.length)

  return new Byteimg(new Buffer(jpegHeader), new Buffer(body), prefix)
}

export async function fromJoined(input: fs.PathLike | Buffer): Promise<Byteimg> {
  const inputBuffer =  await fs_readFile(input)
  const prefix = inputBuffer.readPrefix()

  if (prefix.headerLength > inputBuffer.length) {
    throw `fromJoined: Input too small. Perhaps input just contains body data? Use fromBody function instead`
  }

  const body = inputBuffer.slice(0, inputBuffer.length - prefix.headerLength)
  const header = inputBuffer.slice(inputBuffer.length - prefix.headerLength)

  return new Byteimg(header, body, prefix)
}

export async function fromBody(input: fs.PathLike | Buffer, header: Buffer): Promise<Byteimg> {
  const body =  await fs_readFile(input)
  const prefix = body.readPrefix()

  console.log(header.length, prefix.headerLength)
  if (header.length != prefix.headerLength) {
    throw `fromBody: header length doesn't match length data stored in body`
  }

  return new Byteimg(header, body, prefix)
}

declare global {
  interface Buffer {
    indexOfBytes: (byte1: number, byte2: number) => number | null
    readPrefix: () => Prefix
    writePrefix: (prefix: Prefix) => void
  }
}

Buffer.prototype.indexOfBytes = function(byte1: number, byte2: number): number | undefined {
  for (let i = 0; i < this.length - 1; i++) {
    const curr = this[i]
    const next = this[i + 1]

    if (curr == byte1 && next == byte2) {
      return i
    }
  }
}

Buffer.prototype.readPrefix = function (): Prefix {
  const dataView = new DataView(this.buffer)
  const formatVersion = dataView.getUint8(0)

  if (formatVersion != FORMAT_VERSION) {
    throw `fromJoined: Format version ${formatVersion} is not supported`
  }

  return {
    formatVersion: formatVersion,
    originalWidth: dataView.getUint16(1),
    originalHeight: dataView.getUint16(3),
    smallWidth: dataView.getUint8(5),
    smallHeight: dataView.getUint8(6),
    headerLength: dataView.getUint16(7)
  }
}

Buffer.prototype.writePrefix = function (prefix: Prefix) {
  const dataView = new DataView(this.buffer)
  dataView.setUint8(0, prefix.formatVersion)
  dataView.setUint16(1, prefix.originalWidth)
  dataView.setUint16(3, prefix.originalHeight)
  dataView.setUint8(5, prefix.smallWidth)
  dataView.setUint8(6, prefix.smallHeight)
  dataView.setUint16(7, prefix.headerLength)
}
