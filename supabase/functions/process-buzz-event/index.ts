export function createProcessBuzzEventHandler(): (
  request: Request,
) => Promise<Response> {
  return async () =>
    Response.json(
      {
        error: {
          code: 'endpoint_deprecated',
          message: 'Use the authenticated verified lifecycle approval path.',
          retryable: false,
        },
      },
      { status: 410 },
    );
}

const deno = (
  globalThis as {
    Deno?: { serve(handler: (request: Request) => Promise<Response>): void };
  }
).Deno;
if (deno) deno.serve(createProcessBuzzEventHandler());
