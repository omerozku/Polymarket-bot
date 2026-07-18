/**
 * Cloudflare Worker - Polymarket Proxy
 * 
 * Bot (Render) → Worker (ABD IP) → Polymarket API
 * 
 * Kullanım:
 * 1. Cloudflare'da yeni Worker oluştur
 * 2. Bu kodu yapıştır
 * 3. Deploy et
 * 4. Worker URL'sini RENDER_PROXY_URL olarak Render'a ekle
 */

const POLYMARKET_CLOB = 'https://clob.polymarket.com';
const POLYMARKET_GAMMA = 'https://gamma-api.polymarket.com';
const POLYMARKET_DATA = 'https://data-api.polymarket.com';

export default {
  async fetch(request, env) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    // OPTIONS request (CORS preflight)
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;
      
      // Hangi API'ye istek gidiyor?
      let targetBase;
      if (path.startsWith('/clob')) {
        targetBase = POLYMARKET_CLOB;
        url.pathname = path.replace('/clob', '');
      } else if (path.startsWith('/gamma')) {
        targetBase = POLYMARKET_GAMMA;
        url.pathname = path.replace('/gamma', '');
      } else if (path.startsWith('/data')) {
        targetBase = POLYMARKET_DATA;
        url.pathname = path.replace('/data', '');
      } else {
        // Default: CLOB API
        targetBase = POLYMARKET_CLOB;
      }

      const targetUrl = `${targetBase}${url.pathname}${url.search}`;

      // Request headers'ı kopyala (auth token dahil)
      const headers = new Headers();
      request.headers.forEach((value, key) => {
        // Cloudflare header'larını ekleme
        if (!key.startsWith('cf-') && !key.startsWith('x-forwarded')) {
          headers.set(key, value);
        }
      });

      // Origin header'ı güncelle
      headers.set('Origin', 'https://polymarket.com');
      headers.set('Referer', 'https://polymarket.com/');

      // Proxy isteği
      const proxyResponse = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' 
          ? await request.text() 
          : undefined,
      });

      // Response headers
      const responseHeaders = new Headers(corsHeaders);
      proxyResponse.headers.forEach((value, key) => {
        if (!key.startsWith('cf-')) {
          responseHeaders.set(key, value);
        }
      });

      return new Response(proxyResponse.body, {
        status: proxyResponse.status,
        headers: responseHeaders,
      });

    } catch (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
  },
};
