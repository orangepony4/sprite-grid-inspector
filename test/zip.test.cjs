const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { buildStoredZip } = require('../zip.js');

test('builds a deterministic stored ZIP with correct fields, CRC and exact payload views', async () => {
    const backing = Buffer.from('x123456789y');
    const bytes = backing.subarray(1, -1);
    const empty = new Uint8Array();
    const zip = buildStoredZip([{ name: 'frame-001.png', bytes }, { name: 'manifest.json', bytes: empty }]);
    assert.equal(zip.type, 'application/zip');
    backing.fill(0);

    const data = Buffer.from(await zip.arrayBuffer());
    const expected = [
        { name: 'frame-001.png', payload: Buffer.from('123456789'), crc: 0xcbf43926 },
        { name: 'manifest.json', payload: Buffer.alloc(0), crc: 0 },
    ];
    const repeat = buildStoredZip(expected.map(({ name, payload }) => ({ name, bytes: payload })));
    assert.deepEqual(data, Buffer.from(await repeat.arrayBuffer()));

    const end = data.length - 22;
    assert.equal(data.readUInt32LE(end), 0x06054b50);
    assert.equal(data.readUInt32LE(end + 4), 0); // Disk numbers.
    assert.equal(data.readUInt16LE(end + 8), expected.length);
    assert.equal(data.readUInt16LE(end + 10), expected.length);
    assert.equal(data.readUInt16LE(end + 20), 0); // No archive comment.
    const centralSize = data.readUInt32LE(end + 12);
    const centralStart = data.readUInt32LE(end + 16);
    assert.equal(centralStart + centralSize, end);

    let offset = centralStart;
    let local = 0;
    for (const { name, payload, crc } of expected) {
        assert.equal(data.readUInt32LE(offset), 0x02014b50);
        assert.equal(data.readUInt16LE(offset + 6), 10);
        assert.equal(data.readUInt16LE(offset + 8), 0); // No flags.
        assert.equal(data.readUInt16LE(offset + 10), 0); // Store.
        assert.equal(data.readUInt16LE(offset + 12), 0); // Midnight.
        assert.equal(data.readUInt16LE(offset + 14), 0x0021);
        assert.equal(data.readUInt32LE(offset + 16), crc);
        assert.equal(data.readUInt32LE(offset + 20), payload.length);
        assert.equal(data.readUInt32LE(offset + 24), payload.length);
        assert.equal(data.readUInt16LE(offset + 28), name.length);
        assert.equal(data.readUInt16LE(offset + 30), 0);
        assert.equal(data.readUInt16LE(offset + 32), 0);
        assert.equal(data.readUInt32LE(offset + 42), local);
        assert.equal(data.toString('ascii', offset + 46, offset + 46 + name.length), name);
        assert.equal(data.readUInt32LE(local), 0x04034b50);
        assert.deepEqual(data.subarray(local + 4, local + 28), data.subarray(offset + 6, offset + 30));
        assert.equal(data.readUInt16LE(local + 28), 0);
        const payloadOffset = local + 30 + name.length;
        assert.equal(data.toString('ascii', local + 30, payloadOffset), name);
        assert.deepEqual(data.subarray(payloadOffset, payloadOffset + payload.length), payload);
        local = payloadOffset + payload.length;
        offset += 46 + name.length;
    }
    assert.equal(local, centralStart);
    assert.equal(offset, end);
});

test('rejects unsafe names, case aliases and unsupported byte types', () => {
    const bytes = new Uint8Array(1);
    for (const name of [
        '', '.', '..', '../file.png', 'path/file.png', 'path\\file.png', 'D:file.png',
        'NUL.png', 'COM1.json', ' trailing.png', 'file.png ', 'file.png.', 'x?.png',
        'x\n.png', 'é.png', 'x'.repeat(256),
    ]) {
        assert.throws(() => buildStoredZip([{ name, bytes }]), /safe ASCII/);
    }
    assert.throws(() => buildStoredZip([{ name: 'same.png', bytes }, { name: 'Same.PNG', bytes }]), /Duplicate/);
    assert.throws(() => buildStoredZip([{ name: 'frame.png', bytes: new Uint16Array(1) }]), /Uint8Array/);
    assert.throws(() => buildStoredZip([{ name: 'frame.png', bytes: [1, 2, 3] }]), /Uint8Array/);
});

test('enforces entry count and total payload limits', async () => {
    const empty = new Uint8Array();
    const entries = Array.from({ length: 513 }, (_, index) => ({ name: `frame-${index}.png`, bytes: empty }));
    const data = Buffer.from(await buildStoredZip(entries).arrayBuffer());
    assert.equal(data.readUInt16LE(data.length - 12), 513);
    assert.throws(() => buildStoredZip([]), /between 1 and 513/);
    assert.throws(() => buildStoredZip([...entries, { name: 'manifest.json', bytes: empty }]), /513/);

    const repeated = new Uint8Array(200 * 1024);
    assert.throws(() => buildStoredZip(entries.map(entry => ({ ...entry, bytes: repeated }))), /96 MiB/);
});

test('exposes the builder as a classic browser script', () => {
    const source = readFileSync(path.join(__dirname, '..', 'zip.js'), 'utf8');
    const sandbox = vm.createContext({ Blob, TextEncoder });
    vm.runInContext(source, sandbox);
    const zip = sandbox.SpriteZip.buildStoredZip([{ name: 'space name.json', bytes: Buffer.from('{}') }]);
    assert.equal(zip.type, 'application/zip');
    assert.ok(zip.size > 2);
});
