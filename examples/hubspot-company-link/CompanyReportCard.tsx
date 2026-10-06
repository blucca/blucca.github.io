// SPDX-License-Identifier: MIT
import { useEffect, useState } from 'react';
import {
  Button, Flex, Link, Text, hubspot, useExtensionActions, useExtensionContext,
  type CrmHostActions,
} from '@hubspot/ui-extensions';
import { buildReportLink } from './report-link';

export const REPORT_CONFIG = {
  baseUrl: 'https://reports.example.com/report?source=hubspot',
  companyProperty: 'public_id', // HubSpot internal property name; store IDs as text.
};

type Props = {
  recordKey: string;
  email: string;
  fetchProperties: CrmHostActions['fetchCrmObjectProperties'];
  config?: typeof REPORT_CONFIG;
};
type ReadResult = { key: string; publicId?: string; error?: string };

export function CompanyReportCard({ recordKey, email, fetchProperties, config = REPORT_CONFIG }: Props) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<ReadResult>();
  const property = config.companyProperty;
  const requestKey = JSON.stringify([recordKey, property, revision]);
  const loading = result?.key !== requestKey;

  useEffect(() => {
    let current = true;
    // Associate each response with the record and refresh that requested it.
    const read = async () => {
      try {
        const properties = await fetchProperties([property]);
        if (current) setResult({ key: requestKey, publicId: properties[property] });
      } catch {
        if (current) setResult({ key: requestKey, error: 'Company property could not be read. Try Refresh.' });
      }
    };
    void read();
    return () => { current = false; };
  }, [requestKey, property, fetchProperties]);

  const link = buildReportLink(config.baseUrl, email, result?.publicId);
  const error = result?.error || link.error;
  return (
    <Flex direction="column" gap="small">
      {loading ? <Text>Loading company report link…</Text> : error ? <Text>{error}</Text> : (
        <Link href={{ url: link.url!, external: true }}>Open company report</Link>
      )}
      <Button variant="secondary" disabled={loading} onClick={() => setRevision(n => n + 1)}>
        Refresh
      </Button>
    </Flex>
  );
}

export function ConnectedCompanyReportCard() {
  const context = useExtensionContext<'crm.record.sidebar'>();
  const actions = useExtensionActions<'crm.record.sidebar'>();
  const recordKey = JSON.stringify([context.portal.id, context.crm.objectTypeId, context.crm.objectId]);
  return <CompanyReportCard recordKey={recordKey} email={context.user.email}
    fetchProperties={actions.fetchCrmObjectProperties} />;
}

hubspot.extend<'crm.record.sidebar'>(() => <ConnectedCompanyReportCard />);
