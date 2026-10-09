/**
 * 生成桌面快捷方式用的图标（assets/graph.ico）。
 * 用 sharp 把一段 SVG 画成 PNG，再按 PNG-in-ICO 规则打包（Vista+ 支持）。
 * 运行：node tools/make-icon.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const ASSETS = join(ROOT, 'assets')

// sharp 随 DSH 一起装着，这里直接用它，免安装。
const APP_MODULES = 'D:\\AI驱动盘\\Deep Harness\\resources\\app\\node_modules'
const required = createRequire(join(APP_MODULES, 'noop.cjs'))
const sharp = required(join(APP_MODULES, 'sharp'))

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b2233"/>
      <stop offset="1" stop-color="#0d1119"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="244" height="244" rx="46" fill="url(#bg)" stroke="#4c6ef5" stroke-width="5"/>
  <g stroke="#6b7cff" stroke-width="7" stroke-linecap="round" opacity="0.85">
    <line x1="76" y1="84" x2="180" y2="84"/>
    <line x1="180" y1="84" x2="180" y2="176"/>
    <line x1="76" y1="84" x2="76" y2="176"/>
    <line x1="76" y1="176" x2="180" y2="176"/>
  </g>
  <circle cx="76" cy="84" r="22" fill="#4c6ef5" stroke="#c7d2fe" stroke-width="5"/>
  <circle cx="180" cy="84" r="22" fill="#12b886" stroke="#bbf7d0" stroke-width="5"/>
  <circle cx="180" cy="176" r="22" fill="#e0a03a" stroke="#fde68a" stroke-width="5"/>
  <circle cx="76" cy="176" r="22" fill="#a855f7" stroke="#e9d5ff" stroke-width="5"/>
</svg>`

const png = await sharp(Buffer.from(svg, 'utf8')).resize(256, 256).png({ compressionLevel: 9 }).toBuffer()
mkdirSync(ASSETS, { recursive: true })

// ICO: 6 字节目录头 + 16 字节目录项 + PNG 数据
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)
const entry = Buffer.alloc(16)
entry.writeUInt8(0, 0)             // 宽 256 记作 0
entry.writeUInt8(0, 1)             // 高 256 记作 0
entry.writeUInt8(0, 2)             // 调色板
entry.writeUInt8(0, 3)
entry.writeUInt16LE(1, 4)          // color planes
entry.writeUInt16LE(32, 6)         // bpp
entry.writeUInt32LE(png.length, 8) // 数据长度
entry.writeUInt32LE(22, 12)        // 数据偏移
const icoPath = join(ASSETS, 'graph.ico')
writeFileSync(icoPath, Buffer.concat([header, entry, png]))

const check = readFileSync(icoPath)
console.log('icon written: ' + icoPath)
console.log('  bytes: ' + check.length + '   png payload: ' + png.length)
