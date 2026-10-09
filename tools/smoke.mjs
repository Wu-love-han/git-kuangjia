/**
 * 图谱框架自检：
 *   1. app/index.html 里那段脚本能编译（vm.Script 当语法检查）
 *   2. 纯逻辑 KG：建图/加节点/连线/删节点/布局/适应/缩放/导入校验
 *   3. 起一个真服务（随机端口，stdio 不接管），跑一遍 HTTP 接口：
 *      ping / list / 保存 / 读回 / 列表包含 / 删除 / 删后 404 / 名字穿越防护
 *
 * 运行：node tools/smoke.mjs
 */
import { spawn } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = 43119
const BASE = 'http://127.0.0.1:' + PORT

let failures = 0
const check = (ok, label, extra) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (extra === undefined ? '' : '  -> ' + extra))
  if (!ok) failures += 1
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------- 1. 语法
console.log('# 内联脚本编译')
const html = readFileSync(join(ROOT, 'app', 'index.html'), 'utf8')
const scriptBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((item) => item[1])
check(scriptBlocks.length >= 1, 'index.html 里有 <script> 段', scriptBlocks.length + ' 段')
const script = scriptBlocks.find((text) => text.indexOf('const KG = (() =>') !== -1) ?? scriptBlocks[scriptBlocks.length - 1] ?? ''
check(script.indexOf('const KG = (() =>') !== -1, '找到主脚本（含 KG 逻辑那段）')
check(scriptBlocks.some((text) => text.indexOf('unhandledrejection') !== -1), '页面带全局异常上报（出错会显示在横幅上）')
let compiled = undefined
try {
  compiled = new vm.Script(script, { filename: 'index.html#script' })
  check(true, '脚本编译通过')
} catch (error) {
  check(false, '脚本编译通过', error.message)
}

// ---------------------------------------------------------------- 2. 纯逻辑
console.log('# 纯逻辑 KG')
const fakeWindow = {}
const sandbox = { window: fakeWindow, console: { log: () => {}, error: () => {} }, setTimeout, clearTimeout, Promise, Math, Date, JSON, Object, Array, String, Number, Boolean, Error }
sandbox.globalThis = sandbox
try {
  vm.runInNewContext(script, sandbox, { filename: 'index.html#logic' })
  check(true, '纯逻辑段在无 DOM 环境可执行')
} catch (error) {
  check(false, '纯逻辑段在无 DOM 环境可执行', error.message)
}
const KG = fakeWindow.KG
check(KG !== undefined && typeof KG.layoutStep === 'function', 'window.KG 暴露出来了')

const graph = KG.newGraph('测试图谱')
check(graph.nodes.length === 0 && graph.edges.length === 0, '新图谱是空的', graph.name)
const a = KG.addNode(graph, { title: 'A', x: 0, y: 0 })
const b = KG.addNode(graph, { title: 'B', x: 10, y: 0 })
const c = KG.addNode(graph, { title: 'C' })
check(graph.nodes.length === 3, '加了 3 个节点', graph.nodes.length)
check(KG.addNode(graph, {}).title === '新节点', '默认标题是「新节点」', graph.nodes[3].title)

check(KG.link(graph, a.id, b.id) !== undefined, '连 A→B 成功')
check(KG.link(graph, a.id, b.id) === undefined, '重复连线被拒绝')
check(KG.link(graph, b.id, a.id) === undefined, '反向重复也被拒绝')
check(KG.link(graph, a.id, a.id) === undefined, '自连被拒绝')
check(KG.link(graph, a.id, 'no-such-node') === undefined, '连不存在的节点被拒绝')
check(graph.edges.length === 1, '只留了一条边', graph.edges.length)

const edgeId = graph.edges[0].id
check(KG.unlink(graph, edgeId) === true, '删边成功')
check(KG.link(graph, a.id, b.id) !== undefined, '删掉后可以重新连')

check(KG.removeNode(graph, c.id) === true, '删节点成功')
check(KG.nodeById(graph, c.id) === undefined, '删掉的节点查不到')
KG.link(graph, b.id, graph.nodes[1].id)
const before = graph.edges.length
check(KG.removeNode(graph, a.id) === true, '删掉有边的节点成功')
check(graph.edges.every((edge) => edge.from !== a.id && edge.to !== a.id), '删节点会带走它的边', before + ' -> ' + graph.edges.length)

console.log('# 布局与视图')
const flat = KG.newGraph('布局')
for (let i = 0; i < 6; i += 1) KG.addNode(flat, { title: 'N' + i, x: 0, y: 0 })
const beforeSpread = Math.max(...flat.nodes.map((node) => Math.abs(node.x))) + Math.max(...flat.nodes.map((node) => Math.abs(node.y)))
KG.layoutToEnd(flat, 200)
const afterSpread = Math.max(...flat.nodes.map((node) => Math.abs(node.x))) + Math.max(...flat.nodes.map((node) => Math.abs(node.y)))
check(afterSpread > beforeSpread, '布局把重叠的节点推开', beforeSpread.toFixed(1) + ' -> ' + afterSpread.toFixed(1))
check(afterSpread < 4000, '布局不会炸开到离谱范围', afterSpread.toFixed(1) + ' px')
check(flat.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)), '布局后坐标都是有限数')
const spread = KG.bounds(flat)
check(spread.width > 0 && spread.height > 0, 'bounds 算得出包围盒', JSON.stringify({ w: Math.round(spread.width), h: Math.round(spread.height) }))
const fitted = KG.fit(flat, 800, 600)
check(fitted.k > 0 && fitted.k <= 2, 'fit 给出合理缩放', fitted.k.toFixed(2))
const zoomed = KG.zoomAt({ x: 0, y: 0, k: 1 }, 400, 300, 1.5)
const worldBefore = KG.toWorld({ x: 0, y: 0, k: 1 }, 400, 300)
const worldAfter = KG.toWorld(zoomed, 400, 300)
check(Math.abs(worldBefore.x - worldAfter.x) < 0.01 && Math.abs(worldBefore.y - worldAfter.y) < 0.01, '缩放时指针下的世界点不动')
check(KG.zoomAt({ x: 0, y: 0, k: 1 }, 0, 0, 100).k === 2.6, '缩放有上限')
check(KG.zoomAt({ x: 0, y: 0, k: 1 }, 0, 0, 0.0001).k === 0.15, '缩放有下限')

console.log('# 导入校验')
const dirty = KG.sanitize({ nodes: [{ id: 'x', title: 'X' }, { title: '' }, null], edges: [{ from: 'x', to: 'x' }, { from: 'x', to: 'nope' }] }, '导入')
check(dirty.nodes.length === 2, '坏节点被丢掉', dirty.nodes.length)
check(dirty.edges.length === 0, '无效的边被丢掉', dirty.edges.length)
check(KG.sanitize(null, '空').nodes.length === 0, 'null 导入得到空图谱')
check(KG.sanitize({ nodes: [{ title: 'A' }, { title: 'B' }], edges: [{ from: undefined, to: undefined }] }, 'X').nodes.length === 2, '缺 id 的节点仍会被保留')

console.log('# 左键连线（点击意图判定）')
const planOf = (input) => KG.resolveClick(input)
check(planOf({ moved: false, pressedId: 'a', releasedId: 'a', linkFrom: undefined }).action === 'setSource', '点第一个节点 = 选为起点')
check(planOf({ moved: false, pressedId: 'a', releasedId: 'a', linkFrom: undefined }).linkFrom === 'a', '起点记下来了')
check(planOf({ moved: false, pressedId: 'b', releasedId: 'b', linkFrom: 'a' }).action === 'connect', '再点另一个节点 = 连线')
const connectPlan = planOf({ moved: false, pressedId: 'b', releasedId: 'b', linkFrom: 'a' })
check(connectPlan.from === 'a' && connectPlan.to === 'b' && connectPlan.linkFrom === undefined, '连线方向是 A→B 且清掉起点')
check(planOf({ moved: false, pressedId: 'a', releasedId: 'a', linkFrom: 'a' }).action === 'clearSource', '再点起点自己 = 取消起点')
check(planOf({ moved: true, pressedId: 'a', releasedId: 'a', linkFrom: undefined }).action === 'drag', '移动超过阈值 = 拖动而不是连线')
check(planOf({ moved: true, pressedId: 'a', releasedId: 'b', linkFrom: 'a' }).action === 'drag', '拖着走就不连线')
check(planOf({ moved: false, pressedId: undefined, releasedId: undefined, linkFrom: 'a' }).action === 'select', '点空白 = 不连线')
check(planOf({ moved: false, pressedId: 'a', releasedId: 'b', linkFrom: undefined }).action === 'select', '按下与松开不在同一节点 = 不连线')
check(planOf(undefined).action === 'select', '空输入也不炸')
// 端到端：走一遍 点A -> 点B，模型里真的要出现一条边
const clickGraph = KG.newGraph('左键连线')
const ca = KG.addNode(clickGraph, { title: 'A' })
const cb = KG.addNode(clickGraph, { title: 'B' })
let pending = undefined
let step = planOf({ moved: false, pressedId: ca.id, releasedId: ca.id, linkFrom: pending })
pending = step.linkFrom
step = planOf({ moved: false, pressedId: cb.id, releasedId: cb.id, linkFrom: pending })
if (step.action === 'connect') KG.link(clickGraph, step.from, step.to)
check(clickGraph.edges.length === 1, '点两下之后模型里真的多了一条边', clickGraph.edges.length)
check(clickGraph.edges[0].from === ca.id && clickGraph.edges[0].to === cb.id, '边的方向正确')
const again = planOf({ moved: false, pressedId: cb.id, releasedId: cb.id, linkFrom: ca.id })
check(again.action === 'connect' && KG.link(clickGraph, again.from, again.to) === undefined, '同一对再连一次会被拒绝')

console.log('# 布局稳定性 + 间距（连点重排不会越来越挤）')
const avgEdge = (target) => {
  if (target.edges.length === 0) return 0
  let sum = 0
  for (const edge of target.edges) {
    const a = KG.nodeById(target, edge.from)
    const b = KG.nodeById(target, edge.to)
    sum += Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y))
  }
  return sum / target.edges.length
}
const stable = KG.newGraph('稳定性')
for (let i = 0; i < 8; i += 1) KG.addNode(stable, { title: 'N' + i, x: Math.cos(i * 1.7) * 160, y: Math.sin(i * 1.7) * 160 })
for (let i = 0; i < 7; i += 1) KG.link(stable, stable.nodes[i].id, stable.nodes[i + 1].id)
const runs = []
for (let i = 0; i < 5; i += 1) { KG.layoutToEnd(stable, 260, 190); runs.push(avgEdge(stable)) }
check(runs.every((value) => Math.abs(value - 190) < 1), '连点 5 次重排，平均边长都锁在 190', runs.map((v) => v.toFixed(1)).join(' -> '))
check(runs[4] > runs[0] * 0.95, '多次重排不会越来越近', runs[0].toFixed(1) + ' -> ' + runs[4].toFixed(1))
const wideRuns = []
for (let i = 0; i < 3; i += 1) { KG.layoutToEnd(stable, 120, 320); wideRuns.push(avgEdge(stable)) }
check(wideRuns.every((value) => Math.abs(value - 320) < 2), '重排按传入的间距（320）排版', wideRuns.map((v) => v.toFixed(1)).join(' -> '))
check(KG.DEFAULT_SPACING === 190, '默认间距是 190')
// 向心：整图重心应当被拉回原点附近，而不是把坐标越缩越小
let cx = 0
let cy = 0
for (const node of stable.nodes) { cx += node.x; cy += node.y }
cx /= stable.nodes.length
cy /= stable.nodes.length
check(Math.hypot(cx, cy) < 60, '重排后整图重心回到中心附近', Math.hypot(cx, cy).toFixed(1))
check(stable.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)), '坐标都是有限数')

console.log('# 间距缩放（滑杆拖动时实时调这个）')
const two = KG.newGraph('两节点')
KG.addNode(two, { x: 0, y: 0 })
KG.addNode(two, { x: 100, y: 0 })
KG.link(two, two.nodes[0].id, two.nodes[1].id)
KG.spread(two, 300)
check(Math.abs(avgEdge(two) - 300) < 0.5, 'spread 到 300 就是 300', avgEdge(two).toFixed(1))
KG.spread(two, 150)
check(Math.abs(avgEdge(two) - 150) < 0.5, 'spread 到 150 就是 150', avgEdge(two).toFixed(1))
check(KG.spread(two, 900) <= 900 / 150 + 0.01, 'spread 上限不会失控')
const single = KG.newGraph('单节点')
KG.addNode(single, { x: 10, y: 10 })
check(KG.spread(single, 300) === 1, '只有一个节点时 spread 不动')
const subset = KG.newGraph('子集')
for (let i = 0; i < 4; i += 1) KG.addNode(subset, { x: i * 100, y: 0 })
KG.link(subset, subset.nodes[0].id, subset.nodes[1].id)
KG.link(subset, subset.nodes[2].id, subset.nodes[3].id)
const untouchedX = subset.nodes[3].x
const untouchedY = subset.nodes[3].y
KG.spread(subset, 300, [subset.nodes[0].id, subset.nodes[1].id])
check(Math.abs(Math.abs(subset.nodes[1].x - subset.nodes[0].x) - 300) < 1, '只调选中的那两个节点之间的距离', Math.abs(subset.nodes[1].x - subset.nodes[0].x).toFixed(1))
check(subset.nodes[3].x === untouchedX && subset.nodes[3].y === untouchedY, '没选中的节点一点不动')
const noEdge = KG.newGraph('无边')
for (let i = 0; i < 3; i += 1) KG.addNode(noEdge, { x: i * 10, y: 0 })
KG.spread(noEdge, 240)
check(avgEdge(noEdge) === 0 && noEdge.nodes[2].x - noEdge.nodes[0].x > 20, '没有边时按半径估算拉开', (noEdge.nodes[2].x - noEdge.nodes[0].x).toFixed(1))

console.log('# 导出接口完整性')
const usedMembers = [...new Set([...script.matchAll(/KG\.([A-Za-z_$][\w$]*)/g)].map((item) => item[1]))]
const missingMembers = usedMembers.filter((name) => !(name in KG))
check(missingMembers.length === 0, '页面用到的 ' + usedMembers.length + ' 个 KG 成员都导出了', missingMembers.join(', ') || 'ok')
// 血泪教训：漏导出 KG.clip 时每次 render 都抛异常，画面全黑、看着像"动不了"。
// 这条静态检查能在开浏览器之前就抓住这类漏导出。
check(usedMembers.indexOf('clip') !== -1 && typeof KG.clip === 'function', 'KG.clip 必须存在（渲染依赖）')

console.log('# 框架模板 + 4 色')
check(KG.PALETTE.length === 4, '调色板正好 4 色', KG.PALETTE.join(' '))
check(new Set(KG.PALETTE).size === 4, '4 色互不相同')
check(KG.PALETTE.every((color) => /^#[0-9a-fA-F]{6}$/.test(color)), '颜色都是合法十六进制')
check(KG.TEMPLATES.length >= 6, '至少有 6 个可选模板', String(KG.TEMPLATES.length))
check(KG.TEMPLATES[0].id === 'blank' && KG.TEMPLATES[0].nodes.length === 0, '第一个是空白模板')
const templateIds = KG.TEMPLATES.map((item) => item.id)
check(new Set(templateIds).size === templateIds.length, '模板 id 不重复')
let templateProblems = []
for (const template of KG.TEMPLATES) {
  const built = KG.fromTemplate(template.id, 'x')
  if (built.nodes.length !== template.nodes.length) templateProblems.push(template.id + ':节点数')
  if (built.edges.length !== template.edges.filter((edge) => edge[0] !== edge[1]).length) templateProblems.push(template.id + ':边数')
  for (const edge of template.edges) {
    if (edge[0] >= template.nodes.length || edge[1] >= template.nodes.length) templateProblems.push(template.id + ':边越界')
  }
  if (built.nodes.some((node) => KG.PALETTE.indexOf(node.color) === -1)) templateProblems.push(template.id + ':颜色不在调色板')
  if (built.nodes.some((node) => !Number.isFinite(node.x) || !Number.isFinite(node.y))) templateProblems.push(template.id + ':坐标非法')
  if (template.nodes.length > 1 && built.nodes.every((node) => node.x === built.nodes[0].x && node.y === built.nodes[0].y)) templateProblems.push(template.id + ':节点全叠在一起')
  if (built.edges.some((edge) => edge.from === edge.to)) templateProblems.push(template.id + ':自连')
}
check(templateProblems.length === 0, '每个模板都能造出结构正确的图', templateProblems.join(', ') || 'ok')
const project = KG.fromTemplate('project', '我的项目')
check(project.name === '我的项目' && project.nodes.length === 5 && project.edges.length === 4, '项目流程模板 5 节点 4 边')
check(KG.fromTemplate('project').name === '项目流程', '不传名字时用模板名')
check(project.nodes[0].title === '需求' && project.nodes[4].title === '交付', '节点标题按顺序摆好')
const decision = KG.fromTemplate('decision', 'd')
check(decision.edges.some((edge) => edge.label === '是') && decision.edges.some((edge) => edge.label === '否'), '决策树模板带「是/否」标签')
check(KG.fromTemplate('blank', '空').nodes.length === 0, '空白模板什么都不放')
check(KG.fromTemplate('no-such-template', 'x').nodes.length === 0, '未知模板得到空图')
check(KG.templateById('arch') !== undefined && KG.templateById('nope') === undefined, 'templateById 命中/未命中都对')
const colored = KG.fromTemplate('arch', 'c')
const beforeColor = colored.nodes[0].color
colored.nodes[0].color = KG.PALETTE[3]
check(colored.nodes[0].color === KG.PALETTE[3] && beforeColor !== KG.PALETTE[3], '换色就是改 node.color（右侧 4 色块用的就是它）')
check(KG.toSvg(colored).indexOf(KG.shade(KG.PALETTE[3], -70)) !== -1, '换色后导出 SVG 也跟着变')

console.log('# 节点说明标签（写了才显示）')
check(KG.tagOf({ note: '' }) === null, '说明为空 -> 没有标签')
check(KG.tagOf({ note: '   ' }) === null, '只有空格 -> 没有标签')
check(KG.tagOf({}) === null, '没有 note 字段 -> 没有标签')
check(KG.tagOf(undefined) === null, '节点是 undefined 也不炸')
const tagCjk = KG.tagOf({ note: '负责登录模块' })
check(tagCjk !== null && tagCjk.text === '负责登录模块', '中文说明原样成标签', tagCjk && tagCjk.text)
check(tagCjk.width > 50 && tagCjk.width < 210, '标签宽度合理', tagCjk.width)
const tagLong = KG.tagOf({ note: '一二三四五六七八九十一二三四五六七八九十' })
check(tagLong.text.length === 14 && tagLong.text.endsWith('…'), '太长会截断成 14 字加省略号', tagLong.text)
check(KG.tagOf({ note: 'a'.repeat(80) }).width <= 210, '宽度有上限', KG.tagOf({ note: 'a'.repeat(80) }).width)
const tagGraph = KG.newGraph('标签')
const tagNode = KG.addNode(tagGraph, { title: '甲', note: '接口层' })
KG.addNode(tagGraph, { title: '乙' })
const tagSvg = KG.toSvg(tagGraph)
check(tagSvg.indexOf('接口层') !== -1, 'SVG 导出带上说明标签')
// 有说明的比没说明的恰好多一枚圆角标签（rx="9" 同时用于节点框，所以比差值）
const withTagCount = (tagSvg.match(/rx="9"/g) || []).length
tagNode.note = ''
const bareSvg = KG.toSvg(tagGraph)
const withoutTagCount = (bareSvg.match(/rx="9"/g) || []).length
check(withTagCount === withoutTagCount + 1, '写了说明的节点恰好多一枚标签', withTagCount + ' vs ' + withoutTagCount)
check(bareSvg.indexOf('接口层') === -1, '清空说明后导出里也没有标签了')

console.log('# 连线标签 / 复制粘贴 / SVG 导出')
const labeled = KG.newGraph('标签')
const l1 = KG.addNode(labeled, { title: '甲', x: 0, y: 0 })
const l2 = KG.addNode(labeled, { title: '乙', x: 200, y: 0 })
const le = KG.link(labeled, l1.id, l2.id)
check(KG.setEdgeLabel(labeled, le.id, '调用') === true, '设置连线标签成功')
check(KG.edgeById(labeled, le.id).label === '调用', '标签读得回来')
check(KG.setEdgeLabel(labeled, 'nope', 'x') === false, '给不存在的边设标签返回 false')
check(KG.setEdgeLabel(labeled, le.id, '') === true && KG.edgeById(labeled, le.id).label === '', '空字符串清掉标签')

const copySource = KG.newGraph('复制')
const c1 = KG.addNode(copySource, { title: '源A', x: 0, y: 0, note: '备注A', color: '#12b886' })
const c2 = KG.addNode(copySource, { title: '源B', x: 120, y: 40 })
KG.link(copySource, c1.id, c2.id, '内部')
const outside = KG.addNode(copySource, { title: '外部', x: 400, y: 400 })
KG.link(copySource, c2.id, outside.id, '外部边')
const beforeCount = copySource.nodes.length
const pasted = KG.pasteNodes(copySource, [c1, c2], copySource.edges.slice(0, 1), 30, 30)
check(copySource.nodes.length === beforeCount + 2, '粘贴加了两个节点', copySource.nodes.length - beforeCount)
check(pasted.nodes.length === 2 && pasted.edges.length === 1, '粘贴返回 2 节点 1 边', JSON.stringify([pasted.nodes.length, pasted.edges.length]))
check(pasted.nodes[0].id !== c1.id && copySource.nodes.filter((n) => n.id === pasted.nodes[0].id).length === 1, '粘贴出来的是新 id')
check(pasted.nodes[0].x === c1.x + 30 && pasted.nodes[0].y === c1.y + 30, '粘贴带偏移', pasted.nodes[0].x + ',' + pasted.nodes[0].y)
check(pasted.nodes[0].title === '源A' && pasted.nodes[0].color === '#12b886', '标题与颜色一起复制')
check(pasted.edges[0].label === '内部' && pasted.edges[0].from === pasted.nodes[0].id, '内部连线跟着复制并指向新节点')
check(copySource.edges.filter((e) => e.label === '外部边').length === 1, '外部连线不会被复制成重复')

KG.setEdgeLabel(labeled, le.id, '调用')   // 前面的断言把标签清掉了，这里补回来再导出
const svg = KG.toSvg(labeled, { background: '#101010', grid: true })
check(svg.indexOf('<svg') === 0 && svg.trim().endsWith('</svg>'), 'toSvg 产出完整 SVG')
check(svg.indexOf('甲') !== -1 && svg.indexOf('乙') !== -1, 'SVG 里有中文节点标题')
check(svg.indexOf('调用') !== -1, 'SVG 里有连线标签')
check(svg.indexOf('#101010') !== -1, 'SVG 用了指定背景色')
check((svg.match(/<line /g) || []).length > 2, '开了网格后有多条网格线')
check(svg.indexOf('rx="9"') !== -1, '默认形状是圆角')
const wide = KG.newGraph('宽')
for (let i = 0; i < 8; i += 1) KG.addNode(wide, { title: 'W' + i, x: i * 400, y: 0 })
const wideSvg = KG.toSvg(wide)
const widthMatch = wideSvg.match(/width="(\d+)"/)
check(widthMatch !== null && Number(widthMatch[1]) > 2000, 'SVG 尺寸随内容变宽', widthMatch === null ? 'n/a' : widthMatch[1])
check(KG.toSvg(KG.newGraph('空')).indexOf('<svg') === 0, '空图谱也能导出 SVG')
const escaped = KG.newGraph('转义')
const risky = KG.addNode(escaped, { title: '<b>&"', x: 0, y: 0 })
KG.link(escaped, risky.id, risky.id)
check(KG.toSvg(escaped).indexOf('&lt;b&gt;&amp;&quot;') !== -1, 'SVG 文本做了 XML 转义')
check(KG.SHAPES.length === 3, '有 3 种节点形状可选', KG.SHAPES.join('/'))

// ---------------------------------------------------------------- 3. 服务
console.log('# 本地服务与 HTTP 接口')
const child = spawn(process.execPath, [join(ROOT, 'app', 'server.mjs')], {
  env: { ...process.env, KG_PORT: String(PORT) },
  stdio: 'ignore',
  windowsHide: true,
})
let ready = false
for (let i = 0; i < 40 && !ready; i += 1) {
  await sleep(150)
  try {
    const response = await fetch(BASE + '/api/ping')
    ready = response.ok
  } catch { ready = false }
}
check(ready, '服务起来了 ' + BASE)

if (ready) {
  const ping = await (await fetch(BASE + '/api/ping')).json()
  check(ping.ok === true && typeof ping.graphs === 'string', 'ping 返回图谱目录', ping.graphs)

  const page = await fetch(BASE + '/')
  const pageText = await page.text()
  check(page.ok && pageText.indexOf('图谱框架') !== -1, 'GET / 送回编辑器页面', pageText.length + ' bytes')

  const name = '自检临时图谱'
  const payload = { v: 1, name, nodes: [{ id: 'n1', title: '甲', x: 0, y: 0, color: '#4c6ef5', note: '' }, { id: 'n2', title: '乙', x: 120, y: 40, color: '#12b886', note: '备注' }], edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '连' }] }
  const saveResponse = await fetch(BASE + '/api/graph?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  const saved = await saveResponse.json()
  check(saveResponse.ok && saved.ok === true, '保存成功', JSON.stringify(saved))

  const loaded = await (await fetch(BASE + '/api/graph?name=' + encodeURIComponent(name))).json()
  check(loaded.nodes.length === 2 && loaded.edges.length === 1, '读回来有 2 节点 1 边', loaded.nodes.length + '/' + loaded.edges.length)
  check(loaded.nodes[1].title === '乙' && loaded.edges[0].label === '连', '中文内容原样存取', JSON.stringify([loaded.nodes[1].title, loaded.edges[0].label]))
  check(typeof loaded.updatedAt === 'string', '保存时补了 updatedAt')

  const list = await (await fetch(BASE + '/api/list')).json()
  check(list.items.some((item) => item.name === name), '列表里能看到它', list.items.map((item) => item.name).join(', '))

  const bad = await fetch(BASE + '/api/graph?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"nodes":1}' })
  check(bad.status === 400, '结构不对的图谱被拒（400）', bad.status)

  // 名字穿越防护：../ 会被剥掉，落到 graphs 目录内
  const evil = await fetch(BASE + '/api/graph?name=' + encodeURIComponent('../../evil'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodes: [], edges: [] }) })
  check(evil.ok, '带 ../ 的名字不会 500', evil.status)
  const evilFile = join(ROOT, 'graphs', 'evil.json')
  const outside = join(ROOT, '..', 'evil.json')
  check(readFileSync(evilFile, 'utf8').length > 0, '确实落在 graphs\\ 里（evil.json）')
  check(!(await import('node:fs')).existsSync(outside), '没有写到上一级目录')

  const del = await fetch(BASE + '/api/graph?name=' + encodeURIComponent(name), { method: 'DELETE' })
  check(del.ok, '删除成功')
  const after = await fetch(BASE + '/api/graph?name=' + encodeURIComponent(name))
  check(after.status === 404, '删掉之后是 404', after.status)
  await fetch(BASE + '/api/graph?name=evil', { method: 'DELETE' })
}

child.kill()
// 清掉自检留下的临时图谱（含历史版本可能留下的怪异名字）
const { readdirSync } = await import('node:fs')
for (const file of readdirSync(join(ROOT, 'graphs'))) {
  if (file.indexOf('evil') !== -1) rmSync(join(ROOT, 'graphs', file), { force: true })
}

console.log('')
console.log(failures === 0 ? '图谱框架自检 OK - 全部通过' : '图谱框架自检失败 - ' + failures + ' 项')
process.exit(failures === 0 ? 0 : 1)
