/**
 * 轻量 Markdown 渲染器，输出 uni-app <rich-text> 可用的节点数组。
 *
 * App 端的逻辑层和视图层是分开的，不能直接操作 DOM，也不适合引入依赖
 * document 的解析库；这里只做聊天里常见的 Markdown 语法：
 * 标题、段落、代码块/行内代码、加粗/斜体、列表、引用、表格、分隔线、链接。
 *
 * 所有输出都是受控节点（text / 少量标签 + 内联样式），原始 HTML 会按
 * 普通文本处理，不会被当作标签执行。
 */

const MONO = 'ui-monospace, Menlo, Consolas, monospace'

/**
 * Markdown 的颜色各写一套，浅色模式是白底黑字，深色模式是黑底白字。
 * rich-text 只能吃内联样式，不能直接继承页面 CSS 变量，所以这里按主题
 * 生成具体颜色。
 */
function markdownStyles(theme) {
  const light = theme === 'light'
  const ink = light ? '#000000' : '#ffffff'
  return {
    paragraph:
      'margin:0 0 10px;line-height:1.68;white-space:pre-wrap;word-break:break-word;',
    quoteParagraph:
      'margin:0;line-height:1.68;white-space:pre-wrap;word-break:break-word;',
    heading: [
      `margin:16px 0 8px;font-size:21px;line-height:1.35;font-weight:700;color:${ink};`,
      `margin:14px 0 8px;font-size:19px;line-height:1.35;font-weight:700;color:${ink};`,
      `margin:12px 0 6px;font-size:17px;line-height:1.35;font-weight:700;color:${ink};`,
      `margin:10px 0 6px;font-size:15.5px;line-height:1.35;font-weight:700;color:${ink};`
    ],
    hr: `border:none;border-top:1px solid ${light ? '#e0e0e0' : '#292929'};margin:14px 0;`,
    quote: light
      ? 'margin:12px 0;padding:8px 14px;border-left:3px solid #000000;border-radius:0 8px 8px 0;background:#f5f5f5;color:#666666;'
      : 'margin:10px 0;padding:6px 12px;border-left:3px solid #3d3d3d;color:#d4d4d4;',
    pre: light
      ? 'margin:12px 0;padding:14px;background:#f7f7f7;border:1px solid #e0e0e0;border-radius:10px;white-space:pre-wrap;word-break:break-word;'
      : 'margin:10px 0;padding:12px;background:#050505;border:1px solid #292929;border-radius:8px;white-space:pre-wrap;word-break:break-word;',
    codeBlock: `font-family:${MONO};font-size:12.5px;line-height:1.6;color:${light ? '#111111' : '#e6e6e6'};`,
    codeInline: `font-family:${MONO};font-size:0.9em;background:${light ? '#ebebeb' : '#1a1a1a'};color:${light ? '#111111' : '#e6e6e6'};padding:1px 5px;border-radius:4px;`,
    list: 'margin:8px 0;padding-left:22px;',
    nestedList: 'margin:4px 0;padding-left:20px;',
    listItem:
      'margin:3px 0;line-height:1.68;white-space:pre-wrap;word-break:break-word;',
    tableWrap: 'margin:12px 0;',
    table: 'border-collapse:collapse;width:100%;font-size:12.5px;line-height:1.5;',
    tableHead: `border:1px solid ${light ? '#e0e0e0' : '#292929'};padding:6px 8px;text-align:left;background:${light ? '#f5f5f5' : '#131313'};color:${ink};font-weight:600;word-break:break-word;`,
    tableCell: `border:1px solid ${light ? '#ededed' : '#202020'};padding:6px 8px;text-align:left;color:${light ? '#666666' : '#d4d4d4'};word-break:break-word;`,
    link: `color:${ink};text-decoration:underline;`,
    imageWrap: 'margin:12px 0 14px;',
    image: `display:block;width:100%;height:auto;border-radius:10px;border:1px solid ${light ? '#e0e0e0' : '#292929'};background:${light ? '#f5f5f5' : '#0a0a0a'};`,
    imageCaption: `margin:6px 2px 0;font-size:12px;line-height:1.55;color:${light ? '#666666' : '#b4b4b4'};text-align:center;`
  }
}

const DARK_STYLE = markdownStyles('dark')
const LIGHT_STYLE = markdownStyles('light')

function textNode(value) {
  return { type: 'text', text: String(value ?? '') }
}

function element(name, style, children) {
  return { name, attrs: { style }, children: children || [] }
}

/* ------------------------------------------------------------------ */
/* 行内语法                                                            */
/* ------------------------------------------------------------------ */

function inlineNodes(input, style) {
  const value = String(input ?? '')
  const nodes = []
  let index = 0
  let buffer = ''

  const flush = () => {
    if (!buffer) return
    nodes.push(textNode(buffer))
    buffer = ''
  }

  while (index < value.length) {
    const rest = value.slice(index)

    if (rest.startsWith('`')) {
      const end = value.indexOf('`', index + 1)
      if (end > index + 1) {
        flush()
        nodes.push(element('code', style.codeInline, [textNode(value.slice(index + 1, end))]))
        index = end + 1
        continue
      }
    }

    if (rest.startsWith('**') || rest.startsWith('__')) {
      const marker = rest.slice(0, 2)
      const end = value.indexOf(marker, index + 2)
      if (end > index + 2) {
        flush()
        nodes.push(
          element('strong', 'font-weight:700;', inlineNodes(value.slice(index + 2, end), style))
        )
        index = end + 2
        continue
      }
    }

    const character = value[index]
    if (character === '*' || character === '_') {
      const previous = index > 0 ? value[index - 1] : ' '
      const isWordUnderscore = character === '_' && /[A-Za-z0-9]/.test(previous)
      if (!isWordUnderscore) {
        const end = value.indexOf(character, index + 1)
        if (end > index + 1) {
          flush()
          nodes.push(
            element('em', 'font-style:italic;', inlineNodes(value.slice(index + 1, end), style))
          )
          index = end + 1
          continue
        }
      }
    }

    if (character === '[') {
      const match = rest.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/)
      if (match) {
        flush()
        nodes.push({
          name: 'span',
          attrs: { style: style.link, title: match[2] },
          children: [textNode(match[1])]
        })
        index += match[0].length
        continue
      }
    }

    if (character === '<') {
      const match = rest.match(/^<(https?:\/\/[^>\s]+)>/)
      if (match) {
        flush()
        nodes.push({
          name: 'span',
          attrs: { style: style.link, title: match[1] },
          children: [textNode(match[1])]
        })
        index += match[0].length
        continue
      }
    }

    buffer += character
    index += 1
  }

  flush()
  return nodes
}

/* ------------------------------------------------------------------ */
/* 块级语法                                                            */
/* ------------------------------------------------------------------ */

function matchListLine(line) {
  const match = String(line).match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
  if (!match) return null
  return {
    indent: match[1].replace(/\t/g, '  ').length,
    ordered: /^\d/.test(match[2]),
    text: match[3]
  }
}

function isBlockStart(line) {
  const trimmed = String(line).trim()
  if (!trimmed) return true
  if (/^```/.test(trimmed)) return true
  if (/^#{1,6}\s+/.test(trimmed)) return true
  if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) return true
  if (/^>/.test(trimmed)) return true
  if (/^([-*+]|\d+[.)])\s+/.test(trimmed)) return true
  return false
}

function splitTableRow(line) {
  let value = String(line).trim()
  if (value.startsWith('|')) value = value.slice(1)
  if (value.endsWith('|')) value = value.slice(0, -1)
  return value.split('|').map((cell) => cell.trim())
}

function isTableSeparator(line) {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell))
}

function buildList(lines, startIndex, style) {
  const first = matchListLine(lines[startIndex])
  const root = element(first.ordered ? 'ol' : 'ul', style.list, [])
  const stack = [{ indent: first.indent, list: root }]
  let index = startIndex

  while (index < lines.length) {
    if (!lines[index].trim()) {
      let lookahead = index + 1
      while (lookahead < lines.length && !lines[lookahead].trim()) lookahead += 1
      const next = matchListLine(lines[lookahead] || '')
      if (next && next.indent >= first.indent) {
        index = lookahead
        continue
      }
      break
    }

    const item = matchListLine(lines[index])
    if (!item || item.indent < first.indent) break

    while (stack.length > 1 && item.indent < stack[stack.length - 1].indent) {
      stack.pop()
    }

    let frame = stack[stack.length - 1]
    if (item.indent > frame.indent) {
      const parentItem = frame.list.children[frame.list.children.length - 1]
      if (parentItem) {
        const nested = element(item.ordered ? 'ol' : 'ul', style.nestedList, [])
        parentItem.children.push(nested)
        frame = { indent: item.indent, list: nested }
        stack.push(frame)
      }
    } else if (item.ordered !== (frame.list.name === 'ol')) {
      break
    }

    frame.list.children.push(element('li', style.listItem, inlineNodes(item.text, style)))
    index += 1
  }

  return { node: root, nextIndex: index }
}

function buildTable(lines, startIndex, style) {
  const headers = splitTableRow(lines[startIndex])
  const rows = []
  let index = startIndex + 2
  while (index < lines.length && lines[index].trim().startsWith('|')) {
    rows.push(splitTableRow(lines[index]))
    index += 1
  }

  const headRow = element('tr', '', [])
  for (const cell of headers) {
    headRow.children.push(element('th', style.tableHead, inlineNodes(cell, style)))
  }
  const head = element('thead', '', [headRow])

  const body = element('tbody', '', [])
  for (const row of rows) {
    const tr = element('tr', '', [])
    const count = Math.max(headers.length, row.length)
    for (let column = 0; column < count; column += 1) {
      tr.children.push(element('td', style.tableCell, inlineNodes(row[column] || '', style)))
    }
    body.children.push(tr)
  }

  const table = element('table', style.table, [head, body])
  return { node: element('div', style.tableWrap, [table]), nextIndex: index }
}

/**
 * 把一段 Markdown 文本转换成 <rich-text> 的 nodes 数组。
 * 空文本返回空数组。
 */
export function renderMarkdown(input, options = {}) {
  const style = options.theme === 'light' ? LIGHT_STYLE : DARK_STYLE
  // 图片默认不解析：聊天回复里的 ![](...) 不能触发远程图片请求。
  // 只有内置手册这类可信来源才显式打开，并通过 resolveImage 拿到内联 data URL。
  const allowImages = options.allowImages === true
  const resolveImage =
    typeof options.resolveImage === 'function' ? options.resolveImage : null
  const lines = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const nodes = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(/^\s*```+\s*([\w+#.-]*)\s*$/)
    if (fence) {
      const codeLines = []
      index += 1
      while (index < lines.length && !/^\s*```+\s*$/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      nodes.push(
        element('pre', style.pre, [
          element('code', style.codeBlock, [textNode(codeLines.join('\n'))])
        ])
      )
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = Math.min(4, heading[1].length)
      nodes.push(
        element(`h${level}`, style.heading[level - 1], inlineNodes(heading[2].trim(), style))
      )
      index += 1
      continue
    }

    const image = allowImages
      ? line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/)
      : null
    if (image) {
      index += 1
      let src = ''
      try {
        src = resolveImage ? resolveImage(image[2]) : ''
      } catch {
        src = ''
      }
      if (typeof src === 'string' && /^data:image\//i.test(src)) {
        const children = [
          {
            name: 'img',
            attrs: { src, alt: image[1], style: style.image },
            children: []
          }
        ]
        if (image[1]) {
          children.push(element('p', style.imageCaption, [textNode(image[1])]))
        }
        nodes.push(element('div', style.imageWrap, children))
      } else if (image[1]) {
        // 图片缺失时至少保留图注，读者能知道这里原本该有什么。
        nodes.push(element('p', style.imageCaption, [textNode(image[1])]))
      } else {
        nodes.push(element('p', style.paragraph, [textNode(image[2])]))
      }
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      nodes.push({ name: 'hr', attrs: { style: style.hr }, children: [] })
      index += 1
      continue
    }

    if (/^\s*>/.test(line)) {
      const quoteLines = []
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      nodes.push(
        element('blockquote', style.quote, [
          element('p', style.quoteParagraph, inlineNodes(quoteLines.join('\n'), style))
        ])
      )
      continue
    }

    if (line.trim().startsWith('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const table = buildTable(lines, index, style)
      nodes.push(table.node)
      index = table.nextIndex
      continue
    }

    if (matchListLine(line)) {
      const list = buildList(lines, index, style)
      nodes.push(list.node)
      index = list.nextIndex
      continue
    }

    const paragraphLines = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      const next = lines[index].trim()
      if (
        next.startsWith('|') &&
        index + 1 < lines.length &&
        isTableSeparator(lines[index + 1])
      ) {
        break
      }
      paragraphLines.push(lines[index])
      index += 1
    }
    nodes.push(
      element('p', style.paragraph, inlineNodes(paragraphLines.join('\n'), style))
    )
  }

  return nodes
}
