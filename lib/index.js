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
// 0:   format version 
// 1,2: original width
// 3,4: original height
// 5:   small width
// 6:   small height
// 7,8: header length
const prefixLength = 1 + 2 + 2 + 1 + 1 + 2;
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
    toJoined() {
        const joined = new Buffer(this.body.length + this.header.length);
        joined.set(this.body, 0);
        joined.set(this.header, this.body.length);
        return joined;
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
    writeJoinedFile(fileOut) {
        return __awaiter(this, void 0, void 0, function* () {
            yield fs_writeFile(fileOut, this.toJoined());
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
            quality: 70,
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
            headerLength: jpegHeader.length
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
function fromJoined(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const inputBuffer = yield fs_readFile(input);
        const prefix = inputBuffer.readPrefix();
        if (prefix.headerLength > inputBuffer.length) {
            throw `fromJoined: Input too small. Perhaps input just contains body data? Use fromBody function instead`;
        }
        const body = inputBuffer.slice(0, inputBuffer.length - prefix.headerLength);
        const header = inputBuffer.slice(inputBuffer.length - prefix.headerLength);
        return new Byteimg(header, body, prefix);
    });
}
exports.fromJoined = fromJoined;
function fromBody(input, header) {
    return __awaiter(this, void 0, void 0, function* () {
        const body = yield fs_readFile(input);
        const prefix = body.readPrefix();
        console.log(header.length, prefix.headerLength);
        if (header.length != prefix.headerLength) {
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
        throw `fromJoined: Format version ${formatVersion} is not supported`;
    }
    return {
        formatVersion: formatVersion,
        originalWidth: dataView.getUint16(1),
        originalHeight: dataView.getUint16(3),
        smallWidth: dataView.getUint8(5),
        smallHeight: dataView.getUint8(6),
        headerLength: dataView.getUint16(7)
    };
};
Buffer.prototype.writePrefix = function (prefix) {
    const dataView = new DataView(this.buffer);
    dataView.setUint8(0, prefix.formatVersion);
    dataView.setUint16(1, prefix.originalWidth);
    dataView.setUint16(3, prefix.originalHeight);
    dataView.setUint8(5, prefix.smallWidth);
    dataView.setUint8(6, prefix.smallHeight);
    dataView.setUint16(7, prefix.headerLength);
};
//# sourceMappingURL=index.js.map