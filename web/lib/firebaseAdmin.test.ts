import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_FIREBASE_ADMIN_SDK_KEY = process.env.FIREBASE_ADMIN_SDK_KEY;

const VALID_SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'test-key-id',
  private_key: '-----BEGIN PRIVATE KEY-----\ntestkey\n-----END PRIVATE KEY-----\n',
  client_email: 'test@test-project.iam.gserviceaccount.com',
});

const VALID_DECODED_TOKEN = {
  uid: 'test-firebase-uid',
  email: 'renter@example.com',
  aud: 'test-project',
  iss: 'https://securetoken.google.com/test-project',
  auth_time: 1723420800,
  iat: 1723420800,
  exp: 1723424400,
  sub: 'test-firebase-uid',
  firebase: { identities: {}, sign_in_provider: 'password' },
};

// No live Firebase emulator is available in this environment, so per the
// spec's own stated fallback, admin.auth() is mocked rather than requiring
// real credentials or a running emulator.
const mockVerifyIdToken = vi.fn();
const mockGetAuth = vi.fn(() => ({ verifyIdToken: mockVerifyIdToken }));
const mockCert = vi.fn((serviceAccount: unknown) => serviceAccount);
const mockInitializeApp = vi.fn(() => ({ name: '[DEFAULT]' }));
const mockGetApps = vi.fn(() => [] as unknown[]);

vi.mock('firebase-admin/app', () => ({
  cert: (serviceAccount: unknown) => mockCert(serviceAccount),
  getApps: () => mockGetApps(),
  initializeApp: () => mockInitializeApp(),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => mockGetAuth(),
}));

describe('firebaseAdmin', () => {
  beforeEach(() => {
    vi.resetModules();
    mockVerifyIdToken.mockReset();
    mockGetAuth.mockClear();
    mockCert.mockClear();
    mockInitializeApp.mockClear();
    mockGetApps.mockReset().mockReturnValue([]);
  });

  afterEach(() => {
    process.env.FIREBASE_ADMIN_SDK_KEY = ORIGINAL_FIREBASE_ADMIN_SDK_KEY;
  });

  describe('getFirebaseAdmin', () => {
    it('throws a clear error when FIREBASE_ADMIN_SDK_KEY is missing', async () => {
      delete process.env.FIREBASE_ADMIN_SDK_KEY;
      const { getFirebaseAdmin } = await import('./firebaseAdmin');
      expect(() => getFirebaseAdmin()).toThrow(/FIREBASE_ADMIN_SDK_KEY is not set/);
    });

    it('throws a clear error when FIREBASE_ADMIN_SDK_KEY is empty', async () => {
      process.env.FIREBASE_ADMIN_SDK_KEY = '   ';
      const { getFirebaseAdmin } = await import('./firebaseAdmin');
      expect(() => getFirebaseAdmin()).toThrow(/FIREBASE_ADMIN_SDK_KEY is not set/);
    });

    it('throws a clear error when FIREBASE_ADMIN_SDK_KEY is still the .env.example placeholder', async () => {
      process.env.FIREBASE_ADMIN_SDK_KEY =
        '{"type":"service_account","project_id":"YOUR-PROJECT-ID","private_key":"..."}';
      const { getFirebaseAdmin } = await import('./firebaseAdmin');
      expect(() => getFirebaseAdmin()).toThrow(/placeholder value/);
    });

    it('throws a clear error when FIREBASE_ADMIN_SDK_KEY is not valid JSON', async () => {
      process.env.FIREBASE_ADMIN_SDK_KEY = 'not-json-at-all';
      const { getFirebaseAdmin } = await import('./firebaseAdmin');
      expect(() => getFirebaseAdmin()).toThrow(/could not be parsed as JSON/);
    });

    it('initializes the Admin SDK app for a well-formed service account key', async () => {
      process.env.FIREBASE_ADMIN_SDK_KEY = VALID_SERVICE_ACCOUNT_JSON;
      const { getFirebaseAdmin } = await import('./firebaseAdmin');
      expect(() => getFirebaseAdmin()).not.toThrow();
      expect(mockInitializeApp).toHaveBeenCalledTimes(1);
    });

    it('returns a singleton instance on repeated calls', async () => {
      process.env.FIREBASE_ADMIN_SDK_KEY = VALID_SERVICE_ACCOUNT_JSON;
      const { getFirebaseAdmin } = await import('./firebaseAdmin');
      const firstCall = getFirebaseAdmin();
      const secondCall = getFirebaseAdmin();
      expect(firstCall).toBe(secondCall);
      expect(mockInitializeApp).toHaveBeenCalledTimes(1);
    });

    it('reuses an already-initialized app instead of re-initializing', async () => {
      process.env.FIREBASE_ADMIN_SDK_KEY = VALID_SERVICE_ACCOUNT_JSON;
      const existingApp = { name: '[DEFAULT]' };
      mockGetApps.mockReturnValue([existingApp]);
      const { getFirebaseAdmin } = await import('./firebaseAdmin');
      expect(getFirebaseAdmin()).toBe(existingApp);
      expect(mockInitializeApp).not.toHaveBeenCalled();
    });
  });

  describe('verifyIdToken', () => {
    it('returns the expected decoded claims for a validly-signed token', async () => {
      process.env.FIREBASE_ADMIN_SDK_KEY = VALID_SERVICE_ACCOUNT_JSON;
      mockVerifyIdToken.mockResolvedValue(VALID_DECODED_TOKEN);

      const { verifyIdToken } = await import('./firebaseAdmin');
      const decoded = await verifyIdToken('valid-test-token');

      expect(decoded).toEqual(VALID_DECODED_TOKEN);
      expect(decoded.uid).toBe('test-firebase-uid');
      expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-test-token');
    });

    it('rejects (throws) for a malformed token, never returning a falsy-but-truthy result', async () => {
      process.env.FIREBASE_ADMIN_SDK_KEY = VALID_SERVICE_ACCOUNT_JSON;
      mockVerifyIdToken.mockRejectedValue(new Error('Decoding Firebase ID token failed'));

      const { verifyIdToken } = await import('./firebaseAdmin');
      await expect(verifyIdToken('not-a-real-token')).rejects.toThrow(/Decoding Firebase ID token failed/);
    });

    it('rejects (throws) for an expired token', async () => {
      process.env.FIREBASE_ADMIN_SDK_KEY = VALID_SERVICE_ACCOUNT_JSON;
      mockVerifyIdToken.mockRejectedValue(new Error('Firebase ID token has expired'));

      const { verifyIdToken } = await import('./firebaseAdmin');
      await expect(verifyIdToken('expired-test-token')).rejects.toThrow(/expired/);
    });

    it('rejects (throws) for a token with an invalid signature', async () => {
      process.env.FIREBASE_ADMIN_SDK_KEY = VALID_SERVICE_ACCOUNT_JSON;
      mockVerifyIdToken.mockRejectedValue(new Error('Firebase ID token has invalid signature'));

      const { verifyIdToken } = await import('./firebaseAdmin');
      await expect(verifyIdToken('bad-signature-token')).rejects.toThrow(/invalid signature/);
    });
  });
});
