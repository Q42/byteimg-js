import * as sharp from 'sharp'
import * as fs from 'fs'

const FORMAT_VERSION = 2

// 0:   format version 
// 1,2: original width
// 3,4: original height
// 5:   small width
// 6:   small height
// 7,8: header length
const prefixLength = 1 + 2 + 2 + 1 + 1 + 2

export class Byteimg {
  common: Uint8Array
  specific: Uint8Array

  readonly formatVersion = FORMAT_VERSION
  readonly originalWidth: number
  readonly originalHeight: number
  readonly smallWidth: number
  readonly smallHeight: number

  constructor (
    common: Uint8Array,
    specific: Uint8Array,
    originalWidth: number,
    originalHeight: number,
    smallWidth: number,
    smallHeight: number,
  ) {
    this.common = common
    this.specific = specific
    this.originalWidth = originalWidth
    this.originalHeight = originalHeight
    this.smallWidth = smallWidth
    this.smallHeight = smallHeight
  }

  async toJoinedFile(fileOut: string): Promise<string> {
    return 'DONE'
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
}

export async function fromOriginal(input: string | Buffer): Promise<Byteimg> {
  const inputSharp = sharp(input)
  const {width: originalWidth, height: originalHeight} = await inputSharp.metadata()
  if (!originalWidth || !originalHeight) {
    throw 'Can\'t extract width/height metadata from input'
  }

  const max = 24 // because this fits 3 JPEG 8x8 blocks
  const ratio = originalWidth > originalHeight ? max / originalWidth : max / originalHeight
  const [smallWidth, smallHeight] = [Math.round(originalWidth * ratio), Math.round(originalHeight * ratio)]

  const jpegBuffer = await inputSharp
    .resize(smallWidth, smallHeight)
    .jpeg({
      quality: 70
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

  const prefixBuffer = new ArrayBuffer(prefixLength)
  const dataView = new DataView(prefixBuffer)
  dataView.setUint8(0, FORMAT_VERSION)
  dataView.setUint16(1, originalWidth)
  dataView.setUint16(3, originalHeight)
  dataView.setUint8(5, smallWidth)
  dataView.setUint8(6, smallHeight)
  dataView.setUint16(7, header.length)
  const prefixArray = new Uint8Array(prefixBuffer)

  const specific = new Uint8Array(prefixArray.length + body.length)
  specific.set(prefixArray, 0)
  specific.set(body, prefixArray.length)

  return new Byteimg(header, specific, originalWidth, originalHeight, smallWidth, smallHeight)
}

declare global {
  interface Buffer {
    indexOfBytes: (byte1: number, byte2: number) => number | null
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
