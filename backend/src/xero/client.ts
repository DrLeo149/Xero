import { XeroClient } from 'xero-node';
import { env } from '../lib/env.js';
import { prisma } from '../db/client.js';

/**
 * Creates a fresh XeroClient instance configured with our app credentials.
 * We create a new instance per request (stateless) because xero-node is designed that way -
 * you feed it a token set, operate, and discard. Tokens live in the DB, not in memory.
 */
export function newXeroClient(): XeroClient {
  return new XeroClient({
    clientId: env.XERO_CLIENT_ID,
    clientSecret: env.XERO_CLIENT_SECRET,
    redirectUris: [env.XERO_REDIRECT_URI],
    scopes: env.XERO_SCOPES.split(' '),
  });
}

/**
 * Loads the tenant's stored tokens, rebuilds a XeroClient, and refreshes the
 * access token if it's close to expiring. Returns a ready-to-use client plus
 * the Xero-side tenantId (GUID) needed for API calls.
 */
export async function getXeroClientForTenant(tenantId: string) {
  const conn = await prisma.xeroConnection.findUnique({ where: { tenantId } });
  if (!conn) throw new Error(`No Xero connection for tenant ${tenantId}`);

  const client = newXeroClient();
  // Must initialize the OpenID client before setTokenSet/refreshToken -
  // otherwise client.openIdClient is undefined and refreshToken() throws
  // "Cannot read properties of undefined (reading 'refresh')".
  await client.initialize();
  client.setTokenSet({
    access_token: conn.accessToken,
    refresh_token: conn.refreshToken,
    expires_at: Math.floor(conn.expiresAt.getTime() / 1000),
    token_type: 'Bearer',
    scope: conn.scopes,
  });

  // Refresh if already expired or expiring within 60s
  const now = Date.now();
  if (conn.expiresAt.getTime() - now < 60_000) {
    const fresh = await client.refreshToken();
    await prisma.xeroConnection.update({
      where: { tenantId },
      data: {
        accessToken: fresh.access_token!,
        refreshToken: fresh.refresh_token ?? conn.refreshToken,
        expiresAt: new Date((fresh.expires_at ?? Math.floor(now / 1000) + 1800) * 1000),
      },
    });
  }

  return { client, xeroTenantId: conn.xeroTenantId };
}
