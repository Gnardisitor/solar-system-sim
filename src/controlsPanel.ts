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
  const panel = requireElement<HTMLDivElement>("controls");
  const dockCollapsible = requireElement<HTMLDivElement>("dock-collapsible");
  const dockCollapsibleInner = dockCollapsible.querySelector<HTMLDivElement>(".dock-collapsible-inner");
  const collapseBtn = requireElement<HTMLButtonElement>("collapse-btn");
  const collapseDown = collapseBtn.querySelector<SVGElement>(".icon-caret-down");
  const collapseUp = collapseBtn.querySelector<SVGElement>(".icon-caret-up");
  const methodGroup = requireElement<HTMLDivElement>("method-group");
  const methodIndicator = methodGroup.querySelector<HTMLSpanElement>(".method-indicator");
  const methodButtons = Array.from(methodGroup.querySelectorAll<HTMLButtonElement>(".method-btn"));
  const yearInput = requireElement<HTMLInputElement>("yearInput");
  const setYearBtn = requireElement<HTMLButtonElement>("setYear");
  const yearError = requireElement<HTMLParagraphElement>("yearError");
  const yearMin = Number(yearInput.min);
  const yearMax = Number(yearInput.max);
  const stepSlider = requireElement<HTMLInputElement>("step");
  const stepText = requireElement<HTMLSpanElement>("stepText");
  const stepTimeSlider = requireElement<HTMLInputElement>("stepTime");
  const stepTimeText = requireElement<HTMLSpanElement>("stepTimeText");
  const dateText = requireElement<HTMLParagraphElement>("dateText");
  const runBtn = requireElement<HTMLButtonElement>("run");
  const runPlayIcon = runBtn.querySelector<SVGElement>(".icon-play");
  const runPauseIcon = runBtn.querySelector<SVGElement>(".icon-pause");

  const initialMethodBtn = methodButtons.find((btn) => btn.getAttribute("aria-checked") === "true");
  let method: SimulationMethod =
    initialMethodBtn && isSimulationMethod(initialMethodBtn.dataset["method"] ?? "")
      ? (initialMethodBtn.dataset["method"] as SimulationMethod)
      : "euler";
  let stepDays = Number(stepSlider.value);
  let updateIntervalSeconds = Number(stepTimeSlider.value);
  let isRunning = false;

  stepText.textContent = `${stepDays} d`;
  stepTimeText.textContent = `${updateIntervalSeconds} s`;

  // Mobile starts collapsed to a playback-only pill. No animation: this sets the
  // initial resting state before first paint, not a toggle.
  if (window.matchMedia("(max-width: 640px)").matches) {
    panel.classList.add("collapsed");
    collapseBtn.title = "Expand";
    collapseBtn.setAttribute("aria-label", "Expand controls");
    collapseDown?.classList.add("icon-hidden");
    collapseUp?.classList.remove("icon-hidden");
  }

  function moveIndicatorTo(btn: HTMLButtonElement): void {
    if (!methodIndicator) return;
    methodIndicator.style.left = `${btn.offsetLeft}px`;
    methodIndicator.style.width = `${btn.offsetWidth}px`;
  }

  if (initialMethodBtn) moveIndicatorTo(initialMethodBtn);
  // Reposition once the real font loads, in case the fallback measured differently.
  document.fonts?.ready.then(() => {
    if (initialMethodBtn) moveIndicatorTo(initialMethodBtn);
  });
  window.addEventListener("resize", () => {
    const checked = methodButtons.find((btn) => btn.getAttribute("aria-checked") === "true");
    if (checked) moveIndicatorTo(checked);
    if (yearError.classList.contains("visible")) positionYearError();
  });

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  for (const btn of methodButtons) {
    btn.addEventListener("click", () => {
      const value = btn.dataset["method"] ?? "";
      if (!isSimulationMethod(value)) return;
      method = value;
      for (const other of methodButtons) other.setAttribute("aria-checked", String(other === btn));
      moveIndicatorTo(btn);
      // Confirmation pop on the picked label. Curve matches --ease-out (WAAPI can't
      // read CSS custom properties, so it's copied here).
      if (!reduceMotion) {
        btn.animate([{ transform: "scale(0.94)" }, { transform: "scale(1)" }], {
          duration: 180,
          easing: "cubic-bezier(0.23, 1, 0.32, 1)",
        });
      }
    });
  }

  stepSlider.oninput = () => {
    stepDays = Number(stepSlider.value);
    stepText.textContent = `${stepDays} d`;
  };

  stepTimeSlider.oninput = () => {
    updateIntervalSeconds = Number(stepTimeSlider.value);
    stepTimeText.textContent = `${updateIntervalSeconds} s`;
  };

  runBtn.onclick = () => {
    isRunning = !isRunning;
    runBtn.title = isRunning ? "Pause" : "Play";
    runBtn.setAttribute("aria-label", runBtn.title);
    runPlayIcon?.classList.toggle("icon-hidden", isRunning);
    runPauseIcon?.classList.toggle("icon-hidden", !isRunning);
  };

  // #yearError lives outside #controls (see index.html) so .dock-collapsible's
  // overflow: hidden can't clip it; position it here from #yearInput's real screen rect.
  function positionYearError(): void {
    const inputRect = yearInput.getBoundingClientRect();
    const errorRect = yearError.getBoundingClientRect();
    const idealLeft = inputRect.left + inputRect.width / 2 - errorRect.width / 2;
    const clampedLeft = Math.min(Math.max(idealLeft, 8), window.innerWidth - errorRect.width - 8);
    yearError.style.left = `${clampedLeft}px`;
    yearError.style.top = `${inputRect.top - errorRect.height - 10}px`;
  }

  let yearErrorTimeout: ReturnType<typeof setTimeout> | undefined;

  function showYearError(message: string): void {
    yearError.textContent = message;
    positionYearError();
    yearError.classList.add("visible");
    yearInput.setAttribute("aria-invalid", "true");
    clearTimeout(yearErrorTimeout);
    yearErrorTimeout = setTimeout(clearYearError, 4000);
  }

  function clearYearError(): void {
    clearTimeout(yearErrorTimeout);
    yearError.classList.remove("visible");
    yearInput.removeAttribute("aria-invalid");
  }

  // Clear on input, not just on a successful Set, so the warning doesn't linger.
  yearInput.addEventListener("input", clearYearError);

  setYearBtn.onclick = () => {
    const year = Number(yearInput.value);
    if (!yearInput.value.trim() || Number.isNaN(year)) {
      showYearError("Enter a year to jump to.");
      return;
    }
    if (year < yearMin || year > yearMax) {
      showYearError(`Enter a year between ${yearMin} and ${yearMax}.`);
      return;
    }
    clearYearError();
    callbacks.onYearChange(year);
  };

  collapseBtn.addEventListener("click", () => {
    // FLIP: animate between the real rendered sizes before and after the toggle.
    // A scrollWidth guess breaks on narrow viewports, since that size still depends
    // on flex negotiation with the collapse state being measured.
    if (dockCollapsibleInner && !reduceMotion) {
      for (const existing of dockCollapsible.getAnimations()) existing.cancel();
      dockCollapsible.style.maxWidth = "";
      dockCollapsible.style.maxHeight = "";

      const before = dockCollapsible.getBoundingClientRect();
      panel.classList.toggle("collapsed");
      // Force layout to settle into the new state before reading it.
      void dockCollapsible.offsetHeight;
      const after = dockCollapsible.getBoundingClientRect();

      // A backdrop-filter blur recomputing against a resizing region is janky.
      // Swap to a flat background for the animation, restore blur at rest.
      panel.classList.add("dock-collapsing");
      const anim = dockCollapsible.animate(
        [
          { maxWidth: `${before.width}px`, maxHeight: `${before.height}px` },
          { maxWidth: `${after.width}px`, maxHeight: `${after.height}px` },
        ],
        { duration: 300, easing: "cubic-bezier(0.77, 0, 0.175, 1)", fill: "forwards" },
      );
      anim.addEventListener("finish", () => {
        dockCollapsible.style.maxWidth = "";
        dockCollapsible.style.maxHeight = "";
        panel.classList.remove("dock-collapsing");
      });
    } else {
      panel.classList.toggle("collapsed");
    }

    const collapsed = panel.classList.contains("collapsed");
    collapseBtn.title = collapsed ? "Expand" : "Collapse";
    collapseBtn.setAttribute("aria-label", collapsed ? "Expand controls" : "Collapse controls");
    collapseDown?.classList.toggle("icon-hidden", collapsed);
    collapseUp?.classList.toggle("icon-hidden", !collapsed);
    // The year field just collapsed away, so there's nothing left for the warning to point at.
    if (collapsed) clearYearError();
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
