# UI theme research: SPEED FOR NEED

Goal: replace the lime/teal UI with a white, GTA V / Need for Speed style. Three palette options, one picked.

## What the research actually confirmed

- Rockstar's support page lists map-icon colours: Franklin green, Michael blue, Trevor orange. These are map markers, not a UI palette. (support.rockstargames.com, "Information about character icons in Grand Theft Auto V")
- NFS Heat's night-time visuals are described as bright blues, greens and pinks. That describes the in-world look, not the menus.
- Need for Speed: Most Wanted (2012) Wii U version switched minimap highlights to blue. The December 2011 prototype HUD was reddish.
- Not confirmed by search: the #FCAF17 Rockstar colour, a GTA V pause-menu palette, and any NFS or Forza menu hex values. The hex values below are design choices inspired by these games, not values extracted from them.

## Option A: Los Santos Daylight (chosen)

| Token | Hex | Use |
|---|---|---|
| `--paper` | #F5F5F2 | Frosted white panels |
| `--white` | #FFFFFF | Pure highlights |
| `--ink` | #0E1013 | Text on light, selected-row fill |
| `--ink-2` | #4A4F57 | Secondary text on light |
| `--amber` | #FCAF17 | Primary accent, DRIVE / Take the wheel, progress start |
| `--amber-hi` | #FFC247 | Hover |
| `--red` | #E4002B | Race, danger, progress end, error |
| `--cyan` | #73E6FF | Nitro only (existing nitro colour, not repainted) |
| `--night` | #0B0D10 | Dark base, overlays, loader |

- Mood: clean daylight on the Coast. White cards, black type, one hot accent.
- Inspiration: GTA V's white/black menu contrast and Rockstar's warm yellow-orange; NFS red for urgency.
- Contrast: ink on paper 17.4:1; ink on amber 10.2:1; white on red 4.85:1; ink-2 on paper 7.6:1.
- Rule: amber is never used as text or a focus ring on white (amber on white is 1.86:1).

## Option B: Vice Night Neon

| Token | Hex | Use |
|---|---|---|
| `--panel` | #14101C | Dark panels |
| `--ink` | #F4F1FA | Text |
| `--accent` | #FF2E88 | Magenta: primary |
| `--accent-2` | #FFB000 | Amber: secondary |
| `--cyan` | #2FD6FF | Nitro only |

- Mood: Miami or Palm City night. Closer to NFS Heat's neon feel.
- Downside: dark panels hide the 3D showroom; less clean than A.

## Option C: Forza Chrome

| Token | Hex | Use |
|---|---|---|
| `--paper` | #FAFAFA | White panels |
| `--ink` | #111318 | Text |
| `--accent` | #1E6BFF | Blue primary |
| `--danger` | #E0301E | Race and cancel |

- Mood: studio-clean, calm. Modern and tidy, less GTA.
- Downside: blue is not the GTA/NFS signal the brief asked for.

## Implementation notes

- Tokens live in one `:root` block in `dist/theme.css`, loaded after `style.css` and `loading.css`.
- `style.css` is not restyled. Only `theme.css` overrides, plus the `<link>` line in `index.html`.
- Chamfered 45-degree corners on buttons (clip-path). Thin dark rules. Condensed bold uppercase headings.
- Panels are frosted white over the blurred game scene. HUD elements over the game stay dark pills with white text, so they read on sky and asphalt.
