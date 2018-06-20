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
// 7,8: common length
const prefixLength = 1 + 2 + 2 + 1 + 1 + 2

export interface Prefix {
  formatVersion: number
  originalWidth: number
  originalHeight: number
  smallWidth: number
  smallHeight: number
  commonLength: number
}

export class Byteimg {
  readonly common: Buffer
  readonly specific: Buffer

  readonly formatVersion = FORMAT_VERSION
  readonly originalWidth: number
  readonly originalHeight: number
  readonly smallWidth: number
  readonly smallHeight: number

  constructor (
    common: Buffer,
    specific: Buffer,
    prefix: Prefix,
  ) {
    this.common = common
    this.specific = specific
    this.originalWidth = prefix.originalWidth
    this.originalHeight = prefix.originalHeight
    this.smallWidth = prefix.smallWidth
    this.smallHeight = prefix.smallHeight
  }

  toJoined(): Buffer {
    const joined = new Buffer(this.specific.length + this.common.length)
    joined.set(this.specific, 0)
    joined.set(this.common, this.specific.length)

    return joined
  }

  toImage(): Buffer {
    const sizeBuffer = new ArrayBuffer(4)
    const dataView = new DataView(sizeBuffer)
    dataView.setUint16(0, this.smallHeight)
    dataView.setUint16(2, this.smallWidth)
    const sizeArray = new Uint8Array(sizeBuffer)

    const result = new Buffer(this.common.length + this.specific.length - prefixLength)
    result.set(this.common, 0)
    result.set(this.specific.subarray(prefixLength), this.common.length)

    const indexC0 = result.indexOfBytes(0xFF, 0xC0) // start of frame
    const sizeBegin = indexC0 + 5
    result.set(sizeArray, sizeBegin)

    return result
  }

  async writeJoinedFile(fileOut: string): Promise<void> {
    await fs_writeFile(fileOut, this.toJoined())
  }

  async writeSpecificFile(fileOut: string): Promise<void> {
    await fs_writeFile(fileOut, this.specific)
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

  const header = jpegBuffer.subarray(0, indexDA)
  const body = jpegBuffer.subarray(indexDA)

  const prefix: Prefix = {
    formatVersion: FORMAT_VERSION,
    originalWidth,
    originalHeight,
    smallWidth,
    smallHeight,
    commonLength: header.length
  }
  const prefixBuffer = new Buffer(prefixLength)
  prefixBuffer.writePrefix(prefix)

  const specific = new Uint8Array(prefixBuffer.length + body.length)
  specific.set(prefixBuffer, 0)
  specific.set(body, prefixBuffer.length)

  return new Byteimg(new Buffer(header), new Buffer(specific), prefix)
}

export async function fromJoined(input: fs.PathLike | Buffer): Promise<Byteimg> {
  const inputBuffer =  await fs_readFile(input)
  const prefix = inputBuffer.readPrefix()

  if (prefix.commonLength > inputBuffer.length) {
    throw `fromJoined: Input too small. Perhaps input just contains specific data? Use fromSpecific function instead`
  }

  const specific = inputBuffer.slice(0, inputBuffer.length - prefix.commonLength)
  const common = inputBuffer.slice(inputBuffer.length - prefix.commonLength)

  return new Byteimg(common, specific, prefix)
}

export async function fromSpecific(input: fs.PathLike | Buffer, common: Buffer): Promise<Byteimg> {
  const specific =  await fs_readFile(input)
  const prefix = specific.readPrefix()

  if (common.length != prefix.commonLength) {
    throw `fromSpecific: common length doesn't match length data stored in specific`
  }

  return new Byteimg(common, specific, prefix)
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
    commonLength: dataView.getUint16(7)
  }
}

Buffer.prototype.writePrefix = function (prefix: Prefix) {
  const dataView = new DataView(this.buffer)
  dataView.setUint8(0, prefix.formatVersion)
  dataView.setUint16(1, prefix.originalWidth)
  dataView.setUint16(3, prefix.originalHeight)
  dataView.setUint8(5, prefix.smallWidth)
  dataView.setUint8(6, prefix.smallHeight)
  dataView.setUint16(7, prefix.commonLength)
}
