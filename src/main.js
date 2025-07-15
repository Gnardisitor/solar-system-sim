import * as THREE from "three"
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js"

import createModule from "./nbody.js"
let init_body;
let verlet;
let get_x;
let get_y;
let get_z;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const clock = new THREE.Clock();
const update = 0.05;
let max = 10000;
let meshes;
let step = 0;
let time = 0;

const ambientLight = new THREE.AmbientLight(0x404040, 10);
scene.add(ambientLight);

await createModule().then((Module) => {
    init_body = Module.cwrap('init_body', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number']);
    verlet = Module.cwrap('verlet', null, ['number']);
    get_x = Module.cwrap('get_x', 'number', ['number']);
    get_y = Module.cwrap('get_y', 'number', ['number']);
    get_z = Module.cwrap('get_z', 'number', ['number']);
});
await initBodies(2000);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(animate);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
camera.position.z = 5;

async function parseData(id, year) {
    const proxy = "https://proxy.corsfix.com/?";
    const start = "$$SOE";
    const end = "$$EOE";

    const response = await fetch(`${proxy}https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='${id}'&CENTER='@0'&CSV_FORMAT='YES'&EPHEM_TYPE='VECTOR'&VEC_TABLE='2'&OUT_UNITS='AU-D'&START_TIME='${year}-01-01'&STOP_TIME='${year}-01-02'&STEP_SIZE='2%20d'`);
    const data = await response.text();

    let vectors = data.split(start)[1];
    vectors = vectors.split(end)[0];
    vectors = vectors.split(",");

    let pos = vectors.slice(2, 5).map(e => scientificNotation(e));
    let vel = vectors.slice(5, 8).map(e => scientificNotation(e));
    return [pos, vel];
}

function scientificNotation(num) {
    const nums = num.trim().split("E");
    return Number(nums[0]) * 10 ** Number(nums[1]);
}

async function initBodies(year) {
    const ids = [10, 199, 299, 399, 499, 599, 699, 799, 899];
    const colors = [0xffff00, 0x666699, 0x993333, 0x0099ff, 0xcc3300, 0x996600, 0xffcc99, 0x99ccff, 0x6666ff]

    const geometry = new THREE.SphereGeometry(0.2, 10, 10);

    meshes = []
    console.log(meshes);

    for (let i = 0; i < ids.length; i++) {
        meshes.push(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color: colors[i]})));
        const vec = await parseData(ids[i], year);
        console.log(vec);
        scene.add(meshes[i]);
        meshes[i].position.set(...vec[0]);

        // Initialize the body in the C module
        init_body(i, vec[0][0], vec[0][1], vec[0][2], vec[1][0], vec[1][1], vec[1][2]);
    }
}

function simulate(step) {
    verlet(step);
    console.log(`Moved to step ${step}!`);
    for (let i = 0; i < meshes.length; i++) {
        let x, y, z;
        x = get_x(i);
        y = get_y(i);
        z = get_z(i);
        console.log(`Body ${i} new position: (${x}, ${y}, ${z})`);
        meshes[i].position.set(x, y, z);
    }
}

function animate() {
    time += clock.getDelta();
    if (time >= update && step < max) {
        simulate(++step);
        time = 0;
    }
    else if (step >= max) {
        console.log("Reached max number of steps!");
    }

    controls.update();
    renderer.render(scene, camera);
}
