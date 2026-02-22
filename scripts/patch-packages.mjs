import { globSync } from 'fs';
import { readFileSync, writeFileSync } from 'fs';

const packages = globSync('packages/*/package.json');

for (const pkg of packages) {
    const content = JSON.parse(readFileSync(pkg, 'utf-8'));

    // Make sure dist is the published folder
    if (!content.files) {
        content.files = ['dist'];
    } else if (!content.files.includes('dist')) {
        content.files.push('dist');
    }

    // Set publishConfig
    if (!content.publishConfig) {
        content.publishConfig = { access: 'public' };
    }

    // Remove private if it exists (so we can publish)
    if (content.private === true && content.name !== '@orch/orchestrator') {
        delete content.private;
    }

    writeFileSync(pkg, JSON.stringify(content, null, 4) + '\n');
    console.log(`Updated ${pkg}`);
}
