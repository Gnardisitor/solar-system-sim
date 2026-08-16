import { createPhysicsEngine, toRenderSpace, type StateVector } from "./physics";
import { createSolarSystemScene, type BodyUpdate, type PlanetSpec } from "./scene";
import { createControlsPanel } from "./controlsPanel";

const base = import.meta.env.BASE_URL;

interface PlanetDefinition extends PlanetSpec {
  mass: number;
}

const PLANETS: readonly PlanetDefinition[] = [
  { name: "sun", mass: 1.989e30, radius: 0.22, rotationSpeed: 0.0001, isSun: true, textureUrl: `${base}textures/sun.webp` },
  { name: "mercury", mass: 3.301e23, radius: 0.07, rotationSpeed: 0.017, textureUrl: `${base}textures/mercury.webp` },
  { name: "venus", mass: 4.868e24, radius: 0.15, rotationSpeed: -0.017, textureUrl: `${base}textures/venus.webp` },
  { name: "earth", mass: 5.972e24, radius: 0.16, rotationSpeed: 0.0729, textureUrl: `${base}textures/earth.webp` },
  { name: "mars", mass: 6.417e23, radius: 0.08, rotationSpeed: 0.0708, textureUrl: `${base}textures/mars.webp` },
  { name: "jupiter", mass: 1.898e27, radius: 0.2, rotationSpeed: 0.174, textureUrl: `${base}textures/jupiter.webp` },
  { name: "saturn", mass: 5.683e26, radius: 0.19, rotationSpeed: 0.164, textureUrl: `${base}textures/saturn.webp` },
  { name: "uranus", mass: 8.681e25, radius: 0.3, rotationSpeed: -0.097, textureUrl: `${base}textures/uranus.webp` },
  { name: "neptune", mass: 1.024e26, radius: 0.3, rotationSpeed: 0.096, textureUrl: `${base}textures/neptune.webp` },
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

  const [vectors, physics] = await Promise.all([
    fetch(`${base}api.json`).then((response) => response.json() as Promise<VectorTable>),
    createPhysicsEngine(),
  ]);

  const scene = createSolarSystemScene(canvas, { backgroundTextureUrl: `${base}textures/stars.webp` });

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
