import { mkdir, readFile, writeFile } from 'node:fs/promises';
const target = new URL('./assets/', import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ['index.html', 'app.js', 'style.css', 'engine-data.js', 'pikafish.js', 'PIKAFISH-LICENSE.txt', 'PIKAFISH-SOURCE.txt']) {
  const bytes=await readFile(new URL(`../local/${name}`,import.meta.url));
  if(bytes.length<50 || (name==='engine-data.js' && bytes.length<1000000)) throw new Error(`${name} 未完整读取；请确认本地文件下载完成后再打包，禁止生成缺少引擎的应用。`);
  await writeFile(new URL(name,target), bytes);
}
