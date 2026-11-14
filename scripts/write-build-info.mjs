import { writeFile } from 'node:fs/promises'

await writeFile('.output/build-info.json', JSON.stringify({ platform: process.platform, arch: process.arch, node: process.versions.node, builtAt: new Date().toISOString() }, null, 2))
