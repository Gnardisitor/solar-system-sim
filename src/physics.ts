import createNbodyModule from "./nbody.js";

export type Vec3 = readonly [number, number, number];

/** A JPL ephemeris state vector: position and velocity in AU / AU-per-day. */
export type StateVector = readonly [x: number, y: number, z: number, vx: number, vy: number, vz: number];

export type SimulationMethod = "euler" | "verlet" | "rk4";

const METHOD_CODE: Record<SimulationMethod, number> = { euler: 0, verlet: 1, rk4: 2 };

/**
 * The C simulation works entirely in "render space": JPL's (x, y, z) is
 * stored here as (x, z, y). It's a coordinate swap, not a rotation, so it
 * doesn't affect the physics — but it means positions can be handed straight
 * to Three.js without a second conversion at the call site.
 */
export function toRenderSpace(raw: StateVector): { position: Vec3; velocity: Vec3 } {
  const [x, y, z, vx, vy, vz] = raw;
  return { position: [x, z, y], velocity: [vx, vz, vy] };
}

export interface PhysicsEngine {
  initBody(index: number, mass: number, position: Vec3, velocity: Vec3): void;
  /** Removes the system's centre-of-mass velocity. Call once after all bodies are initialized. */
  initSystem(): void;
  step(method: SimulationMethod, days: number): void;
  getPosition(index: number): Vec3;
  /** Frees the WASM module's internal history/RK4 buffers so a new run can start clean. */
  reset(): void;
}

export async function createPhysicsEngine(): Promise<PhysicsEngine> {
  const module = await createNbodyModule();

  const initBodyFn = module.cwrap("init_body", null, [
    "number", "number", "number", "number", "number", "number", "number", "number",
  ]);
  const initSystemFn = module.cwrap("init_system", null, []);
  const simulateStepFn = module.cwrap("simulate_step", null, ["number", "number"]);
  const getXFn = module.cwrap("get_x", "number", ["number"]);
  const getYFn = module.cwrap("get_y", "number", ["number"]);
  const getZFn = module.cwrap("get_z", "number", ["number"]);
  const freeAllFn = module.cwrap("free_all", null, []);

  return {
    initBody(index, mass, position, velocity) {
      initBodyFn(index, mass, position[0], position[1], position[2], velocity[0], velocity[1], velocity[2]);
    },
    initSystem() {
      initSystemFn();
    },
    step(method, days) {
      simulateStepFn(METHOD_CODE[method], days);
    },
    getPosition(index) {
      return [getXFn(index), getYFn(index), getZFn(index)];
    },
    reset() {
      freeAllFn();
    },
  };
}
