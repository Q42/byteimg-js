/// <reference types="node" />
import * as fs from 'fs';
export interface Prefix {
    formatVersion: number;
    originalWidth: number;
    originalHeight: number;
    smallWidth: number;
    smallHeight: number;
    headerLength: number;
}
export declare class Byteimg {
    readonly header: Buffer;
    readonly body: Buffer;
    readonly formatVersion: number;
    readonly originalWidth: number;
    readonly originalHeight: number;
    readonly smallWidth: number;
    readonly smallHeight: number;
    constructor(header: Buffer, body: Buffer, prefix: Prefix);
    toJoined(): Buffer;
    toImage(): Buffer;
    writeJoinedFile(fileOut: string): Promise<void>;
    writeBodyFile(fileOut: string): Promise<void>;
    writeImageFile(fileOut: string): Promise<void>;
}
export declare function fromOriginal(input: string | Buffer): Promise<Byteimg>;
export declare function fromJoined(input: fs.PathLike | Buffer): Promise<Byteimg>;
export declare function fromBody(input: fs.PathLike | Buffer, header: Buffer): Promise<Byteimg>;
declare global  {
    interface Buffer {
        indexOfBytes: (byte1: number, byte2: number) => number | null;
        readPrefix: () => Prefix;
        writePrefix: (prefix: Prefix) => void;
    }
}
declare module "sharp" {
    interface JpegOptions {
        optimiseCoding?: boolean;
    }
}
