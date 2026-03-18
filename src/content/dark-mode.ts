/**
 * Detect whether the current page uses a dark color scheme.
 * Checks both the CSS media query and the page's actual background luminance.
 */
export function isDarkMode(): boolean {
  // 1. Check CSS media query
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return true;
  }

  // 2. Sample the page background color
  try {
    const bg = window.getComputedStyle(document.body).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)") {
      const luminance = parseLuminance(bg);
      if (luminance !== null && luminance < 0.4) {
        return true;
      }
    }

    // Also check <html> element
    const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
    if (htmlBg && htmlBg !== "rgba(0, 0, 0, 0)") {
      const luminance = parseLuminance(htmlBg);
      if (luminance !== null && luminance < 0.4) {
        return true;
      }
    }
  } catch {
    // Ignore — can't access computed style in some edge cases
  }

  return false;
}

/**
 * Parse an rgb/rgba color string and return its relative luminance (0=black, 1=white).
 */
function parseLuminance(color: string): number | null {
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;

  const r = parseInt(match[1]) / 255;
  const g = parseInt(match[2]) / 255;
  const b = parseInt(match[3]) / 255;

  // Perceived brightness (ITU-R BT.709)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
