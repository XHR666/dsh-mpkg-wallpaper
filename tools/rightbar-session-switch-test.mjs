// tools/rightbar-session-switch-test.mjs —— 2026-11-15 DSH022 4.A
//
// 真机读数（docs/reports/DSH022-UI-R3-20261115/ghost-repro.json，插件开、1440×900）：
//   在 qqqq 打开「文件」（better-sidebar 把该页签 keepMounted）再切到 dshmpkg1。
//   前台右栏 data-rightbar-collapsed=true、没有 open 标记，rect 仍在视口（约 780,10,650×882），
//   z-index 12。旧会话面板仍是 data-sidebar-right-open=true，包在带 hidden 的会话容器里，
//   rect 为 0。对照：只展开右栏、不打开工具再切走，open 列表为空，z-index 为 auto。
//
// 根因：mpwRightbarParked 和每条 :has([data-sidebar-right-open="true"]) 都把 hidden 里的
// 保留面板当成"右栏还开着"，于是悬浮几何和磨砂停在前台那块已经收起的面板上。
//
// 断言（每条都能被文末变异打红）：
//   H1  open 的祖先有 hidden ⇒ 不算正在显示
//   H2  可见的 open ⇒ 不算收起
//   H3  只有 hidden 里的 open，外加收起标记 ⇒ 算收起
//   H4  只剩 hidden 里的面板、没有收起标记 ⇒ 仍算收起（切走后的保留视图）
//   H5  可见面板 aria-hidden ⇒ 算收起（旧的停靠件判据保留）
//   H6  可见 open 同时带着旧的 collapsed 属性 ⇒ 不算收起（2026-11-05 的展开优先保留）
//   C1  产物 CSS 里不再有裸 :has([data-sidebar-right-open="true"])
//   C2  收起后清边框的那条规则改认"可见会话里的 open"
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'lib/client.js'), 'utf8')
const LIVE = ':has([data-sidebar-right-session]:not([hidden]) [data-sidebar-right-open="true"])'
const BARE = ':has([data-sidebar-right-open="true"])'

function sliceFn(text, name) {
	const start = text.indexOf('function ' + name + '(')
	if (start < 0) throw new Error('找不到 ' + name)
	let depth = 0
	for (let j = text.indexOf('{', start); j < text.length; j++) {
		if (text[j] === '{') depth++
		else if (text[j] === '}') {
			depth--
			if (depth === 0) return text.slice(start, j + 1).replace(/^\t\t/gm, '')
		}
	}
	throw new Error(name + ' 没有收口')
}

function load(text) {
	const code = sliceFn(text, 'mpwRightbarOpenIsLive') + '\n' + sliceFn(text, 'mpwRightbarParkedFrom')
	return new Function(code + '\nreturn { mpwRightbarOpenIsLive, mpwRightbarParkedFrom }')()
}

function el(attrs, children, hidden) {
	const node = {
		attrs,
		children: children || [],
		parentElement: null,
		hasAttribute(name) { return name === 'hidden' ? !!hidden : Object.prototype.hasOwnProperty.call(attrs, name) },
		getAttribute(name) {
			if (name === 'hidden') return hidden ? '' : null
			return Object.prototype.hasOwnProperty.call(attrs, name) ? String(attrs[name]) : null
		},
	}
	for (const c of node.children) c.parentElement = node
	return node
}

function withQuery(node) {
	const all = []
	const walk = (n) => { all.push(n); n.children.forEach(walk) }
	walk(node)
	const hit = (n, sel) => {
		if (sel === '[data-sidebar-right-open="true"]') return n.attrs['data-sidebar-right-open'] === 'true'
		if (sel === '[data-rightbar-collapsed]') return Object.prototype.hasOwnProperty.call(n.attrs, 'data-rightbar-collapsed')
		if (sel === '[data-sidebar-right-panel]') return Object.prototype.hasOwnProperty.call(n.attrs, 'data-sidebar-right-panel')
		throw new Error('未支持的选择器 ' + sel)
	}
	node.querySelector = (sel) => all.find((n) => hit(n, sel)) || null
	node.querySelectorAll = (sel) => all.filter((n) => hit(n, sel))
	return node
}

const HIDE = 'html body:not(' + LIVE + ') [data-rightbar-collapsed="true"] [data-sidebar-right-panel]'

function run(text) {
	const api = load(text)
	const failed = []
	const check = (id, ok) => { if (!ok) failed.push(id) }
	const hiddenOpen = el({ 'data-sidebar-right-panel': 'push', 'data-sidebar-right-open': 'true' }, [], false)
	const hiddenWrap = el({ 'data-sidebar-right-session': 'old' }, [hiddenOpen], true)
	const fg = el({ 'data-sidebar-right-panel': 'push', 'aria-hidden': 'true' })
	const frame = el({ 'data-rightbar-collapsed': 'true' }, [hiddenWrap, fg])
	check('H1', api.mpwRightbarOpenIsLive(hiddenOpen) === false)
	check('H2', api.mpwRightbarOpenIsLive(el({ 'data-sidebar-right-open': 'true' })) === true)
	check('H3', api.mpwRightbarParkedFrom(withQuery(frame)) === true)
	check('H4', api.mpwRightbarParkedFrom(withQuery(el({}, [hiddenWrap]))) === true)
	check('H5', api.mpwRightbarParkedFrom(withQuery(el({}, [el({ 'data-sidebar-right-panel': 'push', 'aria-hidden': 'true' })]))) === true)
	const liveOpen = el({ 'data-sidebar-right-panel': 'push', 'data-sidebar-right-open': 'true' })
	const liveFrame = el({ 'data-rightbar-collapsed': 'true' }, [liveOpen])
	check('H6', api.mpwRightbarParkedFrom(withQuery(liveFrame)) === false)
	check('C1', !text.includes(BARE))
	check('C2', text.includes(HIDE))
	return failed
}

const red = run(src)
if (red.length) {
	console.error('rightbar-session-switch FAIL ' + red.join(','))
	process.exit(1)
}

function mutant(text, from, to) {
	const n = text.split(from).length - 1
	if (n !== 1) throw new Error('变异锚点命中 ' + n + ' 次：' + from.slice(0, 60))
	return text.replace(from, to)
}

const cases = [
	['M1 不再看 hidden', 'p.hasAttribute(\'hidden\')) return false', 'p.hasAttribute(\'hidden\')) return true', ['H1', 'H3', 'H4']],
	['M2 恢复裸 :has', HIDE, HIDE.split(LIVE).join(BARE), ['C1', 'C2']],
]
for (const [name, from, to, expect] of cases) {
	const got = run(mutant(src, from, to)).filter((id) => expect.includes(id))
	const missing = expect.filter((id) => !got.includes(id))
	if (missing.length) {
		console.error(name + ' 没有打红 ' + missing.join(','))
		process.exit(1)
	}
}
console.log('rightbar-session-switch-test: ok (' + cases.length + ' mutants)')
