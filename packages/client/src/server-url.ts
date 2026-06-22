// Single source of truth for the live server's address (ADR 0009 / 0012). The
// client bakes the wss:// URL into its published bundle to reach the World; the
// release pipeline reads PROD_SERVER_HOST from THIS file (by path, in `release.yml`)
// to derive the https:// /health URL it gates the publish on. Stored as the bare
// host so both forms come from one string — change the host here and nowhere else.
export const PROD_SERVER_HOST = 'mmoserver-production-c9d8.up.railway.app';
export const PROD_SERVER_URL = `wss://${PROD_SERVER_HOST}`;
