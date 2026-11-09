(() => {
    'use strict';

    const { inspectPngHeader, findPngDecodeOmissions, makeGrid, inspectFrames } = globalThis.SpriteGrid;
    const { buildStoredZip } = globalThis.SpriteZip;
    const byId = id => document.getElementById(id);
    const fileInput = byId('fileInput');
    const loadStatus = byId('loadStatus');
    const gridError = byId('gridError');
    const gridSummary = byId('gridSummary');
    const sheetCanvas = byId('sheetCanvas');
    const sheetViewport = sheetCanvas.parentElement;
    const frameCanvas = byId('frameCanvas');
    const frameList = byId('frameList');
    const frameDetails = byId('frameDetails');
    const downloadFrame = byId('downloadFrame');
    const frameExportStatus = byId('frameExportStatus');
    const downloadManifest = byId('downloadManifest');
    const downloadBatch = byId('downloadBatch');
    const exportStatus = byId('exportStatus');
    const defaults = { cellWidth: 16, cellHeight: 16, offsetX: 0, offsetY: 0, gapX: 0, gapY: 0 };
    const settings = Object.keys(defaults).map(key => [key, byId(key)]);
    const byteLimit = 32 * 1024 * 1024;

    let source;
    let grid;
    let selected;
    let frameButtons = [];
    let tabStop;
    let loadVersion = 0;
    let batchPending = false;
    let pendingFrame;

    function createSourceCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
    }

    function displayContext(canvas, width, height, maxWidth, maxHeight) {
        const scale = Math.min(8, maxWidth / width, maxHeight / height);
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = false;
        return context;
    }

    function renderSheet() {
        const { canvas, width, height } = source;
        const context = displayContext(sheetCanvas, width, height, 640, 400);
        context.drawImage(canvas, 0, 0, sheetCanvas.width, sheetCanvas.height);
        if (!grid) return;

        const scaleX = sheetCanvas.width / width;
        const scaleY = sheetCanvas.height / height;
        const strokeFrame = frame => context.strokeRect(
            frame.x * scaleX, frame.y * scaleY, frame.width * scaleX, frame.height * scaleY,
        );
        for (const frame of grid.frames) {
            context.strokeStyle = frame.empty ? '#697185' : '#263852';
            context.setLineDash(frame.empty ? [3, 3] : []);
            strokeFrame(frame);
        }
        if (selected) {
            context.setLineDash([]);
            context.lineWidth = 4;
            context.strokeStyle = '#172338';
            strokeFrame(selected);
            context.lineWidth = 2;
            context.strokeStyle = '#FFE27A';
            strokeFrame(selected);
        }
    }

    function setTabStop(index) {
        if (tabStop) tabStop.tabIndex = -1;
        tabStop = frameButtons[index];
        tabStop.tabIndex = 0;
    }

    function focusedFrameIndex() {
        const button = document.activeElement?.closest('button[data-index]');
        return button && frameList.contains(button) ? Number(button.dataset.index) : null;
    }

    function focusFrame(index) {
        setTabStop(index);
        tabStop.focus({ preventScroll: true });
        tabStop.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function frameLabel(frame) {
        return `Frame ${frameNumber(frame)}`;
    }

    function frameNumber(frame) {
        return String(frame.index + 1).padStart(2, '0');
    }

    function frameFilename(frame) {
        return `sprite-frame-${frameNumber(frame)}.png`;
    }

    function nearestScroll(start, end, visibleStart, visibleEnd) {
        const before = start < visibleStart;
        const after = end > visibleEnd;
        if (before === after) return 0;
        if (end - start > visibleEnd - visibleStart) {
            return before ? end - visibleEnd : start - visibleStart;
        }
        return before ? start - visibleStart : end - visibleEnd;
    }

    function revealIn(viewport, bounds) {
        const rect = viewport.getBoundingClientRect();
        const left = rect.left + viewport.clientLeft;
        const top = rect.top + viewport.clientTop;
        const margin = 3;
        viewport.scrollBy({
            left: nearestScroll(bounds.left - margin, bounds.right + margin, left, left + viewport.clientWidth),
            top: nearestScroll(bounds.top - margin, bounds.bottom + margin, top, top + viewport.clientHeight),
        });
    }

    function revealSelection(frame) {
        const rect = sheetCanvas.getBoundingClientRect();
        const scaleX = rect.width / source.width;
        const scaleY = rect.height / source.height;
        revealIn(sheetViewport, {
            left: rect.left + frame.x * scaleX,
            right: rect.left + (frame.x + frame.width) * scaleX,
            top: rect.top + frame.y * scaleY,
            bottom: rect.top + (frame.y + frame.height) * scaleY,
        });
        revealIn(frameList, tabStop.getBoundingClientRect());
    }

    function drawFramePreview(area) {
        const context = displayContext(frameCanvas, area.width, area.height, 192, 192);
        context.drawImage(source.canvas, area.x, area.y, area.width, area.height,
            0, 0, frameCanvas.width, frameCanvas.height);
        return context;
    }

    function isBlankDownscale(context, area) {
        const { width, height } = frameCanvas;
        if (width >= area.width && height >= area.height) return false;
        const { data } = context.getImageData(0, 0, width, height);
        for (let alpha = 3; alpha < data.length; alpha += 4) {
            if (data[alpha] !== 0) return false;
        }
        return true;
    }

    function renderFramePreview(frame) {
        const fullPreview = drawFramePreview(frame);
        const { bounds } = frame;
        if (!bounds || !isBlankDownscale(fullPreview, frame)) return '';
        if (!isBlankDownscale(drawFramePreview(bounds), bounds)) return ' Preview zoomed to visible pixels.';

        // Widely scattered pixels can disappear even after fitting their bounds.
        // The top row of the measured bounds contains at least one visible pixel.
        const { y } = bounds;
        let { x } = bounds;
        while (source.rgba[(y * source.width + x) * 4 + 3] === 0) x++;
        drawFramePreview({ x, y, width: 1, height: 1 });
        return ' Preview zoomed to one visible pixel.';
    }

    function renderSelectedFrame(frame) {
        if (selected) frameButtons[selected.index]?.setAttribute('aria-pressed', 'false');
        selected = frame;
        if (!batchPending) exportStatus.textContent = '';
        refreshFrameExport();
        frameCanvas.hidden = !frame;
        if (!frame) {
            frameCanvas.width = 1;
            frameCanvas.height = 1;
            frameDetails.textContent = 'Apply a valid grid to select a frame.';
            renderSheet();
            return;
        }

        setTabStop(frame.index);
        tabStop.setAttribute('aria-pressed', 'true');
        const previewNote = renderFramePreview(frame);
        const bounds = frame.bounds;
        const content = bounds
            ? `Visible bounds ${bounds.width} × ${bounds.height} px at (${bounds.x}, ${bounds.y}).`
            : 'Empty frame. Every pixel is transparent.';
        frameDetails.textContent = `${frameLabel(frame)} · ${frame.width} × ${frame.height} px at (${frame.x}, ${frame.y}). ${content}${previewNote}`;
        renderSheet();
        revealSelection(frame);
    }

    function renderFrameList() {
        frameButtons = grid.frames.map(frame => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'frame-button';
            button.dataset.index = String(frame.index);
            button.dataset.empty = String(frame.empty);
            button.tabIndex = -1;
            button.setAttribute('aria-pressed', 'false');
            const name = document.createElement('strong');
            name.textContent = frameLabel(frame);
            const badge = document.createElement('span');
            badge.textContent = frame.empty ? 'Empty' : 'Occupied';
            button.append(name, ' ', badge);
            return button;
        });
        frameList.style.setProperty('--frame-columns', String(grid.columns));
        frameList.replaceChildren(...frameButtons);
        tabStop = null;
    }

    function applyGrid(focusedIndex = focusedFrameIndex()) {
        const options = Object.fromEntries(settings.map(([key, input]) => [key, input.valueAsNumber]));
        let layout;
        let frames;
        try {
            layout = makeGrid(source.width, source.height, options);
            frames = inspectFrames(source.rgba, source.width, source.height, layout.frames);
        } catch (error) {
            gridError.textContent = grid ? `${error.message} The previous grid is still shown.` : error.message;
            if (!grid && focusedIndex !== null) byId('applyGrid').focus();
            return;
        }

        const oldIndex = selected?.index ?? 0;
        selected = null;
        grid = { ...options, columns: layout.columns, rows: layout.rows, frames };
        gridError.textContent = '';
        const empty = frames.filter(frame => frame.empty).length;
        gridSummary.textContent = `${layout.columns} columns × ${layout.rows} rows · ${frames.length} frames · ${frames.length - empty} occupied · ${empty} empty`;
        downloadManifest.disabled = false;
        refreshBatchButton();
        renderFrameList();
        renderSelectedFrame(frames[oldIndex] ?? frames[0]);
        if (focusedIndex !== null) focusFrame(Math.min(focusedIndex, frames.length - 1));
    }

    function useSource(canvas, context, label) {
        const focusedIndex = focusedFrameIndex();
        const { width, height } = canvas;
        const rgba = context.getImageData(0, 0, width, height).data;
        source = { canvas, width, height, rgba };
        grid = null;
        selected = null;
        tabStop = null;
        frameButtons = [];
        frameList.replaceChildren();
        gridSummary.textContent = 'Apply a valid grid to inspect frames.';
        downloadManifest.disabled = true;
        refreshBatchButton();
        renderSelectedFrame(null);
        loadStatus.dataset.error = 'false';
        loadStatus.textContent = `${label} · ${width} × ${height} px`;
        applyGrid(focusedIndex);
    }

    function loadDemo() {
        loadVersion++;
        fileInput.value = '';
        const { canvas, context } = createSourceCanvas(64, 32);
        const ink = { '#': '#233148', g: '#54B89D', G: '#B7EBB3', p: '#A389E9', P: '#E2D5FF', y: '#F0B75A', Y: '#FFE49A', b: '#5198CC', B: '#B5E1FF' };
        const sprites = [
            [0, ['...##...', '..#GG#..', '.#GGGg#.', '#GGGGgg#', '#GGgggg#', '.#gggg#.', '..####..']],
            [1, ['..####..', '.#PPpp#.', '#PPPPPp#', '#P#PP#p#', '#PPPPPp#', '#PPpppp#', '.##..##.']],
            [2, ['....##..', '...#YY#.', '..#YYYy#', '.#YYYy#.', '#YYyy#..', '.#Yy#...', '..##....']],
            [4, ['.######.', '#BBBBBb#', '#B#BB#b#', '#BBBBbb#', '.#bbbb#.', '..#bb#..', '...##...']],
            [5, ['...##...', '..#YY#..', '.#YYYY#.', '#YYYYyy#', '.#YYYY#.', '..#yy#..', '...##...']],
            [6, ['...##...', '..#GG#..', '.#GGgg#.', '#GGgggg#', '...##...', '...##...', '..####..']],
        ];
        for (const [index, rows] of sprites) {
            rows.forEach((row, y) => [...row].forEach((pixel, x) => {
                if (pixel === '.') return;
                context.fillStyle = ink[pixel];
                context.fillRect((index % 4) * 16 + 4 + x, Math.floor(index / 4) * 16 + 4 + y, 1, 1);
            }));
        }
        for (const [key, input] of settings) input.value = defaults[key];
        useSource(canvas, context, 'Demo sprite sheet');
    }

    async function loadFile(file) {
        const version = ++loadVersion;
        loadStatus.dataset.error = 'false';
        loadStatus.textContent = 'Reading PNG…';
        let bitmap;
        try {
            if (file.size > byteLimit) throw new Error('Choose a PNG smaller than or equal to 32 MiB.');
            const header = new Uint8Array(await file.slice(0, 33).arrayBuffer());
            if (version !== loadVersion) return;
            const { width, height } = inspectPngHeader(header);
            const buffer = await file.arrayBuffer();
            if (version !== loadVersion) return;
            const omissions = findPngDecodeOmissions(buffer);
            let png = file;
            if (omissions.length) {
                // Without eXIf or acTL, the decoder uses the stored still image and its coordinates.
                const chunks = [];
                let offset = 0;
                for (const { start, end } of omissions) {
                    chunks.push(file.slice(offset, start));
                    offset = end;
                }
                chunks.push(file.slice(offset));
                png = new Blob(chunks, { type: 'image/png' });
            }
            try {
                bitmap = await createImageBitmap(png);
            } catch {
                throw new Error('The browser could not decode this PNG.');
            }
            if (version !== loadVersion) return;
            if (bitmap.width !== width || bitmap.height !== height) {
                throw new Error('Decoded image dimensions do not match the PNG header.');
            }
            const { canvas, context } = createSourceCanvas(width, height);
            context.drawImage(bitmap, 0, 0);
            useSource(canvas, context, file.name);
        } catch (error) {
            if (version !== loadVersion) return;
            loadStatus.dataset.error = 'true';
            loadStatus.textContent = error.message;
        } finally {
            bitmap?.close();
        }
    }

    function saveFile(blob, name) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function setExportButtonState(button, available, pending) {
        // A pending export keeps its keyboard focus while blocking repeat activation.
        button.disabled = !pending && !available;
        if (pending) button.setAttribute('aria-disabled', 'true');
        else button.removeAttribute('aria-disabled');
    }

    function refreshFrameExport() {
        setExportButtonState(downloadFrame, selected, pendingFrame);
        frameExportStatus.textContent = pendingFrame && pendingFrame === selected
            ? `Preparing ${frameLabel(pendingFrame)} PNG…`
            : '';
    }

    function refreshBatchButton() {
        setExportButtonState(downloadBatch, grid?.frames.some(frame => !frame.empty), batchPending);
    }

    function manifestContent(image, currentGrid) {
        const { frames, ...layout } = currentGrid;
        const { width, height } = image;
        const manifest = { image: { width, height }, grid: layout, frames };
        return JSON.stringify(manifest, null, 2) + '\n';
    }

    async function frameBlob(canvas, frame) {
        const crop = document.createElement('canvas');
        crop.width = frame.width;
        crop.height = frame.height;
        crop.getContext('2d').drawImage(canvas, frame.x, frame.y, frame.width, frame.height,
            0, 0, frame.width, frame.height);
        const blob = await new Promise(resolve => crop.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error(`The browser could not encode ${frameLabel(frame)} as PNG.`);
        return blob;
    }

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        fileInput.value = '';
        if (file) void loadFile(file);
    });
    byId('loadDemo').addEventListener('click', loadDemo);
    byId('gridForm').addEventListener('submit', event => {
        event.preventDefault();
        applyGrid();
    });

    frameList.addEventListener('click', event => {
        const button = event.target.closest('button[data-index]');
        if (button) renderSelectedFrame(grid.frames[Number(button.dataset.index)]);
    });
    frameList.addEventListener('keydown', event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const button = event.target.closest('button[data-index]');
        if (!button) return;
        const { index, row, column } = grid.frames[Number(button.dataset.index)];
        let next = index;
        switch (event.key) {
            case 'ArrowLeft': next -= column > 0 ? 1 : 0; break;
            case 'ArrowRight': next += column < grid.columns - 1 ? 1 : 0; break;
            case 'ArrowUp': next -= row > 0 ? grid.columns : 0; break;
            case 'ArrowDown': next += row < grid.rows - 1 ? grid.columns : 0; break;
            case 'Home': next -= column; break;
            case 'End': next += grid.columns - 1 - column; break;
            default: return;
        }
        event.preventDefault();
        focusFrame(next);
    });
    sheetCanvas.addEventListener('click', event => {
        if (!grid) return;
        const rect = sheetCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) * source.width / rect.width;
        const y = (event.clientY - rect.top) * source.height / rect.height;
        const frame = grid.frames.find(cell => x >= cell.x && x < cell.x + cell.width &&
            y >= cell.y && y < cell.y + cell.height);
        if (frame) renderSelectedFrame(frame);
    });

    downloadFrame.addEventListener('click', async () => {
        if (!selected || pendingFrame) return;
        const frame = selected;
        pendingFrame = frame;
        refreshFrameExport();
        let message;
        try {
            const blob = await frameBlob(source.canvas, frame);
            saveFile(blob, frameFilename(frame));
            message = `${frameLabel(frame)} exported as PNG.`;
        } catch (error) {
            message = error.message;
        } finally {
            pendingFrame = undefined;
            setExportButtonState(downloadFrame, selected, false);
            if (selected === frame) frameExportStatus.textContent = message;
        }
    });
    downloadManifest.addEventListener('click', () => {
        if (!grid) return;
        const blob = new Blob([manifestContent(source, grid)], { type: 'application/json' });
        saveFile(blob, 'sprite-grid.json');
        exportStatus.textContent = 'Grid exported as JSON.';
    });
    downloadBatch.addEventListener('click', async () => {
        if (batchPending || downloadBatch.disabled) return;
        const canvas = source.canvas;
        const frames = grid.frames.filter(frame => !frame.empty);
        const manifest = new TextEncoder().encode(manifestContent(source, grid));
        batchPending = true;
        refreshBatchButton();
        exportStatus.textContent = `Preparing ${frames.length} occupied frames…`;
        try {
            const entries = [];
            for (const frame of frames) {
                const png = await frameBlob(canvas, frame);
                entries.push({ name: frameFilename(frame), bytes: new Uint8Array(await png.arrayBuffer()) });
            }
            entries.push({ name: 'sprite-grid.json', bytes: manifest });
            saveFile(buildStoredZip(entries), 'sprite-frames.zip');
            exportStatus.textContent = `Exported ${frames.length} PNG files and the grid manifest.`;
        } catch (error) {
            exportStatus.textContent = error.message;
        } finally {
            batchPending = false;
            refreshBatchButton();
        }
    });

    loadDemo();
})();
