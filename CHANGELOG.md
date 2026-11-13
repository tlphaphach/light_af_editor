# Changelog

All notable changes to **LightAF Editor** are documented in this file.

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
