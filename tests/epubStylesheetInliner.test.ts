import { describe, expect, it } from "vitest";
import { expandSelfClosingAnchors } from "../src/epubStylesheetInliner";

describe("expandSelfClosingAnchors", () => {
  it("expands empty self-closing anchors that HTML parsing would leave open", () => {
    expect(expandSelfClosingAnchors('<p>a</p><a id="page_3"/><p>b</p>')).toBe(
      '<p>a</p><a id="page_3"></a><p>b</p>'
    );
    expect(expandSelfClosingAnchors('<a name="page_4" />')).toBe('<a name="page_4"></a>');
    expect(expandSelfClosingAnchors('<xhtml:a id="p5"/>')).toBe('<xhtml:a id="p5"></xhtml:a>');
  });

  it("keeps real anchors and other self-closing tags untouched", () => {
    expect(expandSelfClosingAnchors('<a href="ch2.xhtml">next</a>')).toBe(
      '<a href="ch2.xhtml">next</a>'
    );
    expect(expandSelfClosingAnchors('<abbr title="x"/>')).toBe('<abbr title="x"/>');
    expect(expandSelfClosingAnchors('<br/><img src="a.png"/>')).toBe('<br/><img src="a.png"/>');
  });
});
