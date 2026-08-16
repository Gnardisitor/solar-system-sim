import type { SimulationMethod } from "./physics";

const METHODS: readonly SimulationMethod[] = ["euler", "verlet", "rk4"];

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element`);
  return el as T;
}

function isSimulationMethod(value: string): value is SimulationMethod {
  return (METHODS as readonly string[]).includes(value);
}

export interface ControlsPanel {
  readonly initialYear: number;
  readonly method: SimulationMethod;
  readonly stepDays: number;
  readonly updateIntervalSeconds: number;
  readonly isRunning: boolean;
  setDateText(text: string): void;
}

export interface ControlsPanelCallbacks {
  onYearChange: (year: number) => void;
}

export function createControlsPanel(callbacks: ControlsPanelCallbacks): ControlsPanel {
  const base = import.meta.env.BASE_URL;

  const panel = requireElement<HTMLDivElement>("controls");
  const dragHandle = requireElement<HTMLDivElement>("controls-drag-handle");
  const collapseBtn = requireElement<HTMLButtonElement>("collapse-btn");
  const methodSelect = requireElement<HTMLSelectElement>("method");
  const yearInput = requireElement<HTMLInputElement>("yearInput");
  const setYearBtn = requireElement<HTMLButtonElement>("setYear");
  const stepSlider = requireElement<HTMLInputElement>("step");
  const stepText = requireElement<HTMLLabelElement>("stepText");
  const stepTimeSlider = requireElement<HTMLInputElement>("stepTime");
  const stepTimeText = requireElement<HTMLLabelElement>("stepTimeText");
  const dateText = requireElement<HTMLParagraphElement>("dateText");
  const runCheck = requireElement<HTMLButtonElement>("run");
  const runIcon = requireElement<HTMLImageElement>("runIcon");

  let method: SimulationMethod = isSimulationMethod(methodSelect.value) ? methodSelect.value : "euler";
  let stepDays = Number(stepSlider.value);
  let updateIntervalSeconds = Number(stepTimeSlider.value);
  let isRunning = false;

  stepText.textContent = `${stepDays} days/step`;
  stepTimeText.textContent = `${updateIntervalSeconds} sec/step`;

  methodSelect.onchange = () => {
    if (isSimulationMethod(methodSelect.value)) method = methodSelect.value;
  };

  stepSlider.oninput = () => {
    stepDays = Number(stepSlider.value);
    stepText.textContent = `${stepDays} days/step`;
  };

  stepTimeSlider.oninput = () => {
    updateIntervalSeconds = Number(stepTimeSlider.value);
    stepTimeText.textContent = `${updateIntervalSeconds} sec/step`;
  };

  runCheck.onclick = () => {
    isRunning = !isRunning;
    runIcon.src = isRunning ? `${base}icons/pause.svg` : `${base}icons/play.svg`;
  };

  setYearBtn.onclick = () => {
    callbacks.onYearChange(Number(yearInput.value));
  };

  collapseBtn.addEventListener("click", () => {
    panel.classList.toggle("collapsed");
    const collapsed = panel.classList.contains("collapsed");
    collapseBtn.textContent = collapsed ? "+" : "-";
    collapseBtn.title = collapsed ? "Expand" : "Collapse";
  });

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  dragHandle.addEventListener("mousedown", (event) => {
    isDragging = true;
    dragOffsetX = event.clientX - panel.getBoundingClientRect().left;
    dragOffsetY = event.clientY - panel.getBoundingClientRect().top;
    panel.style.transition = "none";
    document.body.style.userSelect = "none";
  });

  dragHandle.addEventListener("dragstart", (event) => event.preventDefault());

  document.addEventListener("mousemove", (event) => {
    if (!isDragging) return;
    let left = event.clientX - dragOffsetX;
    let top = event.clientY - dragOffsetY;
    left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, left));
    top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, top));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = "auto";
    panel.style.transform = "none";
    panel.style.position = "fixed";
  });

  document.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;
    panel.style.transition = "";
    document.body.style.userSelect = "";
  });

  window.addEventListener("resize", () => {
    if (panel.style.position !== "fixed") return;
    let left = parseInt(panel.style.left, 10) || 0;
    let top = parseInt(panel.style.top, 10) || 0;
    left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, left));
    top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, top));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  });

  return {
    initialYear: Number(yearInput.value),
    get method() {
      return method;
    },
    get stepDays() {
      return stepDays;
    },
    get updateIntervalSeconds() {
      return updateIntervalSeconds;
    },
    get isRunning() {
      return isRunning;
    },
    setDateText(text: string) {
      dateText.textContent = text;
    },
  };
}
