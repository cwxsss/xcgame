const os = require('os');
const QRCode = require('qrcode');

/**
 * 获取本地局域网 IPv4 地址
 */
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // 过滤 IPv4 且不是内部回环地址 (127.0.0.1)
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

/**
 * 生成终端 ASCII 二维码与 DataURL
 */
async function generateQRCodes(url) {
  try {
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 256 });
    return { dataUrl };
  } catch (err) {
    console.error('QR code generation failed:', err);
    return { dataUrl: '' };
  }
}

module.exports = {
  getLocalIpAddress,
  generateQRCodes
};
