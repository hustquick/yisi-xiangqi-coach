#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22 或更新版本，再重新打开本文件。'
  read '?按回车关闭'
  exit 1
fi
node start-local.mjs --open
