import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const output = resolve(import.meta.dirname, '.pages-dist');
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js', 'pikafish.js', 'PIKAFISH-LICENSE.txt', 'PIKAFISH-SOURCE.txt'])
  await copyFile(resolve(import.meta.dirname, '../local', file), resolve(output, file));
const index = await readFile(resolve(output, 'index.html'), 'utf8');
await writeFile(resolve(output, 'index.html'), index.replace('./engine-data.js', 'https://141.148.168.171/engine-data.js'));
