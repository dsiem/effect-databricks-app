import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

// Rerunnable interaction study; these are illustrative layouts, not live answers.
const options = [
  [
    "popover",
    "Floating helper",
    "Keeps the dashboard layout intact. Expand when results need more room.",
  ],
  [
    "dock",
    "Docked analyst",
    "Always visible alongside the data, but compresses charts and tables.",
  ],
  [
    "inline",
    "Inline explanation",
    "Strong connection to one chart, but moves the dashboard as answers grow.",
  ],
];
const chart = `<svg role="img" viewBox="0 0 500 150" aria-label="Illustrative activity chart"><path d="M0 130H500M0 80H500M0 30H500" stroke="#eee"/><path d="M0 125L35 100 70 114 105 66 140 87 175 51 210 65 245 16 280 61 315 43 350 69 385 38 420 56 455 21 500 32V150H0Z" fill="#fff0e9"/><path d="M0 125L35 100 70 114 105 66 140 87 175 51 210 65 245 16 280 61 315 43 350 69 385 38 420 56 455 21 500 32" stroke="#df744e" stroke-width="2" fill="none"/></svg>`;
const helper = `<div class="helper-head"><b>✧ Genie</b><span>↗ <button type="button" aria-label="Close helper">×</button></span></div><div class="scope"><small>LOOKING AT</small><b>Trips by pickup date</b><span>Jan 10 – Jan 20, 2016 · ZIP 10001</span></div><div class="conversation"><h3>Go deeper into this view</h3><p>Explain a pattern or run a new analysis with your current filters.</p><button type="button" class="suggest">Explain the daily pattern ↗</button><button type="button" class="suggest">Compare weekdays and weekends ↗</button><div class="answer" hidden><b>Illustrative response</b><p>A live answer would explain the selected chart, with query results and SQL available to inspect.</p><details><summary>View generated SQL</summary><code>SELECT …</code></details></div></div><form><textarea aria-label="Question" placeholder="Ask about this view…"></textarea><div><small>Current view included</small><button type="submit" class="send" aria-label="Send question">↑</button></div></form>`;
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Contextual Genie — interaction comparison</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f6f6;color:#202020;font:14px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}header{padding:24px 32px;background:white;border-bottom:1px solid #e5e5e5}h1{font-size:24px;margin:0 0 8px}p{color:#737373;line-height:1.6}header p{margin:0}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;padding:24px}.option>h2{margin:0;font-size:17px}.option>p{height:44px;font-size:12px}.stage{height:650px;position:relative;border:1px solid #ddd;border-radius:12px;background:white;overflow:hidden}.nav{height:40px;padding:12px;border-bottom:1px solid #eee;font-size:11px}.dashboard{padding:18px}.dashboard h3{margin:0 0 18px;font-size:17px}.filters,.metrics,.chart,.table{border:1px solid #e5e5e5;border-radius:7px;margin:0 0 16px;padding:12px}.filters{font-size:10px;background:#fafafa}.metrics{display:flex;gap:25px;font-size:11px}.metrics b{display:block;margin-top:6px;font-size:21px}.chart{position:relative}.chart b,.table b{font-size:12px}svg{width:100%;margin-top:22px}button{cursor:pointer;font:inherit;border:0;background:none}.explain{float:right;font-size:10px;color:#777}.table p{font-size:10px}.helper{position:absolute;display:flex;flex-direction:column;right:12px;bottom:12px;width:280px;height:460px;border:1px solid #ddd;border-radius:12px;background:#fff;box-shadow:0 12px 40px #0002;overflow:hidden}.helper-head{display:flex;align-items:center;justify-content:space-between;padding:15px;border-bottom:1px solid #eee}.helper-head span{color:#777}.scope{display:flex;flex-direction:column;gap:7px;padding:14px;background:#fafafa;border-bottom:1px solid #eee}.scope small{font-size:9px;letter-spacing:1px;color:#777}.scope b{font-size:12px}.scope span{font-size:10px;color:#777}.conversation{padding:15px;flex:1;overflow:auto}.conversation h3{font-size:16px;margin:10px 0}.conversation p{font-size:12px}.suggest{display:block;text-align:left;border:1px solid #e5e5e5;border-radius:6px;padding:10px;width:100%;margin-top:8px;font-size:11px}.answer{font-size:12px}.answer p{margin-bottom:10px}form{margin:10px;border:1px solid #ddd;border-radius:8px;padding:10px}textarea{border:0;resize:none;width:100%;height:40px;font:12px inherit;outline:none}form>div{display:flex;align-items:center;justify-content:space-between}.helper form small{font-size:9px;color:#777}.send{background:#222;color:white;border-radius:5px;padding:5px 9px}.dock .dashboard{width:55%}.dock .metrics{display:block}.dock .metrics span+span{display:none}.dock .helper{top:40px;bottom:0;right:0;width:45%;height:auto;border-radius:0;box-shadow:none}.dock .suggest{font-size:10px}.inline .helper{position:relative;inset:auto;width:100%;height:310px;margin:12px 0 0;box-shadow:none}.inline .scope{display:none}.inline .conversation{padding:10px}.inline .conversation h3{margin:0}.inline .conversation>p{display:none}.inline .suggest{display:inline-block;width:auto;margin-right:4px}.inline .table{display:none}.launch{position:absolute;bottom:12px;right:12px;background:#222;color:white;border-radius:8px;padding:10px}.answer[hidden],.helper[hidden],.suggest[hidden]{display:none}@media(max-width:1000px){main{grid-template-columns:1fr}.option>p{height:auto}.stage{max-width:800px}.dock .helper{width:40%}}
</style><header><h1>Genie, beside the data</h1><p>Three working interaction prototypes · illustrative content · select a suggestion or ask a question</p></header><main>${options.map(([id, title, description]) => `<section class="option ${id}"><h2>${title}</h2><p>${description}</p><div class="stage"><div class="nav">☷ &nbsp; NYC Taxi / Overview</div><div class="dashboard"><h3>Trip overview</h3><div class="filters">Jan 10 – Jan 20, 2016 &nbsp; | &nbsp; Pickup ZIP 10001</div><div class="metrics"><span>Total trips<b>2,184</b></span><span>Average fare<b>$13.42</b></span></div><div class="chart"><b>Trips by pickup date</b><button type="button" class="explain">✧ Explain</button>${chart}${id === "inline" ? `<div class="helper">${helper}</div>` : ""}</div><div class="table"><b>Top pickup ZIP codes</b><p>10001 &nbsp; 10003 &nbsp; 10019</p></div></div>${id !== "inline" ? `<div class="helper">${helper}</div>` : ""}<button type="button" class="launch" hidden>✧ Ask Genie</button></div></section>`).join("")}</main><script>document.querySelectorAll('.stage').forEach(stage=>{const panel=stage.querySelector('.helper');const show=()=>{panel.hidden=false;stage.querySelector('.launch').hidden=true};stage.querySelector('.helper-head button').onclick=()=>{panel.hidden=true;stage.querySelector('.launch').hidden=false};stage.querySelector('.launch').onclick=show;stage.querySelector('.explain').onclick=show;const answer=()=>{stage.querySelector('.answer').hidden=false;stage.querySelectorAll('.suggest').forEach(x=>{x.hidden=true});stage.querySelector('.conversation h3').hidden=true};stage.querySelectorAll('.suggest').forEach(x=>{x.onclick=answer});stage.querySelector('form').onsubmit=e=>{e.preventDefault();answer()}})</script></html>`;
await mkdir("output", { recursive: true });
await writeFile("output/genie-helper-options.html", html);
execFileSync(
  "node_modules/.bin/biome",
  ["check", "--write", "output/genie-helper-options.html"],
  { stdio: "pipe" },
);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1720, height: 880 } });
await page.setContent(html);
await page.screenshot({
  path: "output/genie-helper-options.png",
  fullPage: true,
});
for (const [id] of options) {
  const stage = page.locator(`.option.${id}`);
  await stage.locator(".suggest").first().click();
  assert.equal(await stage.locator(".answer").isVisible(), true);
  assert.equal(await stage.locator(".suggest").first().isVisible(), false);
  await stage.getByRole("button", { name: "Close helper" }).click();
  assert.equal(await stage.locator(".helper").isVisible(), false);
  await stage.locator(".launch").click();
  assert.equal(await stage.locator(".helper").isVisible(), true);
  await stage.getByRole("textbox", { name: "Question" }).fill("Compare fares");
  await stage.getByRole("button", { name: "Send question" }).click();
  assert.equal(await stage.locator(".answer").isVisible(), true);
}
await browser.close();
console.log("Created output/genie-helper-options.html and comparison PNG");
