// Import Three.js
import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";

// Import Emscripten module
import createModule from "./nbody.js";   // The Emscripten module is compiled from nbody.c

// Create variables for the Emscripten module functions
let initBody;           // Takes id, mass, x, y, z, vx, vy, vz, returns nothing
let simulateStep;       // Takes method (0: Euler, 1: Verlet, 2: RK4), and step size, returns nothing
let getX, getY, getZ;   // Takes id, returns x, y, z
let free;               // Frees all memory allocated by the Emscripten module 

const masses = [1.989E30, 3.301E23, 4.868E24, 5.972E24, 6.417E23, 1.898E27, 5.683E26, 8.681E25, 1.024E26];

// Controls
const sliderStep = document.getElementById("step");
const sliderStepTime = document.getElementById("stepTime");
const runCheck = document.getElementById("run");

// Text
const stepText = document.getElementById("stepText");
const stepTimeText = document.getElementById("stepTimeText");
const runIcon = document.getElementById("runIcon");
let running = false;

// Initialize date
const yearInput = document.getElementById("yearInput");
const setYear = document.getElementById("setYear");

let wantedYear = yearInput.value;
let dayText = "01";
let monthText = "01";
let yearText = wantedYear.toString();
const date = new Date(`01-01-${wantedYear}`);
const dateText = document.getElementById("dateText");
dateText.innerHTML = `${dayText}-${monthText}-${yearText} UTC`;

const clock = new THREE.Clock();
let update = 0.025;
let meshes = [];
let step = 0.5;
let currentStep = 0;
let time = 0;
const methodDict = {"euler": 0, "verlet": 1, "rk4": 2};
const methodSelect = document.getElementById("method");
let method = methodDict[methodSelect.value];

// Initialize inputs
stepText.innerHTML = `${step} days/step`;
stepTimeText.innerHTML = `${update} sec/step`;
running = false;

methodSelect.onchange = function() {
    method = methodDict[this.value];
}

sliderStep.oninput = function() {
    step = this.value;
    stepText.innerHTML = `${step} day/step`;
}

sliderStepTime.oninput = function() {
    update = this.value;
    stepTimeText.innerHTML = `${update} sec/step`;
}

runCheck.onclick = () => {
    running = !running;
    if (running) {
        runIcon.src = "/icons/pause.svg";
    }
    else {
        runIcon.src = "/icons/play.svg";
    }
}

const canvas = document.getElementById("canvas");
const renderer = new THREE.WebGLRenderer();
renderer.setSize(canvas.clientWidth, canvas.clientHeight);
renderer.setAnimationLoop(animate);
canvas.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
camera.position.z = 5;

const textureLoader = new THREE.TextureLoader();
textureLoader.load('/textures/stars.jpg', (texture) => {
    const image = texture.image;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;

    const context = canvas.getContext('2d');
    context.filter = 'brightness(20%)'; 
    context.drawImage(image, 0, 0);

    const darkTexture = new THREE.CanvasTexture(canvas);
    darkTexture.mapping = THREE.EquirectangularReflectionMapping;
    
    scene.background = darkTexture;
    scene.environment = darkTexture;
});

const ambientLight = new THREE.AmbientLight(0x404040, 10);
scene.add(ambientLight);

window.addEventListener("resize", () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
});

// Make sure everything is loaded before starting the simulation
let isLoaded = false;
await createModule().then((Module) => {
    initBody = Module.cwrap('init_body', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']);
    simulateStep = Module.cwrap('simulate_step', null, ['number', 'number']);
    getX = Module.cwrap('get_x', 'number', ['number']);
    getY = Module.cwrap('get_y', 'number', ['number']);
    getZ = Module.cwrap('get_z', 'number', ['number']);
    free = Module.cwrap('free_all', null, []);
});
await initBodies(wantedYear);

setYear.onclick = async function() {
    isLoaded = false;
    free(); // Free the memory allocated by the Emscripten module
    wantedYear = yearInput.value;
    meshes.forEach(mesh => scene.remove(mesh));
    meshes = [];
    dayText = "01";
    monthText = "01";
    yearText = wantedYear.toString();
    date.setUTCFullYear(wantedYear, 0, 1); // Set date to January 1st of the wanted year
    dateText.innerHTML = `${dayText}-${monthText}-${yearText} UTC`;
    await initBodies(wantedYear);
}

async function initBodies(year) {
    const names = ["sun", "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];

    // These are based on the real values, but modified to fit the simulation scale, therefore not accurate
    const diameters = [13914, 4879, 12104, 12756, 6792, 14290, 12050, 25110, 24520];
    const sizes = diameters.map(diameter => diameter / 149600);

    const response = await fetch("/api.json");
    const data = await response.json();
    const vectors = data[year];

    for (let i = 0; i < 9; i++) {
        const geometry = new THREE.SphereGeometry(sizes[i], 25, 25);
        const texture = textureLoader.load(`/textures/${names[i]}.jpg`);
        let material;
        if (i === 0) {  // Sun
            material = new THREE.MeshStandardMaterial({
                map: texture,
                emissive: 0xffff00,
                emissiveMap: texture,
                emissiveIntensity: 2
            });
            const pointLight = new THREE.PointLight(0xffffff, 1, 10);
            meshes.push(new THREE.Mesh(geometry, material));
            meshes[0].add(pointLight);
        } else {        // Planets
            material = new THREE.MeshStandardMaterial({ map: texture });
            meshes.push(new THREE.Mesh(geometry, material));
        }
        const vec = vectors[i];
        //console.log(vec);
        scene.add(meshes[i]);
        // Since Three.js uses a different coordinate system than the usual scientific coordinate system like
        // matlab and matplotlib, the coordinates need to be adjusted from (x, y, z) to (x, z, y).
        meshes[i].position.set(vec[0], vec[2], vec[1]);

        // Initialize the body in the C module
        initBody(i, masses[i], vec[0], vec[2], vec[1], vec[3], vec[5], vec[4]);
    }
    isLoaded = true;
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

    // Update the date
    date.setTime(date.getTime() + (step * 86400 * 1000)); // Convert step from days to milliseconds
    dayText = String(date.getUTCDate()).padStart(2, '0');
    monthText = String(date.getUTCMonth() + 1).padStart(2, '0'); // Months are 0-indexed in JavaScript
    yearText = date.getUTCFullYear().toString();
    dateText.innerHTML = `${dayText}-${monthText}-${yearText} UTC`;
}

function animate() {
    if (running && isLoaded) {
        time += clock.getDelta();
        if (time >= update) {
            currentStep++;
            simulate();
            time = 0;
        }
    }

    controls.update();
    renderer.render(scene, camera);
}
