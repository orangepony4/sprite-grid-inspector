# Sprite Grid Inspector

[![Tests](https://github.com/orangepony4/sprite-grid-inspector/actions/workflows/test.yml/badge.svg)](https://github.com/orangepony4/sprite-grid-inspector/actions/workflows/test.yml)

[English](#english) · [Русский](#русский)

## English

Check how a PNG sprite sheet splits into frames before using it in a game. The browser preview overlays the grid, marks empty frames, and shows the bounds of visible pixels. All file processing stays in the browser.

### Inspect a sheet

**[Try it here](https://orangepony4.github.io/sprite-grid-inspector/)** · [Offline ZIP in the latest release](https://github.com/orangepony4/sprite-grid-inspector/releases/latest)

For offline use, download `sprite-grid-inspector-<version>-offline.zip` from **Assets**, extract it, and open `index.html`.

The first visit opens in English. Choose **RU** or **EN** in the header to switch the interface language. The grid, selected frame, and exported files stay the same. If browser storage is available, the app remembers the language.

1. Start with the built-in demo. The 64 × 32 sheet uses 16 × 16 cells and contains six occupied frames and two empty ones. **Load demo sheet** restores this example and its grid settings.
2. To inspect your own sheet, select **Choose PNG**. Set the cell width and height in pixels. Offsets move the grid start from the left and top edges. Gaps add space between neighboring cells. Select **Apply grid** or press Enter in a settings field. If a number is invalid, focus moves to the field that needs correcting.
3. Select a cell in the sheet or in **Frame inspector**. With the frame list focused, use the arrow keys to move between cells and Home or End to go to the edges of the current row. Press Enter or Space to select the focused frame.
4. Select **Download frame PNG** to save the current cell, **Download JSON manifest** to save the grid and frame positions, or **Download occupied frames** to save a ZIP. The demo ZIP contains six PNGs and the manifest.

![Sprite Grid Inspector showing the 64 × 32 demo sheet, grid controls, two empty cells, and a preview of the selected frame](docs/preview.webp)

### Export details

Only full cells are included. A cell is empty when every pixel has zero alpha. The browser encodes the selected cell as a fresh PNG at its original dimensions and keeps its transparency. The preview may be scaled to fit and can enlarge very thin strips along their short side.

The JSON lists the source dimensions, grid settings, and frames in row-major order. Frame indexes, rows, and columns start at zero. Coordinates and nonempty bounds use source-image pixels measured from its top-left corner. Empty frames have `bounds: null`.

The ZIP skips empty cells and keeps the original one-based frame numbers in the PNG filenames. The manifest describes every cell. Individual and archived PNG filenames use two digits for grids with up to 99 cells and three digits for larger grids, so sorting by filename preserves grid order. The ZIP stores the PNGs without recompressing them.

While the browser prepares the ZIP, select **Cancel ZIP export** to stop it. The current frame finishes encoding, and no ZIP is downloaded. You can start a new export when the cancellation completes.

### Limits

The browser accepts PNG files up to 32 MiB and 4096 × 4096 pixels. A grid can contain up to 512 full cells. Animated PNGs use their default still image, including files with a separate poster image. Frame positions follow the PNG's stored pixel orientation, regardless of EXIF rotation metadata.

### Development

Run `npm test` with Node.js 20 or newer. The browser application has no runtime dependencies.

Released under the [MIT License](LICENSE).

---

## Русский

Проверьте, как PNG-спрайт-лист делится на кадры для игры. Программа накладывает сетку, отмечает пустые кадры и показывает границы видимых пикселей. Файлы обрабатываются в браузере.

### Как проверить спрайт-лист

**[Попробовать здесь](https://orangepony4.github.io/sprite-grid-inspector/)** · [ZIP для работы без интернета в последнем релизе](https://github.com/orangepony4/sprite-grid-inspector/releases/latest)

Для работы без интернета скачайте `sprite-grid-inspector-<версия>-offline.zip` из раздела **Assets**, распакуйте архив и откройте `index.html`.

При первом открытии интерфейс на английском. Нажмите **RU** или **EN** в шапке, чтобы сменить язык. Сетка, выбранный кадр и содержимое экспортируемых файлов сохраняются. Если браузер разрешает хранить настройки, приложение запоминает язык.

1. Начните со встроенного примера. На листе 64 × 32 ячейки размером 16 × 16 пикселей образуют шесть заполненных кадров и два пустых. Кнопка **Загрузить пример** возвращает пример и его настройки сетки.
2. Чтобы проверить свой лист, нажмите **Выбрать PNG**. Укажите ширину и высоту ячейки в пикселях. Смещения задают отступ сетки от левого и верхнего края. Промежутки задают расстояние между соседними ячейками. Нажмите **Применить сетку** или Enter в поле настроек. Если число введено неверно, фокус перейдёт в поле, которое нужно исправить.
3. Выберите ячейку на листе или в списке **Кадры**. Когда фокус в списке, перемещайтесь по сетке стрелками, а к краям текущей строки переходите клавишами Home и End. Нажмите Enter или пробел, чтобы выбрать кадр.
4. Кнопка **Скачать кадр PNG** сохраняет выбранную ячейку. **Скачать JSON-манифест** выгружает сетку и координаты кадров. Кнопка **Скачать заполненные кадры** сохраняет ZIP с заполненными кадрами и манифестом. Во встроенном примере в архиве будет шесть PNG.

### Что входит в экспорт

Программа учитывает только полные ячейки. Ячейка считается пустой, когда все её пиксели полностью прозрачны. PNG сохраняет исходный размер ячейки и прозрачность. Предпросмотр может быть увеличен или уменьшен. Очень узкие полосы в предпросмотре могут быть растянуты по короткой стороне.

В JSON указаны размеры исходного листа, настройки сетки и кадры по строкам слева направо. Номера строк, столбцов и кадров в JSON начинаются с нуля. Координаты и границы видимой части измеряются в пикселях от левого верхнего угла исходного листа. У пустых кадров `bounds: null`.

В ZIP входят PNG заполненных кадров и JSON со всеми ячейками. Номера в именах PNG начинаются с единицы и соответствуют исходной сетке. В именах отдельных PNG и файлов в архиве используются две цифры для сеток до 99 ячеек и три для сеток от 100 ячеек. Сортировка по имени сохраняет порядок кадров. Архив сохраняет PNG без повторного сжатия.

Во время подготовки архива нажмите **Отменить экспорт ZIP**, чтобы остановить выгрузку. Браузер завершит кодирование текущего кадра, и ZIP не будет скачан. После завершения отмены можно запустить экспорт снова.

### Ограничения

Поддерживаются PNG размером до 32 МиБ и 4096 × 4096 пикселей. В сетку входит до 512 полных ячеек. Для анимированных PNG используется изображение по умолчанию, включая отдельный кадр-постер. Положение кадров определяется сохранённым порядком пикселей PNG без учёта поворота в EXIF.

### Разработка

Для проверок запустите `npm test` в Node.js 20 или новее. У веб-приложения нет дополнительных зависимостей.

Проект распространяется по [лицензии MIT](LICENSE).
