import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.uni = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  getLocale: () => 'en-US'
}

const {
  extractLinks,
  extensionOf,
  isMediaName,
  linkLabel,
  linkifySegments,
  mediaKindOf,
  mediaMimeOf,
  mediaPlayableOnDevice,
  trimUrl
} = await import('../lib/media.js')

test('media kinds are recognised by extension', () => {
  assert.equal(extensionOf('C:\\work\\clip.MP4'), 'mp4')
  assert.equal(mediaKindOf('clip.mp4'), 'video')
  assert.equal(mediaKindOf('movie.webm'), 'video')
  assert.equal(mediaKindOf('track.mp3'), 'audio')
  assert.equal(mediaKindOf('voice.flac'), 'audio')
  assert.equal(mediaKindOf('readme.md'), '')
  assert.equal(mediaKindOf('noext'), '')
  assert.equal(isMediaName('song.m4a'), true)
  assert.equal(isMediaName('notes.txt'), false)
  assert.equal(mediaMimeOf('a.mp4'), 'video/mp4')
  assert.equal(mediaMimeOf('a.flac'), 'audio/flac')
  assert.equal(mediaMimeOf('a.txt'), '')
})

test('containers the system player usually rejects are flagged', () => {
  assert.equal(mediaPlayableOnDevice('a.mp4'), true)
  assert.equal(mediaPlayableOnDevice('a.mp3'), true)
  assert.equal(mediaPlayableOnDevice('a.mkv'), false)
  assert.equal(mediaPlayableOnDevice('a.ogv'), false)
})

test('links are trimmed of trailing punctuation', () => {
  assert.equal(trimUrl('https://a.com/x.'), 'https://a.com/x')
  assert.equal(trimUrl('https://a.com/x）'), 'https://a.com/x')
  assert.equal(trimUrl('https://a.com/a(b)'), 'https://a.com/a(b)')
  assert.equal(trimUrl('https://a.com/a)'), 'https://a.com/a')
  assert.equal(trimUrl('not a link'), '')
  assert.equal(trimUrl('https://localhost:5173/'), 'https://localhost:5173/')
  assert.equal(trimUrl('https://nodot/'), '')
})

test('extractLinks dedupes, limits and skips non-web text', () => {
  const text = [
    '看这个 https://example.com/docs?a=1。',
    '还有 http://localhost:3000/ 和 https://example.com/docs?a=1',
    '以及 <https://a.com/b>'
  ].join('\n')
  const links = extractLinks(text)
  assert.deepEqual(links, [
    'https://example.com/docs?a=1',
    'http://localhost:3000/',
    'https://a.com/b'
  ])
  assert.equal(extractLinks('没有链接').length, 0)
  assert.equal(extractLinks('').length, 0)
  assert.equal(extractLinks('x'.repeat(40_001) + ' https://a.com').length, 0)
  const many = Array.from({ length: 9 }, (_, index) => `https://a.com/${index}`).join(' ')
  assert.equal(extractLinks(many).length, 5)
  assert.equal(extractLinks(many, { limit: 2 }).length, 2)
})

test('linkLabel shortens to host and path', () => {
  assert.equal(linkLabel('https://example.com/'), 'example.com')
  assert.equal(linkLabel('https://example.com/a/b/'), 'example.com/a/b')
  const long = linkLabel(`https://example.com/${'x'.repeat(80)}`, 20)
  assert.equal(long.length, 20)
  assert.ok(long.endsWith('…'))
  assert.equal(linkLabel(''), '')
})

test('links beside Chinese text stop at the punctuation', () => {
  // 中文正文紧跟网址时不能把后面的字吞进链接，否则打开的是坏地址。
  assert.deepEqual(extractLinks('看这个 https://example.com/a?b=1。还有 https://b.com/y'), [
    'https://example.com/a?b=1',
    'https://b.com/y'
  ])
  assert.deepEqual(linkifySegments('看这个 https://example.com/a?b=1。还有'), [
    { index: 0, kind: 'text', text: '看这个 ' },
    { index: 1, kind: 'link', text: 'https://example.com/a?b=1', url: 'https://example.com/a?b=1' },
    { index: 2, kind: 'text', text: '。还有' }
  ])
})

test('linkifySegments keeps order and falls back to plain text', () => {
  assert.deepEqual(linkifySegments('没有链接'), [{ index: 0, kind: 'text', text: '没有链接' }])
  assert.deepEqual(linkifySegments(''), [])
  const mix = linkifySegments('a https://x.com/p b http://y.com/q c')
  assert.deepEqual(
    mix.map((seg) => seg.kind),
    ['text', 'link', 'text', 'link', 'text']
  )
  assert.deepEqual(
    mix.filter((seg) => seg.kind === 'link').map((seg) => seg.url),
    ['https://x.com/p', 'http://y.com/q']
  )
  // 剪掉的右括号要留在文字里，不能连带下一句话。
  const wiki = linkifySegments('见 https://a.com/a_(b) 和 https://a.com/c)')
  assert.deepEqual(
    wiki.filter((seg) => seg.kind === 'link').map((seg) => seg.url),
    ['https://a.com/a_(b)', 'https://a.com/c']
  )
  assert.equal(wiki[wiki.length - 1].text, ')')
})

test('link helpers work without the URL global (App logic layer)', () => {
  // App 的逻辑层跑在 V8 / JSCore 里，没有浏览器那个 URL 构造器。
  const saved = globalThis.URL
  delete globalThis.URL
  try {
    assert.equal(trimUrl('https://a.com/x.'), 'https://a.com/x')
    assert.equal(trimUrl('https://nodot/'), '')
    assert.deepEqual(extractLinks('https://a.com/x https://b.com/y'), [
      'https://a.com/x',
      'https://b.com/y'
    ])
    assert.equal(linkLabel('https://example.com/a/b/?q=1'), 'example.com/a/b/?q=1')
  } finally {
    globalThis.URL = saved
  }
})
