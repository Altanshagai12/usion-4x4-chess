import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the 4x4 chess home screen", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>4×4 Chess: Last Man Stand<\/title>/i);
  assert.match(html, /4×4 CHESS/);
  assert.match(html, /LAST MAN STAND/);
  // Server render is the pre-SDK state, so the out-of-host fallback shows.
  // Self-play is never offered as the in-Usions path.
  assert.match(html, /PRACTICE ON THIS DEVICE/);
  assert.doesNotMatch(html, /LOCAL DEMO/);
  assert.match(html, /HOW TO PLAY/);
  assert.match(html, /https:\/\/usions\.com\/usion-sdk\.js/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
