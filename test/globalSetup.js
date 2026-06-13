'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Jest globalSetup: 确保 root CA 证书存在，以便所有测试套件都能正常运行。
 *
 * 查找顺序:
 *   1. 环境变量 ANYPROXY_CERT_SRC_DIR
 *   2. ../block-proxy/cert/ (相对本仓库根目录)
 *   3. 不复制 — 依赖 certMgr.generateRootCA() 或已存在的证书
 */
module.exports = async function globalSetup() {
  // 全局禁用 TLS 证书校验，避免测试客户端拒绝 MITM 证书
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const certDir = path.join(os.homedir(), '.anyproxy', 'certificates');
  const crtPath = path.join(certDir, 'rootCA.crt');
  const keyPath = path.join(certDir, 'rootCA.key');

  // 如果 root CA 已存在，无需操作
  if (fs.existsSync(crtPath) && fs.existsSync(keyPath)) {
    return;
  }

  // 确定源证书目录
  const srcDir =
    process.env.ANYPROXY_CERT_SRC_DIR ||
    path.resolve(__dirname, '../../block-proxy/cert');

  const srcCrt = path.join(srcDir, 'rootCA.crt');
  const srcKey = path.join(srcDir, 'rootCA.key');

  if (!fs.existsSync(srcCrt) || !fs.existsSync(srcKey)) {
    // 源证书不存在，不做任何操作（测试会尝试自动生成或报错）
    return;
  }

  // 创建目标目录并复制证书
  fs.mkdirSync(certDir, { recursive: true });
  fs.copyFileSync(srcCrt, crtPath);
  fs.copyFileSync(srcKey, keyPath);
};
