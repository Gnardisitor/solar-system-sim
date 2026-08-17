import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { Vec3 } from "./physics";
import {
  BLOOM_LAYER,
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
  textureUrl: string;
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
  private readonly positions: Float32Array;
  private readonly ages: Float32Array;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly ageAttr: THREE.BufferAttribute;
  private readonly capacity: number;
  private count = 0;

  constructor(capacity: number, color: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.ages = new Float32Array(capacity);
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.positions, 3);
    this.ageAttr = new THREE.BufferAttribute(this.ages, 1);
    geometry.setAttribute("position", this.positionAttr);
    geometry.setAttribute("aAge", this.ageAttr);
    geometry.setDrawRange(0, 0);
    this.line = new THREE.Line(geometry, createOrbitTrailMaterial(color));
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

    for (let k = 0; k < this.count; k++) this.ages[k] = (k + 1) / this.count;

    this.positionAttr.needsUpdate = true;
    this.ageAttr.needsUpdate = true;
    this.line.geometry.setDrawRange(0, this.count);
  }

  dispose(): void {
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
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

  const starfield = createStarfield(STAR_COUNT, BACKDROP_RADIUS * 0.9);
  scene.add(starfield);
  timeUniformMaterials.push(starfield.material as THREE.ShaderMaterial);

  // decay: 0 (no falloff) is deliberate — with real inverse-square falloff, Neptune at
  // ~30 AU would be ~5600x dimmer than Mercury at ~0.4 AU and vanish entirely. A modest
  // flat intensity keeps every planet visibly lit without blowing out the inner ones.
  const sunLight = new THREE.PointLight(0xfff2d0, 1.3, 0, 0);
  const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
  scene.add(ambientLight);

  // Selective bloom: the sun renders on BLOOM_LAYER. Every frame, everything
  // else is swapped to a black material, rendered through a dedicated bloom
  // composer, restored, then the real scene is rendered and the bloom result
  // is additively mixed on top.
  const bloomLayer = new THREE.Layers();
  bloomLayer.set(BLOOM_LAYER);
  const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const darkPointsMaterial = new THREE.PointsMaterial({ color: 0x000000, size: 0 });
  const darkLineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
  const materialCache = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>();

  function darkenNonBloomed(obj: THREE.Object3D): void {
    const withMaterial = obj as THREE.Object3D & { material?: THREE.Material | THREE.Material[]; isPoints?: boolean; isLine?: boolean };
    if (!withMaterial.material || bloomLayer.test(obj.layers)) return;
    materialCache.set(obj, withMaterial.material);
    withMaterial.material = withMaterial.isPoints ? darkPointsMaterial : withMaterial.isLine ? darkLineMaterial : darkMaterial;
  }

  function restoreMaterial(obj: THREE.Object3D): void {
    const cached = materialCache.get(obj);
    if (!cached) return;
    (obj as THREE.Object3D & { material: THREE.Material | THREE.Material[] }).material = cached;
    materialCache.delete(obj);
  }

  function sizeVector(): THREE.Vector2 {
    return new THREE.Vector2(canvas.clientWidth, canvas.clientHeight);
  }

  const renderScene = new RenderPass(scene, camera);

  const bloomPass = new UnrealBloomPass(sizeVector(), 0.75, 0.35, 0.0);
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
      mesh.layers.enable(BLOOM_LAYER);
      mesh.add(sunLight);
      timeUniformMaterials.push(sunMaterial);
    } else {
      const texture = textureLoader.load(spec.textureUrl);
      material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, metalness: 0.0 });
      mesh = new THREE.Mesh(geometry, material);
    }
    scene.add(mesh);

    let atmosphere: Shell | null = null;
    if (spec.atmosphere) {
      const atmosphereMaterial = createAtmosphereMaterial(spec.atmosphere.color, spec.atmosphere.intensity ?? 1);
      const atmosphereMesh = new THREE.Mesh(new THREE.SphereGeometry(spec.radius * 1.02, 40, 40), atmosphereMaterial);
      scene.add(atmosphereMesh);
      atmosphere = { mesh: atmosphereMesh, material: atmosphereMaterial };
      sunFacingMaterials.push(atmosphereMaterial);
    }

    let clouds: Shell | null = null;
    if (spec.clouds) {
      const cloudsMaterial = createCloudsMaterial();
      const cloudsMesh = new THREE.Mesh(new THREE.SphereGeometry(spec.radius * 1.012, 48, 48), cloudsMaterial);
      scene.add(cloudsMesh);
      clouds = { mesh: cloudsMesh, material: cloudsMaterial };
      sunFacingMaterials.push(cloudsMaterial);
      timeUniformMaterials.push(cloudsMaterial);
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
    }

    const trail = spec.isSun ? null : new OrbitTrail(ORBIT_TRAIL_CAPACITY, spec.trailColor ?? 0xffffff);
    if (trail) scene.add(trail.line);

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
    // Sun/clouds materials get re-pushed by addBody; drop stale refs to sun-owned ones.
    timeUniformMaterials.length = 2; // nebula + starfield, added once at scene creation
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

      scene.traverse(darkenNonBloomed);
      bloomComposer.render();
      scene.traverse(restoreMaterial);
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
