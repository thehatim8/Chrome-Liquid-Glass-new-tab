# Composition Brief: Chrome Liquid Glass Master Showcase (96s)

## Product Core
- App: Chrome Liquid Glass New Tab Extension
- Version: 1.1.0
- Target Resolution: 1920x1080 (16:9 Widescreen Desktop)
- Total Duration: 96.0 seconds (2,880 frames at 30 fps)

## Visual Architecture
- Canvas Frame: 1920x1080 with deep midnight radial gradient `#0e1b38` to `#040711`.
- Browser Container: 1640x948px centered at `top: 68px; left: 140px;` with authentic macOS/Chrome titlebar (44px) and an inner stage viewport of 1640x904px matching exact 16:9 widescreen format.
- Asset Handling: High-resolution screenshots of the 5 authentic looks (`look1-bentley-dark.png`, `look2-fuji-pagoda.jpg`, `look3-mclaren-amber.png`, `look4-anime-luffy.png`, `look5-yellow-supercar.jpg`) displayed with zero crop or distortion.
- Annotation System: Non-obscuring widget focus rings (`.widget-focus-ring`) with soft cyan glow paired with floating pointer pills (`.spotlight-pill`) positioned in negative space to highlight widgets without covering any text, clock digits, or artwork.

## Scene Progression (9 Scenes)
1. **Scene 1 (0.0s - 11.5s): The Blank Tab Dilemma**
   - Sterile Google Search tab with animated "BORING & STERILE" stamp drop.
2. **Scene 2 (11.5s - 22.0s): Liquid Glass Engine Reveal**
   - Staggered glass cards showing core engine pillars: Dynamic Glass, Magnetic Snap, Subject Awareness, macOS Dock.
3. **Scene 3 (22.0s - 33.5s): Look 1 — Midnight Executive**
   - Dark frosted Bentley look with spotlights for Calendar, FIFA World Cup scores, Clock/Apps, and macOS Dock.
4. **Scene 4 (33.5s - 44.5s): Look 2 — Kyoto Serenity**
   - Pure translucent white frosted glass over Mount Fuji with Multi-Engine Search highlight.
5. **Scene 5 (44.5s - 54.5s): Look 3 — McLaren Amber & Smart Detection**
   - Orange supercar look highlighting Intelligent Subject Awareness with an auto-adjust banner and vehicle outline.
6. **Scene 6 (54.5s - 66.0s): Look 4 — Straw Hat Anime**
   - Dedicated full-screen showcase of Straw Hat Luffy with Cream frosted glass, OpenRouter AI Chat ("Ask me anything, Hatim"), Notes math solver (`(10+10=) ➔ 20`), and custom dock icons.
7. **Scene 7 (66.0s - 76.0s): Look 5 — Cyber Runway**
   - Dedicated full-screen showcase of Yellow Hypercar with Smoked obsidian glass, bold clock (`19:00`), yellow accent buttons, and dark shortcuts.
8. **Scene 8 (76.0s - 85.0s): Modular Grid & Snap Haptics**
   - Long-press demonstration, magnetic grid guidelines, Notes card dragging and snapping into place, dock bounce physics.
9. **Scene 9 (85.0s - 96.0s): Grand Finale & Call to Action**
   - 3D fanned card presentation of all 5 looks, feature value chips, and animated "Add to Chrome — Free" CTA button.

## Audio Cues
- Voice: `assets/voiceover.wav` (duration: 94.44s)
- Background Score: `assets/music/happy-beats-business-moves-vol-1-by-ende-dot-app.mp3`
- Sound Effects: 10 synchronized audio markers triggering UI state changes.
