import { drawFrame, sampleFrame } from "@qarton/cinematic-engine/motion-studio";
import { drawCharacter } from "./studio-character-track.js";
import { sampleVisualEffects } from "./studio-visual-effects-model.js";
import { drawCinematicEffects } from "../../src/effects/cinematic-effects.js";

function drawCharacterWithCamera(ctx, pose, width, height, camera) {
  ctx.save();
  try {
    ctx.translate(width / 2 + camera.x, height / 2 + camera.y);
    ctx.rotate(camera.rotation * Math.PI / 180);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-width / 2, -height / 2);
    drawCharacter(ctx, pose, width, height);
  } finally { ctx.restore(); }
}

/** Shared deterministic compositor for preview and every export backend. */
export function drawStudioScene({ ctx, compiledProject, timeMs, characterAnimation, characterTrack,
  characterTracks = null, audioSample = null, visualEffectsCompiled, viewport = compiledProject.viewport }) {
  const effectSample = sampleVisualEffects(visualEffectsCompiled, timeMs);
  drawFrame(ctx, { ...sampleFrame(compiledProject, timeMs), camera: effectSample.camera });
  const dialogue = audioSample?.dialogue ?? [];
  if (characterTracks) {
    characterTracks.forEach(({ track, animation }, index) => {
      if (!track.keyframes.length && !(index === 0 && dialogue.length)) return;
      const pose = { ...animation.sample(timeMs) };
      if (index === 0 && dialogue.length) pose.mouthOpen = Math.max(...dialogue.map(({ mouthOpen }) => mouthOpen));
      drawCharacterWithCamera(ctx, pose, viewport.width, viewport.height, effectSample.camera);
    });
  } else if (characterTrack && characterAnimation && (characterTrack.keyframes.length || dialogue.length)) {
    const pose = { ...characterAnimation.sample(timeMs) };
    if (dialogue.length) pose.mouthOpen = Math.max(...dialogue.map(({ mouthOpen }) => mouthOpen));
    drawCharacterWithCamera(ctx, pose, viewport.width, viewport.height, effectSample.camera);
  }
  drawCinematicEffects(ctx, { ...effectSample, camera: { x: 0, y: 0, zoom: 1, rotation: 0 }, layers: [] });
  return effectSample;
}
