#!/usr/bin/env node
// MIT. Create an isolated, uploadable project from the reference source files.
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const destination = process.argv[2];
if (!destination) throw new Error('Usage: node prepare-project.mjs /path/to/new-project');
const root = resolve(destination);
const source = fileURLToPath(new URL('.', import.meta.url));
await mkdir(root); // A fresh destination prevents overwriting an existing project.
const cards = join(root, 'src/app/cards');
await mkdir(cards, { recursive: true });
const json = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
await json(join(root, 'hsproject.json'), {
  name: 'BluccaCompanyReportReference', srcDir: 'src', platformVersion: '2026.03',
});
await json(join(root, 'src/app/app-hsmeta.json'), {
  uid: 'blucca-company-report-reference', type: 'app',
  config: {
    name: 'Blucca Company Report Reference',
    description: 'Company report navigation with viewer email and a text Public ID.',
    distribution: 'private',
    auth: { type: 'static', requiredScopes: ['oauth', 'crm.objects.companies.read'], optionalScopes: [], conditionallyRequiredScopes: [] },
    permittedUrls: { fetch: [], iframe: [], img: [] },
    support: {
      supportEmail: 'belgialucca@gmail.com',
      documentationUrl: 'https://blucca.github.io/examples/hubspot-company-link/',
      supportUrl: 'https://blucca.github.io/',
    },
  },
});
await json(join(cards, 'package.json'), {
  name: 'blucca-company-report-card', version: '1.0.0', private: true,
  dependencies: { '@hubspot/ui-extensions': '0.11.6', react: '18.3.1' },
});
for (const file of ['CompanyReportCard.tsx', 'report-link.ts', 'CompanyReportCard-hsmeta.json']) {
  await copyFile(join(source, file), join(cards, file));
}
await writeFile(join(root, '.gitignore'), 'node_modules/\n.hs/\n');
console.log(`Project prepared: ${root}`);
console.log('Set REPORT_CONFIG in src/app/cards/CompanyReportCard.tsx, then upload to your authenticated test account.');
