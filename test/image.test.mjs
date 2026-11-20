/**
 * 图片选择与压缩：App 端必须返回可直接显示的本地预览路径，
 * 并保证读不出文件时给出明确错误，而不是静默无图。
 */

import './locale-zh.mjs'

import test from 'node:test'
import assert from 'node:assert/strict'

import { pickImageAttachments, pickImageDataUrls } from '../lib/image.js'

const SMALL_DATA_URL = 'data:image/jpeg;base64,AAAA'

function cleanup() {
  delete globalThis.uni
  delete globalThis.plus
}

function installMocks({ paths, dataUrls = {}, compress } = {}) {
  const calls = { compress: [], reads: [] }
  globalThis.uni = {
    chooseImage(options) {
      options.success({
        tempFilePaths: paths,
        tempFiles: paths.map((path) => ({ path }))
      })
    },
    getImageInfo(options) {
      options.success({ width: 800, height: 600 })
    },
    compressImage(options) {
      calls.compress.push(options)
      const next = compress ? compress(options) : 'file:///tmp/compressed.jpg'
      if (next) options.success({ tempFilePath: next })
      else options.fail?.({ errMsg: 'compressImage:fail' })
    }
  }
  globalThis.plus = {
    io: {
      FileReader: class {
        readAsDataURL(file) {
          calls.reads.push(file.path)
          const result = dataUrls[file.path]
          if (result) this.onload?.({ target: { result } })
          else this.onerror?.({})
        }
      },
      resolveLocalFileSystemURL(path, success, fail) {
        if (!dataUrls[path]) {
          fail?.({})
          return
        }
        success({
          file(callback) {
            callback({ path })
          }
        })
      }
    }
  }
  return calls
}

test('App 端返回本地预览路径和压缩后的 data URL', async () => {
  const calls = installMocks({
    paths: ['file:///src/photo.jpg'],
    dataUrls: { 'file:///tmp/compressed.jpg': SMALL_DATA_URL }
  })
  const items = await pickImageAttachments(3)
  assert.equal(items.length, 1)
  // 缩略图用本地路径，<image> / previewImage 在真机上最稳。
  assert.equal(items[0].preview, 'file:///src/photo.jpg')
  assert.equal(items[0].url, SMALL_DATA_URL)
  assert.ok(calls.compress.length > 0)
  cleanup()
})

test('没有 plus 时退回文件系统管理器读取 base64', async () => {
  globalThis.uni = {
    chooseImage(options) {
      options.success({ tempFilePaths: ['_doc/p.jpg'], tempFiles: [{ path: '_doc/p.jpg' }] })
    },
    getImageInfo(options) {
      options.success({ width: 1000, height: 1000 })
    },
    compressImage(options) {
      options.success({ tempFilePath: '_doc/compressed.jpg' })
    },
    getFileSystemManager() {
      return {
        readFile(options) {
          if (options.filePath === '_doc/compressed.jpg') options.success({ data: 'BBBB' })
          else options.fail({})
        }
      }
    }
  }
  const items = await pickImageAttachments(1)
  assert.equal(items[0].preview, '_doc/p.jpg')
  assert.equal(items[0].url, 'data:image/jpeg;base64,BBBB')
  cleanup()
})

test('一张失败不影响其他图片', async () => {
  installMocks({
    paths: ['file:///bad.jpg', 'file:///ok.jpg'],
    dataUrls: { 'file:///tmp/ok.jpg': SMALL_DATA_URL },
    compress: (options) => (options.src.includes('bad') ? 'file:///tmp/bad.jpg' : 'file:///tmp/ok.jpg')
  })
  const items = await pickImageAttachments(3)
  assert.equal(items.length, 1)
  assert.equal(items[0].preview, 'file:///ok.jpg')
  cleanup()
})

test('全部读取失败时抛出明确错误', async () => {
  installMocks({ paths: ['file:///bad.jpg'], dataUrls: {} })
  await assert.rejects(pickImageAttachments(1), /无法读取图片文件|图片太大/)
  cleanup()
})

test('用户取消选择返回空数组', async () => {
  globalThis.uni = {
    chooseImage(options) {
      options.fail({ errMsg: 'chooseImage:fail cancel' })
    }
  }
  assert.deepEqual(await pickImageAttachments(3), [])
  cleanup()
})

test('pickImageDataUrls 仍只返回 data URL 字符串', async () => {
  installMocks({
    paths: ['file:///src/photo.jpg'],
    dataUrls: { 'file:///tmp/compressed.jpg': SMALL_DATA_URL }
  })
  assert.deepEqual(await pickImageDataUrls(1), [SMALL_DATA_URL])
  cleanup()
})
