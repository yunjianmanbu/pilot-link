import test from 'node:test'
import assert from 'node:assert/strict'

import { base64ToBytes, bytesToBase64 } from '../lib/files.js'
import {
  androidOpenableInfo,
  collectAndroidUris,
  copyAndroidUri,
  createUploadReader,
  pickAndroidUploadFiles,
  pickedUploadFiles,
  pickUploadFiles,
  UPLOAD_LIMIT,
  uploadFileToWorkspace
} from '../lib/upload.js'

function fakePlus(bytes) {
  const localFile = {
    size: bytes.length,
    slice(start, end) {
      return { bytes: bytes.subarray(start, end) }
    }
  }
  class FileReader {
    readAsDataURL(file) {
      setTimeout(() => {
        try {
          this.result = `data:application/octet-stream;base64,${bytesToBase64(file.bytes)}`
          this.onload?.({ target: { result: this.result } })
        } catch {
          this.onerror?.()
        }
      }, 0)
    }
  }
  return {
    localFile,
    io: {
      FileReader,
      resolveLocalFileSystemURL(path, success) {
        success({ file: (ok) => ok(localFile) })
      }
    }
  }
}

function fakeWorkspaceServer(bytes) {
  let received = []
  const calls = []
  const request = async (method, params) => {
    calls.push({ method, params })
    if (method === 'files.upload.begin') {
      return { uploadId: 'upload-1', path: 'uploads/example.bin', name: 'example.bin' }
    }
    if (method === 'files.upload.chunk') {
      assert.equal(params.uploadId, 'upload-1')
      assert.equal(params.offset, received.length)
      received = received.concat([...base64ToBytes(params.data)])
      return { received: received.length, size: bytes.length }
    }
    if (method === 'files.upload.finish') {
      return { path: 'uploads/example.bin', name: 'example.bin', size: received.length }
    }
    if (method === 'files.upload.cancel') return { ok: true }
    throw new Error(`unexpected method: ${method}`)
  }
  request.calls = calls
  request.received = () => Uint8Array.from(received)
  return request
}

function fakeUri(value) {
  return {
    toString: () => value,
    getLastPathSegment: () => value.split('/').pop()
  }
}

function fakeAndroidPicker(uris, { resultCode = -1, clip = uris.length > 1 } = {}) {
  const calls = []
  let main = null
  function Intent(action) {
    this.action = action
    this.categories = []
    this.flags = []
    this.extras = {}
  }
  Intent.ACTION_GET_CONTENT = 'android.intent.action.GET_CONTENT'
  Intent.CATEGORY_OPENABLE = 'android.intent.category.OPENABLE'
  Intent.FLAG_GRANT_READ_URI_PERMISSION = 1
  Intent.EXTRA_ALLOW_MULTIPLE = 'android.intent.extra.ALLOW_MULTIPLE'
  Intent.prototype.setType = function (type) {
    this.type = type
    return this
  }
  Intent.prototype.addCategory = function (category) {
    this.categories.push(category)
    return this
  }
  Intent.prototype.addFlags = function (flag) {
    this.flags.push(flag)
    return this
  }
  Intent.prototype.putExtra = function (key, value) {
    this.extras[key] = value
    return this
  }

  main = {
    startActivityForResult(intent, code) {
      calls.push({ intent, code })
      setTimeout(() => {
        const data = clip
          ? {
              getClipData: () => ({
                getItemCount: () => uris.length,
                getItemAt: (index) => ({ getUri: () => uris[index] })
              }),
              getData: () => uris[0]
            }
          : { getClipData: () => null, getData: () => uris[0] }
        main.onActivityResult(code, resultCode, data)
      }, 0)
    }
  }

  const android = {
    runtimeMainActivity: () => main,
    importClass(name) {
      if (name === 'android.content.Intent') return Intent
      throw new Error(`unexpected class: ${name}`)
    },
    invoke(target, method, ...args) {
      return target[method](...args)
    }
  }
  return {
    plusApi: { android, os: { name: 'Android' }, io: {} },
    main,
    calls
  }
}

function fakeAndroidCopy(bytes, { displayName = 'report.pdf', statSize = bytes.length } = {}) {
  const files = new Map()
  let destination = ''
  class FakeFile {
    constructor(parent, name) {
      if (name === undefined && typeof parent === 'string') {
        this.path = parent
        this.name = parent.split('/').pop()
      } else {
        this.path = `${parent.path}/${name}`
        this.name = name
      }
      if (!files.has(this.path)) files.set(this.path, new Uint8Array(0))
    }

    exists() {
      return files.has(this.path)
    }

    mkdirs() {
      files.set(this.path, new Uint8Array(0))
      return true
    }

    length() {
      return files.get(this.path)?.length || 0
    }

    delete() {
      return files.delete(this.path)
    }
  }

  let offset = 0
  const destinationChannel = {
    transferFrom(_source, position, count) {
      const moved = Math.min(count, bytes.length - offset)
      if (moved <= 0) return 0
      const current = files.get(destination) || new Uint8Array(0)
      const next = new Uint8Array(Math.max(current.length, position + moved))
      next.set(current)
      next.set(bytes.subarray(offset, offset + moved), position)
      files.set(destination, next)
      offset += moved
      return moved
    },
    close() {}
  }

  class FakeFileInputStream {
    getChannel() {
      return { close() {} }
    }

    close() {}
  }

  class FakeFileOutputStream {
    constructor(file) {
      destination = file.path
    }

    getChannel() {
      return destinationChannel
    }

    close() {}
  }

  const resolver = {
    query() {
      const columns = ['_display_name', '_size']
      const values = [displayName, String(statSize)]
      return {
        moveToFirst: () => true,
        getColumnIndex: (name) => columns.indexOf(name),
        getString: (index) => values[index],
        getLong: (index) => Number(values[index]),
        close() {}
      }
    },
    openFileDescriptor() {
      return {
        getFileDescriptor: () => ({ fd: 1 }),
        getStatSize: () => statSize,
        close() {}
      }
    }
  }

  const main = { getContentResolver: () => resolver }
  const android = {
    runtimeMainActivity: () => main,
    importClass(name) {
      if (name === 'java.io.File') return FakeFile
      if (name === 'java.io.FileInputStream') return FakeFileInputStream
      if (name === 'java.io.FileOutputStream') return FakeFileOutputStream
      throw new Error(`unexpected class: ${name}`)
    },
    invoke(target, method, ...args) {
      return target[method](...args)
    }
  }
  return {
    plusApi: {
      android,
      os: { name: 'Android' },
      io: { convertLocalFileSystemURL: () => '/data/app/doc/upload-cache' }
    },
    files
  }
}

test('Android 端用系统文件选择器多选，并限制选择数量', async () => {
  const uris = [
    fakeUri('content://docs/a.pdf'),
    fakeUri('content://docs/b.png'),
    fakeUri('content://docs/c.txt')
  ]
  const picker = fakeAndroidPicker(uris)
  const picked = await pickAndroidUploadFiles(picker.plusApi, 2, {
    copyAndroidUri: (_plus, uri, index) => ({
      name: `file-${index}.bin`,
      size: 3,
      path: `_doc/upload-cache/file-${index}.bin`
    })
  })
  assert.deepEqual(
    picked.map((file) => file.name),
    ['file-0.bin', 'file-1.bin']
  )
  assert.equal(picker.calls.length, 1)
  assert.equal(picker.calls[0].intent.type, '*/*')
  assert.deepEqual(picker.calls[0].intent.categories, ['android.intent.category.OPENABLE'])
  assert.equal(picker.calls[0].intent.extras['android.intent.extra.ALLOW_MULTIPLE'], true)
})

test('Android 端取消选择返回空数组', async () => {
  const picker = fakeAndroidPicker([fakeUri('content://docs/a.pdf')], { resultCode: 0 })
  const picked = await pickAndroidUploadFiles(picker.plusApi, 3, {
    copyAndroidUri: () => {
      throw new Error('should not copy after cancel')
    }
  })
  assert.deepEqual(picked, [])
})

test('Android 复制失败时抛出可读错误，部分成功则保留成功的文件', async () => {
  const picker = fakeAndroidPicker([
    fakeUri('content://docs/a.pdf'),
    fakeUri('content://docs/b.png')
  ])
  await assert.rejects(
    pickAndroidUploadFiles(picker.plusApi, 2, {
      copyAndroidUri: () => {
        throw new Error('provider crashed')
      }
    }),
    /provider crashed/
  )
  const partial = await pickAndroidUploadFiles(picker.plusApi, 2, {
    copyAndroidUri: (_plus, _uri, index) => {
      if (index === 0) throw new Error('provider crashed')
      return { name: 'b.png', size: 2, path: '_doc/upload-cache/b.png' }
    }
  })
  assert.deepEqual(
    partial.map((file) => file.name),
    ['b.png']
  )
})

test('Android 单选结果和 ClipData 都能解析并去重', () => {
  const android = { invoke: () => undefined }
  const first = fakeUri('content://docs/a.pdf')
  const second = fakeUri('content://docs/b.png')
  const multi = {
    getClipData: () => ({
      getItemCount: () => 3,
      getItemAt: (index) => ({ getUri: () => [first, second, first][index] })
    }),
    getData: () => second
  }
  assert.deepEqual(collectAndroidUris(android, multi, 9), [first, second])
  assert.deepEqual(collectAndroidUris(android, multi, 1), [first])
  const single = { getClipData: () => null, getData: () => first }
  assert.deepEqual(collectAndroidUris(android, single, 9), [first])
})

test('Android content:// 通过 FileChannel 复制到私有目录', () => {
  const bytes = Uint8Array.from({ length: 37 }, (_, index) => (index * 13 + 7) & 0xff)
  const harness = fakeAndroidCopy(bytes, { displayName: '季度报告.pdf' })
  const file = copyAndroidUri(harness.plusApi, fakeUri('content://docs/1'), 0)
  assert.equal(file.name, '季度报告.pdf')
  assert.equal(file.size, bytes.length)
  assert.match(file.path, /^_doc\/upload-cache\//)
  assert.equal(file.temporary, true)
  const stored = [...harness.files.entries()].find(([path]) => path.includes('/upload-cache/'))
  assert.deepEqual(stored[1], bytes)
})

test('Android 超过 100 MB 的文件在选择阶段就拒绝', () => {
  const harness = fakeAndroidCopy(Uint8Array.from([1]), {
    displayName: 'huge.bin',
    statSize: UPLOAD_LIMIT + 1
  })
  assert.throws(
    () => copyAndroidUri(harness.plusApi, fakeUri('content://docs/huge'), 0),
    /100 MB/
  )
})

test('Android OpenableColumns 读取名称和大小', () => {
  const harness = fakeAndroidCopy(Uint8Array.from([1, 2, 3]), { displayName: 'a.txt', statSize: 3 })
  const resolver = harness.plusApi.android.runtimeMainActivity().getContentResolver()
  assert.deepEqual(androidOpenableInfo(harness.plusApi.android, resolver, fakeUri('content://a')), {
    name: 'a.txt',
    size: 3
  })
})

test('H5 仍然使用 uni.chooseFile', async () => {
  const picked = await pickUploadFiles(2, {
    plus: null,
    uni: {
      chooseFile(options) {
        options.success({
          tempFilePaths: ['/tmp/a.txt'],
          tempFiles: [{ name: 'a.txt', size: 2, path: '/tmp/a.txt' }]
        })
      }
    }
  })
  assert.deepEqual(
    picked.map((file) => ({ name: file.name, size: file.size, path: file.path })),
    [{ name: 'a.txt', size: 2, path: '/tmp/a.txt' }]
  )
})

test('选择结果整理成名称、大小和读取句柄', () => {
  const picked = pickedUploadFiles({
    tempFilePaths: ['/tmp/a.pdf', '/tmp/b.png'],
    tempFiles: [
      { name: 'a.pdf', size: 12, path: '/tmp/a.pdf' },
      { name: '', size: 34, path: '/tmp/b.png' },
      // H5 may hand back the File object itself.
      { name: 'c.txt', size: 5, slice() {} }
    ]
  })
  assert.deepEqual(
    picked.map((file) => ({ name: file.name, size: file.size, path: file.path })),
    [
      { name: 'a.pdf', size: 12, path: '/tmp/a.pdf' },
      { name: 'b.png', size: 34, path: '/tmp/b.png' },
      { name: 'c.txt', size: 5, path: '' }
    ]
  )
  assert.deepEqual(pickedUploadFiles(null), [])
})

test('App 端通过 plus.io 按偏移读取分块', async () => {
  const bytes = Uint8Array.from({ length: 97 }, (_, index) => (index * 31) & 0xff)
  const reader = await createUploadReader(
    { name: 'x.bin', size: bytes.length, path: '/tmp/x.bin' },
    { plus: fakePlus(bytes) }
  )
  const first = await reader(0, 40)
  const second = await reader(40, 57)
  assert.deepEqual(base64ToBytes(first), bytes.subarray(0, 40))
  assert.deepEqual(base64ToBytes(second), bytes.subarray(40))
})

test('分块上传到工作区并汇报进度', async () => {
  const bytes = Uint8Array.from({ length: 61 }, (_, index) => (index * 17 + 3) & 0xff)
  const request = fakeWorkspaceServer(bytes)
  const progress = []
  const result = await uploadFileToWorkspace(request, {
    workspacePath: 'C:/workspace',
    file: { name: 'example.bin', size: bytes.length, path: '/tmp/example.bin' },
    plus: fakePlus(bytes),
    chunkSize: 20,
    onProgress: (event) => progress.push(event.uploaded)
  })
  assert.equal(result.path, 'uploads/example.bin')
  assert.equal(result.size, bytes.length)
  assert.deepEqual(request.received(), bytes)
  assert.deepEqual(
    request.calls.map((entry) => entry.method),
    [
      'files.upload.begin',
      'files.upload.chunk',
      'files.upload.chunk',
      'files.upload.chunk',
      'files.upload.chunk',
      'files.upload.finish'
    ]
  )
  assert.deepEqual(progress, [20, 40, 60, 61])
  const begin = request.calls[0].params
  assert.equal(begin.workspacePath, 'C:/workspace')
  assert.equal(begin.directory, 'uploads')
  assert.equal(begin.name, 'example.bin')
})

test('Android 临时文件上传成功后从私有目录删除', async () => {
  const bytes = Uint8Array.from({ length: 24 }, (_, index) => index + 1)
  const request = fakeWorkspaceServer(bytes)
  const plusApi = fakePlus(bytes)
  const removed = []
  plusApi.io.resolveLocalFileSystemURL = (path, success) => {
    if (String(path).startsWith('_doc/upload-cache/')) {
      success({
        file: (ok) => ok(plusApi.localFile),
        remove(ok) {
          removed.push(path)
          ok?.()
        }
      })
      return
    }
    success({ file: (ok) => ok(plusApi.localFile) })
  }
  await uploadFileToWorkspace(request, {
    workspacePath: 'C:/workspace',
    file: {
      name: 'example.bin',
      size: bytes.length,
      path: '_doc/upload-cache/example.bin',
      temporary: true
    },
    plus: plusApi
  })
  assert.deepEqual(removed, ['_doc/upload-cache/example.bin'])
})

test('上传失败时也清理选择器产生的临时文件', async () => {
  const plusApi = fakePlus(new Uint8Array(0))
  const removed = []
  plusApi.io.resolveLocalFileSystemURL = (path, success) => {
    success({
      remove(ok) {
        removed.push(path)
        ok?.()
      }
    })
  }
  await assert.rejects(
    uploadFileToWorkspace(
      async () => {
        throw new Error('relay offline')
      },
      {
        workspacePath: 'C:/workspace',
        file: {
          name: 'example.bin',
          size: 4,
          path: '_doc/upload-cache/example.bin',
          temporary: true
        },
        plus: plusApi
      }
    ),
    /relay offline/
  )
  assert.deepEqual(removed, ['_doc/upload-cache/example.bin'])
})

test('空文件也会完成一次上传', async () => {
  const bytes = new Uint8Array(0)
  const request = fakeWorkspaceServer(bytes)
  const result = await uploadFileToWorkspace(request, {
    workspacePath: 'C:/workspace',
    file: { name: 'empty.txt', size: 0, path: '/tmp/empty.txt' },
    plus: fakePlus(bytes)
  })
  assert.equal(result.path, 'uploads/example.bin')
  assert.deepEqual(
    request.calls.map((entry) => entry.method),
    ['files.upload.begin', 'files.upload.finish']
  )
})

test('中途失败会取消电脑端的临时上传', async () => {
  const bytes = Uint8Array.from({ length: 40 }, (_, index) => index)
  let chunkCalls = 0
  const methods = []
  const request = async (method, params) => {
    methods.push(method)
    if (method === 'files.upload.begin') return { uploadId: 'upload-1' }
    if (method === 'files.upload.chunk') {
      chunkCalls += 1
      if (chunkCalls === 2) throw new Error('relay dropped')
      return { received: 20 }
    }
    if (method === 'files.upload.cancel') {
      assert.equal(params.uploadId, 'upload-1')
      return { ok: true }
    }
    throw new Error(`unexpected method: ${method}`)
  }
  await assert.rejects(
    uploadFileToWorkspace(request, {
      workspacePath: 'C:/workspace',
      file: { name: 'x.bin', size: bytes.length, path: '/tmp/x.bin' },
      plus: fakePlus(bytes),
      chunkSize: 20
    }),
    /relay dropped/
  )
  assert.equal(methods.includes('files.upload.cancel'), true)
})

test('超过上限的文件在本地就被拒绝', async () => {
  const request = async () => {
    throw new Error('should not be called')
  }
  await assert.rejects(
    uploadFileToWorkspace(request, {
      workspacePath: 'C:/workspace',
      file: { name: 'huge.bin', size: UPLOAD_LIMIT + 1, path: '/tmp/huge.bin' }
    }),
    /100 MB/
  )
})
