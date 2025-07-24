// Import Three.js
import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";

// Import Emscripten module
import createModule from "./nbody.js";

// Create constants for Emscripten functions
let initBody;           // Initialize a body in the simulation
let simulateStep;       // Simulate one step and update positions
let getX, getY, getZ;   // Get position of body depending on id
let free;               // Free all arrays if allocated 

// Get base URL for assets
const base = import.meta.env.BASE_URL;

// Make collapse button functional
const collapseBtn = document.getElementById("collapse-btn");
collapseBtn.addEventListener("click", () => {
    controlsDiv.classList.toggle("collapsed");
    // Change button icon
    collapseBtn.innerHTML = controlsDiv.classList.contains("collapsed") ? "&#x25BC;" : "&#x25B2;";
    collapseBtn.title = controlsDiv.classList.contains("collapsed") ? "Expand" : "Collapse";
});

// Make drawer draggable
const controlsDiv = document.getElementById("controls");
const dragBar = document.getElementById("controls-drag-handle");
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

dragBar.addEventListener("mousedown", function(e) {
    isDragging = true;
    dragOffsetX = e.clientX - controlsDiv.getBoundingClientRect().left;
    dragOffsetY = e.clientY - controlsDiv.getBoundingClientRect().top;
    controlsDiv.style.transition = "none";
    document.body.style.userSelect = "none";
});

document.addEventListener("mousemove", function(e) {
    if (isDragging) {
        let left = e.clientX - dragOffsetX;
        let top = e.clientY - dragOffsetY;
        left = Math.max(0, Math.min(window.innerWidth - controlsDiv.offsetWidth, left));
        top = Math.max(0, Math.min(window.innerHeight - controlsDiv.offsetHeight, top));
        controlsDiv.style.left = left + "px";
        controlsDiv.style.top = top + "px";
        controlsDiv.style.right = "auto";
        controlsDiv.style.transform = "none";
        controlsDiv.style.position = "fixed";
    }
});

document.addEventListener("mouseup", function() {
    if (isDragging) {
        isDragging = false;
        controlsDiv.style.transition = "";
        document.body.style.userSelect = "";
    }
});

// Constants for planetary bodies
const names = ["sun", "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];
const masses = [1.989E30, 3.301E23, 4.868E24, 5.972E24, 6.417E23, 1.898E27, 5.683E26, 8.681E25, 1.024E26];
const vectors = await fetch(`${base}api.json`).then(response => response.json());
const sizes = [0.22, 0.07, 0.15, 0.16, 0.08, 0.20, 0.19, 0.30, 0.30]    // Scaled sizes for Three.js

// Control elements
const methodSelect = document.getElementById("method");
const sliderStep = document.getElementById("step");
const sliderStepTime = document.getElementById("stepTime");
const runCheck = document.getElementById("run");
const yearInput = document.getElementById("yearInput");
const setYear = document.getElementById("setYear");

// Text elements
const stepText = document.getElementById("stepText");
const stepTimeText = document.getElementById("stepTimeText");
const dateText = document.getElementById("dateText");
const runIcon = document.getElementById("runIcon");

// Date variables
let wantedYear = yearInput.value;
let dayText = "01";
let monthText = "01";
let yearText = wantedYear.toString();
const date = new Date(`01-01-${wantedYear}`);

// Simulation variables
const methodDict = {"euler": 0, "verlet": 1, "rk4": 2};
let method = methodDict[methodSelect.value];
let update = sliderStepTime.value;
let step = sliderStep.value;
let isLoaded = false;
let running = false;
let time = 0;

// Initialize text
stepText.innerHTML = `${step} days/step`;
stepTimeText.innerHTML = `${update} sec/step`;
dateText.innerHTML = `${dayText}-${monthText}-${yearText} UTC`;

/* Update functions for controls */

methodSelect.onchange = function() {
    method = methodDict[this.value];
}

setYear.onclick = async function() {
    // Reset simulation
    isLoaded = false;
    meshes.forEach(mesh => scene.remove(mesh));
    meshes = [];
    free();

    // Set new year and update date text
    wantedYear = yearInput.value;
    dayText = "01";
    monthText = "01";
    yearText = wantedYear.toString();
    date.setUTCFullYear(wantedYear, 0, 1); // Set date to January 1st of the wanted year
    dateText.innerHTML = `${dayText}-${monthText}-${yearText} UTC`;

    // Reinitialize bodies
    await initBodies(wantedYear);
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
    if (running) runIcon.src = `${base}/icons/pause.svg`;
    else runIcon.src = `${base}/icons/play.svg`;
}

// Three.js variables
const canvas = document.getElementById("canvas");
const textureLoader = new THREE.TextureLoader();
const clock = new THREE.Clock();
let meshes = [];

// Setup renderer
const renderer = new THREE.WebGLRenderer();
renderer.setSize(canvas.clientWidth, canvas.clientHeight);
canvas.appendChild(renderer.domElement);
renderer.setAnimationLoop(animate);

// Prevent default drag behavior on the canvas (fixes bug on new Firfox version)
renderer.domElement.addEventListener('dragstart', (event) => {
    event.preventDefault();
});

// Setup camera and controls
const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
camera.position.z = 5;

// Setup scene and background
const scene = new THREE.Scene();
textureLoader.load(`${base}/textures/stars.jpg`, (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.environment = texture;
});
const ambientLight = new THREE.AmbientLight(0x404040, 10);
scene.add(ambientLight);

// Add resize function
window.addEventListener("resize", () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
});

// Initialize Emscripten functions
await createModule().then((Module) => {
    initBody = Module.cwrap('init_body', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']);
    simulateStep = Module.cwrap('simulate_step', null, ['number', 'number']);
    getX = Module.cwrap('get_x', 'number', ['number']);
    getY = Module.cwrap('get_y', 'number', ['number']);
    getZ = Module.cwrap('get_z', 'number', ['number']);
    free = Module.cwrap('free_all', null, []);
});

// Initialize bodies and begin simulation
await initBodies(wantedYear);

async function initBodies(year) {
    const currentVectors = vectors[year];

    for (let i = 0; i < 9; i++) {
        const geometry = new THREE.SphereGeometry(sizes[i], 25, 25);
        const texture = textureLoader.load(`${base}/textures/${names[i]}.jpg`);
        let material;

        // Texture loading and mesh creation, add point light for the sun
        if (i === 0) {
            material = new THREE.MeshStandardMaterial({
                map: texture,
                emissive: 0xffff00,
                emissiveMap: texture,
                emissiveIntensity: 2
            });
            const pointLight = new THREE.PointLight(0xffffff, 1, 10);
            meshes.push(new THREE.Mesh(geometry, material));
            meshes[0].add(pointLight);
        } else {
            material = new THREE.MeshStandardMaterial({ map: texture });
            meshes.push(new THREE.Mesh(geometry, material));
        }

        // Since Three.js uses a different coordinate system than the usual scientific coordinate system like
        // matlab and matplotlib, the coordinates need to be adjusted from (x, y, z) to (x, z, y)
        const vector = currentVectors[i];
        scene.add(meshes[i]);
        meshes[i].position.set(vector[0], vector[2], vector[1]);

        // Initialize the body in the C module
        initBody(i, masses[i], vector[0], vector[2], vector[1], vector[3], vector[5], vector[4]);
    }
    isLoaded = true;
}

function simulate() {
    simulateStep(method, step);
    for (let i = 0; i < meshes.length; i++) {
        const x = getX(i);
        const y = getY(i);
        const z = getZ(i);
        meshes[i].position.set(x, y, z);
    }

    // Update the date
    date.setTime(date.getTime() + (step * 86400 * 1000));           // Convert step from days to milliseconds
    dayText = String(date.getUTCDate()).padStart(2, '0');
    monthText = String(date.getUTCMonth() + 1).padStart(2, '0');    // Months are 0-indexed in JavaScript
    yearText = date.getUTCFullYear().toString();
    dateText.innerHTML = `${dayText}-${monthText}-${yearText} UTC`;
}

function animate() {
    // Make sure the simulation is running and loaded before updating
    if (running && isLoaded) {
        time += clock.getDelta();
        if (time >= update) {
            simulate();
            time = 0;
        }
    }

    // Update camera and controls
    controls.update();
    renderer.render(scene, camera);
}
