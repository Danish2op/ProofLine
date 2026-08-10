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
