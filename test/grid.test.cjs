const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { inspectPngHeader, findPngDecodeOmissions, makeGrid, frameAtPoint, frameForSelection, inspectFrames } = require('../grid.js');

test('keeps selection near its source position when grid columns, gaps or offsets change', () => {
    const original = makeGrid(64, 32, { cellWidth: 16, cellHeight: 16 });
    const resized = makeGrid(64, 32, { cellWidth: 32, cellHeight: 16 });
    assert.equal(frameForSelection(resized.frames, original.frames[4]), resized.frames[2]);
    assert.equal(frameForSelection(resized.frames), resized.frames[0]);

    const gapped = makeGrid(64, 32, { cellWidth: 8, cellHeight: 16, gapX: 14 });
    assert.equal(frameAtPoint(gapped.frames, 16, 24), undefined);
    assert.equal(frameForSelection(gapped.frames, resized.frames[2]), gapped.frames[4]);

    const shifted = makeGrid(64, 32, { cellWidth: 8, cellHeight: 8, offsetX: 24, offsetY: 16 });
    assert.equal(frameForSelection(shifted.frames, original.frames[0]), shifted.frames[0]);
    assert.equal(frameAtPoint(shifted.frames, 32, 16), shifted.frames[1]);
});

function pngHeader(width, height) {
    const bytes = Buffer.alloc(33);
    Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    bytes[24] = 8;
    bytes[25] = 6;
    return bytes;
}

test('reads bounded PNG IHDR dimensions without reading the image body', () => {
    const header = pngHeader(64, 32);
    const wrapped = Buffer.concat([Buffer.alloc(7), header, Buffer.alloc(3)]);
    const view = wrapped.subarray(7, 40);
    const expected = { width: 64, height: 32 };
    assert.deepEqual(inspectPngHeader(view), expected);
    assert.deepEqual(inspectPngHeader(Uint8Array.from(header).buffer), expected);
    assert.deepEqual(inspectPngHeader(pngHeader(4096, 4096)), { width: 4096, height: 4096 });
});

test('rejects truncated, malformed, zero-sized, and oversized PNG headers', () => {
    const wrongSignature = pngHeader(1, 1);
    wrongSignature[3] ^= 0xff;
    const wrongLength = pngHeader(1, 1);
    wrongLength.writeUInt32BE(12, 8);
    const wrongChunk = pngHeader(1, 1);
    wrongChunk.write('IDAT', 12, 'ascii');
    assert.throws(() => inspectPngHeader(pngHeader(1, 1).subarray(0, 32)), /truncated/);
    assert.throws(() => inspectPngHeader(wrongSignature), /signature/);
    assert.throws(() => inspectPngHeader(wrongLength), /IHDR/);
    assert.throws(() => inspectPngHeader(wrongChunk), /IHDR/);
    assert.throws(() => inspectPngHeader(pngHeader(0, 1)), /positive/);
    assert.throws(() => inspectPngHeader(pngHeader(4097, 1)), /4096/);
    assert.throws(() => inspectPngHeader(pngHeader(1, 0xffffffff)), /4096/);
});

function pngChunk(type, data = Buffer.alloc(0)) {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4, 'ascii');
    data.copy(chunk, 8);
    return chunk;
}

test('finds only complete metadata chunks, including their CRCs, without changing pixel bytes', () => {
    const header = pngHeader(32, 16);
    const pixelData = pngChunk('IDAT', Buffer.from('eXIf and acTL inside compressed data'));
    const exif = pngChunk('eXIf', Buffer.from('orientation metadata'));
    const animation = pngChunk('acTL', Buffer.from('0000000200000000', 'hex'));
    const end = pngChunk('IEND');
    const plain = Buffer.concat([header, pixelData, end]);
    const find = bytes => findPngDecodeOmissions(Uint8Array.from(bytes).buffer);
    assert.deepEqual(find(plain), []);

    const afterPixels = Buffer.concat([header, pixelData]);
    assert.deepEqual(find(Buffer.concat([afterPixels, exif, end])), [
        { start: afterPixels.length, end: afterPixels.length + exif.length },
    ]);
    assert.deepEqual(find(Buffer.concat([header, animation, pixelData, end])), [
        { start: header.length, end: header.length + animation.length },
    ]);

    const animationFrame = Buffer.concat([pngChunk('fcTL', Buffer.alloc(26)), pngChunk('fdAT', Buffer.alloc(9))]);
    const animated = Buffer.concat([header, animation, pixelData, exif, animationFrame, end]);
    const animationEnd = header.length + animation.length;
    const exifStart = animationEnd + pixelData.length;
    const ranges = find(animated);
    assert.deepEqual(ranges, [
        { start: header.length, end: animationEnd },
        { start: exifStart, end: exifStart + exif.length },
    ]);
    const [first, second] = ranges;
    assert.deepEqual(Buffer.concat([
        animated.subarray(0, first.start), animated.subarray(first.end, second.start), animated.subarray(second.end),
    ]), Buffer.concat([header, pixelData, animationFrame, end]));
});

test('rejects PNG metadata with incomplete bounds or duplicate chunks', () => {
    const header = pngHeader(32, 16);
    const exif = pngChunk('eXIf', Buffer.alloc(12));
    const animation = pngChunk('acTL', Buffer.alloc(8));
    const iend = pngChunk('IEND');
    const find = (...parts) => findPngDecodeOmissions(Uint8Array.from(Buffer.concat(parts)).buffer);
    assert.throws(() => find(header, exif.subarray(0, 10)), /incomplete/);
    assert.throws(() => find(header, exif.subarray(0, -1)), /extends past/);
    assert.throws(() => find(header, animation.subarray(0, -1)), /extends past/);
    assert.throws(() => find(header, exif), /missing IEND/);
    assert.throws(() => find(header, exif, exif, iend), /more than one EXIF/);
    assert.throws(() => find(header, animation, animation, iend), /more than one animation control/);
});

test('enumerates complete cells top-to-bottom and left-to-right with offsets and gaps', () => {
    const grid = makeGrid(19, 14, { cellWidth: 4, cellHeight: 3, offsetX: 2, offsetY: 1, gapX: 2, gapY: 1 });
    assert.equal(grid.columns, 3);
    assert.equal(grid.rows, 3);
    assert.deepEqual(grid.frames, [
        [2, 1], [8, 1], [14, 1], [2, 5], [8, 5], [14, 5], [2, 9], [8, 9], [14, 9],
    ].map(([x, y], index) => ({
        index, row: Math.floor(index / 3), column: index % 3, x, y, width: 4, height: 3,
    })));
    const flush = makeGrid(6, 4, { cellWidth: 2, cellHeight: 2, gapX: 2 });
    assert.deepEqual(flush.frames.at(-1), { index: 3, row: 1, column: 1, x: 4, y: 2, width: 2, height: 2 });
});

test('guards invalid grids, no complete cells, and the 512-frame limit', () => {
    const cell = { cellWidth: 1, cellHeight: 1 };
    assert.equal(makeGrid(512, 1, cell).frames.length, 512);
    assert.throws(() => makeGrid(513, 1, cell), /512/);
    assert.throws(() => makeGrid(0, 1, cell), /positive/);
    assert.throws(() => makeGrid(4097, 1, cell), /4096/);
    assert.throws(() => makeGrid(5, 5, { ...cell, cellWidth: 1.5 }), /Cell width.*integer/);
    assert.throws(() => makeGrid(5, 5, { ...cell, cellHeight: '1' }), /Cell height.*integer/);
    assert.throws(() => makeGrid(5, 5, { ...cell, offsetY: -1 }), /Vertical offset/);
    assert.throws(() => makeGrid(5, 5, { ...cell, gapX: 4097 }), /Horizontal gap/);
    assert.throws(() => makeGrid(5, 5, { ...cell, offsetX: 5 }), /No complete cell/);
    assert.throws(() => makeGrid(5, 5, { ...cell, cellHeight: 6 }), /No complete cell/);
});

test('identifies the invalid numeric field without assigning grid-wide errors to a field', () => {
    const cell = { cellWidth: 1, cellHeight: 1 };
    for (const field of ['cellWidth', 'cellHeight', 'offsetX', 'offsetY', 'gapX', 'gapY']) {
        assert.throws(() => makeGrid(5, 5, { ...cell, [field]: -1 }), { gridField: field });
    }
    assert.throws(() => makeGrid(5, 5, { ...cell, offsetX: 5 }), error => error.gridField === undefined);
});

test('finds absolute nonzero-alpha bounds and leaves frame and pixel inputs unchanged', () => {
    const width = 9;
    const height = 6;
    const { frames } = makeGrid(width, height, { cellWidth: 3, cellHeight: 2, offsetX: 1, offsetY: 1, gapX: 1, gapY: 1 });
    frames.forEach(Object.freeze);
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (const [x, y, alpha] of [[2, 1, 1], [3, 2, 255], [1, 5, 128], [7, 4, 255], [5, 5, 255], [4, 1, 255], [8, 5, 255]]) {
        rgba[(y * width + x) * 4 + 3] = alpha;
    }
    rgba[(2 * width + 5) * 4] = 255; // RGB without alpha does not occupy a frame.
    const before = rgba.slice();
    const actual = inspectFrames(rgba, width, height, frames);
    assert.deepEqual(actual, [
        { ...frames[0], empty: false, bounds: { x: 2, y: 1, width: 2, height: 2 } },
        { ...frames[1], empty: true, bounds: null },
        { ...frames[2], empty: false, bounds: { x: 1, y: 5, width: 1, height: 1 } },
        { ...frames[3], empty: false, bounds: { x: 5, y: 4, width: 3, height: 2 } },
    ]);
    assert.notEqual(actual[0], frames[0]);
    assert.deepEqual(rgba, before);
});

test('validates pixel lengths and frame bounds before scanning', () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    const frame = { x: 0, y: 0, width: 4, height: 4 };
    assert.throws(() => inspectFrames(rgba.subarray(0, -1), 4, 4, [frame]), /four bytes/);
    assert.throws(() => inspectFrames(new Uint32Array(16), 4, 4, [frame]), /four bytes/);
    assert.throws(() => inspectFrames(rgba, 4, 4, [{ ...frame, x: 1 }]), /inside the sheet/);
    assert.throws(() => inspectFrames(rgba, 4, 4, [{ ...frame, width: 0 }]), /inside the sheet/);
    assert.throws(() => inspectFrames(rgba, 4, 4, Array(513).fill(frame)), /512/);
    const largeFrame = { x: 0, y: 0, width: 256, height: 256 };
    assert.throws(() => inspectFrames(new Uint8Array(256 * 256 * 4), 256, 256, Array(512).fill(largeFrame)),
        /16,777,216/);
});

test('exposes the same API as a classic browser script', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'grid.js'), 'utf8');
    const sandbox = vm.createContext({});
    vm.runInContext(source, sandbox);
    assert.deepEqual(Object.keys(sandbox.SpriteGrid), [
        'inspectPngHeader', 'findPngDecodeOmissions', 'makeGrid', 'frameAtPoint', 'frameForSelection', 'inspectFrames',
    ]);
    assert.equal(sandbox.SpriteGrid.inspectPngHeader(pngHeader(9, 6)).width, 9);
});
