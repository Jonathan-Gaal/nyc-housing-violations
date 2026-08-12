import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

// Server-only Firebase Admin SDK singleton. Never import this file from a
// Client Component — FIREBASE_ADMIN_SDK_KEY must never reach the browser
// bundle. Mirrors pgClient.ts's getPool() lazy-singleton, fail-fast shape.

// Substrings that indicate the env var still holds the documented
// placeholder from .env.example rather than a real service account credential.
const PLACEHOLDER_MARKERS = ['YOUR-', 'PROJECT-ID', '[', ']'];

// Shared placeholder-detection logic, exported so test suites can decide
// whether to skip tests that require a real Firebase project rather than
// fail against a placeholder credential.
export function isFirebaseAdminSdkKeyPlaceholder(firebaseAdminSdkKey: string | undefined): boolean {
  if (!firebaseAdminSdkKey || firebaseAdminSdkKey.trim().length === 0) return true;
  return PLACEHOLDER_MARKERS.some((marker) => firebaseAdminSdkKey.includes(marker));
}

function assertValidFirebaseAdminSdkKey(
  firebaseAdminSdkKey: string | undefined
): asserts firebaseAdminSdkKey is string {
  if (!firebaseAdminSdkKey || firebaseAdminSdkKey.trim().length === 0) {
    throw new Error(
      'FIREBASE_ADMIN_SDK_KEY is not set. Add it to web/.env.local using the Firebase service ' +
        'account JSON (single-line, e.g. via `jq -c`) — see web/.env.example for the shape.'
    );
  }

  if (isFirebaseAdminSdkKeyPlaceholder(firebaseAdminSdkKey)) {
    throw new Error(
      'FIREBASE_ADMIN_SDK_KEY still contains the placeholder value from web/.env.example. ' +
        'Replace it with your real Firebase service account JSON before running this.'
    );
  }
}

function parseServiceAccountJson(firebaseAdminSdkKey: string): ServiceAccount {
  try {
    return JSON.parse(firebaseAdminSdkKey) as ServiceAccount;
  } catch {
    throw new Error(
      'FIREBASE_ADMIN_SDK_KEY could not be parsed as JSON. Expected the Firebase service ' +
        'account key file contents as a single-line JSON string — see web/.env.example.'
    );
  }
}

let _firebaseAdminApp: App | null = null;

export function getFirebaseAdmin(): App {
  if (_firebaseAdminApp) return _firebaseAdminApp;

  assertValidFirebaseAdminSdkKey(process.env.FIREBASE_ADMIN_SDK_KEY);
  const serviceAccount = parseServiceAccountJson(process.env.FIREBASE_ADMIN_SDK_KEY);

  const existingApps = getApps();
  _firebaseAdminApp =
    existingApps.length > 0 && existingApps[0]
      ? existingApps[0]
      : initializeApp({ credential: cert(serviceAccount) });

  return _firebaseAdminApp;
}

// Verifies a Firebase ID token's cryptographic signature and returns its
// decoded claims. Rejects (throws) on any malformed, expired, or
// invalid-signature token — never returns a falsy-but-truthy fallback that a
// caller might mistake for an authenticated result.
export async function verifyIdToken(token: string): Promise<DecodedIdToken> {
  const app = getFirebaseAdmin();
  return getAuth(app).verifyIdToken(token);
}
