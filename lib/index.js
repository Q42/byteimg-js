"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const sharp = require("sharp");
const fs = require("fs");
const util = require("util");
const fs_readFile = util.promisify(fs.readFile);
const fs_writeFile = util.promisify(fs.writeFile);
const FORMAT_VERSION = 2;
// byte | description
// ------------------
// 0      format version
// 1,2    original width (big endian)
// 3,4    original height (big endian)
// 5      small width
// 6      small height
// 7,8    header byte count (big endian)
// 9,10   body byte count (big endian)
const prefixLength = 1 + 2 + 2 + 1 + 1 + 2 + 2;
class Byteimg {
    constructor(header, body, prefix) {
        this.formatVersion = FORMAT_VERSION;
        this.header = header;
        this.body = body;
        this.originalWidth = prefix.originalWidth;
        this.originalHeight = prefix.originalHeight;
        this.smallWidth = prefix.smallWidth;
        this.smallHeight = prefix.smallHeight;
    }
    toBuffer() {
        const buffer = new Buffer(this.body.length + this.header.length);
        buffer.set(this.body, 0);
        buffer.set(this.header, this.body.length);
        return buffer;
    }
    toImage() {
        const sizeBuffer = new ArrayBuffer(4);
        const dataView = new DataView(sizeBuffer);
        dataView.setUint16(0, this.smallHeight);
        dataView.setUint16(2, this.smallWidth);
        const sizeArray = new Uint8Array(sizeBuffer);
        const jpeg = new Buffer(this.header.length + this.body.length - prefixLength);
        jpeg.set(this.header, 0);
        jpeg.set(this.body.subarray(prefixLength), this.header.length);
        const indexC0 = jpeg.indexOfBytes(0xFF, 0xC0); // start of frame
        const sizeBegin = indexC0 + 5;
        jpeg.set(sizeArray, sizeBegin);
        return jpeg;
    }
    writeByteimgFile(fileOut) {
        return __awaiter(this, void 0, void 0, function* () {
            yield fs_writeFile(fileOut, this.toBuffer());
        });
    }
    writeBodyFile(fileOut) {
        return __awaiter(this, void 0, void 0, function* () {
            yield fs_writeFile(fileOut, this.body);
        });
    }
    writeImageFile(fileOut) {
        return __awaiter(this, void 0, void 0, function* () {
            yield fs_writeFile(fileOut, this.toImage());
        });
    }
}
exports.Byteimg = Byteimg;
function fromOriginal(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const inputSharp = sharp(input);
        const { width: originalWidth, height: originalHeight } = yield inputSharp.metadata();
        if (!originalWidth || !originalHeight) {
            throw 'fromOriginal: Can\'t extract width/height metadata from input';
        }
        const max = 24; // because this fits 3 JPEG 8x8 blocks
        const ratio = originalWidth > originalHeight ? max / originalWidth : max / originalHeight;
        const [smallWidth, smallHeight] = [Math.round(originalWidth * ratio), Math.round(originalHeight * ratio)];
        const jpegBuffer = yield inputSharp
            .resize(smallWidth, smallHeight)
            .jpeg({
            quality: 60,
            optimiseCoding: false
        })
            .toBuffer();
        // Find size in JPEG header
        const indexC0 = jpegBuffer.indexOfBytes(0xFF, 0xC0); // start of frame
        const indexDA = jpegBuffer.indexOfBytes(0xFF, 0xDA); // start of scan
        const sizeBegin = indexC0 + 5;
        const sizeEnd = sizeBegin + 4;
        // Override size in header with all zeroes, so headers for different files are the same
        jpegBuffer.fill(0, sizeBegin, sizeEnd);
        const jpegHeader = jpegBuffer.subarray(0, indexDA);
        const jpegBody = jpegBuffer.subarray(indexDA);
        const prefix = {
            formatVersion: FORMAT_VERSION,
            originalWidth,
            originalHeight,
            smallWidth,
            smallHeight,
            headerByteCount: jpegHeader.length,
            bodyByteCount: jpegBody.length
        };
        const prefixBuffer = new Buffer(prefixLength);
        prefixBuffer.writePrefix(prefix);
        const body = new Uint8Array(prefixBuffer.length + jpegBody.length);
        body.set(prefixBuffer, 0);
        body.set(jpegBody, prefixBuffer.length);
        return new Byteimg(new Buffer(jpegHeader), new Buffer(body), prefix);
    });
}
exports.fromOriginal = fromOriginal;
function fromByteimg(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const inputBuffer = yield fs_readFile(input);
        const prefix = inputBuffer.readPrefix();
        const expectedByteCount = prefixLength + prefix.bodyByteCount + prefix.headerByteCount;
        // Input validation
        if (inputBuffer.length == prefixLength + prefix.bodyByteCount) {
            throw `fromByteimg: Input contains only body. Use fromBody function instead`;
        }
        if (inputBuffer.length != expectedByteCount) {
            throw `fromByteimg: Input has wrong number of bytes. Expected ${expectedByteCount} bytes, got ${inputBuffer.length} bytes`;
        }
        // Split body and header from input
        const body = inputBuffer.slice(0, inputBuffer.length - prefix.headerByteCount);
        const header = inputBuffer.slice(inputBuffer.length - prefix.headerByteCount);
        return new Byteimg(header, body, prefix);
    });
}
exports.fromByteimg = fromByteimg;
function fromBody(input, header) {
    return __awaiter(this, void 0, void 0, function* () {
        const body = yield fs_readFile(input);
        const prefix = body.readPrefix();
        if (header.length != prefix.headerByteCount) {
            throw `fromBody: header length doesn't match length data stored in body`;
        }
        return new Byteimg(header, body, prefix);
    });
}
exports.fromBody = fromBody;
Buffer.prototype.indexOfBytes = function (byte1, byte2) {
    for (let i = 0; i < this.length - 1; i++) {
        const curr = this[i];
        const next = this[i + 1];
        if (curr == byte1 && next == byte2) {
            return i;
        }
    }
};
Buffer.prototype.readPrefix = function () {
    const dataView = new DataView(this.buffer);
    const formatVersion = dataView.getUint8(0);
    if (formatVersion != FORMAT_VERSION) {
        throw `readPrefix: Format version ${formatVersion} is not supported`;
    }
    return {
        formatVersion: formatVersion,
        originalWidth: dataView.getUint16(1),
        originalHeight: dataView.getUint16(3),
        smallWidth: dataView.getUint8(5),
        smallHeight: dataView.getUint8(6),
        headerByteCount: dataView.getUint16(7),
        bodyByteCount: dataView.getUint16(9)
    };
};
Buffer.prototype.writePrefix = function (prefix) {
    const dataView = new DataView(this.buffer);
    dataView.setUint8(0, prefix.formatVersion);
    dataView.setUint16(1, prefix.originalWidth);
    dataView.setUint16(3, prefix.originalHeight);
    dataView.setUint8(5, prefix.smallWidth);
    dataView.setUint8(6, prefix.smallHeight);
    dataView.setUint16(7, prefix.headerByteCount);
    dataView.setUint16(9, prefix.bodyByteCount);
};
//# sourceMappingURL=index.js.map