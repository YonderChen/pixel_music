'use strict';
function describe(error) {
  const message = typeof error === 'string' ? error : error && (error.message || error.errMsg) || '操作未完成';
  if (/api scope is not declared in the privacy agreement/i.test(message)) {
    if (/^chooseMedia:/.test(message)) return {
      status: '相册/拍照暂不可用',
      error: '当前小程序尚未配置照片或摄像头的隐私声明。可以先使用“内置样图”；相册选图和拍照需由开发者完善隐私保护指引。'
    };
    return {status: '此功能暂不可用', error: '当前小程序尚未配置此功能的隐私声明，请联系开发者完善隐私保护指引后重试。'};
  }
  return {status: '操作未完成，可以重试', error: message};
}
module.exports = {describe};
