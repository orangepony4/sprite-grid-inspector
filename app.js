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
    const cancelBatch = byId('cancelBatch');
    const manifestExportStatus = byId('manifestExportStatus');
    const exportStatus = byId('exportStatus');
    const languageToggle = byId('languageToggle');
    const defaults = { cellWidth: 16, cellHeight: 16, offsetX: 0, offsetY: 0, gapX: 0, gapY: 0 };
    const settings = Object.keys(defaults).map(key => [key, byId(key)]);
    const byteLimit = 32 * 1024 * 1024;
    const messages = {
        switchLanguage: ['Switch to Russian', 'Переключить на английский'],
        frame: ['Frame {0}', 'Кадр {0}'],
        occupied: ['Occupied', 'Заполнен'],
        empty: ['Empty', 'Пуст'],
        position: ['{0} · {1} × {2} px at ({3}, {4}).', '{0} · {1} × {2} пкс в точке ({3}, {4}).'],
        visibleBounds: ['Visible bounds {0} × {1} px at ({2}, {3}).', 'Видимая область {0} × {1} пкс в точке ({2}, {3}).'],
        emptyFrame: ['Empty frame. Every pixel is transparent.', 'Пустой кадр. Все пиксели прозрачны.'],
        zoomedBounds: ['Preview zoomed to visible pixels.', 'Предпросмотр увеличен до видимой области.'],
        zoomedPixel: ['Preview zoomed to one visible pixel.', 'Предпросмотр увеличен до одного видимого пикселя.'],
        chooseFrame: ['Apply a valid grid to select a frame.', 'Примените корректную сетку, чтобы выбрать кадр.'],
        inspectFrames: ['Apply a valid grid to inspect frames.', 'Примените корректную сетку, чтобы проверить кадры.'],
        gridSummary: ['{0} columns × {1} rows · {2} frames · {3} occupied · {4} empty', 'Сетка {0} × {1} · Кадров {2} · Заполнено {3} · Пусто {4}'],
        previousGrid: ['The previous grid is still shown.', 'На экране осталась предыдущая сетка.'],
        gridFailed: ['Could not apply the grid.', 'Не удалось применить сетку.'],
        demoSheet: ['Demo sprite sheet', 'Демонстрационный спрайт-лист'],
        loaded: ['{0} · {1} × {2} px', '{0} · {1} × {2} пкс'],
        reading: ['Reading PNG…', 'Читаем PNG…'],
        fileTooLarge: ['Choose a PNG smaller than or equal to 32 MiB.', 'Выберите PNG размером не больше 32 МиБ.'],
        decodeFailed: ['The browser could not decode this PNG.', 'Браузер не смог декодировать этот PNG.'],
        dimensionMismatch: ['Decoded image dimensions do not match the PNG header.', 'Размер изображения не совпадает с размером в заголовке PNG.'],
        loadFailed: ['Could not open the PNG.', 'Не удалось открыть PNG.'],
        preparingFrame: ['Preparing Frame {0} PNG…', 'Готовим PNG для кадра {0}…'],
        encodeFailed: ['The browser could not encode Frame {0} as PNG.', 'Браузер не смог сохранить кадр {0} как PNG.'],
        frameSaved: ['Frame {0} exported as PNG.', 'Кадр {0} сохранён как PNG.'],
        frameFailed: ['Could not export the frame.', 'Не удалось сохранить кадр.'],
        manifestSaved: ['Grid exported as JSON.', 'Сетка сохранена как JSON.'],
        preparingZip: ['Preparing {0} occupied frames…', 'Готовим заполненные кадры ({0})…'],
        cancelingZip: ['Canceling ZIP export…', 'Отменяем экспорт ZIP…'],
        zipCanceled: ['ZIP export canceled.', 'Экспорт ZIP отменён.'],
        zipSaved: ['Exported {0} PNG files and the grid manifest.', 'Сохранён ZIP с файлами PNG ({0}) и манифестом сетки.'],
        zipFailed: ['Could not export the frame ZIP.', 'Не удалось сохранить ZIP с кадрами.'],
        previousZip: ['This ZIP export uses the grid that was open when it started.', 'Для этого ZIP используется сетка, открытая на момент начала экспорта.'],
    };
    const languageKey = 'spriteGridLanguage';
    const staticTranslations = [];
    for (const [marker, attribute] of [['data-ru', null], ['data-ru-label', 'aria-label']]) {
        for (const element of document.querySelectorAll(`[${marker}]`)) {
            const english = attribute ? element.getAttribute(attribute) : element.textContent;
            staticTranslations.push({ element, attribute, english, russian: element.getAttribute(marker) });
        }
    }
    const visibleMessages = new Map();
    let language = 'en';
    try {
        if (localStorage.getItem(languageKey) === 'ru') language = 'ru';
    } catch {
        // Storage can be unavailable for the offline copy.
    }

    let source;
    let grid;
    let selected;
    let frameButtons = [];
    let tabStop;
    let loadVersion = 0;
    let pendingBatch;
    let pendingFrame;

    function translate(key, ...args) {
        const template = messages[key][language === 'ru' ? 1 : 0];
        return args.length ? template.replace(/\{(\d+)\}/g, (_, index) => args[Number(index)]) : template;
    }

    function setMessage(element, key, ...args) {
        if (!key) {
            visibleMessages.delete(element);
            element.textContent = '';
            return;
        }
        const render = typeof key === 'function' ? key : () => translate(key, ...args);
        visibleMessages.set(element, render);
        element.textContent = render();
    }

    function showError(element, error, fallback, detail) {
        setMessage(element, () => {
            const text = error?.messageKey
                ? translate(error.messageKey, ...error.messageArgs)
                : (language === 'ru' ? error?.messageRu : error?.message) || translate(fallback);
            return detail ? `${text} ${translate(detail)}` : text;
        });
    }

    function appError(key, ...args) {
        return Object.assign(new Error(translate(key, ...args)), { messageKey: key, messageArgs: args });
    }

    function applyLanguage() {
        document.documentElement.lang = language;
        for (const { element, attribute, english, russian } of staticTranslations) {
            const text = language === 'ru' ? russian : english;
            if (attribute) element.setAttribute(attribute, text);
            else element.textContent = text;
        }
        languageToggle.textContent = language === 'ru' ? 'EN' : 'RU';
        const switchLabel = translate('switchLanguage');
        languageToggle.setAttribute('aria-label', switchLabel);
        languageToggle.title = switchLabel;
        for (const [element, render] of visibleMessages) element.textContent = render();
        frameButtons.forEach((button, index) => updateFrameButton(button, grid.frames[index]));
    }

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
        return translate('frame', frameNumber(frame));
    }

    function frameNumber(frame) {
        return String(frame.index + 1).padStart(2, '0');
    }

    function frameFilename(frame, frameCount) {
        const number = frameNumber(frame).padStart(String(frameCount).length, '0');
        return `sprite-frame-${number}.png`;
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
        if (!isBlankDownscale(drawFramePreview(bounds), bounds)) return 'zoomedBounds';

        // Widely scattered pixels can disappear even after fitting their bounds.
        // The top row of the measured bounds contains at least one visible pixel.
        const { y } = bounds;
        let { x } = bounds;
        while (source.rgba[(y * source.width + x) * 4 + 3] === 0) x++;
        drawFramePreview({ x, y, width: 1, height: 1 });
        return 'zoomedPixel';
    }

    function renderSelectedFrame(frame) {
        if (selected) frameButtons[selected.index]?.setAttribute('aria-pressed', 'false');
        selected = frame;
        refreshFrameExport();
        frameCanvas.hidden = !frame;
        if (!frame) {
            frameCanvas.width = 1;
            frameCanvas.height = 1;
            setMessage(frameDetails, 'chooseFrame');
            renderSheet();
            return;
        }

        setTabStop(frame.index);
        tabStop.setAttribute('aria-pressed', 'true');
        const previewNote = renderFramePreview(frame);
        const bounds = frame.bounds;
        setMessage(frameDetails, () => {
            const position = translate('position', frameLabel(frame), frame.width, frame.height, frame.x, frame.y);
            const content = bounds ? translate('visibleBounds', bounds.width, bounds.height, bounds.x, bounds.y) : translate('emptyFrame');
            return previewNote ? `${position} ${content} ${translate(previewNote)}` : `${position} ${content}`;
        });
        renderSheet();
        revealSelection(frame);
    }

    function updateFrameButton(button, frame) {
        button.firstElementChild.textContent = frameLabel(frame);
        button.lastElementChild.textContent = translate(frame.empty ? 'empty' : 'occupied');
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
            button.append(document.createElement('strong'), ' ', document.createElement('span'));
            updateFrameButton(button, frame);
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
            showError(gridError, error, 'gridFailed', grid ? 'previousGrid' : undefined);
            if (!grid && focusedIndex !== null) byId('applyGrid').focus();
            return;
        }

        const oldIndex = selected?.index ?? 0;
        selected = null;
        grid = { ...options, columns: layout.columns, rows: layout.rows, frames };
        resetGridExportFeedback();
        setMessage(gridError);
        const empty = frames.filter(frame => frame.empty).length;
        setMessage(gridSummary, 'gridSummary', layout.columns, layout.rows, frames.length, frames.length - empty, empty);
        setExportButtonState(downloadManifest, true);
        refreshBatchControls();
        renderFrameList();
        renderSelectedFrame(frames[oldIndex] ?? frames[0]);
        if (focusedIndex !== null) focusFrame(Math.min(focusedIndex, frames.length - 1));
    }

    function useSource(canvas, context, fileName) {
        const focusedIndex = focusedFrameIndex();
        const { width, height } = canvas;
        const rgba = context.getImageData(0, 0, width, height).data;
        source = { canvas, width, height, rgba };
        grid = null;
        selected = null;
        loadStatus.dataset.error = 'false';
        setMessage(loadStatus, () => translate('loaded', fileName ?? translate('demoSheet'), width, height));
        applyGrid(focusedIndex);
        if (!grid) {
            resetGridExportFeedback();
            tabStop = null;
            frameButtons = [];
            frameList.replaceChildren();
            setMessage(gridSummary, 'inspectFrames');
            setExportButtonState(downloadManifest, false);
            refreshBatchControls();
            renderSelectedFrame(null);
        }
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
        useSource(canvas, context);
    }

    async function loadFile(file) {
        const version = ++loadVersion;
        loadStatus.dataset.error = 'false';
        setMessage(loadStatus, 'reading');
        let bitmap;
        try {
            if (file.size > byteLimit) throw appError('fileTooLarge');
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
                throw appError('decodeFailed');
            }
            if (version !== loadVersion) return;
            if (bitmap.width !== width || bitmap.height !== height) {
                throw appError('dimensionMismatch');
            }
            const { canvas, context } = createSourceCanvas(width, height);
            context.drawImage(bitmap, 0, 0);
            useSource(canvas, context, file.name);
        } catch (error) {
            if (version !== loadVersion) return;
            loadStatus.dataset.error = 'true';
            showError(loadStatus, error, 'loadFailed');
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

    function exportFocusFallback() {
        return grid ? downloadManifest : byId('applyGrid');
    }

    function setExportButtonState(button, available, pending = false) {
        // A pending export keeps its keyboard focus while blocking repeat activation.
        const disabled = !pending && !available;
        if (disabled && document.activeElement === button) {
            exportFocusFallback().focus();
        }
        button.disabled = disabled;
        if (pending) button.setAttribute('aria-disabled', 'true');
        else button.removeAttribute('aria-disabled');
    }

    function refreshFrameExport() {
        setExportButtonState(downloadFrame, selected, pendingFrame);
        setMessage(frameExportStatus, pendingFrame && pendingFrame === selected ? 'preparingFrame' : null,
            pendingFrame ? frameNumber(pendingFrame) : null);
    }

    function refreshBatchControls() {
        setExportButtonState(downloadBatch, grid?.frames.some(frame => !frame.empty), pendingBatch);
        if (!pendingBatch && document.activeElement === cancelBatch) {
            (downloadBatch.disabled ? exportFocusFallback() : downloadBatch).focus();
        }
        cancelBatch.hidden = !pendingBatch;
        setExportButtonState(cancelBatch, true, pendingBatch?.cancelRequested);
    }

    function setBatchMessage(key) {
        const { grid: exportedGrid, count } = pendingBatch;
        setMessage(exportStatus, () => {
            const text = translate(key, count);
            return grid === exportedGrid ? text : `${text} ${translate('previousZip')}`;
        });
    }

    function resetGridExportFeedback() {
        setMessage(manifestExportStatus);
        if (pendingBatch) setBatchMessage(pendingBatch.cancelRequested ? 'cancelingZip' : 'preparingZip');
        else setMessage(exportStatus);
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
        if (!blob) throw appError('encodeFailed', frameNumber(frame));
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
        const filename = frameFilename(frame, grid.frames.length);
        pendingFrame = frame;
        refreshFrameExport();
        try {
            const blob = await frameBlob(source.canvas, frame);
            saveFile(blob, filename);
            if (selected === frame) setMessage(frameExportStatus, 'frameSaved', frameNumber(frame));
        } catch (error) {
            if (selected === frame) showError(frameExportStatus, error, 'frameFailed');
        } finally {
            pendingFrame = undefined;
            setExportButtonState(downloadFrame, selected, false);
        }
    });
    downloadManifest.addEventListener('click', () => {
        if (!grid) return;
        const blob = new Blob([manifestContent(source, grid)], { type: 'application/json' });
        saveFile(blob, 'sprite-grid.json');
        setMessage(manifestExportStatus, 'manifestSaved');
    });
    cancelBatch.addEventListener('click', () => {
        if (!pendingBatch || pendingBatch.cancelRequested) return;
        pendingBatch.cancelRequested = true;
        refreshBatchControls();
        setBatchMessage('cancelingZip');
    });
    downloadBatch.addEventListener('click', async () => {
        if (pendingBatch || downloadBatch.disabled) return;
        const canvas = source.canvas;
        const frameCount = grid.frames.length;
        const frames = grid.frames.filter(frame => !frame.empty);
        const manifest = new TextEncoder().encode(manifestContent(source, grid));
        const batch = { grid, count: frames.length, cancelRequested: false };
        pendingBatch = batch;
        refreshBatchControls();
        setBatchMessage('preparingZip');
        try {
            const entries = [];
            for (const frame of frames) {
                const png = await frameBlob(canvas, frame);
                if (batch.cancelRequested) return;
                const bytes = new Uint8Array(await png.arrayBuffer());
                if (batch.cancelRequested) return;
                entries.push({ name: frameFilename(frame, frameCount), bytes });
            }
            entries.push({ name: 'sprite-grid.json', bytes: manifest });
            saveFile(buildStoredZip(entries), 'sprite-frames.zip');
            setBatchMessage('zipSaved');
        } catch (error) {
            if (!batch.cancelRequested) showError(exportStatus, error, 'zipFailed', grid !== batch.grid ? 'previousZip' : undefined);
        } finally {
            if (batch.cancelRequested) setBatchMessage('zipCanceled');
            pendingBatch = undefined;
            refreshBatchControls();
        }
    });

    languageToggle.addEventListener('click', () => {
        language = language === 'en' ? 'ru' : 'en';
        applyLanguage();
        try {
            localStorage.setItem(languageKey, language);
        } catch {
            // The current page still uses the selected language.
        }
    });
    applyLanguage();
    languageToggle.hidden = false;
    loadDemo();
})();
