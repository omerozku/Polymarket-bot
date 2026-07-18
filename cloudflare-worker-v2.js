/**
 * Cloudflare Worker - Polymarket Proxy v2
 * 
 * Tüm header'ları yönlendirir (POLY_* auth başlıkları dahil)
 */

const POLYMARKET_CLOB = 'https://clob.polymarket.com';
const POLYMARKET_GAMMA = 'https://gamma-api.polymarket.com';
const POLYMARKET_DATA = 'https://data-api.polymarket.com';

export default {
  async fetch(request, env) {
    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;
      
      let targetBase;
      if (path.startsWith('/clob')) {
        targetBase = POLYMARKET_CLOB;
        url.pathname = path.replace('/clob', '') || '/';
      } else if (path.startsWith('/gamma')) {
        targetBase = POLYMARKET_GAMMA;
        url.pathname = path.replace('/gamma', '') || '/';
      } else if (path.startsWith('/data')) {
        targetBase = POLYMARKET_DATA;
        url.pathname = path.replace('/data', '') || '/';
      } else {
        targetBase = POLYMARKET_CLOB;
      }

      const targetUrl = `${targetBase}${url.pathname}${url.search}`;

      // TÜM header'ları yönlendir (POLY_* auth dahil)
      const headers = new Headers();
      request.headers.forEach((value, key) => {
        headers.set(key, value);
      });
      // Origin ve Referer'i güncelle
      headers.set('Origin', 'https://polymarket.com');
      headers.set('Referer', 'https://polymarket.com/');

      const init = {
        method: request.method,
        headers: headers,
      };

      // Body varsa ekle (POST, PUT için)
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        init.body = await request.text();
      }

      const resp = await fetch(targetUrl, init);

      // Response headers
      const responseHeaders = new Headers();
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      resp.headers.forEach((value, key) => {
        responseHeaders.set(key, value);
      });

      return new Response(resp.body, {
        status: resp.status,
        headers: responseHeaders,
      });

    } catch (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { 
          status: 500, 
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
          }
        }
      );
    }
  },
};
