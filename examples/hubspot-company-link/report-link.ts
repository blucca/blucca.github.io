// SPDX-License-Identifier: MIT
export type ReportLink = { url: string; error?: never } | { error: string; url?: never };

/** Preserve other query values and the fragment; own the user/id parameters. */
export function buildReportLink(baseUrl: string, email: unknown, publicId: unknown): ReportLink {
  if (typeof email !== 'string' || !email.trim()) {
    return { error: 'Current HubSpot user email is missing.' };
  }
  if (typeof publicId !== 'string' || !publicId.trim()) {
    return { error: 'Company Public ID is missing. Add it to this company, then refresh.' };
  }
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Protocol');
    url.searchParams.set('user', email.trim());
    url.searchParams.set('id', publicId.trim());
    return { url: url.toString() };
  } catch {
    return { error: 'Configure an absolute HTTP or HTTPS report URL.' };
  }
}
