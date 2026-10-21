import { describe, expect, it } from "vitest";
import { expandSelfClosingTags } from "../src/epubStylesheetInliner";

describe("expandSelfClosingTags", () => {
  it("expands non-void self-closing tags that HTML parsing would leave open", () => {
    expect(expandSelfClosingTags('<p>a</p><a id="page_3"/><p>b</p>')).toBe(
      '<p>a</p><a id="page_3"></a><p>b</p>'
    );
    expect(expandSelfClosingTags('<span id="x"/><em/>')).toBe(
      '<span id="x"></span><em></em>'
    );
    expect(expandSelfClosingTags('<a name="page_4" />')).toBe('<a name="page_4"></a>');
    expect(expandSelfClosingTags('<xhtml:a id="p5"/>')).toBe('<xhtml:a id="p5"></xhtml:a>');
  });

  it("keeps void tags, real anchors and quoted slashes untouched", () => {
    expect(expandSelfClosingTags('<a href="ch2.xhtml">next</a>')).toBe(
      '<a href="ch2.xhtml">next</a>'
    );
    expect(expandSelfClosingTags('<br/><img src="a.png"/><hr/>')).toBe(
      '<br/><img src="a.png"/><hr/>'
    );
    expect(expandSelfClosingTags('<span title="a/>b"/>')).toBe('<span title="a/>b"></span>');
  });

  it("does not rewrite style, textarea or comment contents", () => {
    expect(expandSelfClosingTags("<style>a{content:'<b/>'}</style><i/>")).toBe(
      "<style>a{content:'<b/>'}</style><i></i>"
    );
    expect(expandSelfClosingTags("<!-- <u/> --><u/>")).toBe("<!-- <u/> --><u></u>");
  });
});
