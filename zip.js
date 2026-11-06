(function () {
    'use strict';

    const maxEntries = 513;
    const maxPayloadBytes = 96 * 1024 * 1024;
    const dosDate = 0x0021; // 1980-01-01, with a zero time field.
    const deviceName = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])$/i;

    const crcTable = new Uint32Array(256);
    for (let index = 0; index < crcTable.length; index++) {
        let crc = index;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        crcTable[index] = crc;
    }

    function crc32(bytes) {
        let crc = 0xffffffff;
        for (let index = 0; index < bytes.length; index++) {
            crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    function validateEntries(entries) {
        if (!Array.isArray(entries) || entries.length < 1 || entries.length > maxEntries) {
            throw new Error('A ZIP archive must contain between 1 and 513 files.');
        }
        let total = 0;
        const names = new Set();
        for (const entry of entries) {
            const { name, bytes } = entry ?? {};
            if (typeof name !== 'string' || name.length < 1 || name.length > 255
                || name.trim() !== name || name.endsWith('.') || /[^ -~]|[<>:"/\\|?*]/.test(name)
                || deviceName.test(name.split('.')[0].trimEnd())) {
                throw new Error('Each ZIP entry needs a safe ASCII file name of at most 255 characters.');
            }
            const key = name.toUpperCase();
            if (names.has(key)) throw new Error(`Duplicate ZIP entry name: ${name}.`);
            names.add(key);

            if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== '[object Uint8Array]'
                || Object.prototype.toString.call(bytes.buffer) !== '[object ArrayBuffer]') {
                throw new Error(`ZIP entry ${name} must contain Uint8Array bytes backed by an ArrayBuffer.`);
            }
            total += bytes.byteLength;
            if (total > maxPayloadBytes) throw new Error('ZIP file payloads cannot exceed 96 MiB in total.');
        }
    }

    // Local and central headers have identical fields from the extraction
    // version through the name length. The zeroed flags, method and time mean
    // no descriptor or encryption, Store compression, and midnight.
    function writeEntryFields(view, start, size, checksum, nameLength) {
        view.setUint16(start, 10, true);
        view.setUint16(start + 8, dosDate, true);
        view.setUint32(start + 10, checksum, true);
        view.setUint32(start + 14, size, true);
        view.setUint32(start + 18, size, true);
        view.setUint16(start + 22, nameLength, true);
    }

    function buildStoredZip(entries) {
        validateEntries(entries);
        const encoder = new TextEncoder();
        const parts = [];
        const central = [];
        let localSize = 0;
        let centralSize = 0;

        for (const { name, bytes } of entries) {
            const fileName = encoder.encode(name);
            const checksum = crc32(bytes);
            const size = bytes.byteLength;
            const localHeader = new Uint8Array(30 + fileName.length);
            const localView = new DataView(localHeader.buffer);
            localView.setUint32(0, 0x04034b50, true);
            writeEntryFields(localView, 4, size, checksum, fileName.length);
            localHeader.set(fileName, 30);
            parts.push(localHeader, bytes);

            const centralHeader = new Uint8Array(46 + fileName.length);
            const centralView = new DataView(centralHeader.buffer);
            centralView.setUint32(0, 0x02014b50, true);
            centralView.setUint16(4, 20, true); // ZIP version 2.0, MS-DOS origin.
            writeEntryFields(centralView, 6, size, checksum, fileName.length);
            centralView.setUint32(42, localSize, true);
            centralHeader.set(fileName, 46);
            central.push(centralHeader);
            localSize += localHeader.length + size;
            centralSize += centralHeader.length;
        }

        const end = new Uint8Array(22);
        const endView = new DataView(end.buffer);
        endView.setUint32(0, 0x06054b50, true);
        endView.setUint16(8, entries.length, true);
        endView.setUint16(10, entries.length, true);
        endView.setUint32(12, centralSize, true);
        endView.setUint32(16, localSize, true);
        return new Blob([...parts, ...central, end], { type: 'application/zip' });
    }

    const api = { buildStoredZip };
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        globalThis.SpriteZip = api;
    }
})();
