# Changelog

All notable changes to **LightAF Editor** are documented in this file.

## [1.3.0] - 2026-11-14

### Added
- **Multiple Custom Layers**: Added **`+ Video Layer`** and **`+ Audio Layer`** buttons in the timeline toolbar to create unlimited custom visual (`V3`, `V4`, …) and audio (`A3`, `A4`, …) tracks with per-layer mute/hide toggles, inline renaming (double-click or **`✎`** button), custom layer colors, and layer deletion.
- **Text Overlays & Direct Canvas Positioning**: Added **`+ Text`** to insert multi-line text clips at the playhead with font family, size (`16px–220px`), bold/italic, text color, outline color & width (`0px–16px`), background box color & opacity (`0%–100%`), fade in/out, opacity, and Position X/Y (`-50%` to `50%`) — plus direct click-and-drag positioning on the preview canvas and FFmpeg `drawtext` export.
- **Multi-Track & Multi-Clip Selection**: Added **`Click`**, **`Ctrl+Click`**, and **`Shift+Click`** multi-selection on track headers (with **Select Clips**, **Rename**, **Recolor**, **Mute/Hide**, and **Delete** actions) as well as **`Ctrl+Click`** / marquee box selection across timeline clips with synchronized multi-clip dragging, bulk volume/mute/opacity inspector controls, duplicate, split, and delete.
- **Library Multi-Select Delete**: Added selection checkboxes, **`Ctrl+Click`**, **`Shift+Click`**, **All**, **Clear**, and **🗑 Delete** actions in the Library panel to delete multiple media items at once.
- **Documentation Rules (`rule.md`)**: Added standardized guidelines for maintaining `USER_GUIDE.md`, `README.md`, and `CHANGELOG.md`.

## [1.2.0] - 2026-11-14

### Added
- **Undo & Redo**: Added `↶ Undo` and `↷ Redo` buttons to the transport bar along with `Ctrl+Z` and `Ctrl+Y` / `Ctrl+Shift+Z` shortcuts, tracking clip edits, trims, splits, inspector adjustments, and aspect ratio changes (up to 100 steps).
- **Clip Speed Adjustment (`0.1x–100x`)**: Added a logarithmic **Speed** slider (`0.1x` to `100x`) and `1x` reset button in the Clip Inspector for video and audio clips, automatically scaling clip duration on the timeline and exporting via FFmpeg `setpts` and chained `atempo` filters.

### Changed
- **Expanded Scale Range**: Increased the maximum Clip Inspector **Scale** from `200%` to `500%` (`10%–500%`).

## [1.1.0] - 2026-11-14

### Added
- **Fade In & Fade Out**: Added `Fade In (s)` and `Fade Out (s)` controls in the Clip Inspector for both visual (video/image alpha) and audio (volume) clips, with real-time canvas/audio preview and matching FFmpeg `fade`/`afade` export filters.
- **Image & Visual Opacity**: Added an `Opacity (0%–100%)` slider in the Clip Inspector's transform section (included in **Reset**), rendered in real-time on `<canvas>` and exported via FFmpeg `colorchannelmixer`.
- **Smart Split Fade Handling**: Splitting a clip (`S`) preserves `Fade In` on the left segment and `Fade Out` on the right segment while carrying over `Opacity` to both.

## [1.0.0] - 2026-11-13

### Added
- **Portable Windows Launcher (`LightAFEditor.exe`)**: Compiled native C# launcher with embedded app icon (`logo.ico`), automatic `bin\node.exe` detection, and standalone Microsoft Edge app window launch.
- **Persistent Meme & Sound Library**: Drag-and-drop or browse videos, memes, sound effects, and images into `data/library/` with auto-generated thumbnails (`data/thumbs/`), favorites (`★`), categories (`Meme`, `SFX`, `Footage`, `Image`), search, and in-place quick preview.
- **Multi-Track Timeline & Compositor**: 4 tracks (`V2` Overlay/Meme, `V1` Main Video, `A1` SFX/Sound, `A2` Music/Audio), real-time `<canvas>` preview, clip move/trim, Split (`S`), Duplicate (`Ctrl+D`), Delete (`Del`), edge snapping, `Ctrl + Scroll` timeline zoom, and automatic playhead scrolling.
- **Clip Inspector & Media Properties**: Volume (`0%–200%`), Mute, `V2` overlay Scale/Position X/Y controls, and Media Properties viewer (format, resolution, duration, file size, and audio/video streams) in both the Clip Inspector and Library modal.
- **MP4 Export up to 4K**: FFmpeg (`ffmpeg-static`) export supporting `720p`, `1080p`, `2K (1440p)`, `4K (2160p)`, `9:16` Vertical (`1080p`/`2K`/`4K`), and `1:1` Square.
- **Dark & Light Themes**: Pill toggle switch in the top bar that switches UI theme, topbar logo, and favicon between Dark (`/logo.png`) and Light (`/logo-light.png`).
- **Windows File Explorer Integration**: Pill toggle switch (**Explorer Menu**) to register/unregister `Edit with LightAF Editor` (top of classic / `Shift + Right-Click` menu) and `Open with → LightAF Editor`, with automatic import on launch or into an already-open window.
- **Portable Release Builder (`build_portable.ps1`)**: Packages a clean, self-contained `releases/LightAFEditor-v<version>-Portable.zip` with bundled `bin/node.exe` and `ffmpeg.exe`.
