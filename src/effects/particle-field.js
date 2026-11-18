const MAX_PARTICLES = 10_000;

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
 * A hard ceiling prevents accidental unbounded allocations when no quality
 * profile is supplied; lower device-specific budgets can still be injected.
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
  if (!Number.isInteger(count) || count < 0 || count > MAX_PARTICLES || !Number.isFinite(seed)
    || ![width, height, lifetimeMs, speedMin, speedMax, gravity].every(Number.isFinite)
    || width <= 0 || height <= 0 || lifetimeMs <= 0 || speedMin < 0 || speedMax < speedMin) {
    throw new TypeError(`Particle field configuration is invalid (count must be between 0 and ${MAX_PARTICLES})`);
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
      // Add modulo values without overflowing when lifetimeMs is very large.
      const timePhase = timeMs % lifetimeMs;
      const particlePhase = particle.phaseMs % lifetimeMs;
      const remaining = lifetimeMs - particlePhase;
      const ageMs = timePhase >= remaining ? timePhase - remaining : timePhase + particlePhase;
      const seconds = ageMs / 1000;
      const x = particle.x + particle.vx * seconds;
      const y = particle.y + particle.vy * seconds + 0.5 * gravity * seconds * seconds;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new RangeError("Particle position exceeded the finite numeric range");
      }
      const wrap = (value, size) => ((value % size) + size) % size;
      return Object.freeze({
        id: particle.id,
        x: wrap(x, width),
        y: wrap(y, height),
        radius: particle.radius,
        opacity: 1 - ageMs / lifetimeMs
      });
    }));
  }

  return Object.freeze({ count: budget, sample });
}
