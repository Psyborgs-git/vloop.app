import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'glob';

const packages = globSync('packages/*/package.json');
for (const pkg of packages) {
    const data = JSON.parse(readFileSync(pkg, 'utf-8'));
    if (!data.exports) data.exports = {};
    if (!data.exports['.']) {
        data.exports['.'] = {
            import: './dist/index.js',
            types: './dist/index.d.ts',
        }
    }
    if (!data.exports['./*']) {
        data.exports['./*'] = {
            import: './dist/*.js',
            types: './dist/*.d.ts',
        };
        writeFileSync(pkg, JSON.stringify(data, null, 4) + '\n');
        console.log('patched', pkg);
    }
}
