import { mkdir, copyFile } from 'node:fs/promises';
const target = new URL('./assets/', import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ['index.html', 'app.js', 'style.css', 'engine-data.js', 'pikafish.js', 'PIKAFISH-LICENSE.txt', 'PIKAFISH-SOURCE.txt']) {
  await copyFile(new URL(`../local/${name}`, import.meta.url), new URL(name, target));
}
