// Import Three.js
import * as THREE from "three"
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js"

// Import Emscripten module
import createModule from "./nbody.js"   // The Emscripten module is compiled from nbody.c

// Create variables for the Emscripten module functions
let initBody;           // Takes id, mass, x, y, z, vx, vy, vz, returns nothing
let simulateStep;       // Takes method (0: Euler, 1: Verlet, 2: RK4), and step size, returns nothing
let getX, getY, getZ;   // Takes id, returns x, y, z
let free;               // Frees all memory allocated by the Emscripten module 

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const masses = [1.989E30, 3.301E23, 4.868E24, 5.972E24, 6.417E23, 1.898E27, 5.683E26, 8.681E25, 1.024E26]

// Controls
const sliderStep = document.getElementById("step");
const sliderStepTime = document.getElementById("stepTime");
const runCheck = document.getElementById("run");

// Text
const stepText = document.getElementById("stepText");
const stepTimeText = document.getElementById("stepTimeText");
const runCheckText = document.getElementById("runText");
let running = false;

const clock = new THREE.Clock();
let update = 0.025;
let max = 10000;
let meshes = [];
let step = 0.5;
let currentStep = 0;
let time = 0;
const method = 2;

// Initialize inputs
stepText.innerHTML = `${step} day/step`;
stepTimeText.innerHTML = `${update} seconds between steps`;
if (runCheck.checked) {
    runCheckText.innerHTML = "Running";
    running = true;
} else {
    runCheckText.innerHTML = "Paused";
    running = false;
}


sliderStep.oninput = function() {
    step = this.value;
    stepText.innerHTML = `${step} day/step`;
}

sliderStepTime.oninput = function() {
    update = this.value;
    stepTimeText.innerHTML = `${update} seconds between steps`;
}

runCheck.onchange = () => {
    if (runCheck.checked) {
        runCheckText.innerHTML = "Running";
        running = true;
    } else {
        runCheckText.innerHTML = "Paused";
        running = false;
    }
}

const ambientLight = new THREE.AmbientLight(0x404040, 10);
scene.add(ambientLight);

await createModule().then((Module) => {
    initBody = Module.cwrap('init_body', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']);
    simulateStep = Module.cwrap('simulate_step', null, ['number', 'number']);
    getX = Module.cwrap('get_x', 'number', ['number']);
    getY = Module.cwrap('get_y', 'number', ['number']);
    getZ = Module.cwrap('get_z', 'number', ['number']);
    free = Module.cwrap('free_all', null, []);
});
await initBodies(2000);

const canvas = document.getElementById("canvas");
const renderer = new THREE.WebGLRenderer();
//renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setSize(canvas.clientWidth, canvas.clientHeight);
renderer.setAnimationLoop(animate);
canvas.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
camera.position.z = 5;

async function parseData(id, year) {
    const proxy = "https://proxy.corsfix.com/?";
    //const proxy =  "http://localhost:3000/jpl?url=";
    const url = `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='${id}'&CENTER='@0'&CSV_FORMAT='YES'&EPHEM_TYPE='VECTOR'&VEC_TABLE='2'&OUT_UNITS='AU-D'&START_TIME='${year}-01-01'&STOP_TIME='${year}-01-02'&STEP_SIZE='2%20d'`
    const start = "$$SOE";
    const end = "$$EOE";

    //const response = await fetch(proxy + encodeURIComponent(url));
    const response = await fetch(proxy + url);
    const data = await response.text();

    let vecData = data.split(start)[1];
    vecData = vecData.split(end)[0];
    vecData = vecData.split(",");

    let pos = vecData.slice(2, 5).map(e => scientificNotation(e));
    let vel = vecData.slice(5, 8).map(e => scientificNotation(e));
    return [pos, vel];
}

function scientificNotation(num) {
    const nums = num.trim().split("E");
    return Number(nums[0]) * 10 ** Number(nums[1]);
}

async function batchFetch(ids, year, batchSize) {
    const results = [];
    for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(id => parseData(id, year)));
        results.push(...batchResults);
    }
    return results;
}

async function initBodies(year) {
    const ids = [10, 199, 299, 399, 499, 599, 699, 799, 899];
    const colors = [0xffff00, 0x666699, 0x993333, 0x0099ff, 0xcc3300, 0x996600, 0xffcc99, 0x99ccff, 0x6666ff]
    const geometry = new THREE.SphereGeometry(0.2, 10, 10);

    const vectors = await batchFetch(ids, year, 2);
    for (let i = 0; i < ids.length; i++) {
        meshes.push(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color: colors[i]})));
        const vec = vectors[i];
        console.log(vec);
        scene.add(meshes[i]);
        meshes[i].position.set(...vec[0]);

        // Initialize the body in the C module
        initBody(i, masses[i], vec[0][0], vec[0][1], vec[0][2], vec[1][0], vec[1][1], vec[1][2]);
    }
}

function simulate() {
    simulateStep(method, step);
    console.log(`Moved to step ${currentStep}!`);
    for (let i = 0; i < meshes.length; i++) {
        const x = getX(i);
        const y = getY(i);
        const z = getZ(i);
        console.log(`Body ${i} new position: (${x}, ${y}, ${z})`);
        meshes[i].position.set(x, y, z);
    }
}

function animate() {
    if (running) {
        time += clock.getDelta();
        if (time >= update && currentStep < max) {
            currentStep++;
            simulate();
            time = 0;
        }
        else if (currentStep >= max) {
            free();  // Free memory if max steps reached
            console.log("Reached max number of steps!");
        }
    }

    controls.update();
    renderer.render(scene, camera);
}
