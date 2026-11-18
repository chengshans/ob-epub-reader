import { describe, expect, it } from "vitest";
import {
  expandSelfClosingTags,
  injectScriptBlockingCsp,
  prepareSectionHtmlForSpine,
} from "../src/epubStylesheetInliner";

const CSP_META = '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'">';

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

describe("injectScriptBlockingCsp", () => {
  it("injects the CSP meta as the first child of an existing head", () => {
    const html = "<html><head><title>t</title></head><body><p>a</p></body></html>";
    expect(injectScriptBlockingCsp(html)).toBe(
      `<html><head>${CSP_META}<title>t</title></head><body><p>a</p></body></html>`
    );
  });

  it("matches head tags with attributes and mixed case, but not <header>", () => {
    const html = '<HTML><HEAD profile="x"><title>t</title></HEAD></HTML>';
    expect(injectScriptBlockingCsp(html).startsWith(`<HTML><HEAD profile="x">${CSP_META}`)).toBe(
      true
    );
    const headerHtml = "<header>nav</header><p>a</p>";
    expect(injectScriptBlockingCsp(headerHtml)).toBe(`${CSP_META}<header>nav</header><p>a</p>`);
  });

  it("creates a head after <html> when the document lacks one", () => {
    const html = "<html><body><p>a</p></body></html>";
    expect(injectScriptBlockingCsp(html)).toBe(
      `<html><head>${CSP_META}</head><body><p>a</p></body></html>`
    );
  });

  it("prepends to headless fragments (parser hoists meta into implicit head)", () => {
    expect(injectScriptBlockingCsp("<p>a</p>")).toBe(`${CSP_META}<p>a</p>`);
  });

  it("does not duplicate its own meta on repeated serialization", () => {
    const once = injectScriptBlockingCsp("<p>a</p>");
    expect(injectScriptBlockingCsp(once)).toBe(once);
  });

  it("still injects when the book ships its own CSP meta (metas intersect)", () => {
    const html =
      '<html><head><meta http-equiv="Content-Security-Policy" content="style-src \'self\'"></head><body></body></html>';
    expect(injectScriptBlockingCsp(html).startsWith(`<html><head>${CSP_META}`)).toBe(true);
  });
});

describe("prepareSectionHtmlForSpine", () => {
  it("injects the script-blocking CSP into serialized chapter output", async () => {
    const out = await prepareSectionHtmlForSpine(
      "<html><head><title>t</title></head><body><p>a</p></body></html>"
    );
    expect(out).toContain(CSP_META);
  });
});
