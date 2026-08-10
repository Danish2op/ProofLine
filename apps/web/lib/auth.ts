export interface SupabaseSession {
  accessToken: string;
  expiresAt: number;
  user: { id: string };
}

export interface SupabaseSessionClient {
  getSession(request: Request): Promise<SupabaseSession | null>;
  refreshSession(request: Request): Promise<SupabaseSession | null>;
}

export type SessionResolver = (
  request: Request,
) => Promise<SupabaseSession | null>;

export class AuthSessionError extends Error {
  readonly code = 'session_expired';

  constructor() {
    super('The authentication session has expired.');
  }
}

export const supabaseAuthCookieOptions = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax' as const,
  secure: true,
};

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createSessionResolver(
  client: SupabaseSessionClient,
  now: () => number = () => Math.floor(Date.now() / 1_000),
): SessionResolver {
  return async (request) => {
    const current = await client.getSession(request);
    if (current === null) {
      return null;
    }

    if (current.expiresAt > now()) {
      return current;
    }

    const refreshed = await client.refreshSession(request);
    if (refreshed === null || refreshed.expiresAt <= now()) {
      throw new AuthSessionError();
    }

    return refreshed;
  };
}

export function assertCsrfProtection(
  request: Request,
  appOrigin: string,
): void {
  if (!unsafeMethods.has(request.method.toUpperCase())) {
    return;
  }

  if (request.headers.get('origin') !== appOrigin) {
    throw new AuthSessionErrorWithCode('csrf_failed');
  }

  const cookieToken = readCookie(
    request.headers.get('cookie'),
    'proofline_csrf',
  );
  const headerToken = request.headers.get('x-proofline-csrf');
  if (!tokensMatch(cookieToken, headerToken)) {
    throw new AuthSessionErrorWithCode('csrf_failed');
  }
}

export class AuthSessionErrorWithCode extends Error {
  constructor(readonly code: 'csrf_failed') {
    super('The browser request did not pass CSRF validation.');
  }
}

export function getPublicSupabaseConfig(environment: {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}): { url: string; anonKey: string } {
  const {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  } = environment;
  if (!url || !anonKey) {
    throw new Error('Public Supabase configuration is incomplete.');
  }

  return { url, anonKey };
}

function readCookie(header: string | null, name: string): string | null {
  if (header === null) {
    return null;
  }

  for (const part of header.split(';')) {
    const [cookieName, ...value] = part.trim().split('=');
    if (cookieName === name) {
      return value.join('=');
    }
  }
  return null;
}

function tokensMatch(left: string | null, right: string | null): boolean {
  if (left === null || right === null || left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
