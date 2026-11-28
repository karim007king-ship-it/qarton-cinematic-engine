import originalFaceRigs from "./original-face-rigs.js";

const riggedPortraitIds = new Set(Object.keys(originalFaceRigs).map(id => `${id}-portrait`));

export function withOriginalFaceRigs(story) {
  const scenes = story.scenes.map(scene => {
    const rigs = new Map();
    const characters = scene.characters.map(actor => {
      const layers = originalFaceRigs[actor.id];
      if (!layers || actor.assetId !== `${actor.id}-portrait`) return actor;
      const { assetId, ...placement } = actor;
      const atlasId = layers[0].assetId;
      rigs.set(atlasId, { id: atlasId, src: `assets/characters/${atlasId}.webp` });
      return { ...placement, layers };
    });
    const portraits = new Set(characters.map(actor => actor.assetId));
    const assets = scene.assets.filter(asset =>
      !riggedPortraitIds.has(asset.id)
      || portraits.has(asset.id)
    );
    return { ...scene, characters, assets: [...assets, ...rigs.values()] };
  });
  return { ...story, scenes };
}
