import { describe, expect, it } from "vitest";
import { createElement, isValidElement, type ReactElement } from "react";
import { rich } from "./rich-text";

const children = (nodes: ReturnType<typeof rich>) =>
  nodes.map((n) => (isValidElement(n) ? (n as ReactElement<{ children: unknown }>).props.children : n));

describe("rich", () => {
  it("slots nodes where the translation puts them", () => {
    const strong = createElement("strong", null, "x");
    const out = children(rich("Öffne die Seite {{page}} jetzt", { page: strong }));
    expect(out).toEqual(["Öffne die Seite ", strong, " jetzt"]);
  });

  it("leaves an unknown slot visible rather than dropping text", () => {
    expect(children(rich("a {{nope}} b", {}))).toEqual(["a ", "{{nope}}", " b"]);
  });

  it("returns the plain string when there are no slots", () => {
    expect(children(rich("plain", { x: "y" }))).toEqual(["plain"]);
  });
});
