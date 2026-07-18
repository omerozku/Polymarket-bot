/**
 * Test: New API format with direct HTTP
 */
import 'dotenv/config';
import { ClobClient, Chain, Side } from '@polymarket/clob-client';
import { Wallet } from 'ethers';
import crypto from 'crypto';

async function main() {
  const pk = process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk) { console.error('No private key'); process.exit(1); }

  const wallet = new Wallet(pk);
  const client = new ClobClient('https://clob.polymarket.com', Chain.POLYGON, wallet);

  // Derive API key
  const derived = await client.deriveApiKey();

  const testTokenId = '38352310116372992123977928911192323127299152605857098751973676720018570396554';
  const tickSize = await client.getTickSize(testTokenId);
  const negRisk = await client.getNegRisk(testTokenId);
  console.log('Tick size:', tickSize, 'Neg risk:', negRisk);

  // Create the signed order
  const signedOrder = await client.createOrder(
    { tokenID: testTokenId, side: Side.BUY, price: 0.01, size: 5 },
    { tickSize, negRisk }
  );
  console.log('\nSigned order:', JSON.stringify(signedOrder, null, 2));

  // Build NEW format payload
  const now = Math.floor(Date.now() / 1000).toString();
  const newPayload = {
    deferExec: false,
    order: {
      salt: Number.parseInt(signedOrder.salt, 10),
      maker: signedOrder.maker,
      signer: signedOrder.signer,
      tokenId: signedOrder.tokenId,
      makerAmount: signedOrder.makerAmount,
      takerAmount: signedOrder.takerAmount,
      side: signedOrder.side,
      expiration: `${signedOrder.expiration}`,
      signatureType: signedOrder.signatureType,
      signature: signedOrder.signature,
      builder: '0x0000000000000000000000000000000000000000000000000000000000000000',
      metadata: '0x0000000000000000000000000000000000000000000000000000000000000000',
      timestamp: now,
    },
    owner: derived.key,
    orderType: 'GTC',
  };

  console.log('\nNew payload:', JSON.stringify(newPayload, null, 2));

  // Generate L2 auth headers
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const method = 'POST';
  const requestPath = '/order';
  const body = JSON.stringify(newPayload);
  const prehash = timestamp + method + requestPath + body;
  const hmac = crypto.createHmac('sha256', Buffer.from(derived.secret, 'base64'));
  hmac.update(prehash);
  const signature = hmac.digest('base64');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'POLY_ADDRESS': wallet.address,
    'POLY_SIGNATURE': signature,
    'POLY_TIMESTAMP': timestamp,
    'POLY_API_KEY': derived.key,
    'POLY_PASSPHRASE': derived.passphrase,
  };

  console.log('\n--- Posting to /order ---');
  try {
    const response = await fetch('https://clob.polymarket.com/order', {
      method: 'POST',
      headers,
      body,
    });

    const result = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

main();
