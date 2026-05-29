export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Extract target URL from the query string or path
    const targetUrlStr = url.searchParams.get('url') || url.pathname.slice(1);
    
    if (!targetUrlStr) {
      return new Response('Missing target URL. Usage: /?url=https://example.com', { status: 400 });
    }

    try {
      const targetUrl = new URL(targetUrlStr);
      
      // Copy original headers but modify for the target
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetUrl.host);
      newHeaders.set('Origin', targetUrl.origin);
      newHeaders.set('Referer', targetUrl.origin);

      // Fetch the external asset
      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: newHeaders,
        body: request.body
      });

      // Prepare standard CORS headers
      const corsHeaders = new Headers(response.headers);
      corsHeaders.set('Access-Control-Allow-Origin', '*');
      corsHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
      corsHeaders.set('Access-Control-Allow-Headers', '*');
      corsHeaders.set('Access-Control-Expose-Headers', '*');

      // Handle preflight requests
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      const contentType = response.headers.get('content-type') || '';
      
      // Rewrite manifests to route sub-resources through this proxy
      if (contentType.includes('mpegurl') || contentType.includes('mpegURL') || contentType.includes('dash+xml')) {
        let text = await response.text();
        const baseProxyUrl = `${url.origin}/?url=`;
        
        if (contentType.includes('dash+xml')) {
          // Rewrite relative paths in MPD files using BaseURL tag
          if (!text.includes('<BaseURL>')) {
            const baseUrl = targetUrl.href.substring(0, targetUrl.href.lastIndexOf('/') + 1);
            text = text.replace('<MPD', `<MPD><BaseURL>${baseProxyUrl}${encodeURIComponent(baseUrl)}</BaseURL>`);
          }
        } else {
          // Rewrite relative and absolute paths in M3U8 files line by line
          const baseUrl = targetUrl.href.substring(0, targetUrl.href.lastIndexOf('/') + 1);
          text = text.split('\n').map(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
              const absoluteUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
              return `${baseProxyUrl}${encodeURIComponent(absoluteUrl)}`;
            }
            return line;
          }).join('\n');
        }

        return new Response(text, { status: response.status, headers: corsHeaders });
      }

      // Return standard media chunks (TS, M4S, MP4) directly with CORS headers
      return new Response(response.body, { status: response.status, headers: corsHeaders });

    } catch (err) {
      return new Response(`Proxy Error: ${err.message}`, { status: 500 });
    }
  }
};
