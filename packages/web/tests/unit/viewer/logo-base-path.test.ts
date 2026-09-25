// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { NdxLogoPng, ProductLogoPng } from "../../../src/viewer/components/logos.js";
import { updateFavicon } from "../../../src/viewer/components/favicon.js";
import { setBasePathForTests } from "../../../src/viewer/base-path.js";

afterEach(() => setBasePathForTests(null));

describe("logos behind the hub", () => {
  it("prefix product and n-dx logos with the /p/<id> base path", () => {
    setBasePathForTests("/p/caos");
    expect((ProductLogoPng({ product: "rex" }) as { props: { src: string } }).props.src).toBe("/p/caos/Rex-F.png");
    expect((ProductLogoPng({ product: "sourcevision" }) as { props: { src: string } }).props.src).toBe("/p/caos/SourceVision-F.png");
    expect((NdxLogoPng({}) as { props: { src: string } }).props.src).toBe("/p/caos/n-dx.png");
  });

  it("stay root-relative when served standalone", () => {
    setBasePathForTests("");
    expect((ProductLogoPng({ product: "hench" }) as { props: { src: string } }).props.src).toBe("/Hench-F.png");
  });

  it("prefix the product favicon", () => {
    setBasePathForTests("/p/caos");
    updateFavicon("prd");
    const link = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
    expect(link.getAttribute("href")).toBe("/p/caos/Rex-F.png");
  });
});
