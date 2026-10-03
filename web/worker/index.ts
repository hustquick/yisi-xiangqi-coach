/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/pikafish-network") {
      const upstream = await fetch(
        "https://github.com/official-pikafish/Networks/releases/download/master-net/pikafish.nnue",
        { cf: { cacheEverything: true, cacheTtl: 86400 } } as RequestInit,
      );
      if (!upstream.ok) return new Response("Pikafish network unavailable", { status: 502 });
      const network = new Response(upstream.body, upstream);
      network.headers.set("Cache-Control", "public, max-age=86400, immutable");
      network.headers.set("Cross-Origin-Resource-Policy", "same-origin");
      network.headers.set("Content-Type", "application/octet-stream");
      return network;
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    const secured = new Response(response.body, response);
    secured.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    secured.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    secured.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    return secured;
  },
};

export default worker;
