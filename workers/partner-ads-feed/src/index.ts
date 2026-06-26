export interface Env {
  PARTNER_ADS_FEED_URL: string;
  FEED_API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/partner-ads.xml" && url.pathname !== "/partnerads.xml") {
      return new Response("Not found", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const headers = new Headers();
    if (env.FEED_API_KEY) {
      headers.set("X-Feed-Api-Key", env.FEED_API_KEY);
    }

    try {
      const response = await fetch(env.PARTNER_ADS_FEED_URL, {
        method: request.method,
        headers,
      });

      const outHeaders = new Headers(response.headers);
      outHeaders.set("Access-Control-Allow-Origin", "*");
      outHeaders.set("X-Robots-Tag", "noindex");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: outHeaders,
      });
    } catch (err) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><error>Feed unavailable</error>`,
        {
          status: 503,
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    }
  },
};
