import { NextResponse, type NextRequest } from 'next/server';

export type DemoRequestDecision =
  | { allowed: true; public: true }
  | { allowed: false; public: true; status: 405 }
  | { allowed: false; public: false; status: 404 };

export function isReadOnlyDemoRequest(request: Request): DemoRequestDecision {
  const pathname = new URL(request.url).pathname;
  if (pathname !== '/demo' && !pathname.startsWith('/demo/')) {
    return { allowed: false, public: false, status: 404 };
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    return { allowed: true, public: true };
  }

  return { allowed: false, public: true, status: 405 };
}

export const config = {
  matcher: ['/demo/:path*'],
};

export function middleware(request: NextRequest): NextResponse {
  const decision = isReadOnlyDemoRequest(request);

  if (!decision.public || decision.allowed) {
    return NextResponse.next({ request });
  }

  return NextResponse.json(
    { error: 'The public demo is read-only.' },
    {
      status: decision.status,
      headers: {
        allow: 'GET, HEAD',
        'cache-control': 'no-store',
      },
    },
  );
}
