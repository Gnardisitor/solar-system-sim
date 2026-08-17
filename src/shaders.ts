import * as THREE from "three";

/**
 * Cheap trilinear value-noise + fbm, shared by every procedural shader below.
 * Not simplex-quality, but stable, branch-free, and plenty for stylized
 * plasma/cloud/nebula patterns at the resolution these render at.
 */
const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i + vec3(0.0, 0.0, 0.0)), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amp * vnoise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return value;
}
`;

/** Shared by every material below that shades in world space: world normal + world position. */
const VERTEX_WORLD_GLSL = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vNormalW = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vPosW = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Shared by materials that only need world normal + untransformed local position. */
const VERTEX_LOCAL_GLSL = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosL;
  void main() {
    vNormalW = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vPosL = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Sun: turbulent, self-lit plasma surface (no external light needed). Feeds
// the selective bloom pass directly — no separate corona shell.
// ---------------------------------------------------------------------------

export function createSunSurfaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      colorCore: { value: new THREE.Color(0xfffaea) },
      colorMid: { value: new THREE.Color(0xffcf7a) },
      colorEdge: { value: new THREE.Color(0xe8843a) },
    },
    vertexShader: VERTEX_WORLD_GLSL,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 colorCore;
      uniform vec3 colorMid;
      uniform vec3 colorEdge;
      varying vec3 vNormalW;
      varying vec3 vPosW;

      ${NOISE_GLSL}

      void main() {
        // Direction-based sampling (not raw world position) so the noise
        // frequency is independent of the sun's actual radius in scene units.
        vec3 p = normalize(vPosW) * 16.0;
        vec3 warp = vec3(
          fbm(p * 1.6 + vec3(0.0, 0.0, time * 0.05)),
          fbm(p * 1.6 + vec3(5.2, 1.3, time * 0.045)),
          fbm(p * 1.6 + vec3(1.7, 9.1, time * 0.06))
        );
        float n = fbm(p + warp * 2.2 + vec3(0.0, 0.0, time * 0.08));
        float pattern = clamp(n * n * (3.0 - 2.0 * n), 0.0, 1.0);

        vec3 color = mix(colorEdge, colorMid, smoothstep(0.15, 0.5, pattern));
        color = mix(color, colorCore, smoothstep(0.55, 0.88, pattern));

        vec3 viewDir = normalize(cameraPosition - vPosW);
        float facing = clamp(dot(viewDir, normalize(vNormalW)), 0.0, 1.0);
        float limb = mix(0.6, 1.0, pow(facing, 0.55));

        gl_FragColor = vec4(color * limb, 1.0);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Planet atmosphere: fresnel rim-glow shell, dimmed on the night side.
// ---------------------------------------------------------------------------

export function createAtmosphereMaterial(color: number, intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(color) },
      intensity: { value: intensity },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    vertexShader: VERTEX_WORLD_GLSL,
    fragmentShader: /* glsl */ `
      uniform vec3 glowColor;
      uniform float intensity;
      uniform vec3 sunDirection;
      varying vec3 vNormalW;
      varying vec3 vPosW;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vPosW);
        vec3 n = normalize(vNormalW);
        float fresnel = pow(1.0 - clamp(dot(viewDir, n), 0.0, 1.0), 3.0);
        float lit = clamp(dot(n, sunDirection) * 0.6 + 0.55, 0.0, 1.0);
        float alpha = fresnel * intensity * mix(0.12, 1.0, lit);
        gl_FragColor = vec4(glowColor, alpha);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Procedural cloud shell (Earth-style): drifting fbm coverage, terminator-lit.
// ---------------------------------------------------------------------------

export function createCloudsMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    vertexShader: VERTEX_LOCAL_GLSL,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 sunDirection;
      varying vec3 vNormalW;
      varying vec3 vPosL;

      ${NOISE_GLSL}

      void main() {
        vec3 dir = normalize(vPosL);
        vec3 p = dir * 3.0 + vec3(time * 0.012, 0.0, time * 0.006);

        // Domain-warped fbm: feed fbm's own output back in as a coordinate offset so
        // coverage forms wispy, streaked bands instead of round, evenly-spaced blobs —
        // the same trick that makes the sun's plasma read as turbulent rather than blotchy.
        float warpX = fbm(p * 1.1 + vec3(5.2, 1.3, 0.0));
        float warpY = fbm(p * 1.1 + vec3(1.7, 9.2, 4.4));
        vec3 warped = p + vec3(warpX, warpY, warpX - warpY) * 1.1;

        float base = fbm(warped);
        float fine = fbm(p * 5.5 + vec3(0.0, 0.0, time * 0.02)) * 0.22;
        float n = base + fine;

        float coverage = smoothstep(0.46, 0.72, n);
        float dense = smoothstep(0.74, 1.0, n) * 0.5;
        float thickness = clamp(coverage + dense, 0.0, 1.0);

        float lit = clamp(dot(normalize(vNormalW), sunDirection) * 0.75 + 0.45, 0.05, 1.0);
        vec3 cloudColor = mix(vec3(0.82, 0.85, 0.9), vec3(1.0), dense) * lit;
        gl_FragColor = vec4(cloudColor, thickness * 0.88);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Saturn-style rings: banded radial noise with a soft inner/outer falloff.
// ---------------------------------------------------------------------------

export function createRingMaterial(color: number, innerRadius: number, outerRadius: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ringColor: { value: new THREE.Color(color) },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      innerRadius: { value: innerRadius },
      outerRadius: { value: outerRadius },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: VERTEX_LOCAL_GLSL,
    fragmentShader: /* glsl */ `
      uniform vec3 ringColor;
      uniform vec3 sunDirection;
      uniform float innerRadius;
      uniform float outerRadius;
      varying vec3 vPosL;
      varying vec3 vNormalW;

      ${NOISE_GLSL}

      void main() {
        float radius = length(vPosL.xy);
        float r = clamp((radius - innerRadius) / (outerRadius - innerRadius), 0.0, 1.0);
        float band = fbm(vec3(r * 40.0, 0.0, 0.0));
        float bands2 = fbm(vec3(r * 120.0, 3.0, 0.0));
        float density = mix(band, bands2, 0.4);
        float edgeFade = smoothstep(0.0, 0.08, r) * smoothstep(1.0, 0.94, r);
        float lit = clamp(dot(normalize(vNormalW), sunDirection) * 0.5 + 0.6, 0.15, 1.0);
        float alpha = clamp(density * 1.3 - 0.15, 0.0, 1.0) * edgeFade;
        gl_FragColor = vec4(ringColor * lit, alpha * 0.85);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Background: deep-space nebula backdrop + procedural twinkling starfield.
// ---------------------------------------------------------------------------

export function createNebulaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vPosL;
      void main() {
        vPosL = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float time;
      varying vec3 vPosL;

      ${NOISE_GLSL}

      void main() {
        vec3 p = normalize(vPosL) * 1.6;
        float n = fbm(p * 1.8 + vec3(0.0, 0.0, time * 0.0015));

        // Rich, near-black space: an almost imperceptible dust gradient,
        // not a colorful nebula. Deliberately low-contrast and desaturated.
        vec3 deep = vec3(0.0, 0.0, 0.0);
        vec3 dust = vec3(0.014, 0.014, 0.017);

        vec3 color = mix(deep, dust, smoothstep(0.35, 0.85, n) * 0.6);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

export function createStarfield(count: number, radius: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const tints = new Float32Array(count * 3);

  const tintPalette: readonly [number, number, number][] = [
    [1.0, 1.0, 1.0],
    [0.8, 0.87, 1.0],
    [1.0, 0.93, 0.8],
    [0.85, 0.95, 1.0],
  ];

  for (let i = 0; i < count; i++) {
    const theta = Math.acos(2 * Math.random() - 1);
    const phi = Math.random() * Math.PI * 2;
    const r = radius * (0.8 + Math.random() * 0.2);
    positions[i * 3] = r * Math.sin(theta) * Math.cos(phi);
    positions[i * 3 + 1] = r * Math.cos(theta);
    positions[i * 3 + 2] = r * Math.sin(theta) * Math.sin(phi);

    sizes[i] = Math.random() * Math.random() * 2.2 + 0.4;
    phases[i] = Math.random();

    const tint = tintPalette[(Math.random() * tintPalette.length) | 0] ?? [1, 1, 1];
    tints[i * 3] = tint[0];
    tints[i * 3 + 1] = tint[1];
    tints[i * 3 + 2] = tint[2];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("aTint", new THREE.BufferAttribute(tints, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      attribute vec3 aTint;
      varying vec3 vTint;
      varying float vPhase;
      void main() {
        vTint = aTint;
        vPhase = aPhase;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float time;
      varying vec3 vTint;
      varying float vPhase;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float alpha = smoothstep(0.5, 0.0, d);
        float twinkle = 0.55 + 0.45 * sin(time * 1.6 + vPhase * 6.2831853);
        gl_FragColor = vec4(vTint, alpha * twinkle);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

// ---------------------------------------------------------------------------
// Orbit trail: fixed-capacity ring buffer with a per-vertex age fade so the
// tail dissolves smoothly instead of ending in a hard cut.
// ---------------------------------------------------------------------------

export function createOrbitTrailMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { trailColor: { value: new THREE.Color(color) }, count: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aIndex;
      uniform float count;
      varying float vAge;
      void main() {
        // Each vertex's buffer slot is fixed at creation; age is purely how far along
        // the currently-active [0, count) range that slot sits, recomputed here instead
        // of being rewritten on the CPU every push.
        vAge = count > 0.0 ? (aIndex + 1.0) / count : 0.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 trailColor;
      varying float vAge;
      void main() {
        float alpha = pow(clamp(vAge, 0.0, 1.0), 1.6);
        gl_FragColor = vec4(trailColor * (0.6 + 0.4 * vAge), alpha * 0.9);
      }
    `,
  });
}
