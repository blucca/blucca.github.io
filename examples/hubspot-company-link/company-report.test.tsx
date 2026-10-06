// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { Button, Link, Text } from '@hubspot/ui-extensions';
import { createRenderer } from '@hubspot/ui-extensions/testing';
import { describe, expect, it, vi } from 'vitest';
import { CompanyReportCard, ConnectedCompanyReportCard } from './CompanyReportCard';
import { buildReportLink } from './report-link';

const config = { baseUrl: 'https://reports.example.com/report?source=crm', companyProperty: 'external_public_id' };
function pending() {
  let resolve!: (value: Record<string, string>) => void;
  const promise = new Promise<Record<string, string>>(done => { resolve = done; });
  return { promise, resolve };
}

describe('report URL', () => {
  it('preserves other query values and fragment, replaces owned keys, and encodes values', () => {
    const result = buildReportLink('https://reports.example.com/report?source=crm&tag=a&tag=b&user=old&id=old&id=older#summary', 'a+b&c@example.com', '0007 & west');
    expect(result.error).toBeUndefined();
    const url = new URL(result.url!);
    expect(url.searchParams.get('source')).toBe('crm');
    expect(url.searchParams.getAll('tag')).toEqual(['a', 'b']);
    expect(url.searchParams.getAll('user')).toEqual(['a+b&c@example.com']);
    expect(url.searchParams.getAll('id')).toEqual(['0007 & west']);
    expect(url.hash).toBe('#summary');
    expect(result.url).toContain('user=a%2Bb%26c%40example.com');
  });

  it('keeps leading zeroes and Unicode while trimming surrounding input whitespace', () => {
    const result = buildReportLink('https://reports.example.com/report', ' user@example.com ', ' 000042東京 ');
    expect(new URL(result.url!).searchParams.get('id')).toBe('000042東京');
    expect(new URL(result.url!).searchParams.get('user')).toBe('user@example.com');
  });

  it('returns explicit messages for missing strings and unsupported report URLs', () => {
    expect(buildReportLink(config.baseUrl, '', '1').error).toContain('email');
    for (const id of ['', '  ', undefined, 42]) expect(buildReportLink(config.baseUrl, 'a@example.com', id).error).toContain('Public ID');
    for (const url of ['/relative', 'javascript:alert(1)']) expect(buildReportLink(url, 'a@example.com', '01').error).toContain('absolute HTTP');
  });
});

describe('SDK-rendered company card', () => {
  it('reads the configured current-company property and uses external Link props', async () => {
    const read = pending();
    const fetchProperties = vi.fn(() => read.promise);
    const r = createRenderer('crm.record.sidebar');
    r.render(<CompanyReportCard recordKey="company:A" email="a+b@example.com" fetchProperties={fetchProperties} config={config} />);
    expect(r.find(Text).text).toContain('Loading');
    expect(r.maybeFind(Link)).toBeNull();
    await vi.waitFor(() => expect(fetchProperties).toHaveBeenCalledWith(['external_public_id']));
    read.resolve({ external_public_id: '00123' });
    await r.waitFor(() => expect(r.find(Link).props.href).toEqual({ url: 'https://reports.example.com/report?source=crm&user=a%2Bb%40example.com&id=00123', external: true }));
  });

  it('uses the SDK context email and current-record property action in the connected entry', async () => {
    const r = createRenderer('crm.record.sidebar');
    r.mocks.context.user.email = 'owner+test@example.com';
    r.mocks.context.crm.objectTypeId = '0-2';
    r.mocks.actions.fetchCrmObjectProperties.willCall(async () => ({ public_id: '0001' }));
    r.render(<ConnectedCompanyReportCard />);
    await r.waitFor(() => expect(r.find(Link).props.href).toEqual({ url: 'https://reports.example.com/report?source=hubspot&user=owner%2Btest%40example.com&id=0001', external: true }));
    expect(r.mocks.actions.fetchCrmObjectProperties.calls).toEqual([[['public_id']]]);
  });

  it.each([
    ['', '0001', 'email'],
    ['a@example.com', '', 'Public ID'],
  ])('shows a required-field message for email=%s and ID=%s', async (email, id, message) => {
    const r = createRenderer('crm.record.sidebar');
    r.render(<CompanyReportCard recordKey="A" email={email} fetchProperties={async () => ({ public_id: id })} />);
    await r.waitFor(() => expect(r.find(Text).text).toContain(message));
    expect(r.maybeFind(Link)).toBeNull();
  });

  it('shows a read error and recovers with one explicit refresh', async () => {
    const fetchProperties = vi.fn().mockRejectedValueOnce(new Error('synthetic read failure')).mockResolvedValueOnce({ public_id: '0099' });
    const r = createRenderer('crm.record.sidebar');
    r.render(<CompanyReportCard recordKey="A" email="a@example.com" fetchProperties={fetchProperties} />);
    await r.waitFor(() => expect(r.find(Text).text).toContain('could not be read'));
    r.find(Button).trigger('onClick');
    await r.waitFor(() => expect(r.find(Link).props.href).toMatchObject({ url: expect.stringContaining('id=0099') }));
    expect(fetchProperties).toHaveBeenCalledTimes(2);
  });

  it('hides the old link during record changes and ignores late responses for other records', async () => {
    const b = pending(); const c = pending();
    const fetchProperties = vi.fn().mockResolvedValueOnce({ public_id: 'A001' }).mockImplementationOnce(() => b.promise).mockImplementationOnce(() => c.promise);
    function Harness() {
      const [record, setRecord] = useState(0);
      return <>
        <CompanyReportCard recordKey={String(record)} email="a@example.com" fetchProperties={fetchProperties} />
        <Button testId="next-record" onClick={() => setRecord(n => n + 1)}>Next record</Button>
      </>;
    }
    const r = createRenderer('crm.record.sidebar');
    r.render(<Harness />);
    await r.waitFor(() => expect(r.find(Link).props.href).toMatchObject({ url: expect.stringContaining('id=A001') }));
    r.findByTestId(Button, 'next-record').trigger('onClick');
    expect(r.maybeFind(Link)).toBeNull();
    await vi.waitFor(() => expect(fetchProperties).toHaveBeenCalledTimes(2));
    r.findByTestId(Button, 'next-record').trigger('onClick');
    await vi.waitFor(() => expect(fetchProperties).toHaveBeenCalledTimes(3));
    c.resolve({ public_id: 'C003' });
    await r.waitFor(() => expect(r.find(Link).props.href).toMatchObject({ url: expect.stringContaining('id=C003') }));
    b.resolve({ public_id: 'B002' });
    await b.promise;
    await new Promise(done => setTimeout(done, 0));
    expect(r.find(Link).props.href).toMatchObject({ url: expect.stringContaining('id=C003') });
  });
});
