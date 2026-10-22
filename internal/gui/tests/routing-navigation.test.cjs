const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");
const assets = path.resolve(__dirname, "../assets");
const now = new Date().toISOString();
const seat = { id: "relay#primary", provider: "relay", name: "Relay", who: "primary", kind: "key", model: "test-model" };
const request = { id: 1, seq: 1, time: now, agent: "codex", model: "test-model", provider: "relay", done: true, status: 200, ms: 900, tokens: 1200,
  order: [seat], tries: [{ id: seat.id, model: seat.model, start: now, done: true, status: 200, ms: 900 }],
  prompt: { window: 128000, tokens: 1000, counted: true, turns: 1, parts: [{ kind: "system", tokens: 1000, items: [{ name: "prompt", tokens: 1000 }] }] } };
const labels = { en: ["Routing view", "Accounts and keys", "Routing groups"], zh: ["视图", "账号与密钥", "路由组"], "zh-TW": ["檢視", "帳號與金鑰", "路由群組"], ja: ["ビュー", "アカウントとキー", "ルーティンググループ"], de: ["Ansicht", "Konten und Schlüssel", "Routing-Gruppen"] };
async function setup(t, engine, lang, width, empty = false) {
  const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width, height: 760 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", async route => {
    const u = new URL(route.request().url());
    const json = data => route.fulfill({ json: data });
    if (u.pathname === "/boot.js") return route.fulfill({ contentType: "text/javascript", body: `window.bootPrefs={lang:${JSON.stringify(lang)},theme:"light",web:true};` });
    if (u.pathname === "/wails/runtime.js") return route.fulfill({ contentType: "text/javascript", body: "export const Window={};" });
    if (u.pathname === "/api/state") return json({ agents: [{ id: "codex", name: "Codex", path: "/test/config", fields: [] }], profiles: [], settings: { lang, theme: "light" } });
    if (u.pathname === "/api/gateway/trace") { if (u.searchParams.has("wait")) return; return json({ mine: true, now, seq: 1, totals: { requests: empty ? 0 : 1, errors: 0, rerouted: 0 }, routes: empty ? [] : [request] }); }
    if (u.pathname === "/api/gateway/history") return json({ cut: false, days: [], routes: [] });
    if (u.pathname === "/api/groups") return json({ models: [{ id: "relay/test-model", name: "test-model", providerName: "Relay", icon: "generic" }], groups: [], pools: [{ provider: "relay", name: "Relay", icon: "generic", kind: "key", who: ["primary", "backup"], routing: "", affinity: "" }] });
    if (u.pathname === "/api/providers") return json({ providers: [], presets: [], excluded: [], gateway: { running: true, window: true } });
    if (u.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, u.pathname === "/" ? "index.html" : u.pathname);
    return route.fulfill({ body: await fs.readFile(file), contentType: { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)] });
  });
  await page.goto("http://magpie.test/?view=routing");
  await page.waitForFunction(() => document.querySelector(".rt-inspector"));
  return { page, errors };
}
for (const engine of process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"]) {
  for (const lang of Object.keys(labels)) for (const width of [420, 1280]) {
    test(`${engine} ${lang} ${width}: routing submenus and floating diagnostics`, async t => {
      const { page, errors } = await setup(t, engine, lang, width);
      await page.waitForFunction(() => document.querySelector(".rt-req"));
      const tab = id => page.locator(width >= 1024 ? `.nav-s[data-of="rtTab${id}"]` : `#rtTab${id}`);
      assert.equal((await tab("View").innerText()).trim(), labels[lang][0]);
      assert.equal((await tab("Accounts").innerText()).trim(), labels[lang][1]);
      assert.equal(await page.locator(".rt-inspector").isHidden(), true);
      assert.equal(await page.locator(".rt-gsec").isHidden(), true);
      await page.locator('[data-panel="requests"]').click();
      await page.locator(".rt-req").click();
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".rt-inspector").isHidden(), true);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.panel), "requests");
      assert.equal(await page.locator("#rt > .rt-log .rt-steps").isVisible(), true);
      assert.match(await page.locator(".rt-steps").innerText(), /primary/);
      assert.equal(await page.locator('[data-panel="log"]').count(), 0);
      await page.evaluate(() => window.openRoute(1, new Date().toISOString()));
      assert.equal(await page.locator(".rt-inspector").isHidden(), true);
      await page.locator('[data-panel="context"]').click();
      await page.locator(".rt-ctx .ctx-card").waitFor();
      const bounds = await page.locator(".rt-inspector").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      await page.keyboard.press("Escape");
      await tab("Accounts").click();
      assert.equal(await page.locator("#rt").isHidden(), true);
      await page.locator(".rt-pool").waitFor();
      await tab("Groups").click();
      assert.equal(await page.locator(".rt-accounts-page").isHidden(), true);
      await page.locator("#rtNewGroup").click();
      await page.locator(".rt-gedit").waitFor();
      await tab("View").click();
      await page.evaluate(() => window.openRoute(1, new Date().toISOString(), { context: true }));
      await page.locator(".rt-ctx .ctx-card").waitFor();
      await page.evaluate(() => setLocale("en"));
      await page.waitForFunction(() => document.querySelector("#rtInspectorTitle").textContent === "Context window");
      assert.equal(await page.locator('[data-panel="requests"]').innerText(), "Request log");
      assert.deepEqual(errors, []);
    });
  }
  test(`${engine}: empty routing diagnostics remain readable`, async t => {
    const { page, errors } = await setup(t, engine, "en", 420, true);
    await page.locator('[data-panel="requests"]').click();
    await page.locator(".rt-reqs.none").waitFor();
    assert.ok((await page.locator(".rt-reqs").innerText()).trim());
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#rt > .rt-log").isHidden(), true);
    await page.locator('[data-panel="context"]').click();
    assert.equal(await page.locator(".rt-ctx").getAttribute("data-empty"), "No context window for this request");
    assert.deepEqual(errors, []);
  });
}
