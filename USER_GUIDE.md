# LightAF Editor — User Guide

Welcome to **LightAF Editor**, a lightweight, portable Windows video & meme editor designed for quick edits and instant access to your favorite memes, sound effects, and footage.

---

## 1. Installation & Portable Setup

### Requirements
- **Windows 10 or Windows 11** (opens in a standalone Microsoft Edge app window, or your default browser as fallback).
- **No extra software required** when using the portable release zip (`releases/LightAFEditor-v<version>-Portable.zip`)—both Node.js and FFmpeg are already bundled inside.

### Setup Steps (Portable Release)
1. Download `LightAFEditor-v1.0.0-Portable.zip` from the [**GitHub Releases**](../../releases) page (or from `releases/`).
2. Right-click the `.zip` file → **Extract All...** and extract the `LightAFEditor` folder anywhere you like (Desktop, Documents, or a USB drive).
3. Open the extracted folder and double-click **`LightAFEditor.exe`** to launch the editor.

*(If running from raw source code instead of a release zip, run `npm install` once in PowerShell first.)*

> **Tip:** All your saved memes, sound effects, projects, and exported videos live inside `data/` and `exports/` right next to `LightAFEditor.exe`. You can copy or back up the entire folder and your Library moves with you.

---

## 2. The Persistent Library (Memes, SFX & Footage)

The **Library** on the left panel is permanent—anything you add stays there even when you close the app or start a new video.

### Adding Media to Your Library
- **Drag & Drop**: Drag video files (`.mp4`, `.mov`, `.webm`, `.mkv`), audio/SFX (`.mp3`, `.wav`, `.ogg`, `.m4a`), or images (`.png`, `.jpg`, `.webp`, `.gif`) from Windows Explorer directly into the Library drop zone.
- **File Picker**: Click **`+ Add Media`** at the top of the Library panel to select one or more files.
- **Direct-to-Timeline Drop**: Dropping a file from Windows Explorer straight onto a timeline track automatically saves it to your Library *and* adds it to the timeline.

### Organizing & Quick Preview
- **Filter Tabs**: Switch between **All**, **★ Fav**, **Memes**, **SFX**, **Footage**, and **Images**.
- **Search**: Type in the search box to filter by name or category.
- **Favorite (`★`)**: Click the star on any card to pin your go-to memes and sounds.
- **Quick Preview (`▶`)**: Play any meme or sound effect right inside the Library without adding it to the timeline.
- **Edit / Properties (`⋯`)**: Rename a clip, change its category (`Meme`, `SFX`, `Footage`, `Image`), view its **Media Properties** (format, resolution, duration, size, streams), or delete it from the Library.

---

## 3. Editing on the Timeline

### Adding Clips
- **Drag & Drop** any card from the Library onto a timeline track:
  - **`V2` (Overlay / Meme)**: Top visual layer—ideal for meme cutaways, reaction clips, and image overlays.
  - **`V1` (Main Video)**: Base video layer.
  - **`A1` (SFX / Sound)**: Sound effects and meme audio.
  - **`A2` (Music / Audio)**: Background music or secondary audio.
- Or click **`+ Add`** (or double-click a Library card) to insert it at the current red playhead position.

### Moving, Trimming & Splitting
- **Move**: Drag a clip left or right along its track (or drag between `V1 ↔ V2` / `A1 ↔ A2`). Enable **Snap** to align cleanly with the playhead and other clip edges.
- **Trim**: Hover over the left or right edge of a clip and drag the trim handle inward/outward.
- **Split (`S`)**:
  1. Click a clip to select it.
  2. Click or drag on the **Time** ruler to place the red playhead where you want to cut.
  3. Press **`S`** (or click **`✂ Split`**).
- **Duplicate (`Ctrl+D`)**: Select a clip and press **`Ctrl+D`** (or click **`⧉ Dup`**) to clone it.
- **Delete (`Del`)**: Select a clip and press **`Del`** or **`Backspace`** (or click **`🗑 Delete`**).

### Zooming & Scrolling
- **Zoom Timeline**: Hold **`Ctrl` + Scroll Up / Down** over the timeline to zoom in/out without zooming the app UI, or use the **Zoom** slider and **`-` / `+`** buttons.
- **Auto-Scroll**: During playback or stepping, the timeline automatically scrolls to keep the red playhead in view.

---

## 4. Clip Inspector & Media Properties

Click any clip on the timeline to open its settings in the right-hand **Clip Inspector**:
- **Start (s) / Duration (s)**: Fine-tune exact timing.
- **Volume (`0%–200%`) & Mute**: Boost quiet sound effects or mute a video's original audio.
- **Overlay Transform (Video/Image clips)**: Adjust **Scale (`10%–200%`)**, **Position X**, and **Position Y** (or click **Reset**) to resize and position meme overlays anywhere on screen.
- **Media Properties**: View the source file's format, resolution, duration, file size, and audio/video streams.

---

## 5. Themes, Projects & Exporting

### Dark / Light Theme
- Use the **🌙 Dark / ☀ Light** pill toggle switch in the top-right bar to switch themes. Your preference is saved automatically, and the app logo adapts to match.

### Windows File Explorer Right-Click Menu
1. Click the **Explorer Menu** pill toggle in the top-right bar to turn it **ON** (click again anytime to remove it—no administrator privileges required).
2. Right-click any video, audio, or image file in Windows File Explorer:
   - Choose **Open with → LightAF Editor** directly from the first menu, **or**
   - Hold **`Shift` + Right-Click** (or click **Show more options**) and select **Edit with LightAF Editor** at the top of the menu.
3. The file is automatically imported into your persistent Library and added to the timeline (whether LightAF Editor was closed or already open).

### Saving & Loading Projects
- Click **Save** to store your current timeline in `data/projects/`.
- Click **Projects** to load or delete saved projects.
- Click **New** to clear the timeline for a fresh video *(your Library is always kept intact)*.

### Exporting Your Video (Up to 4K)
1. Choose your output resolution from the dropdown next to the project name:
   - `16:9` — **720p HD**, **1080p FHD**, **2K QHD (`2560×1440`)**, or **4K UHD (`3840×2160`)**
   - `9:16` — **1080p Shorts/TikTok**, **2K Vertical**, or **4K Vertical**
   - `1:1` — **Square (`1080×1080`)**
2. Click **`Export MP4`** and wait for FFmpeg to render.
3. Once complete, click **Download MP4** or **Open Exports Folder** (saved in `exports/`).

---

## 6. Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Space` | Play / Pause |
| `S` | Split selected clip at playhead |
| `Del` / `Backspace` | Delete selected clip |
| `Ctrl + D` | Duplicate selected clip |
| `←` / `→` | Step playhead backward / forward (`0.5s`) |
| `Home` | Jump playhead to start (`00:00.0`) |
| `Ctrl + Scroll` | Zoom timeline in / out |
