(function () {
    'use strict';

    const maxEdge = 4096;
    const maxPixels = 16777216;
    const maxFrames = 512;

    function validateDimensions(width, height) {
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
            throw new Error('Sheet width and height must be positive integers.');
        }
        if (width > maxEdge || height > maxEdge || width * height > maxPixels) {
            throw new Error('The sheet must fit within 4096 × 4096 pixels and 16,777,216 total pixels.');
        }
    }

    function inspectPngHeader(bytes) {
        let header;
        if (ArrayBuffer.isView(bytes)) {
            header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        } else if (bytes instanceof ArrayBuffer) {
            header = new DataView(bytes);
        } else {
            throw new Error('Expected PNG bytes in an ArrayBuffer or typed view.');
        }

        if (header.byteLength < 33) throw new Error('The PNG header is truncated.');
        if (header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a) {
            throw new Error('The file does not have a PNG signature.');
        }
        if (header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452) {
            throw new Error('A PNG must begin with a 13-byte IHDR chunk.');
        }

        const width = header.getUint32(16);
        const height = header.getUint32(20);
        validateDimensions(width, height);
        return { width, height };
    }

    function findPngExif(buffer) {
        const view = new DataView(buffer);
        let exif = null;
        // The caller has already checked the signature and complete IHDR chunk.
        for (let start = 33; start < view.byteLength;) {
            if (view.byteLength - start < 12) throw new Error('Invalid PNG: incomplete chunk header or CRC.');
            const length = view.getUint32(start);
            const type = view.getUint32(start + 4);
            const end = start + 12 + length;
            if (end > view.byteLength) throw new Error('Invalid PNG: chunk extends past the end of the file.');
            if (type === 0x49454e44) return exif; // IEND
            if (type === 0x65584966) { // eXIf
                if (exif) throw new Error('Invalid PNG: more than one EXIF chunk.');
                exif = { start, end };
            }
            start = end;
        }
        throw new Error('Invalid PNG: missing IEND chunk.');
    }

    function validateGridOption(value, label, minimum) {
        if (!Number.isSafeInteger(value) || value < minimum || value > maxEdge) {
            throw new Error(`${label} must be an integer from ${minimum} to ${maxEdge}.`);
        }
    }

    function makeGrid(width, height, options = {}) {
        validateDimensions(width, height);
        if (!options || typeof options !== 'object') throw new Error('Expected grid options.');
        const { cellWidth, cellHeight, offsetX = 0, offsetY = 0, gapX = 0, gapY = 0 } = options;
        validateGridOption(cellWidth, 'Cell width', 1);
        validateGridOption(cellHeight, 'Cell height', 1);
        validateGridOption(offsetX, 'Horizontal offset', 0);
        validateGridOption(offsetY, 'Vertical offset', 0);
        validateGridOption(gapX, 'Horizontal gap', 0);
        validateGridOption(gapY, 'Vertical gap', 0);

        const remainingWidth = width - offsetX - cellWidth;
        const remainingHeight = height - offsetY - cellHeight;
        if (remainingWidth < 0 || remainingHeight < 0) {
            throw new Error('No complete cell fits inside the sheet with this grid.');
        }

        const strideX = cellWidth + gapX;
        const strideY = cellHeight + gapY;
        const columns = 1 + Math.floor(remainingWidth / strideX);
        const rows = 1 + Math.floor(remainingHeight / strideY);
        if (columns * rows > maxFrames) throw new Error('A grid can contain at most 512 full frames.');

        const frames = [];
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                frames.push({
                    index: frames.length, row, column,
                    x: offsetX + column * strideX, y: offsetY + row * strideY,
                    width: cellWidth, height: cellHeight,
                });
            }
        }
        return { columns, rows, frames };
    }

    function inspectFrames(rgba, width, height, frames) {
        validateDimensions(width, height);
        if (!ArrayBuffer.isView(rgba) || rgba.BYTES_PER_ELEMENT !== 1 || rgba.byteLength !== width * height * 4) {
            throw new Error('RGBA data must contain exactly four bytes per sheet pixel.');
        }
        if (!Array.isArray(frames) || frames.length > maxFrames) {
            throw new Error('Expected an array of at most 512 frames.');
        }

        let area = 0;
        for (const frame of frames) {
            const { x, y, width: frameWidth, height: frameHeight } = frame ?? {};
            if (![x, y, frameWidth, frameHeight].every(Number.isSafeInteger)
                || x < 0 || y < 0 || frameWidth < 1 || frameHeight < 1
                || x + frameWidth > width || y + frameHeight > height) {
                throw new Error('Every frame must be a whole-pixel rectangle inside the sheet.');
            }
            area += frameWidth * frameHeight;
        }
        if (area > maxPixels) throw new Error('Frame inspection is limited to 16,777,216 pixels.');

        return frames.map(frame => {
            const right = frame.x + frame.width;
            const bottom = frame.y + frame.height;
            let minX = right;
            let minY = bottom;
            let maxX = -1;
            let maxY = -1;
            for (let y = frame.y; y < bottom; y++) {
                let alpha = (y * width + frame.x) * 4 + 3;
                for (let x = frame.x; x < right; x++, alpha += 4) {
                    if (rgba[alpha] === 0) continue;
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }

            const empty = maxX === -1;
            const bounds = empty ? null : {
                x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1,
            };
            return { ...frame, empty, bounds };
        });
    }

    const api = { inspectPngHeader, findPngExif, makeGrid, inspectFrames };
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        globalThis.SpriteGrid = api;
    }
})();
