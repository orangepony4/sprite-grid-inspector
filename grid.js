(function () {
    'use strict';

    const maxEdge = 4096;
    const maxPixels = 16777216;
    const maxFrames = 512;
    const pngDecodeOmissions = new Map([
        [0x65584966, ['EXIF', 'eXIf']],
        [0x6163544c, ['animation control', 'acTL']],
    ]);

    function gridError(message, messageRu) {
        return Object.assign(new Error(message), { messageRu });
    }

    function validateDimensions(width, height) {
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
            throw gridError('Sheet width and height must be positive integers.',
                'Ширина и высота листа должны быть положительными целыми числами.');
        }
        if (width > maxEdge || height > maxEdge || width * height > maxPixels) {
            throw gridError('The sheet must fit within 4096 × 4096 pixels and 16,777,216 total pixels.',
                'Лист должен быть не больше 4096 × 4096 пикселей и содержать не более 16 777 216 пикселей.');
        }
    }

    function inspectPngHeader(bytes) {
        let header;
        if (ArrayBuffer.isView(bytes)) {
            header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        } else if (bytes instanceof ArrayBuffer) {
            header = new DataView(bytes);
        } else {
            throw gridError('Expected PNG bytes in an ArrayBuffer or typed view.', 'Не удалось прочитать данные PNG.');
        }

        if (header.byteLength < 33) throw gridError('The PNG header is truncated.', 'Заголовок PNG обрезан.');
        if (header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a) {
            throw gridError('The file does not have a PNG signature.', 'В файле нет сигнатуры PNG.');
        }
        if (header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452) {
            throw gridError('A PNG must begin with a 13-byte IHDR chunk.', 'Первый блок PNG должен быть IHDR длиной 13 байт.');
        }

        const width = header.getUint32(16);
        const height = header.getUint32(20);
        validateDimensions(width, height);
        return { width, height };
    }

    function findPngDecodeOmissions(buffer) {
        const view = new DataView(buffer);
        const ranges = new Map();
        // The caller has already checked the signature and complete IHDR chunk.
        for (let start = 33; start < view.byteLength;) {
            if (view.byteLength - start < 12) {
                throw gridError('Invalid PNG: incomplete chunk header or CRC.', 'В PNG обрезан заголовок блока или его контрольная сумма.');
            }
            const length = view.getUint32(start);
            const type = view.getUint32(start + 4);
            const end = start + 12 + length;
            if (end > view.byteLength) {
                throw gridError('Invalid PNG: chunk extends past the end of the file.', 'Блок PNG выходит за пределы файла.');
            }
            if (type === 0x49454e44) return [...ranges.values()]; // IEND
            const labels = pngDecodeOmissions.get(type);
            if (labels) {
                if (ranges.has(type)) {
                    const [label, chunkName] = labels;
                    throw gridError(`Invalid PNG: more than one ${label} chunk.`, `В PNG повторяется блок ${chunkName}.`);
                }
                ranges.set(type, { start, end });
            }
            start = end;
        }
        throw gridError('Invalid PNG: missing IEND chunk.', 'В PNG отсутствует завершающий блок IEND.');
    }

    function validateGridOption(value, field, label, labelRu, minimum) {
        if (!Number.isSafeInteger(value) || value < minimum || value > maxEdge) {
            const error = gridError(`${label} must be an integer from ${minimum} to ${maxEdge}.`,
                `Введите целое число от ${minimum} до ${maxEdge} для поля «${labelRu}».`);
            error.gridField = field;
            throw error;
        }
    }

    function makeGrid(width, height, options = {}) {
        validateDimensions(width, height);
        if (!options || typeof options !== 'object') throw gridError('Expected grid options.', 'Укажите настройки сетки.');
        const { cellWidth, cellHeight, offsetX = 0, offsetY = 0, gapX = 0, gapY = 0 } = options;
        validateGridOption(cellWidth, 'cellWidth', 'Cell width', 'Ширина', 1);
        validateGridOption(cellHeight, 'cellHeight', 'Cell height', 'Высота', 1);
        validateGridOption(offsetX, 'offsetX', 'Horizontal offset', 'Смещение по X', 0);
        validateGridOption(offsetY, 'offsetY', 'Vertical offset', 'Смещение по Y', 0);
        validateGridOption(gapX, 'gapX', 'Horizontal gap', 'Промежуток по X', 0);
        validateGridOption(gapY, 'gapY', 'Vertical gap', 'Промежуток по Y', 0);

        const remainingWidth = width - offsetX - cellWidth;
        const remainingHeight = height - offsetY - cellHeight;
        if (remainingWidth < 0 || remainingHeight < 0) {
            throw gridError('No complete cell fits inside the sheet with this grid.', 'С такой сеткой на листе не помещается ни одной полной ячейки.');
        }

        const strideX = cellWidth + gapX;
        const strideY = cellHeight + gapY;
        const columns = 1 + Math.floor(remainingWidth / strideX);
        const rows = 1 + Math.floor(remainingHeight / strideY);
        if (columns * rows > maxFrames) {
            throw gridError('A grid can contain at most 512 full frames.', 'Сетка может содержать не больше 512 полных кадров.');
        }

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

    function frameAtPoint(frames, x, y) {
        return frames.find(frame => x >= frame.x && x < frame.x + frame.width
            && y >= frame.y && y < frame.y + frame.height);
    }

    function frameForSelection(frames, previous) {
        if (!previous) return frames[0];
        const x = previous.x + previous.width / 2;
        const y = previous.y + previous.height / 2;
        const containing = frameAtPoint(frames, x, y);
        if (containing) return containing;

        let nearest;
        let nearestDistance = Infinity;
        for (const frame of frames) {
            const dx = Math.max(0, frame.x - x, x - frame.x - frame.width);
            const dy = Math.max(0, frame.y - y, y - frame.y - frame.height);
            const distance = dx * dx + dy * dy;
            if (distance < nearestDistance) {
                nearest = frame;
                nearestDistance = distance;
            }
        }
        return nearest;
    }

    function inspectFrames(rgba, width, height, frames) {
        validateDimensions(width, height);
        if (!ArrayBuffer.isView(rgba) || rgba.BYTES_PER_ELEMENT !== 1 || rgba.byteLength !== width * height * 4) {
            throw gridError('RGBA data must contain exactly four bytes per sheet pixel.',
                'В данных RGBA должно быть ровно четыре байта на пиксель листа.');
        }
        if (!Array.isArray(frames) || frames.length > maxFrames) {
            throw gridError('Expected an array of at most 512 frames.', 'Для проверки можно указать не больше 512 кадров.');
        }

        let area = 0;
        for (const frame of frames) {
            const { x, y, width: frameWidth, height: frameHeight } = frame ?? {};
            if (![x, y, frameWidth, frameHeight].every(Number.isSafeInteger)
                || x < 0 || y < 0 || frameWidth < 1 || frameHeight < 1
                || x + frameWidth > width || y + frameHeight > height) {
                throw gridError('Every frame must be a whole-pixel rectangle inside the sheet.',
                    'Кадры должны располагаться внутри листа и состоять из целых пикселей.');
            }
            area += frameWidth * frameHeight;
        }
        if (area > maxPixels) {
            throw gridError('Frame inspection is limited to 16,777,216 pixels.', 'Для проверки доступно не больше 16 777 216 пикселей.');
        }

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

    const api = { inspectPngHeader, findPngDecodeOmissions, makeGrid, frameAtPoint, frameForSelection, inspectFrames };
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        globalThis.SpriteGrid = api;
    }
})();
