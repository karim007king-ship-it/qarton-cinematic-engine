# QARTON Universal Game Intro

## Approved visual reference

The approved reference is the user-provided QARTON intro video (1080 × 1920, 9:16, approximately 4.9 seconds). It is the visual source of truth for the shared brand opener. Preserve the reference's recognizable identity rather than redesigning it independently for each game.

Core visual language:
- QARTON emblem / Q mark and crown as the recurring focal point.
- Gold, deep red, and black as the brand palette.
- Cinematic glow, embers / sparks, flame-like accents, and flowing red fabric where they fit the shot.
- A premium, dramatic reveal with a strong audio impact synchronized to the logo reveal.
- Keep the Arabic and Latin brand identity consistent wherever both are shown in the reference artwork.

## Intro architecture

Every game intro has two separate sequences:

1. **Shared QARTON brand opener** — the same logo treatment, visual language, and original brand sound identity across all games.
2. **Game-specific title sequence** — a distinct scene, title, and sound layer that introduces the individual game's world.

The shared opener must not contain game-specific names, characters, or setting details. The game-specific sequence must not alter the QARTON logo, crown, core palette, or brand sound signature.

## Format and responsive behavior

- Treat the supplied 9:16 video as the approved master reference.
- Create a separately composed 16:9 version for landscape games; do not stretch the portrait master.
- Keep the logo and crown inside a central safe area so they remain legible across phone aspect ratios and common crops.
- Support reduced-motion and low-performance modes with a restrained fallback that preserves the logo, palette, and sound cue without requiring heavy particles or complex animation.
- Allow the host game to skip the intro and respect the game's audio / accessibility settings.

## Runtime integration requirements

- Represent the brand opener and game-specific sequence as separate, reusable intro stages.
- Expose duration, asset keys, transition timing, and audio cues through configuration; do not hard-code game assets into the shared brand module.
- Preload only the assets needed for the active intro and release transient resources after completion or cancellation.
- Make playback deterministic and safe under pause, resume, repeated start, skip, and destroy.
- Never block game startup permanently if an optional visual or audio asset fails; provide a clean fallback and report the failure to the host.

## Asset and approval policy

- The user-provided video remains the approved visual reference.
- Do not replace it with a generic crown, unrelated logo, stock footage, or a newly invented visual direction.
- Production implementation still requires approved, reusable logo artwork, original audio stems / sound effects, and composed landscape and portrait variants. This document records the direction; it does not claim those production assets are already in the repository.
