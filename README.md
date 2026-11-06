# Sprite Grid Inspector

[![Tests](https://github.com/orangepony4/sprite-grid-inspector/actions/workflows/test.yml/badge.svg)](https://github.com/orangepony4/sprite-grid-inspector/actions/workflows/test.yml)

Check how a PNG sprite sheet splits into frames before using it in a game. The browser preview overlays the grid, marks empty frames, and shows the bounds of visible pixels. All file processing stays in the browser.

## Inspect a sheet

1. [Open Sprite Grid Inspector](https://orangepony4.github.io/sprite-grid-inspector/) or open `index.html` from a downloaded copy, then try the included demo or choose a PNG file.
2. Set the cell width and height in pixels. Offsets move the start from the left and top edges, and gaps add space between cells.
3. Apply the grid and choose a frame in the sheet or in the keyboard-accessible list.
4. Download the selected cell as a PNG at its original size, or export the full grid as JSON.

Only full cells are included. A cell is empty when every pixel has zero alpha. The browser encodes the selected cell as a fresh PNG at its original dimensions and keeps its transparency. The preview may be scaled to fit.

The JSON lists the source dimensions, grid settings, and frames in row-major order. Frame indexes, rows, and columns start at zero. Coordinates and nonempty bounds use source-image pixels measured from its top-left corner. Empty frames have `bounds: null`.

## Limits

The browser accepts PNG files up to 32 MiB and 4096 × 4096 pixels. A grid can contain up to 512 full cells. Animated PNGs use their default still image.

## Development

Run `npm test` with Node.js 20 or newer. The browser application has no runtime dependencies.

Released under the [MIT License](LICENSE).
