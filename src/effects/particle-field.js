function createRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Create a deterministic, time-sampled particle field.
 * The host renderer owns drawing and frame scheduling.
 */
export function createParticleField({
  count = 24,
  seed = 1,
  width,
  height,
  lifetimeMs = 3000,
  speedMin = 4,
  speedMax = 24,
  gravity = 0,
  profile
} = {}) {
  if (!Number.isInteger(count) || count < 0 || !Number.isFinite(seed)
    || ![width, height, lifetimeMs, speedMin, speedMax, gravity].every(Number.isFinite)
    || width <= 0 || height <= 0 || lifetimeMs <= 0 || speedMin < 0 || speedMax < speedMin) {
    throw new TypeError("Particle field configuration is invalid");
  }
  const profileBudget = profile?.maxParticles ?? profile?.particleBudget;
  const budget = Number.isInteger(profileBudget) && profileBudget >= 0
    ? Math.min(count, profileBudget)
    : count;
  const random = createRandom(seed);
  const particles = Array.from({ length: budget }, (_, id) => {
    const angle = random() * Math.PI * 2;
    const speed = speedMin + random() * (speedMax - speedMin);
    return Object.freeze({
      id,
      x: random() * width,
      y: random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      phaseMs: random() * lifetimeMs,
      radius: 0.5 + random() * 2
    });
  });

  function sample(timeMs) {
    if (!Number.isFinite(timeMs) || timeMs < 0) {
      throw new TypeError("Particle sample time must be non-negative and finite");
    }
    return Object.freeze(particles.map(particle => {
      const ageMs = (timeMs + particle.phaseMs) % lifetimeMs;
      const seconds = ageMs / 1000;
      const wrap = (value, size) => ((value % size) + size) % size;
      return Object.freeze({
        id: particle.id,
        x: wrap(particle.x + particle.vx * seconds, width),
        y: wrap(particle.y + particle.vy * seconds + 0.5 * gravity * seconds * seconds, height),
        radius: particle.radius,
        opacity: 1 - ageMs / lifetimeMs
      });
    }));
  }

  return Object.freeze({ count: budget, sample });
}
