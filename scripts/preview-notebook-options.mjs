import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

// Rerunnable UX study. Content is illustrative; no warehouse or Lakebase writes.
const options = [
  [
    "journal",
    "1 · Inline journal",
    "A notebook below the results",
    "Good for a running narrative. Long threads push the data away and saved views become hard to scan.",
  ],
  [
    "panel",
    "2 · Contextual panel",
    "Save the view. Discuss the record.",
    "A compact save action and an on-demand trip inspector preserve the table. One surface for context and comments.",
  ],
  [
    "rows",
    "3 · Expandable rows",
    "Discussion inside the table",
    "Very direct for short comments. Multiple threads disrupt scanning; narrow screens have little room for context.",
  ],
];
const comment = `<div class="context"><small>SELECTED TRIP</small><b>10001 → 10019</b><span>Jan 20, 2016 · 09:42</span><span>$18.50 fare · 3.2 mi · 14 min</span></div><h3>Comments <small>Shared</small></h3><p class="empty">What should the next analyst know about this trip?</p><div class="thread"></div><form><label>Add a comment<textarea required placeholder="Flag a fare, ask a question, leave context…"></textarea></label><button class="primary">Post comment</button></form>`;
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Notebook UX comparison</title><style>
*{box-sizing:border-box}body{margin:0;background:#f7f7f7;color:#222;font:14px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}header{padding:28px 32px;background:white;border-bottom:1px solid #ddd}h1{margin:0 0 8px;font-size:25px}p{color:#737373;line-height:1.6}header p{margin:0}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;padding:24px}h2{font-size:19px;margin:0 0 8px}.option>p{font-size:12px;min-height:60px}.stage{height:680px;position:relative;background:white;border:1px solid #ddd;border-radius:12px;overflow:auto}.nav{padding:14px;border-bottom:1px solid #eee;font-size:11px}.content{padding:20px}h3{margin:0 0 15px;font-size:16px}h3 small{float:right;font-size:10px;color:#777;font-weight:400}button{font:inherit;font-size:11px;border:1px solid #ddd;background:white;border-radius:6px;padding:8px 10px;cursor:pointer}.primary{background:#222;color:white;border-color:#222}.tools{display:flex;gap:6px;margin:14px 0}.filters{padding:12px;background:#fafafa;border:1px solid #eee;border-radius:6px;font-size:10px}.table{border:1px solid #eee;border-radius:8px;overflow:hidden}.row{display:flex;gap:8px;align-items:center;justify-content:space-between;font-size:11px;padding:13px 10px;border-bottom:1px solid #eee}.row.selected{background:#fff3ed}.row small{display:block;color:#777;font-size:9px;margin-top:5px}.head{background:#fafafa;color:#777}.context{display:flex;flex-direction:column;gap:8px;padding:16px;margin-bottom:20px;border:1px solid #eee;background:#fafafa;border-radius:8px}.context small{font-size:9px;color:#777;letter-spacing:1px}.context span{font-size:11px;color:#777}.panel{position:absolute;right:0;top:0;bottom:0;width:78%;background:white;border-left:1px solid #ddd;box-shadow:-8px 0 30px #0001;padding:22px;overflow:auto}.close{float:right;margin:-8px -8px 18px 10px}.panel h3:first-of-type{margin-top:5px}.journal{margin-top:20px}.variant-rows .discussion{padding:16px}.variant-rows .context{display:none}.empty{font-size:12px}.thread p{padding:12px;border:1px solid #eee;border-radius:8px;color:#333;font-size:12px;white-space:pre-wrap}label{display:block;font-size:11px;font-weight:500}textarea,input{width:100%;font:12px inherit;padding:10px;border:1px solid #ddd;border-radius:6px;margin:8px 0 12px;resize:vertical}textarea{height:85px}.save-editor{padding:16px;border:1px solid #ddd;border-radius:8px;margin:12px 0;background:#fafafa}.saved{font-size:11px;color:#555}.annotation{margin-top:16px;font-size:10px;color:#888}.panel[hidden],.discussion[hidden],.save-editor[hidden]{display:none}@media(max-width:1000px){main{grid-template-columns:1fr}.stage{max-width:760px}.option>p{min-height:0}}
</style><header><h1>Keep the work beside the data</h1><p>Three interaction prototypes · illustrative content · try saving a view and commenting on a trip</p></header><main>${options.map(([id, title, tagline, description]) => `<section class="option variant-${id}"><h2>${title}</h2><b>${tagline}</b><p>${description}</p><div class="stage"><div class="nav">☷ &nbsp; NYC Taxi / Trip explorer</div><div class="content"><h3>Trip records</h3><div class="filters">Jan 10 – Jan 20, 2016 · Pickup ZIP 10001</div><div class="tools"><button class="save">♧ Save view</button><button class="saved-button">Saved views</button></div><form class="save-editor" hidden><label>View name<input required placeholder="e.g. Midtown fare review"></label><label>Finding (optional)<textarea placeholder="What is worth returning to?"></textarea></label><button class="primary">Save view</button></form><div class="saved"></div><div class="table"><div class="row head"><span>Pickup / route</span><span>Fare</span><span>Discussion</span></div>${[0, 1, 2, 3].map((i) => `<div class="row ${i === 0 ? "selected" : ""}"><span>Jan 20 · 09:${42 - i * 3}<small>10001 → 10019</small></span><span>$${i === 0 ? "18.50" : "12.00"}</span><button class="inspect">◯ Comment</button></div>${id === "rows" && i === 0 ? `<div class="discussion" hidden>${comment}</div>` : ""}`).join("")}</div>${id === "journal" ? `<div class="journal discussion" hidden><h3>Trip notebook</h3>${comment}</div>` : ""}<p class="annotation">Comments follow the record snapshot across filters and sorting.</p></div>${id === "panel" ? `<aside class="panel discussion" hidden><button class="close">×</button><h3>Trip details</h3>${comment}</aside>` : ""}</div></section>`).join("")}</main><script>
document.querySelectorAll('.option').forEach(option=>{const stage=option.querySelector('.stage'),discussion=option.querySelector('.discussion'),editor=option.querySelector('.save-editor');option.querySelector('.save').onclick=()=>{editor.hidden=!editor.hidden;if(!editor.hidden)editor.querySelector('input').focus()};option.querySelector('.saved-button').onclick=()=>{option.querySelector('.saved').textContent=option.dataset.saved||'No saved views yet. Save the current filters with an optional finding.'};editor.onsubmit=e=>{e.preventDefault();option.dataset.saved='♧ '+editor.querySelector('input').value+' · Jan 10–20 · ZIP 10001';option.querySelector('.saved').textContent=option.dataset.saved;editor.hidden=true};option.querySelectorAll('.inspect').forEach(button=>button.onclick=()=>{discussion.hidden=!discussion.hidden;if(!discussion.hidden){discussion.querySelector('textarea').focus();discussion.scrollIntoView({block:'nearest'})}});option.querySelector('.close')?.addEventListener('click',()=>discussion.hidden=true);discussion.querySelector('form').onsubmit=e=>{e.preventDefault();const field=discussion.querySelector('textarea');if(!field.value.trim())return;const p=document.createElement('p');p.textContent=field.value;discussion.querySelector('.thread').append(p);discussion.querySelector('.empty').hidden=true;field.value=''}});
</script></html>`;
await mkdir("output", { recursive: true });
await writeFile("output/notebook-ux-options.html", html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1720, height: 1020 } });
await page.setContent(html);
for (const option of await page.locator(".option").all()) {
  await option.locator(".save").click();
  await option.locator("input").fill("Midtown fare review");
  await option.locator(".save-editor button").click();
  await option.locator(".inspect").first().click();
  await option
    .locator(".discussion textarea")
    .fill("Check this fare against similar trips.");
  await option.locator(".discussion form button").click();
  if (
    !(await option.locator(".thread").textContent()).includes("Check this fare")
  )
    throw new Error("Comment interaction failed");
}
await page.screenshot({
  path: "output/notebook-ux-options.png",
  fullPage: true,
});
await browser.close();
console.log(
  "Created output/notebook-ux-options.html and comparison PNG; save/comment interactions verified.",
);
