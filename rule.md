# Documentation Rules for AI Assistants

This document defines how AI assistants must write and update `USER_GUIDE.md`, `README.md`, and `CHANGELOG.md` in **LightAF Editor** so that all documentation stays accurate, clear, and consistent.

---

## 1. General Principles (Applies to All Docs)

1. **Verify Against the Codebase First**
   - Never document features, shortcuts, UI labels, file paths, or version numbers from memory.
   - Always check `public/index.html`, `public/app.js`, `server.js`, `ffmpeg-helper.js`, and `package.json` before writing.
2. **Use Exact UI Labels & Shortcuts**
   - Match the exact button text, icon, and capitalization shown in the UI (e.g., **`+ Add Media`**, **`+ Text`**, **`+ Video Layer`**, **`+ Audio Layer`**, **`✂ Split`**, **`Export MP4`**).
   - Format keyboard shortcuts in inline code inside bold text: **`Ctrl+Z`**, **`Shift + Click`**, **`Del`**.
3. **Keep Versions Synchronized**
   - The current version in `package.json` (`"version"`), `README.md` (Quick Start zip filename), `USER_GUIDE.md` (Setup Steps zip filename), and the top entry of `CHANGELOG.md` must match.
4. **Update All Relevant Docs Together**
   - When adding or changing a user-facing feature:
     1. Update `USER_GUIDE.md` with how to use it.
     2. Update `README.md` if it affects high-level features, project structure, or setup.
     3. Update `CHANGELOG.md` under the target release (or `## [Unreleased]`).

---

## 2. `USER_GUIDE.md` Rules

**Audience:** End users (creators, editors) using the app—assume no coding knowledge.

### Structure & Tone
- **Title:** `# LightAF Editor — User Guide` followed by a brief 1–2 sentence welcome.
- **Numbered Top-Level Sections (`## 1. ...`, `## 2. ...`)** separated by `---`:
  1. Installation & Portable Setup
  2. The Persistent Library
  3. Editing on the Timeline (tracks/layers, clips, text, multi-select, zoom)
  4. Clip Inspector & Media Properties
  5. Themes, Projects & Exporting
  6. Keyboard Shortcuts Summary (table or structured list)
- **Subsections (`### ...`):** Group by user task (e.g., *Adding Media*, *Managing Custom Layers*, *Adding & Positioning Text*).

### Formatting Conventions
- Use **numbered lists** (`1.`, `2.`, `3.`) for sequential step-by-step workflows.
- Use **bulleted lists** (`- **Feature Name**: ...`) for options, controls, or capabilities.
- Use `> **Tip:** ...` or `> **Note:** ...` callouts sparingly for helpful non-obvious behavior (e.g., portable `data/` folder, minimum track limits).
- State exact ranges and units where applicable (e.g., `0.1x–100x`, `0%–200%`, `-50%` to `50%`).
- Do **not** include internal implementation details (e.g., function names, CSS classes, or FFmpeg filter syntax) in `USER_GUIDE.md`.

---

## 3. `README.md` Rules

**Audience:** Both end users evaluating/downloading the app and developers building or running from source.

### Structure & Order
1. **Header & Logo:** `# LightAF Editor`, centered logo (`public/logo.png`, `width="96"`), and a concise 1-sentence summary mentioning portable Windows use, persistent Library, timeline, and 4K MP4 export.
2. **`## Features`:** High-level bulleted summary grouped by area (Portable & Zero-Bloat, Persistent Library, Multi-Track Timeline & Custom Layers, Text Overlays, Clip Inspector, Export, Themes, Explorer Integration). Keep bullets scannable (1–2 lines each).
3. **`## Tech Stack`:** Concise list of Backend, Media Engine, Frontend, and Launcher.
4. **`## Project Structure`:** Accurate ASCII directory tree inside a ```` ```text ```` block. Only list files/folders that actually exist.
5. **`## Quick Start`:**
   - `### 1. For End Users (Portable Zip — No Installation Needed)`
   - `### 2. For Developers (From Source)`
   - `### Building a Portable Release Zip` (if applicable)

### Formatting Conventions
- Link to `USER_GUIDE.md` and `CHANGELOG.md` using relative markdown links.
- Keep shell commands in ```` ```powershell ```` blocks (since the primary OS is Windows).
- Avoid duplicating the full step-by-step instructions from `USER_GUIDE.md`; summarize capabilities and link to `USER_GUIDE.md` for walkthroughs.

---

## 4. `CHANGELOG.md` Rules

**Audience:** Users and developers checking what changed between versions.

### Format (Keep a Changelog Style)
- **Header:**
  ```markdown
  # Changelog

  All notable changes to **LightAF Editor** are documented in this file.
  ```
- **Version Headings:**
  - Released versions: `## [X.Y.Z] - YYYY-MM-DD` (newest version at the top).
  - Work in progress (if not yet released): `## [Unreleased]`.
- **Standard Categories (include only non-empty categories in this order):**
  1. `### Added` — New features, UI controls, shortcuts, or export capabilities.
  2. `### Changed` — Updates, expansions, or improvements to existing behavior.
  3. `### Fixed` — Bug fixes.
  4. `### Removed` — Removed features or deprecated options.

### Bullet Style
- Start every bullet with a bold summary label followed by a colon:
  `- **Feature Name**: Clear description of what changed and how users interact with it.`
- Include relevant ranges, shortcuts, and (when helpful for release notes) key backend/FFmpeg behavior (e.g., `drawtext`, `atempo`, `colorchannelmixer`).
- Never invent dates or changes—use the current local date (`YYYY-MM-DD`) and only document changes actually implemented in the codebase.

---

## 5. Pre-Commit Documentation Checklist

Before finishing any documentation update, verify:
- [ ] All UI labels, shortcuts, and ranges match the current code.
- [ ] Project tree in `README.md` reflects actual files.
- [ ] Version numbers in `package.json`, `README.md`, `USER_GUIDE.md`, and `CHANGELOG.md` are consistent.
- [ ] No internal code symbols leak into `USER_GUIDE.md`.
- [ ] `CHANGELOG.md` entries are in reverse chronological order with valid `YYYY-MM-DD` dates.
