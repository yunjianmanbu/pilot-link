import './locale-zh.mjs'

import test from 'node:test'
import assert from 'node:assert/strict'

import { utf8Encode } from '../lib/bytes.js'
import {
  base64ToBytes,
  bytesToBase64,
  downloadRemoteFile,
  fileActionLabel,
  fileKind,
  fileUrlOf,
  formatFileSize,
  htmlPreviewDocument,
  isBrowserFileScope,
  isHtmlName,
  localFilePathFor,
  openLocalFile,
  readRemoteBytes,
  readRemoteText,
  safeFileName,
  writeLocalText
} from '../lib/files.js'

function chunkedRequest(bytes, chunkSize = 7, expectedPath = 'C:/docs/example.txt') {
  const calls = []
  const request = async (method, params) => {
    assert.equal(method, 'files.read')
    calls.push({ ...params })
    assert.equal(params.workspacePath, 'C:/docs')
    assert.equal(params.file, expectedPath)
    const offset = Number(params.offset) || 0
    // 模拟弱网/中继限制：每次最多只返回 chunkSize 字节。
    const length = Math.min(Number(params.length) || chunkSize, chunkSize)
    const end = Math.min(offset + length, bytes.length)
    const slice = bytes.subarray(offset, end)
    return {
      name: 'example.txt',
      size: bytes.length,
      mtime: 1700000000000,
      offset,
      length: slice.length,
      eof: end >= bytes.length,
      data: bytesToBase64(slice)
    }
  }
  request.calls = calls
  return request
}

function makeFakePlus() {
  const store = new Map()
  const writerFor = (name) => {
    const writer = {
      _pos: 0,
      seek(position) {
        writer._pos = Math.max(0, Number(position) || 0)
      },
      writeAsBinary(base64) {
        const bytes = base64ToBytes(base64)
        const current = (store.get(name) || []).slice()
        for (let index = 0; index < bytes.length; index += 1) {
          current[writer._pos + index] = bytes[index]
        }
        writer._pos += bytes.length
        store.set(name, current)
        setTimeout(() => writer.onwriteend && writer.onwriteend(), 0)
      },
      close() {}
    }
    return writer
  }
  const fileEntry = (name) => ({
    remove(success) {
      store.delete(name)
      success && success()
    },
    createWriter(ok) {
      ok(writerFor(name))
    },
    getMetadata(success) {
      success({ size: (store.get(name) || []).length })
    }
  })
  const dirEntry = {
    getDirectory(name, options, ok) {
      ok(dirEntry)
    },
    getFile(name, options, ok, fail) {
      if (!store.has(name) && !options?.create) {
        fail && fail({ message: 'not found' })
        return
      }
      if (options?.create && !store.has(name)) store.set(name, [])
      ok(fileEntry(name))
    }
  }
  return {
    store,
    plusApi: {
      io: {
        PRIVATE_DOC: 2,
        requestFileSystem(type, success) {
          success({ root: dirEntry })
        },
        convertLocalFileSystemURL(value) {
          return `/absolute/${value}`
        }
      }
    }
  }
}

test('base64 编解码支持任意长度', () => {
  const all = Uint8Array.from({ length: 256 }, (_, index) => index)
  assert.deepEqual(base64ToBytes(bytesToBase64(all)), all)
  for (const length of [0, 1, 2, 3, 4, 5, 17]) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) & 0xff)
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes, `长度 ${length}`)
  }
  assert.equal(bytesToBase64(new TextEncoder().encode('你好')), '5L2g5aW9')
  assert.equal(new TextDecoder().decode(base64ToBytes('5L2g5aW9')), '你好')
})

test('文件类型与展示信息', () => {
  assert.equal(fileKind('报告.md'), 'markdown')
  assert.equal(fileKind('说明.TXT'), 'text')
  assert.equal(fileKind('截图.PNG'), 'image')
  assert.equal(fileKind('季度报告.docx'), 'document')
  assert.equal(fileKind('打包.zip'), 'binary')
  assert.equal(fileActionLabel('write'), '新增')
  assert.equal(fileActionLabel('edit'), '修改')
  assert.equal(fileActionLabel('generate'), '生成')
  assert.equal(formatFileSize(0), '0 B')
  assert.equal(formatFileSize(1536), '1.5 KB')
  assert.equal(formatFileSize(5 * 1024 * 1024), '5.0 MB')
  assert.equal(safeFileName('a/b\\c:*?.md'), 'c___.md')
  assert.match(localFilePathFor('报告.docx'), /_doc\/pilot-files\/报告\.docx$/)
})

test('分块读取文本：跨块的多字节字符不会被截断', async () => {
  const text = '第一段\n第二段：中文与 emoji 👋\n最后一行'
  const bytes = utf8Encode(text)
  const request = chunkedRequest(bytes, 5)
  const progress = []
  const result = await readRemoteText(request, {
    workspacePath: 'C:/docs',
    path: 'C:/docs/example.txt',
    onProgress: (item) => progress.push(item.received)
  })
  assert.equal(result.text, text)
  assert.equal(result.truncated, false)
  assert.equal(result.size, bytes.length)
  assert.ok(progress.length > 1, '按块汇报进度')
  assert.equal(progress.at(-1), bytes.length)
})

test('超过预览上限时只读取前一段并标记截断', async () => {
  const bytes = utf8Encode('0123456789abcdef'.repeat(4))
  const request = chunkedRequest(bytes, 8)
  const result = await readRemoteBytes(request, {
    workspacePath: 'C:/docs',
    path: 'C:/docs/example.txt',
    maxBytes: 20
  })
  assert.equal(result.bytes.length, 20)
  assert.equal(result.truncated, true)
  assert.equal(result.size, bytes.length)
})

test('分块下载写入 App 私有目录并校验大小', async () => {
  const content = utf8Encode('文档内容'.repeat(50))
  const request = chunkedRequest(content, 9, 'C:/docs/报告.docx')
  const { plusApi, store } = makeFakePlus()
  const progress = []
  const result = await downloadRemoteFile(
    request,
    { path: 'C:/docs/报告.docx', name: '报告.docx', size: content.length },
    {
      workspacePath: 'C:/docs',
      plus: plusApi,
      onProgress: (item) => progress.push(item.received)
    }
  )
  assert.deepEqual(Uint8Array.from(store.get('报告.docx')), content)
  assert.equal(result.size, content.length)
  assert.equal(result.localPath, '_doc/pilot-files/报告.docx')
  assert.equal(result.filePath, '/absolute/_doc/pilot-files/报告.docx')
  assert.equal(progress.at(-1), content.length)
})

test('HTML 文件识别与安全预览文档', () => {
  assert.equal(isHtmlName('report.HTML'), true)
  assert.equal(isHtmlName('index.htm'), true)
  assert.equal(isHtmlName('notes.md'), false)
  assert.equal(fileKind('report.html'), 'text')

  const raw =
    '<!doctype html><html><head><title>季度报告</title>' +
    '<script>alert("x")</script><meta http-equiv="refresh" content="0;url=https://bad">' +
    '<base href="https://evil/"></head><body onload="steal()"><h1>结果</h1>' +
    '<style>.k{color:red}</style><img src="data:image/png;base64,AA"></body></html>'
  const doc = htmlPreviewDocument(raw, '季度报告.html')

  assert.match(doc, /Content-Security-Policy/)
  assert.match(doc, /script-src 'none'/)
  assert.doesNotMatch(doc, /alert\("x"\)/)
  assert.doesNotMatch(doc, /http-equiv="refresh"/)
  assert.doesNotMatch(doc, /<base /)
  assert.match(doc, /<h1>结果<\/h1>/)
  assert.match(doc, /\.k\{color:red\}/)
  assert.ok(
    doc.indexOf('Content-Security-Policy') < doc.indexOf('</head>'),
    'CSP 必须在 head 内尽早生效'
  )

  const fragment = htmlPreviewDocument('<p>纯片段</p>', '片段.html')
  assert.match(fragment, /^<!doctype html><html><head>/)
  assert.match(fragment, /<body><p>纯片段<\/p><\/body>/)
})

test('HTML 本地地址与文件写入', async () => {
  assert.equal(
    fileUrlOf('/data/user/0/app/doc/preview-报告.html'),
    'file:///data/user/0/app/doc/preview-%E6%8A%A5%E5%91%8A.html'
  )
  assert.equal(fileUrlOf('https://example.com/a.html'), 'https://example.com/a.html')

  const { plusApi, store } = makeFakePlus()
  const result = await writeLocalText('preview-报告.html', '<h1>你好</h1>', { plus: plusApi })
  assert.equal(result.localPath, '_doc/pilot-files/preview-报告.html')
  assert.equal(result.filePath, '/absolute/_doc/pilot-files/preview-报告.html')
  const written = new TextDecoder().decode(Uint8Array.from(store.get('preview-报告.html')))
  assert.equal(written, '<h1>你好</h1>')
  assert.equal(result.size, utf8Encode('<h1>你好</h1>').length)
})

test('缺少工作区时拒绝分块读取', async () => {
  await assert.rejects(
    readRemoteBytes(async () => ({}), { path: 'C:/docs/a.txt' }),
    /缺少工作区信息/
  )
})

/**
 * 假的浏览器环境：Blob / URL.createObjectURL / document.createElement('a')。
 * 只够跑 H5 分支，不引入 jsdom。
 */
function makeFakeBrowser() {
  const created = []
  const anchors = []
  const revoked = []
  const blobs = []
  const web = {
    document: {
      createElement(tag) {
        assert.equal(tag, 'a')
        const anchor = { tag, href: '', download: '', rel: '', clicked: false, removed: false }
        anchor.click = () => {
          anchor.clicked = true
          created.push(anchor)
        }
        anchor.remove = () => {
          anchor.removed = true
        }
        anchors.push(anchor)
        return anchor
      },
      body: {
        appendChild(node) {
          node.attached = true
        },
        removeChild(node) {
          node.removed = true
        }
      }
    },
    URL: {
      createObjectURL(blob) {
        blobs.push(blob)
        return `blob:pilot/${blobs.length}`
      },
      revokeObjectURL(url) {
        revoked.push(url)
      }
    },
    open(url) {
      opened.push(url)
      return {}
    },
    setTimeout() {
      return 0
    }
  }
  const opened = []
  web.Blob = class Blob {
    constructor(parts, options = {}) {
      this.parts = parts
      this.type = options.type || ''
      const total = parts.reduce((sum, part) => {
        if (typeof part === 'string') return sum + utf8Encode(part).length
        return sum + (part?.length || 0)
      }, 0)
      this.size = total
    }
  }
  return { web, anchors, created, opened, revoked, blobs }
}

test('网页版（H5/PWA）没有 plus.io 时用 Blob 下载而不是报错', async () => {
  const content = utf8Encode('网页版文件内容')
  const request = chunkedRequest(content, 5, 'C:/docs/notes.txt')
  const { web, blobs } = makeFakeBrowser()

  assert.equal(isBrowserFileScope({ window: web }), true)

  const result = await downloadRemoteFile(
    request,
    { path: 'C:/docs/notes.txt', name: 'notes.txt', size: content.length },
    { workspacePath: 'C:/docs', plus: null, window: web }
  )

  assert.equal(result.web, true)
  assert.equal(result.filePath, 'blob:pilot/1')
  assert.equal(result.size, content.length)
  assert.equal(result.mime, 'text/plain;charset=utf-8')
  // 分块被完整拼回一个 Blob，没有丢字节
  assert.equal(blobs.length, 1)
  assert.equal(blobs[0].size, content.length)
})

test('网页版写文本返回 blob URL，不尝试落盘', async () => {
  const { web, blobs } = makeFakeBrowser()
  const result = await writeLocalText('preview-报告.html', '<h1>你好</h1>', {
    plus: null,
    window: web
  })
  assert.equal(result.web, true)
  assert.equal(result.name, 'preview-报告.html')
  assert.match(result.filePath, /^blob:pilot\//)
  assert.equal(result.size, utf8Encode('<h1>你好</h1>').length)
  assert.equal(blobs[0].type, 'text/plain;charset=utf-8')
})

test('网页版打开文档走下载，图片走新标签', async () => {
  const { web, created, opened } = makeFakeBrowser()

  const doc = await openLocalFile('blob:pilot/1', '报告.docx', { window: web })
  assert.equal(doc, true)
  assert.equal(created.length, 1)
  assert.equal(created[0].download, '报告.docx')
  assert.equal(created[0].clicked, true)
  assert.equal(opened.length, 0)

  const image = await openLocalFile('blob:pilot/2', 'shot.png', { window: web })
  assert.equal(image, true)
  assert.deepEqual(opened, ['blob:pilot/2'])
})

test('既没有 plus.io 也没有浏览器时，仍给出明确错误', async () => {
  await assert.rejects(
    downloadRemoteFile(async () => ({}), { path: 'C:/docs/a.txt' }, {
      workspacePath: 'C:/docs',
      plus: null,
      window: null
    }),
    /当前环境不支持保存文件/
  )
})
