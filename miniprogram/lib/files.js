'use strict';
const directory = () => wx.env.USER_DATA_PATH + '/pixelmusic';
let serial = 0;
function fs() { return wx.getFileSystemManager(); }
function ensure() { try { fs().mkdirSync(directory(), true); } catch (_) {} }
function clean() { ensure(); try { for (const file of fs().readdirSync(directory())) fs().unlinkSync(directory() + '/' + file); } catch (_) {} }
function remove(path) { if (path && path.startsWith(directory() + '/')) try { fs().unlinkSync(path); } catch (_) {} }
function write(data, extension = 'wav') {
  ensure(); const path = directory() + '/' + Date.now() + '-' + (++serial) + '.' + extension;
  return new Promise((resolve, reject) => fs().writeFile({filePath: path, data, encoding: typeof data === 'string' ? 'utf8' : undefined, success: () => resolve(path), fail: reject}));
}
function read(path) { return new Promise((resolve, reject) => fs().readFile({filePath: path, success: result => resolve(result.data), fail: reject})); }
function share(path, name) { return new Promise((resolve, reject) => wx.shareFileMessage({filePath: path, fileName: name.replace(/[\\/:*?"<>|]/g, '-').slice(-180), success: resolve, fail: reject})); }
module.exports = {clean, remove, write, read, share};
