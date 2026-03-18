import { GrammarError } from "../shared/types.js";

interface DomPoint {
  node: Node;
  offset: number;
}

export interface ContentEditableSnapshot {
  text: string;
  points: DomPoint[];
}

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "DL",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
]);

export function getContentEditableText(root: HTMLElement): string {
  return buildContentEditableSnapshot(root).text;
}

export function buildContentEditableSnapshot(root: HTMLElement): ContentEditableSnapshot {
  let text = "";
  const points: DomPoint[] = [];

  const ensureStartPoint = (point: DomPoint) => {
    if (points.length === 0) {
      points.push(point);
    }
  };

  const appendChar = (char: string, afterPoint: DomPoint, beforePoint: DomPoint) => {
    ensureStartPoint(beforePoint);
    text += char;
    points.push(afterPoint);
  };

  const appendTextNode = (node: Text) => {
    const value = node.textContent || "";
    if (!value) return;

    ensureStartPoint({ node, offset: 0 });
    for (let i = 0; i < value.length; i++) {
      text += value[i];
      points.push({ node, offset: i + 1 });
    }
  };

  const appendBreakAfterNode = (node: Node) => {
    const parent = node.parentNode;
    if (!parent) return;
    const childIndex = Array.prototype.indexOf.call(parent.childNodes, node);
    const beforePoint = { node: parent, offset: childIndex };
    const afterPoint = { node: parent, offset: childIndex + 1 };
    appendChar("\n", afterPoint, beforePoint);
  };

  const appendBreakBeforeNode = (node: Node) => {
    const parent = node.parentNode;
    if (!parent) return;
    const childIndex = Array.prototype.indexOf.call(parent.childNodes, node);
    const point = { node: parent, offset: childIndex };
    appendChar("\n", point, point);
  };

  const shouldSkipElement = (element: Element) => {
    if (element instanceof HTMLScriptElement || element instanceof HTMLStyleElement) {
      return true;
    }
    if (element instanceof HTMLElement && element.getAttribute("aria-hidden") === "true") {
      return true;
    }
    return false;
  };

  const hasRenderableContent = (node: Node): boolean => {
    if (node instanceof Text) {
      return (node.textContent || "").length > 0;
    }
    if (!(node instanceof Element) || shouldSkipElement(node)) {
      return false;
    }
    if (node.tagName === "BR") {
      return true;
    }
    for (const child of Array.from(node.childNodes)) {
      if (hasRenderableContent(child)) {
        return true;
      }
    }
    return false;
  };

  const hasNextRenderableSibling = (node: Node): boolean => {
    let sibling = node.nextSibling;
    while (sibling) {
      if (hasRenderableContent(sibling)) {
        return true;
      }
      sibling = sibling.nextSibling;
    }
    return false;
  };

  const visit = (node: Node) => {
    if (node instanceof Text) {
      appendTextNode(node);
      return;
    }

    if (!(node instanceof Element) || shouldSkipElement(node)) {
      return;
    }

    if (node.tagName === "BR") {
      appendBreakAfterNode(node);
      return;
    }

    const isBlock = node !== root && BLOCK_TAGS.has(node.tagName);
    const startLength = text.length;

    for (const child of Array.from(node.childNodes)) {
      const childIsBlock = child instanceof Element && child !== root && BLOCK_TAGS.has(child.tagName);
      if (childIsBlock && text.length > startLength && !text.endsWith("\n") && hasRenderableContent(child)) {
        appendBreakBeforeNode(child);
      }
      visit(child);
    }

    if (isBlock && text.length > startLength && hasNextRenderableSibling(node) && !text.endsWith("\n")) {
      appendBreakAfterNode(node);
    }
  };

  visit(root);

  if (points.length === 0) {
    points.push({ node: root, offset: root.childNodes.length });
  }

  return { text, points };
}

export function resolveContentEditableErrorOffset(
  snapshot: ContentEditableSnapshot,
  error: GrammarError
): number {
  if (error.offset >= 0) {
    if (error.length === 0) {
      if (error.offset <= snapshot.text.length) {
        return error.offset;
      }
    } else if (
      error.offset + error.original.length <= snapshot.text.length &&
      snapshot.text.substring(error.offset, error.offset + error.original.length) === error.original
    ) {
      return error.offset;
    }
  }

  if (error.length === 0) {
    return Math.min(Math.max(error.offset, 0), snapshot.text.length);
  }

  return snapshot.text.indexOf(error.original);
}

export function getContentEditableRangeForError(
  root: HTMLElement,
  error: GrammarError,
  snapshot: ContentEditableSnapshot = buildContentEditableSnapshot(root)
): Range | null {
  const offset = resolveContentEditableErrorOffset(snapshot, error);
  if (offset < 0) return null;
  return getContentEditableRange(snapshot, offset, error.length);
}

export function getContentEditableRange(
  snapshot: ContentEditableSnapshot,
  offset: number,
  length: number
): Range | null {
  const start = snapshot.points[offset];
  const end = snapshot.points[offset + length];

  if (!start || !end) return null;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}
