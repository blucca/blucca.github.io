# Company report Link card

[Example walkthrough and source](https://blucca.github.io/examples/hubspot-company-link/)

A small MIT reference for a Projects 2025.2+ HubSpot company card. It reads a configured company property, combines its text value (with surrounding whitespace trimmed) with the current HubSpot user's email, and renders a report link that opens in a new tab.

Example input:

```text
Base URL: https://reports.example.com/report?source=hubspot
User: analyst+east@example.com
Company Public ID: 000042
```

The generated link retains `source=hubspot`, encodes the email's `+`, and keeps `000042` as text. Existing query values and the fragment survive; `user` and `id` are replaced with the current values. URL serialization may normalize the spelling of existing percent-encoding.

## Add to an existing app

1. Copy `CompanyReportCard.tsx`, `report-link.ts`, and `CompanyReportCard-hsmeta.json` into your project's `src/app/cards/` directory. The manifest targets company records at `crm.record.sidebar`.
2. Set `REPORT_CONFIG.baseUrl` to your report service and `companyProperty` to the **internal name** of the company's Public ID property. Store identifiers in a text property to retain leading zeroes. The `reports.example.com` address is synthetic.
3. Merge the dependencies in this example's `package.json` into the existing cards package. Keep your project's other dependencies and app configuration. Set the manifest UID once, before the first upload.
4. Use an existing Projects 2025.2+ app and a test installation with access to the configured company property. Upload through your normal HubSpot CLI workflow and add the card to a company record view.
5. In that installation, check the current user's email, a company with a leading-zero Public ID, an empty property, Refresh after editing the property, record navigation, and the destination's sign-in/permissions. The report service handles authentication and authorization; query values provide navigation context.

The implementation reads one CRM property through the SDK. It hides the link during loading and after a read failure, displays missing-field messages, and supports an explicit refresh. Each asynchronous read is associated with its record and refresh; late responses from earlier records are ignored. Property edits become visible after **Refresh** or a record change.

## Run the checks

Node.js 20.19+ or 22.12+:

```sh
cd examples/hubspot-company-link
npm install
npm test
npm run typecheck
```

**Recorded result: 9 tests passed; TypeScript check passed.** Tested with `@hubspot/ui-extensions` 0.11.6, React 18.3.1, Vitest 4.1.11, and TypeScript 5.9.3.

Tests execute the URL helper and real SDK components with HubSpot's synthetic renderer and stubbed CRM-property responses. They cover encoding/query preservation, leading-zero IDs, invalid/missing input, current-user wiring, loading, external `Link` props, missing-field UI, read-error recovery, refresh, and asynchronous record changes. Platform installation, live CRM permissions, destination navigation, and production rollout are customer-environment acceptance steps.

For an existing local dependency directory, a temporary `node_modules` symlink also supports the same commands. Set `TEST_CACHE_DIR` to a temporary path to direct the Vitest cache there, and remove the symlink afterward.

## Sources and license

- [Public functional request](https://community.hubspot.com/t/launch-dynamic-url-from-company-page-w-user-email-property/66292): a company shortcut parameterized by the current user's email and a company Public ID.
- [HubSpot context reference](https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/ui-extensions-sdk/context): `user.email` and CRM record identity.
- [HubSpot CRM property actions](https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/ui-extensions-sdk/actions): raw current-record properties via `fetchCrmObjectProperties`.
- [HubSpot Link component](https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensibility/ui-components/standard-components/link): `href: { url, external: true }` opens a new tab.

Original implementation by Blucca, developed by an autonomous AI engineering agent. [MIT license](LICENSE). This reference is available for adaptation to your app; the public discussion supplies the functional scenario.
