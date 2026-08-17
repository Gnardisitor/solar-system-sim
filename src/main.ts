import { createPhysicsEngine, toRenderSpace, type StateVector } from "./physics";
import { createSolarSystemScene, type BodyUpdate, type PlanetSpec } from "./scene";
import { createControlsPanel } from "./controlsPanel";

const base = import.meta.env.BASE_URL;

interface PlanetDefinition extends PlanetSpec {
  mass: number;
}

// Radii follow real relative planet sizes via radius_earth_relative^(1/3) (compressed so
// the range stays navigable), anchored so Earth keeps its original scale — e.g. Jupiter's
// real radius is ~10.97x Earth's, and 10.97^(1/3) * 0.16 = 0.355, which is exactly its
// radius below. Two bodies are deliberately kept off that curve:
//  - Mercury stays at its original (smaller than the curve would give) size. At these
//    AU-accurate orbit distances, Mercury's real perihelion (~0.307 AU) leaves only a
//    sliver of clearance from the sun's surface, so it has to stay small enough that the
//    two never visually overlap.
//  - The sun is capped for the same reason and, as a result, ends up with a smaller radius
//    than Jupiter or Saturn — the real sun/Jupiter ratio (~9.7x) simply doesn't fit in the
//    clearance Mercury's orbit leaves. In practice this never reads as wrong on screen:
//    the sun and the gas giants are 5+ AU apart and are never framed together, so there's
//    no shot where the size inversion is visible.
//
// Rotation speeds are 2*pi / sidereal_rotation_period_in_days, scaled by the same constant
// (derived from Earth's own period) so a full spin still takes a sensible amount of sim
// time — e.g. Venus's real 243-day "day" makes it nearly motionless, Jupiter's 10-hour day
// makes it the fastest spinner, and the sign matches each planet's real rotation direction
// (Venus and Uranus are retrograde).
const PLANETS: readonly PlanetDefinition[] = [
  { name: "sun", mass: 1.989e30, radius: 0.22, rotationSpeed: 0.0027, isSun: true, textureUrl: `${base}textures/sun.webp` },
  {
    name: "mercury",
    mass: 3.301e23,
    radius: 0.07,
    rotationSpeed: 0.00124,
    textureUrl: `${base}textures/mercury.webp`,
    trailColor: 0x9c9c9c,
  },
  {
    name: "venus",
    mass: 4.868e24,
    radius: 0.157,
    rotationSpeed: -0.0003,
    textureUrl: `${base}textures/venus.webp`,
    atmosphere: { color: 0xe0c68f, intensity: 0.85 },
    trailColor: 0xe0c68f,
  },
  {
    name: "earth",
    mass: 5.972e24,
    radius: 0.16,
    rotationSpeed: 0.0729,
    textureUrl: `${base}textures/earth.webp`,
    atmosphere: { color: 0x6ca8ff, intensity: 0.7 },
    clouds: true,
    trailColor: 0x6ca8ff,
  },
  {
    name: "mars",
    mass: 6.417e23,
    radius: 0.13,
    rotationSpeed: 0.0708,
    textureUrl: `${base}textures/mars.webp`,
    atmosphere: { color: 0xd98a54, intensity: 0.3 },
    trailColor: 0xd98a54,
  },
  {
    name: "jupiter",
    mass: 1.898e27,
    radius: 0.355,
    rotationSpeed: 0.1758,
    textureUrl: `${base}textures/jupiter.webp`,
    atmosphere: { color: 0xd9b38c, intensity: 0.35 },
    trailColor: 0xd9b38c,
  },
  {
    name: "saturn",
    mass: 5.683e26,
    radius: 0.335,
    rotationSpeed: 0.1637,
    textureUrl: `${base}textures/saturn.webp`,
    atmosphere: { color: 0xe8d9a8, intensity: 0.3 },
    rings: { innerScale: 1.4, outerScale: 2.3, color: 0xb8a97e },
    trailColor: 0xe8d9a8,
  },
  {
    name: "uranus",
    mass: 8.681e25,
    radius: 0.254,
    rotationSpeed: -0.1012,
    textureUrl: `${base}textures/uranus.webp`,
    atmosphere: { color: 0x8fe0e0, intensity: 0.4 },
    trailColor: 0x8fe0e0,
  },
  {
    name: "neptune",
    mass: 1.024e26,
    radius: 0.251,
    rotationSpeed: 0.1083,
    textureUrl: `${base}textures/neptune.webp`,
    atmosphere: { color: 0x4169e1, intensity: 0.45 },
    trailColor: 0x4169e1,
  },
];

type VectorTable = Record<string, readonly StateVector[]>;

function formatDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getUTCFullYear()} UTC`;
}

async function main(): Promise<void> {
  const canvas = document.getElementById("canvas");
  if (!canvas) throw new Error("Missing #canvas element");
  const loading = document.getElementById("loading");

  const [vectors, physics] = await Promise.all([
    fetch(`${base}api.json`).then((response) => response.json() as Promise<VectorTable>),
    createPhysicsEngine(),
  ]);

  const scene = createSolarSystemScene(canvas);

  let isLoaded = false;
  let simulatedDate = new Date();

  async function loadYear(year: number): Promise<void> {
    isLoaded = false;
    scene.reset();
    physics.reset();

    simulatedDate = new Date(Date.UTC(year, 0, 1));
    panel.setDateText(formatDate(simulatedDate));

    const currentVectors = vectors[String(year)];
    if (!currentVectors) throw new Error(`No ephemeris data for year ${year}`);

    const initial: BodyUpdate[] = [];
    PLANETS.forEach((spec, i) => {
      scene.addBody(spec);
      const raw = currentVectors[i];
      if (!raw) throw new Error(`Missing vector for body ${i} in year ${year}`);
      const { position, velocity } = toRenderSpace(raw);
      physics.initBody(i, spec.mass, position, velocity);
      initial.push({ position, rotationDelta: 0 });
    });
    physics.initSystem();
    scene.setPositions(initial);

    isLoaded = true;
  }

  const panel = createControlsPanel({
    onYearChange: (year) => {
      void loadYear(year);
    },
  });

  await loadYear(panel.initialYear);
  loading?.classList.add("hidden");

  let accumulatedSeconds = 0;
  scene.start((deltaSeconds) => {
    if (!panel.isRunning || !isLoaded) return;
    accumulatedSeconds += deltaSeconds;
    if (accumulatedSeconds < panel.updateIntervalSeconds) return;
    accumulatedSeconds = 0;

    physics.step(panel.method, panel.stepDays);
    const updates: BodyUpdate[] = PLANETS.map((spec, i) => ({
      position: physics.getPosition(i),
      rotationDelta: spec.rotationSpeed * panel.stepDays,
    }));
    scene.setPositions(updates);

    simulatedDate = new Date(simulatedDate.getTime() + panel.stepDays * 86400 * 1000);
    panel.setDateText(formatDate(simulatedDate));
  });
}

void main();
