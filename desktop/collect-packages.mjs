import { cp, mkdir, readdir } from 'node:fs/promises';
const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : null;
if (!platform) throw new Error('目前只收集 macOS 和 Windows 安装包');
const output = new URL(`../local/${platform}/`, import.meta.url);
await mkdir(output, { recursive: true });
for (const directory of platform === 'macos' ? ['macos', 'dmg'] : ['nsis', 'msi']) {
  const base = new URL(`./src-tauri/target/release/bundle/${directory}/`, import.meta.url);
  let entries;
  try { entries = await readdir(base); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  for (const name of entries.filter(name => /\.(app|dmg|exe|msi)$/.test(name))) {
    await cp(new URL(name, base), new URL(name, output), { recursive: true });
    console.log(`安装包：local/${platform}/${name}`);
  }
}
