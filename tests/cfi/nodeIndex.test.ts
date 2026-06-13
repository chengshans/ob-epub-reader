import { describe, expect, it } from "vitest";
import { nodeForEpubjsStep, positionForEpubjs } from "../../src/cfi/nodeIndex";

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("positionForEpubjs mixed content", () => {
  it("counts text before first element as text chunk index 0", () => {
    const d = doc("<html><body>Hello<p>World</p></body></html>");
    const body = d.body;
    const hello = body.firstChild as Text;
    const pos = positionForEpubjs(hello);
    expect(pos).toEqual({ type: "text", index: 0 });
  });

  it("counts first element as element index 0", () => {
    const d = doc("<html><body>Hello<p>World</p></body></html>");
    const p = d.querySelector("p")!;
    expect(positionForEpubjs(p)).toEqual({ type: "element", index: 0 });
  });

  it("resolves text chunk back to first text node", () => {
    const d = doc("<html><body>Hello<p>World</p></body></html>");
    const body = d.body;
    const node = nodeForEpubjsStep(body, "text", 0);
    expect(node?.nodeType).toBe(Node.TEXT_NODE);
    expect(node?.textContent).toBe("Hello");
  });
});
