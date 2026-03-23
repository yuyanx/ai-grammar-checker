import { CONTENT_CSS } from "./content-css.js";

let shadowRoot: ShadowRoot | null = null;
let shadowHost: HTMLElement | null = null;

export function getShadowRoot(): ShadowRoot {
  if (shadowRoot && shadowHost?.isConnected) return shadowRoot;

  if (shadowHost && !shadowHost.isConnected) {
    shadowHost = null;
    shadowRoot = null;
  }

  removeStaleHosts();

  const host = document.createElement("div");
  host.id = "ai-grammar-checker-host";
  host.style.cssText = "position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none; overflow: visible;";
  document.body.appendChild(host);

  shadowRoot = host.attachShadow({ mode: "closed" });
  shadowHost = host;

  const style = document.createElement("style");
  style.textContent = CONTENT_CSS;
  shadowRoot.appendChild(style);

  return shadowRoot;
}

export function getShadowHost(): HTMLElement | null {
  return shadowHost;
}

export function getOrCreateContainer(id: string): HTMLElement {
  const root = getShadowRoot();
  let container = root.getElementById(id);
  if (!container) {
    container = document.createElement("div");
    container.id = id;
    root.appendChild(container);
  }
  return container;
}

function removeStaleHosts(): void {
  const staleHosts = document.querySelectorAll<HTMLElement>("#ai-grammar-checker-host");
  staleHosts.forEach((host) => host.remove());
}
