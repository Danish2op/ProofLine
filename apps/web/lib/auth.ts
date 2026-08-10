import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export interface SupabaseSession {
  accessToken: string;
  expiresAt: number;
  user: { id: string };
}

export interface SupabaseServerClient {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string } | null };
      error: Error | null;
    }>;
    refreshSession(): Promise<{
      data: {
        session: {
          access_token: string;
          expires_at?: number;
          user: { id: string };
        } | null;
      };
      error: Error | null;
    }>;
  };
}

export interface SupabaseCookieToSet {
  name: string;
  value: string;
  options?: CookieOptions;
}

export interface SupabaseServerClientFactoryOptions {
  cookies: {
    getAll(): Array<{ name: string; value: string }>;
    setAll(cookiesToSet: SupabaseCookieToSet[]): void;
  };
  cookieOptions: CookieOptions;
}

export type SupabaseServerClientFactory = (
  url: string,
  anonKey: string,
  options: SupabaseServerClientFactoryOptions,
) => SupabaseServerClient;

export interface SupabaseServerAuth {
  client: SupabaseServerClient;
  response: NextResponse;
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

export function createSupabaseServerAuth(
  request: NextRequest,
  environment: {
    NEXT_PUBLIC_SUPABASE_URL?: string;
    NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  },
  factory: SupabaseServerClientFactory = defaultSupabaseServerClientFactory,
): SupabaseServerAuth {
  const { url, anonKey } = getPublicSupabaseConfig(environment);
  const response = NextResponse.next({ request });
  const client = factory(url, anonKey, {
    cookieOptions: supabaseAuthCookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, {
            ...options,
            ...supabaseAuthCookieOptions,
          });
        }
      },
    },
  });

  return { client, response };
}

export async function refreshSupabaseSession(
  serverAuth: SupabaseServerAuth,
): Promise<SupabaseSession | null> {
  const { data, error } = await serverAuth.client.auth.refreshSession();
  if (error || data.session === null || data.session.expires_at === undefined) {
    return null;
  }

  return {
    accessToken: data.session.access_token,
    expiresAt: data.session.expires_at,
    user: { id: data.session.user.id },
  };
}

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

const defaultSupabaseServerClientFactory: SupabaseServerClientFactory = (
  url,
  anonKey,
  options,
) =>
  createServerClient(url, anonKey, options) as unknown as SupabaseServerClient;

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
