import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Vec3 } from "./physics";

const ORBIT_TRAIL_CAPACITY = 3000;
const MAX_PIXEL_RATIO = 2;

export interface PlanetSpec {
  name: string;
  radius: number;
  textureUrl: string;
  rotationSpeed: number;
  isSun?: boolean;
}

export interface BodyUpdate {
  position: Vec3;
  rotationDelta: number;
}

export interface SolarSystemScene {
  /**
   * Adds a body's mesh (and, unless it's the sun, an orbit trail) to the
   * scene. Bodies must be added in the same order their positions will
   * later be supplied to setPositions — index in, index out.
   */
  addBody(spec: PlanetSpec): void;
  /** One update per body added so far, in addBody order. */
  setPositions(updates: readonly BodyUpdate[]): void;
  /** Disposes every body's geometry/material/texture and clears the scene, ready for addBody again. */
  reset(): void;
  /** Starts the render loop. onTick fires once per frame, before rendering, so callers can drive a physics step. */
  start(onTick: (deltaSeconds: number) => void): void;
  /** Stops the render loop and releases the renderer, textures, and listeners. */
  dispose(): void;
}

/** Fixed-capacity trail buffer: writes in place and only pays for a copy when it wraps, not every frame. */
class OrbitTrail {
  readonly line: THREE.Line;
  private readonly positions: Float32Array;
  private readonly attribute: THREE.BufferAttribute;
  private count = 0;

  constructor(capacity: number) {
    this.positions = new Float32Array(capacity * 3);
    const geometry = new THREE.BufferGeometry();
    this.attribute = new THREE.BufferAttribute(this.positions, 3);
    geometry.setAttribute("position", this.attribute);
    geometry.setDrawRange(0, 0);
    this.line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x808080 }));
  }

  push(position: Vec3): void {
    const capacity = this.positions.length / 3;
    if (this.count >= capacity) {
      const drop = Math.floor(capacity / 4);
      this.positions.copyWithin(0, drop * 3);
      this.count = capacity - drop;
    }
    const i = this.count * 3;
    this.positions[i] = position[0];
    this.positions[i + 1] = position[1];
    this.positions[i + 2] = position[2];
    this.count++;
    this.attribute.needsUpdate = true;
    this.line.geometry.setDrawRange(0, this.count);
  }

  dispose(): void {
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}

interface Body {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  trail: OrbitTrail | null;
}

export interface SceneOptions {
  backgroundTextureUrl: string;
}

export function createSolarSystemScene(canvas: HTMLElement, options: SceneOptions): SolarSystemScene {
  const textureLoader = new THREE.TextureLoader();
  const clock = new THREE.Clock();
  const bodies: Body[] = [];

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  canvas.appendChild(renderer.domElement);

  renderer.domElement.addEventListener("dragstart", (event) => event.preventDefault());

  const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  camera.position.z = 5;
  const controls = new OrbitControls(camera, renderer.domElement);

  const scene = new THREE.Scene();
  textureLoader.load(options.backgroundTextureUrl, (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.environment = texture;
  });

  const sunLight = new THREE.PointLight(0xffffff, 1, 10);
  const ambientLight = new THREE.AmbientLight(0x404040, 5);
  scene.add(ambientLight);

  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  function addBody(spec: PlanetSpec): void {
    const geometry = new THREE.SphereGeometry(spec.radius, 25, 25);
    const texture = textureLoader.load(spec.textureUrl);

    const material = spec.isSun
      ? new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffff00, emissiveMap: texture, emissiveIntensity: 1.2 })
      : new THREE.MeshStandardMaterial({ map: texture });

    const mesh = new THREE.Mesh(geometry, material);
    if (spec.isSun) mesh.add(sunLight);
    scene.add(mesh);

    const trail = spec.isSun ? null : new OrbitTrail(ORBIT_TRAIL_CAPACITY);
    if (trail) scene.add(trail.line);

    bodies.push({ mesh, material, trail });
  }

  function setPositions(updates: readonly BodyUpdate[]): void {
    for (let i = 0; i < updates.length; i++) {
      const body = bodies[i];
      const update = updates[i];
      if (!body || !update) continue;
      body.mesh.position.set(...update.position);
      body.mesh.rotation.y += update.rotationDelta;
      body.trail?.push(update.position);
    }
  }

  function disposeBody(body: Body): void {
    body.mesh.geometry.dispose();
    body.material.map?.dispose();
    body.material.emissiveMap?.dispose();
    body.material.dispose();
    scene.remove(body.mesh);
    if (body.trail) {
      body.trail.dispose();
      scene.remove(body.trail.line);
    }
  }

  function reset(): void {
    for (const body of bodies) disposeBody(body);
    bodies.length = 0;
  }

  function start(onTick: (deltaSeconds: number) => void): void {
    renderer.setAnimationLoop(() => {
      onTick(clock.getDelta());
      controls.update();
      renderer.render(scene, camera);
    });
  }

  function dispose(): void {
    renderer.setAnimationLoop(null);
    window.removeEventListener("resize", resize);
    reset();
    controls.dispose();
    renderer.dispose();
    (scene.background as THREE.Texture | null)?.dispose();
  }

  return { addBody, setPositions, reset, start, dispose };
}
