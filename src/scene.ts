import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { Vec3 } from "./physics";
import {
  createAtmosphereMaterial,
  createCloudsMaterial,
  createNebulaMaterial,
  createOrbitTrailMaterial,
  createRingMaterial,
  createStarfield,
  createSunSurfaceMaterial,
} from "./shaders";

const ORBIT_TRAIL_CAPACITY = 3000;
const MAX_PIXEL_RATIO = 2;
const BACKDROP_RADIUS = 220;
const STAR_COUNT = 7000;

export interface RingSpec {
  innerScale: number;
  outerScale: number;
  color: number;
}

export interface AtmosphereSpec {
  color: number;
  intensity?: number;
}

export interface PlanetSpec {
  name: string;
  radius: number;
  /** Required unless isSun — the sun's surface is fully procedural and never samples a texture. */
  textureUrl?: string;
  rotationSpeed: number;
  isSun?: boolean;
  /** Rim-glow atmosphere shell; omit for airless bodies. */
  atmosphere?: AtmosphereSpec;
  /** Procedural drifting cloud shell. */
  clouds?: boolean;
  rings?: RingSpec;
  /** Orbit trail color; ignored for the sun. */
  trailColor?: number;
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
  /** One update per body added so far, in addBody order. First body is treated as the light source (the sun). */
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
  private readonly material: THREE.ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly capacity: number;
  private count = 0;

  constructor(capacity: number, color: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    // aIndex is each vertex's fixed buffer slot (0..capacity-1), uploaded once and never
    // touched again. Age is (aIndex + 1) / count, computed in the vertex shader against the
    // `count` uniform below — so a push only ever costs one uniform write, not an O(count)
    // CPU rewrite of a per-vertex age array.
    const indices = new Float32Array(capacity);
    for (let k = 0; k < capacity; k++) indices[k] = k;
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.positions, 3);
    geometry.setAttribute("position", this.positionAttr);
    geometry.setAttribute("aIndex", new THREE.BufferAttribute(indices, 1));
    geometry.setDrawRange(0, 0);
    this.material = createOrbitTrailMaterial(color);
    this.line = new THREE.Line(geometry, this.material);
  }

  push(position: Vec3): void {
    if (this.count >= this.capacity) {
      const drop = Math.floor(this.capacity / 4);
      this.positions.copyWithin(0, drop * 3);
      this.count = this.capacity - drop;
    }
    const i = this.count * 3;
    this.positions[i] = position[0];
    this.positions[i + 1] = position[1];
    this.positions[i + 2] = position[2];
    this.count++;

    this.material.uniforms["count"]!.value = this.count;
    this.positionAttr.needsUpdate = true;
    this.line.geometry.setDrawRange(0, this.count);
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.material.dispose();
  }
}

interface Shell {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

interface Body {
  mesh: THREE.Mesh;
  material: THREE.Material;
  trail: OrbitTrail | null;
  atmosphere: Shell | null;
  clouds: Shell | null;
  ring: Shell | null;
}

export function createSolarSystemScene(canvas: HTMLElement): SolarSystemScene {
  const textureLoader = new THREE.TextureLoader();
  const clock = new THREE.Clock();
  const bodies: Body[] = [];
  const timeUniformMaterials: THREE.ShaderMaterial[] = [];
  const sunFacingMaterials: THREE.ShaderMaterial[] = [];
  type Darkenable = THREE.Mesh | THREE.Points | THREE.Line;
  const nonBloomObjects: Darkenable[] = [];

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  canvas.appendChild(renderer.domElement);

  renderer.domElement.addEventListener("dragstart", (event) => event.preventDefault());

  const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  camera.position.z = 5;
  const controls = new OrbitControls(camera, renderer.domElement);

  const scene = new THREE.Scene();

  const nebulaMaterial = createNebulaMaterial();
  const nebula = new THREE.Mesh(new THREE.SphereGeometry(BACKDROP_RADIUS, 48, 32), nebulaMaterial);
  scene.add(nebula);
  timeUniformMaterials.push(nebulaMaterial);
  nonBloomObjects.push(nebula);

  const starfield = createStarfield(STAR_COUNT, BACKDROP_RADIUS * 0.9);
  scene.add(starfield);
  timeUniformMaterials.push(starfield.material as THREE.ShaderMaterial);
  nonBloomObjects.push(starfield);

  // decay: 0 (no falloff) is deliberate — with real inverse-square falloff, Neptune at
  // ~30 AU would be ~5600x dimmer than Mercury at ~0.4 AU and vanish entirely. A modest
  // flat intensity keeps every planet visibly lit without blowing out the inner ones.
  const sunLight = new THREE.PointLight(0xfff2d0, 1.3, 0, 0);
  const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
  scene.add(ambientLight);

  // Selective bloom: only the sun should glow. The bloom composer still has to
  // render every other object (darkened to flat black) rather than just skip them,
  // so they keep occluding the sun in the bloom pass's depth buffer too — otherwise
  // the sun's glow would shine straight through any planet in front of it. This
  // walks a flat list built as bodies are added instead of scene.traverse(), since
  // the scene graph only ever holds a handful of objects that need darkening.
  const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const darkPointsMaterial = new THREE.PointsMaterial({ color: 0x000000, size: 0 });
  const darkLineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
  const materialCache = new Map<Darkenable, THREE.Material | THREE.Material[]>();

  function darkenNonBloomed(): void {
    for (const obj of nonBloomObjects) {
      materialCache.set(obj, obj.material);
      obj.material = (obj as THREE.Points).isPoints ? darkPointsMaterial : (obj as THREE.Line).isLine ? darkLineMaterial : darkMaterial;
    }
  }

  function restoreMaterial(): void {
    for (const obj of nonBloomObjects) {
      const cached = materialCache.get(obj);
      if (cached) obj.material = cached;
    }
    materialCache.clear();
  }

  function sizeVector(): THREE.Vector2 {
    return new THREE.Vector2(canvas.clientWidth, canvas.clientHeight);
  }

  const renderScene = new RenderPass(scene, camera);

  const bloomPass = new UnrealBloomPass(sizeVector(), 0.5, 0.35, 0.0);
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(renderScene);
  bloomComposer.addPass(bloomPass);

  const mixPass = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: {
        baseTexture: { value: null },
        bloomTexture: { value: bloomComposer.renderTarget2.texture },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D baseTexture;
        uniform sampler2D bloomTexture;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(baseTexture, vUv) + vec4(1.0) * texture2D(bloomTexture, vUv);
        }
      `,
    }),
    "baseTexture",
  );
  mixPass.needsSwap = true;

  const outputPass = new OutputPass();
  const finalComposer = new EffectComposer(renderer);
  finalComposer.addPass(renderScene);
  finalComposer.addPass(mixPass);
  finalComposer.addPass(outputPass);

  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    bloomComposer.setSize(width, height);
    finalComposer.setSize(width, height);
    bloomPass.setSize(width, height);
  }
  window.addEventListener("resize", resize);

  function addBody(spec: PlanetSpec): void {
    const geometry = new THREE.SphereGeometry(spec.radius, 48, 48);

    let mesh: THREE.Mesh;
    let material: THREE.Material;

    if (spec.isSun) {
      const sunMaterial = createSunSurfaceMaterial();
      material = sunMaterial;
      mesh = new THREE.Mesh(geometry, material);
      mesh.add(sunLight);
      timeUniformMaterials.push(sunMaterial);
    } else {
      if (!spec.textureUrl) throw new Error(`Missing textureUrl for body "${spec.name}"`);
      const texture = textureLoader.load(spec.textureUrl);
      material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, metalness: 0.0 });
      mesh = new THREE.Mesh(geometry, material);
      nonBloomObjects.push(mesh);
    }
    scene.add(mesh);

    let atmosphere: Shell | null = null;
    if (spec.atmosphere) {
      const atmosphereMaterial = createAtmosphereMaterial(spec.atmosphere.color, spec.atmosphere.intensity ?? 1);
      const atmosphereMesh = new THREE.Mesh(new THREE.SphereGeometry(spec.radius * 1.02, 40, 40), atmosphereMaterial);
      scene.add(atmosphereMesh);
      atmosphere = { mesh: atmosphereMesh, material: atmosphereMaterial };
      sunFacingMaterials.push(atmosphereMaterial);
      nonBloomObjects.push(atmosphereMesh);
    }

    let clouds: Shell | null = null;
    if (spec.clouds) {
      const cloudsMaterial = createCloudsMaterial();
      const cloudsMesh = new THREE.Mesh(new THREE.SphereGeometry(spec.radius * 1.012, 48, 48), cloudsMaterial);
      scene.add(cloudsMesh);
      clouds = { mesh: cloudsMesh, material: cloudsMaterial };
      sunFacingMaterials.push(cloudsMaterial);
      timeUniformMaterials.push(cloudsMaterial);
      nonBloomObjects.push(cloudsMesh);
    }

    let ring: Shell | null = null;
    if (spec.rings) {
      const inner = spec.radius * spec.rings.innerScale;
      const outer = spec.radius * spec.rings.outerScale;
      const ringMaterial = createRingMaterial(spec.rings.color, inner, outer);
      const ringMesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 128, 8), ringMaterial);
      ringMesh.rotation.x = Math.PI / 2 - 0.47;
      scene.add(ringMesh);
      ring = { mesh: ringMesh, material: ringMaterial };
      sunFacingMaterials.push(ringMaterial);
      nonBloomObjects.push(ringMesh);
    }

    const trail = spec.isSun ? null : new OrbitTrail(ORBIT_TRAIL_CAPACITY, spec.trailColor ?? 0xffffff);
    if (trail) {
      scene.add(trail.line);
      nonBloomObjects.push(trail.line);
    }

    bodies.push({ mesh, material, trail, atmosphere, clouds, ring });
  }

  const sunToPlanet = new THREE.Vector3();

  function setPositions(updates: readonly BodyUpdate[]): void {
    const sunPosition = updates[0]?.position;

    for (let i = 0; i < updates.length; i++) {
      const body = bodies[i];
      const update = updates[i];
      if (!body || !update) continue;

      body.mesh.position.set(...update.position);
      body.mesh.rotation.y += update.rotationDelta;
      body.trail?.push(update.position);

      if (body.atmosphere) body.atmosphere.mesh.position.copy(body.mesh.position);
      if (body.clouds) {
        body.clouds.mesh.position.copy(body.mesh.position);
        body.clouds.mesh.rotation.y += update.rotationDelta * 1.15;
      }
      if (body.ring) body.ring.mesh.position.copy(body.mesh.position);

      if (sunPosition && (body.atmosphere || body.clouds || body.ring)) {
        sunToPlanet.set(sunPosition[0] - update.position[0], sunPosition[1] - update.position[1], sunPosition[2] - update.position[2]);
        if (sunToPlanet.lengthSq() > 0) sunToPlanet.normalize();
        for (const shell of [body.atmosphere, body.clouds, body.ring]) {
          shell?.material.uniforms["sunDirection"]?.value.copy(sunToPlanet);
        }
      }
    }
  }

  function disposeShell(shell: Shell | null): void {
    if (!shell) return;
    shell.mesh.geometry.dispose();
    shell.material.dispose();
    scene.remove(shell.mesh);
  }

  function disposeBody(body: Body): void {
    body.mesh.geometry.dispose();
    if (body.material instanceof THREE.MeshStandardMaterial) body.material.map?.dispose();
    body.material.dispose();
    scene.remove(body.mesh);
    disposeShell(body.atmosphere);
    disposeShell(body.clouds);
    disposeShell(body.ring);
    if (body.trail) {
      body.trail.dispose();
      scene.remove(body.trail.line);
    }
  }

  function reset(): void {
    for (const body of bodies) disposeBody(body);
    bodies.length = 0;
    sunFacingMaterials.length = 0;
    // Sun/clouds materials and darkenable meshes get re-pushed by addBody; drop stale
    // refs to body-owned ones, keeping only what's added once at scene creation.
    timeUniformMaterials.length = 2; // nebula + starfield
    nonBloomObjects.length = 2; // nebula + starfield
  }

  function start(onTick: (deltaSeconds: number) => void): void {
    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();
      onTick(delta);
      controls.update();

      // The backdrop is meant to read as infinitely distant, so it must never show
      // parallax as the camera orbits — keep it centered on the camera every frame,
      // the standard skybox trick, rather than fixed at the world origin.
      nebula.position.copy(camera.position);
      starfield.position.copy(camera.position);

      for (const material of timeUniformMaterials) {
        const time = material.uniforms["time"];
        if (time) time.value = elapsed;
      }

      darkenNonBloomed();
      bloomComposer.render();
      restoreMaterial();
      finalComposer.render();
    });
  }

  function dispose(): void {
    renderer.setAnimationLoop(null);
    window.removeEventListener("resize", resize);
    reset();
    scene.remove(nebula, starfield);
    nebula.geometry.dispose();
    nebulaMaterial.dispose();
    starfield.geometry.dispose();
    (starfield.material as THREE.Material).dispose();
    controls.dispose();
    bloomComposer.dispose();
    finalComposer.dispose();
    darkMaterial.dispose();
    darkPointsMaterial.dispose();
    darkLineMaterial.dispose();
    renderer.dispose();
  }

  return { addBody, setPositions, reset, start, dispose };
}
