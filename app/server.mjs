/**
 * 图谱框架 —— 本地服务。
 *
 * 只做两件事：
 *   1. 把 app/index.html 送到浏览器（单文件应用，无构建、无依赖）
 *   2. 把图谱以 JSON 存进本目录的 graphs\ 里，随时可读可改
 *
 * 端口被占用时安静退出（说明已经开着一个实例），启动脚本随后照常打开页面。
 * 运行：node app\server.mjs
 */
import { createServer } from 'node:http'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const APP = join(HERE, 'index.html')
// 图谱目录默认是本目录的 graphs\；自检可以用 KG_GRAPHS 指到临时目录，免得动到真实图谱
const GRAPHS = process.env.KG_GRAPHS ? resolve(process.env.KG_GRAPHS) : join(ROOT, 'graphs')
const PORT = Number(process.env.KG_PORT ?? 43110)
const HOST = '127.0.0.1'

/** 只允许图谱名里出现安全字符（含中文）：剥掉路径分隔符与首尾的点/空白，杜绝目录穿越。 */
function safeName(raw) {
  const name = String(raw ?? '')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/^[\s.]+/, '')
    .replace(/[\s.]+$/, '')
  return name.slice(0, 80)
}
const graphPath = (name) => join(GRAPHS, safeName(name) + '.json')

async function ensureDir() {
  await mkdir(GRAPHS, { recursive: true })
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(body)
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function listGraphs() {
  await ensureDir()
  const files = await readdir(GRAPHS)
  const out = []
  for (const file of files) {
    if (!file.toLowerCase().endsWith('.json')) continue
    const full = join(GRAPHS, file)
    try {
      const info = await stat(full)
      const graph = JSON.parse(await readFile(full, 'utf8'))
      out.push({
        name: graph.name ?? file.replace(/\.json$/i, ''),
        updatedAt: graph.updatedAt ?? info.mtime.toISOString(),
        nodes: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
        edges: Array.isArray(graph.edges) ? graph.edges.length : 0,
      })
    } catch {
      /* 坏文件跳过，不影响其它图谱 */
    }
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
  return out
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://' + HOST + ':' + PORT)
  const route = url.pathname
  try {
    if (request.method === 'GET' && (route === '/' || route === '/index.html')) {
      const html = await readFile(APP)
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(html)
      return
    }
    if (request.method === 'GET' && route === '/favicon.ico') {
      try {
        const icon = await readFile(join(ROOT, 'assets', 'graph.ico'))
        response.writeHead(200, { 'content-type': 'image/x-icon', 'cache-control': 'max-age=3600' })
        response.end(icon)
      } catch {
        response.writeHead(204)
        response.end()
      }
      return
    }
    if (request.method === 'GET' && route === '/api/ping') {
      sendJson(response, 200, { ok: true, root: ROOT, graphs: GRAPHS, port: PORT })
      return
    }
    if (request.method === 'GET' && route === '/api/list') {
      sendJson(response, 200, { ok: true, items: await listGraphs() })
      return
    }
    if (route === '/api/graph') {
      const name = safeName(url.searchParams.get('name'))
      if (name === '') {
        sendJson(response, 400, { ok: false, error: 'name is required' })
        return
      }
      if (request.method === 'GET') {
        try {
          const raw = await readFile(graphPath(name), 'utf8')
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          response.end(raw)
        } catch {
          sendJson(response, 404, { ok: false, error: 'graph not found', name })
        }
        return
      }
      if (request.method === 'POST') {
        const body = await readBody(request)
        let graph
        try {
          graph = JSON.parse(body)
        } catch {
          sendJson(response, 400, { ok: false, error: 'body must be JSON' })
          return
        }
        if (graph === null || typeof graph !== 'object' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
          sendJson(response, 400, { ok: false, error: 'graph needs nodes[] and edges[]' })
          return
        }
        await ensureDir()
        const target = graphPath(name)
        const record = { ...graph, v: 1, name, updatedAt: new Date().toISOString() }
        await writeFile(target + '.tmp', JSON.stringify(record, null, 2), 'utf8')
        await rename(target + '.tmp', target)
        sendJson(response, 200, { ok: true, name, savedAt: record.updatedAt })
        return
      }
      if (request.method === 'DELETE') {
        await rm(graphPath(name), { force: true })
        sendJson(response, 200, { ok: true, name })
        return
      }
      sendJson(response, 405, { ok: false, error: 'method not allowed' })
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('404')
  } catch (error) {
    sendJson(response, 500, { ok: false, error: String(error && error.message ? error.message : error) })
  }
})

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.log('图谱框架：端口 ' + PORT + ' 已在运行，本次启动跳过（页面照常打开）。')
    process.exit(0)
  }
  console.error('图谱框架：服务启动失败 - ' + (error && error.message ? error.message : error))
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log('图谱框架已启动： http://' + HOST + ':' + PORT + '/')
  console.log('图谱目录： ' + GRAPHS)
})
