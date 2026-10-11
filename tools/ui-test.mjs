/**
 * 真浏览器 UI 自检：用 Edge 无头 + DevTools 协议发**真实输入事件**，
 * 把用户抱怨的三件事逐条验一遍：
 *   1. 双击空白能不能新建节点
 *   2. 拖动节点能不能移动
 *   3. 左键点两个节点能不能连线
 *   4. 点右侧 4 色块能不能换色
 *   5. 页面上有没有抛异常（有就把原文打出来）
 *
 * 隔离：服务用 KG_GRAPHS 指向临时目录，绝不动 graphs\ 里的真实图谱。
 * 运行：node tools/ui-test.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = 43121
const CDP_PORT = 9333
const BASE = 'http://127.0.0.1:' + PORT

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]
const EDGE = EDGE_CANDIDATES.find((item) => existsSync(item))

let failures = 0
const check = (ok, label, extra) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (extra === undefined ? '' : '  -> ' + extra))
  if (!ok) failures += 1
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (EDGE === undefined) {
  console.log('没有找到 Edge/Chrome，跳过浏览器 UI 自检')
  process.exit(0)
}

// ---------------------------------------------------------------- 准备隔离环境
const graphs = mkdtempSync(join(tmpdir(), 'kg-ui-'))
const profile = mkdtempSync(join(tmpdir(), 'kg-edge-'))
writeFileSync(join(graphs, 'UITest.json'), JSON.stringify({
  v: 1, name: 'UITest',
  nodes: [
    { id: 'n1', title: '甲', note: '', color: '#4c6ef5', x: -160, y: 0 },
    { id: 'n2', title: '乙', note: '', color: '#12b886', x: 160, y: 0 },
  ],
  edges: [],
}), 'utf8')

const server = spawn(process.execPath, [join(ROOT, 'app', 'server.mjs')], {
  env: { ...process.env, KG_PORT: String(PORT), KG_GRAPHS: graphs },
  stdio: 'ignore', windowsHide: true,
})
const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--user-data-dir=' + profile,
  '--remote-debugging-port=' + CDP_PORT,
  'about:blank',
], { stdio: 'ignore', windowsHide: true })

const cleanup = () => {
  try { browser.kill() } catch { }
  try { server.kill() } catch { }
}
process.on('exit', cleanup)

// ---------------------------------------------------------------- 等 CDP 起来
let wsUrl
for (let i = 0; i < 60 && wsUrl === undefined; i += 1) {
  await sleep(250)
  try {
    const list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json()
    const page = list.find((item) => item.type === 'page')
    if (page !== undefined) wsUrl = page.webSocketDebuggerUrl
  } catch { /* 还没起来 */ }
}
if (wsUrl === undefined) {
  console.log('浏览器调试端口没起来，跳过 UI 自检')
  cleanup()
  process.exit(0)
}

// ---------------------------------------------------------------- 极简 CDP 客户端
const socket = new WebSocket(wsUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let messageId = 0
const pending = new Map()
const problems = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    problems.push('exception: ' + (details.exception && details.exception.description ? details.exception.description : details.text))
  }
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    problems.push('console.error: ' + message.params.entry.text)
  }
})
const send = (method, params) => new Promise((resolve) => {
  const id = ++messageId
  pending.set(id, resolve)
  socket.send(JSON.stringify({ id, method, params: params ?? {} }))
})
const evaluate = async (expression) => {
  const message = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const result = message.result
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.text + ' :: ' + ((result.exceptionDetails.exception || {}).description || ''))
  }
  return result.result.value
}

await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')

// ---------------------------------------------------------------- 打开页面
await send('Page.navigate', { url: BASE + '/' })
let ready = false
for (let i = 0; i < 40 && !ready; i += 1) {
  await sleep(250)
  try { ready = (await evaluate('document.querySelectorAll("[data-node]").length')) === 2 } catch { ready = false }
}
check(ready, '页面打开并渲染出 2 个节点')
check((await evaluate('typeof KG === "object" && typeof KG.resolveClick === "function"')) === true, 'KG 逻辑就绪')
check((await evaluate('document.querySelectorAll("#swatches .swatch").length')) === 4, '右侧有 4 个颜色块')

// 诊断：启动没走完时把原文打出来
if (!ready) {
  console.log('  --- 诊断 ---')
  console.log('  status : ' + (await evaluate('document.getElementById("status").textContent')))
  console.log('  banner : ' + (await evaluate('document.getElementById("banner").textContent')))
  console.log('  world  : ' + (await evaluate('document.getElementById("world").innerHTML.length')))
  console.log('  画布尺寸: ' + JSON.stringify(await evaluate('(() => { const r = document.getElementById("canvas").getBoundingClientRect(); return { w: r.width, h: r.height }; })()')))
  console.log('  下拉选项: ' + JSON.stringify(await evaluate('[...document.getElementById("graphSelect").options].map(o => o.value)')))
  console.log('  页面异常: ' + (problems.length === 0 ? '(没捕获到)' : problems.join(' | ')))
  console.log('  setTimeout 里再抛的: ' + JSON.stringify(await evaluate('window.__lastError || null')))
}

// 鼠标工具：走 CDP 真输入事件
const press = (type, x, y, button, clickCount) => send('Input.dispatchMouseEvent', {
  type, x, y, button: button ?? 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: clickCount ?? 1,
})
const click = async (x, y) => { await press('mousePressed', x, y, 'left', 1); await sleep(40); await press('mouseReleased', x, y, 'left', 1); await sleep(120) }
const dblclick = async (x, y) => {
  await press('mousePressed', x, y, 'left', 1); await press('mouseReleased', x, y, 'left', 1)
  await press('mousePressed', x, y, 'left', 2); await press('mouseReleased', x, y, 'left', 2)
  await sleep(200)
}
const nodeCenter = (id) => evaluate('(() => { const el = document.querySelector(\'[data-node="' + id + '"] rect\'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()')
const canvasSize = () => evaluate('(() => { const r = document.getElementById("canvas").getBoundingClientRect(); return { w: r.width, h: r.height, x: r.x, y: r.y }; })()')

// ---------------------------------------------------------------- 1. 新建节点
console.log('# 交互')
const before = await evaluate('document.querySelectorAll("[data-node]").length')
const box = await canvasSize()
await dblclick(box.x + box.w * 0.5, box.y + box.h * 0.82)
const afterCreate = await evaluate('document.querySelectorAll("[data-node]").length')
check(afterCreate === before + 1, '双击空白新建了一个节点', before + ' -> ' + afterCreate)
check((await evaluate('document.querySelectorAll("[data-node]").length')) === 3, '节点数变成 3')

// ---------------------------------------------------------------- 2. 拖动节点
const ids = await evaluate('[...document.querySelectorAll("[data-node]")].map((el) => el.getAttribute("data-node"))')
check(ids.length === 3, '拿到 3 个节点的 id', ids.join(','))
const firstId = ids[0]
const secondId = ids[1]
const start = await nodeCenter(firstId)
const transformBefore = await evaluate('document.querySelector(\'[data-node="' + firstId + '"]\').getAttribute("transform")')
await press('mousePressed', start.x, start.y, 'left', 1)
for (let step = 1; step <= 5; step += 1) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + step * 12, y: start.y + step * 8, button: 'left', buttons: 1 })
  await sleep(30)
}
await press('mouseReleased', start.x + 60, start.y + 40, 'left', 1)
await sleep(200)
const transformAfter = await evaluate('document.querySelector(\'[data-node="' + firstId + '"]\').getAttribute("transform")')
check(transformBefore !== transformAfter, '拖动节点后位置变了', transformBefore + ' -> ' + transformAfter)

// ---------------------------------------------------------------- 3. 左键点两下连线
const edgesBefore = await evaluate('document.querySelectorAll("[data-edge]").length')
const startNow = await nodeCenter(firstId)          // 刚才拖动过，坐标要重新取
await click(startNow.x, startNow.y)                 // 点节点 1 = 选起点
const toast = await evaluate('document.getElementById("toast").textContent')
const second = await nodeCenter(secondId)
await click(second.x, second.y)                     // 点节点 2 = 连线
const edgesAfter = await evaluate('document.querySelectorAll("[data-edge]").length')
check(edgesAfter === edgesBefore + 1, '左键点两个节点连上了线', edgesBefore + ' -> ' + edgesAfter + '  toast=' + toast)

// ---------------------------------------------------------------- 4. 右侧 4 色换色
const fillBefore = await evaluate('document.querySelector(\'[data-node="' + secondId + '"] rect\').getAttribute("fill")')
const swatch = await evaluate('(() => { const el = document.querySelectorAll("#swatches .swatch")[2]; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, color: el.dataset.color }; })()')
await click(swatch.x, swatch.y)
await sleep(200)
const fillAfter = await evaluate('document.querySelector(\'[data-node="' + secondId + '"] rect\').getAttribute("fill")')
const expectFill = '#' + [1, 3, 5].map((i) => Math.max(0, parseInt(swatch.color.slice(i, i + 2), 16) - 70).toString(16).padStart(2, '0')).join('')
check(fillAfter === expectFill, '点第 3 个色块换色成功', fillBefore + ' -> ' + fillAfter + ' (目标色 ' + swatch.color + ')')
check(fillBefore !== fillAfter, '颜色确实变了')

// ---------------------------------------------------------------- 5. 节点说明标签
console.log('# 节点说明标签')
await click((await nodeCenter(firstId)).x, (await nodeCenter(firstId)).y)   // 选中节点
const noteBox = await evaluate('(() => { const el = document.getElementById("fNote"); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()')
await click(noteBox.x, noteBox.y)
await send('Input.insertText', { text: '接口层' })
await sleep(300)
const tagText = await evaluate('(() => { const el = document.querySelector(\'[data-node="' + firstId + '"] .node-tag-text\'); return el === null ? null : el.textContent; })()')
check(tagText === '接口层', '写了说明，节点上出现标签', String(tagText))
check((await evaluate('document.querySelectorAll(\'[data-node="' + firstId + '"] .node-tag\').length')) === 1, '标签只画一枚')
const untouchedTag = await evaluate('document.querySelectorAll(\'[data-node="' + secondId + '"] .node-tag\').length')
check(untouchedTag === 0, '没写说明的节点没有标签', String(untouchedTag))
// 清空 -> 标签消失
await evaluate('(() => { const el = document.getElementById("fNote"); el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); })()')
await sleep(250)
check((await evaluate('document.querySelectorAll(\'[data-node="' + firstId + '"] .node-tag\').length')) === 0, '清空说明后标签消失')

// ---------------------------------------------------------------- 6. 右侧「我建过的框架」可伸缩 + 预览可关闭
console.log('# 右侧「我建过的框架」（可伸缩 + 预览可关闭）')
check((await evaluate('document.getElementById("libBody").style.display')) === 'none', '默认是收起的（不挤占编辑区）')
await evaluate('document.getElementById("libSect").click()')
await sleep(250)
check((await evaluate('document.getElementById("libBody").style.display')) === 'block', '点标题展开')
const libCount = await evaluate('document.querySelectorAll("#libList .libitem").length')
check(libCount >= 1, '展开后列出了已建过的框架', String(libCount))
const itemRect = await evaluate('(() => { const el = document.querySelector("#libList .libitem"); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, name: el.querySelector(".libname").textContent }; })()')
await click(itemRect.x, itemRect.y)
await sleep(400)
const previewVisible = await evaluate('document.getElementById("libPreview").style.display')
const previewTitle = await evaluate('document.getElementById("libPVTitle").textContent')
const thumbSvg = await evaluate('document.querySelector("#libPVThumb svg") !== null')
check(previewVisible === 'block', '单击后出现预览面板', previewVisible)
check(previewTitle === itemRect.name, '预览标题是点的那张', previewTitle)
check(thumbSvg === true, '预览里画出了缩略图')
check((await evaluate('document.getElementById("libPVMeta").textContent.indexOf("节点") !== -1')) === true, '预览显示了节点/连线数', await evaluate('document.getElementById("libPVMeta").textContent'))
// 预览可以被关掉
const closeRect = await evaluate('(() => { const el = document.getElementById("libPVClose"); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()')
await click(closeRect.x, closeRect.y)
await sleep(250)
check((await evaluate('document.getElementById("libPreview").style.display')) === 'none', '✕ 能关掉预览（不再一直占着）')
// 再收起来
await evaluate('document.getElementById("libSect").click()')
await sleep(200)
check((await evaluate('document.getElementById("libBody").style.display')) === 'none', '再点标题可以收起')
// 标题 Enter -> 说明；说明 Enter -> 收工
await click((await nodeCenter(secondId)).x, (await nodeCenter(secondId)).y)
await evaluate('document.getElementById("fTitle").focus()')
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await sleep(200)
check((await evaluate('document.activeElement.id')) === 'fNote', '标题按 Enter 跳到说明标签', await evaluate('document.activeElement.id'))

// ---------------------------------------------------------------- 8. 多选一起动 + 间距滑杆 + 右侧拖宽
console.log('# 多选一起动 / 间距滑杆 / 右侧拖宽')
const nodeXY = async (id) => evaluate('(() => { const el = document.querySelector(\'[data-node="' + id + '"]\'); const m = /translate\\(([-0-9.]+),([-0-9.]+)\\)/.exec(el.getAttribute("transform")); return { x: parseFloat(m[1]), y: parseFloat(m[2]) }; })()')
const shiftClick = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: 8 })
  await sleep(50)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers: 8 })
  await sleep(200)
}
const allIds = await evaluate('[...document.querySelectorAll("[data-node]")].map((el) => el.getAttribute("data-node"))')
const group = allIds.slice(0, 2)
await click((await nodeCenter(group[0])).x, (await nodeCenter(group[0])).y)
await shiftClick((await nodeCenter(group[1])).x, (await nodeCenter(group[1])).y)
check((await evaluate('document.getElementById("multiHint").textContent')).indexOf('已选 2 个节点') !== -1, 'Shift+点选中两个节点', await evaluate('document.getElementById("multiHint").textContent'))
// 拖动其中一个，两个都要动同样的位移
const g0Before = await nodeXY(group[0])
const g1Before = await nodeXY(group[1])
const grab = await nodeCenter(group[0])
await press('mousePressed', grab.x, grab.y, 'left', 1)
for (let step = 1; step <= 5; step += 1) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grab.x + step * 10, y: grab.y + step * 6, button: 'left', buttons: 1 })
  await sleep(30)
}
await press('mouseReleased', grab.x + 50, grab.y + 30, 'left', 1)
await sleep(250)
const g0After = await nodeXY(group[0])
const g1After = await nodeXY(group[1])
const delta0 = { x: g0After.x - g0Before.x, y: g0After.y - g0Before.y }
const delta1 = { x: g1After.x - g1Before.x, y: g1After.y - g1Before.y }
check(Math.abs(delta0.x) > 20, '被抓住的节点动了', delta0.x.toFixed(1))
check(Math.abs(delta0.x - delta1.x) < 1.5 && Math.abs(delta0.y - delta1.y) < 1.5, '另一个选中的节点一起走同样位移', JSON.stringify([delta0, delta1]))
// 换色作用于全部选中
const fillsBefore = await evaluate('[...document.querySelectorAll("[data-node]")].slice(0, 2).map((el) => el.querySelector("rect").getAttribute("fill"))')
const swatch4 = await evaluate('(() => { const el = document.querySelectorAll("#swatches .swatch")[3]; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()')
await click(swatch4.x, swatch4.y)
await sleep(250)
const fillsAfter = await evaluate('[...document.querySelectorAll("[data-node]")].slice(0, 2).map((el) => el.querySelector("rect").getAttribute("fill"))')
check(fillsAfter[0] === fillsAfter[1] && fillsAfter[0] !== fillsBefore[0], '4 色块作用于全部选中节点', JSON.stringify(fillsBefore) + ' -> ' + JSON.stringify(fillsAfter))
// 间距滑杆：拖动时距离实时变
const distBefore = Math.abs((await nodeXY(group[1])).x - (await nodeXY(group[0])).x)
await evaluate('(() => { const el = document.getElementById("spacing"); el.value = "340"; el.dispatchEvent(new Event("input", { bubbles: true })); })()')
await sleep(300)
const distAfter = Math.abs((await nodeXY(group[1])).x - (await nodeXY(group[0])).x)
check(distAfter > distBefore + 20, '滑杆一拖，节点距离实时变大', distBefore.toFixed(0) + ' -> ' + distAfter.toFixed(0))
check((await evaluate('document.getElementById("spacingValue").textContent')) === '340', '滑杆读数跟着走')
check((await evaluate('JSON.parse(localStorage.getItem("kg.ui.v1")).spacing')) === 340, '间距记在本地')
// 右侧拖宽
const widthBefore = await evaluate('document.getElementById("side").getBoundingClientRect().width')
const splitPoint = await evaluate('(() => { const r = document.getElementById("splitter").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()')
await press('mousePressed', splitPoint.x, splitPoint.y, 'left', 1)
for (let step = 1; step <= 6; step += 1) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: splitPoint.x - step * 12, y: splitPoint.y, button: 'left', buttons: 1 })
  await sleep(30)
}
await press('mouseReleased', splitPoint.x - 72, splitPoint.y, 'left', 1)
await sleep(250)
const widthAfter = await evaluate('document.getElementById("side").getBoundingClientRect().width')
check(widthAfter > widthBefore + 30, '拖分隔条能把右侧拉宽', widthBefore.toFixed(0) + ' -> ' + widthAfter.toFixed(0))
check((await evaluate('JSON.parse(localStorage.getItem("kg.ui.v1")).sideWidth')) === Math.round(widthAfter), '右侧宽度记在本地')

// ---------------------------------------------------------------- 9. 右键框选 + 拖动改大小 + 布局类型
console.log('# 右键框选 / 拖动改大小 / 布局类型')
const canvasBox = await evaluate('(() => { const r = document.getElementById("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()')
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 })
await sleep(300)
const allNames = await evaluate('[...document.querySelectorAll("[data-node]")].map((el) => el.getAttribute("data-node"))')
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: canvasBox.x + 6, y: canvasBox.y + 6, button: 'right', buttons: 2, clickCount: 1 })
for (let step = 1; step <= 6; step += 1) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: canvasBox.x + (canvasBox.w - 12) * step / 6, y: canvasBox.y + (canvasBox.h - 12) * step / 6, button: 'right', buttons: 2 })
  await sleep(40)
}
const bandDrawn = await evaluate('document.querySelectorAll("svg rect[stroke-dasharray]").length')
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: canvasBox.x + canvasBox.w - 6, y: canvasBox.y + canvasBox.h - 6, button: 'right', buttons: 0, clickCount: 1 })
await sleep(300)
check(bandDrawn >= 1, '右键拖动时画出选框', String(bandDrawn))
const multiText = await evaluate('document.getElementById("multiHint").textContent')
check(multiText.indexOf('已选 ' + allNames.length + ' 个节点') !== -1, '框选把圈到的节点全选中', multiText)
check((await evaluate('document.getElementById("menu").classList.contains("on")')) === false, '拉框结束后不弹右键菜单')
const xyA = await nodeXY(allNames[0])
const xyB = await nodeXY(allNames[1])
const grabBand = await nodeCenter(allNames[0])
await press('mousePressed', grabBand.x, grabBand.y, 'left', 1)
for (let step = 1; step <= 5; step += 1) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grabBand.x - step * 8, y: grabBand.y - step * 5, button: 'left', buttons: 1 })
  await sleep(30)
}
await press('mouseReleased', grabBand.x - 40, grabBand.y - 25, 'left', 1)
await sleep(300)
const xyA2 = await nodeXY(allNames[0])
const xyB2 = await nodeXY(allNames[1])
check(Math.abs((xyA2.x - xyA.x) - (xyB2.x - xyB.x)) < 1.5, '框选后拖一个，圈里的节点一起动', (xyA2.x - xyA.x).toFixed(1) + ' vs ' + (xyB2.x - xyB.x).toFixed(1))
check(Math.abs(xyA2.x - xyA.x) > 15, '确实移动了', (xyA2.x - xyA.x).toFixed(1))
await click((await nodeCenter(allNames[0])).x, (await nodeCenter(allNames[0])).y)
await sleep(250)
const handle = await evaluate('(() => { const el = document.querySelector("[data-resize]"); if (el === null) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()')
check(handle !== null, '选中节点后出现右下角缩放手柄')
if (handle !== null) {
  const sizeBefore = await evaluate('(() => { const el = document.querySelector(\'[data-node="' + allNames[0] + '"] rect\'); return { w: parseFloat(el.getAttribute("width")), h: parseFloat(el.getAttribute("height")) }; })()')
  await press('mousePressed', handle.x, handle.y, 'left', 1)
  for (let step = 1; step <= 6; step += 1) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + step * 10, y: handle.y + step * 5, button: 'left', buttons: 1 })
    await sleep(30)
  }
  await press('mouseReleased', handle.x + 60, handle.y + 30, 'left', 1)
  await sleep(300)
  const sizeAfter = await evaluate('(() => { const el = document.querySelector(\'[data-node="' + allNames[0] + '"] rect\'); return { w: parseFloat(el.getAttribute("width")), h: parseFloat(el.getAttribute("height")) }; })()')
  check(sizeAfter.w > sizeBefore.w + 20, '拖把手把节点拉大了（宽度）', sizeBefore.w + ' -> ' + sizeAfter.w)
  check(sizeAfter.h > sizeBefore.h + 5, '高度也变高了', sizeBefore.h + ' -> ' + sizeAfter.h)
}
const layoutOptions = await evaluate('[...document.getElementById("layoutKind").options].map((o) => o.value)')
check(layoutOptions.length >= 6, '布局下拉里有多种类型', layoutOptions.join(','))
const treeResult = await evaluate('(() => { const select = document.getElementById("layoutKind"); select.value = "tree"; select.dispatchEvent(new Event("change", { bubbles: true })); const nodes = [...document.querySelectorAll("[data-node]")]; const ys = nodes.map((el) => { const m = /translate\\(([-0-9.]+),([-0-9.]+)\\)/.exec(el.getAttribute("transform")); return parseFloat(m[2]); }); return { count: nodes.length, distinctY: new Set(ys.map((v) => Math.round(v))).size }; })()')
check(treeResult.distinctY >= 2, '切到树状后节点分层（y 不再同一行）', JSON.stringify(treeResult))
await sleep(250)
const layoutToast = await evaluate('document.getElementById("toast").textContent')
check(layoutToast.indexOf('树状') !== -1, '提示里写明用的是哪种布局', layoutToast.slice(0, 60))

// ---------------------------------------------------------------- 10. 保存到临时目录
await sleep(1200)
const saved = await (await fetch(BASE + '/api/graph?name=UITest')).json()
check(saved.nodes.length === 3 && saved.edges.length === 1, '改动已自动保存（临时目录）', saved.nodes.length + ' 节点 / ' + saved.edges.length + ' 边')
check(saved.nodes.some((node) => node.color !== '#4c6ef5' && node.color !== '#12b886'), '换的颜色也存下来了')

// ---------------------------------------------------------------- 6. 控制台有没有报错
check(problems.length === 0, '页面没有抛异常', problems.slice(0, 3).join(' | ') || 'clean')

console.log('')
console.log(failures === 0 ? 'UI 自检 OK - 真浏览器里全部通过' : 'UI 自检失败 - ' + failures + ' 项')
cleanup()
process.exit(failures === 0 ? 0 : 1)
