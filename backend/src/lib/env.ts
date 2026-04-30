import 'dotenv/config';

function required(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const env = {
  PORT: parseInt(process.env.PORT ?? '3000', 10),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  FRONTEND_URL: process.env.FRONTEND_URL ?? 'http://localhost:5173',

  DATABASE_URL: required('DATABASE_URL', 'file:./dev.db'),

  JWT_SECRET: required('JWT_SECRET', 'dev-only-insecure-jwt-secret-change-me'),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '7d',

  XERO_CLIENT_ID: process.env.XERO_CLIENT_ID ?? '',
  XERO_CLIENT_SECRET: process.env.XERO_CLIENT_SECRET ?? '',
  XERO_REDIRECT_URI: process.env.XERO_REDIRECT_URI ?? 'http://localhost:3000/api/xero/callback',
  // Hardcoded - this Xero app was created post-2 Mar 2026 so it requires
  // granular scopes (broad ones like accounting.transactions.read and
  // accounting.reports.read are rejected with "Invalid scope for client").
  // Reports scopes intentionally omitted until we confirm which granular
  // names are valid for this app - we can add them incrementally.
  XERO_SCOPES:
    'openid profile email offline_access accounting.invoices.read accounting.contacts.read accounting.settings.read',

  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD ?? 'changeme',
};

export const xeroConfigured = Boolean(env.XERO_CLIENT_ID && env.XERO_CLIENT_SECRET);
