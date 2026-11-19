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
