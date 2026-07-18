/**
 * Test: Try different order formats to find what the API accepts
 */
import 'dotenv/config';
import { ClobClient, Chain, Side, OrderType } from '@polymarket/clob-client';
import { Wallet } from 'ethers';
import axios from 'axios';
import crypto from 'crypto';

async function main() {
  const pk = process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk) { console.error('No private key'); process.exit(1); }

  const wallet = new Wallet(pk);
  const client = new ClobClient('https://clob.polymarket.com', Chain.POLYGON, wallet);

  // Derive API key
  const derived = await client.deriveApiKey();
  console.log('API Key:', derived.key.slice(0, 10) + '...');

  // Create L2 client
  const l2Client = new ClobClient(
    'https://clob.polymarket.com',
    Chain.POLYGON,
    wallet,
    { key: derived.key, secret: derived.secret, passphrase: derived.passphrase }
  );

  const testTokenId = '38352310116372992123977928911192323127299152605857098751973676720018570396554';
  const tickSize = await l2Client.getTickSize(testTokenId);
  const negRisk = await l2Client.getNegRisk(testTokenId);
  console.log('Tick size:', tickSize, 'Neg risk:', negRisk);

  // Create the signed order
  const order = await l2Client.createOrder(
    { tokenID: testTokenId, side: Side.BUY, price: 0.01, size: 5 },
    { tickSize, negRisk }
  );
  console.log('\nSigned order (raw):', JSON.stringify(order, null, 2));

  // Build L2 auth headers manually
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const method = 'POST';
  const requestPath = '/order';
  const body = JSON.stringify({
    deferExec: false,
    order: {
      salt: Number.parseInt(order.salt, 10),
      maker: order.maker,
      signer: order.signer,
      taker: order.taker,
      tokenId: order.tokenId,
      makerAmount: order.makerAmount,
      takerAmount: order.takerAmount,
      side: Side.BUY,
      expiration: order.expiration,
      nonce: order.nonce,
      feeRateBps: order.feeRateBps,
      signatureType: order.signatureType,
      signature: order.signature,
    },
    owner: derived.key,
    orderType: 'GTC',
    postOnly: false,
  });

  // Generate HMAC signature for L2 auth
  const prehash = timestamp + method + requestPath + body;
  const hmac = crypto.createHmac('sha256', Buffer.from(derived.secret, 'base64'));
  hmac.update(prehash);
  const signature = hmac.digest('base64');

  const headers = {
    'Content-Type': 'application/json',
    'POLY_ADDRESS': wallet.address,
    'POLY_SIGNATURE': signature,
    'POLY_TIMESTAMP': timestamp,
    'POLY_API_KEY': derived.key,
    'POLY_PASSPHRASE': derived.passphrase,
  };

  console.log('\n--- Test 1: Standard format (side as string) ---');
  try {
    const resp = await axios.post('https://clob.polymarket.com/order', body, { headers });
    console.log('SUCCESS:', resp.data);
  } catch (err: any) {
    console.log('FAILED:', err.response?.data || err.message);
  }

  // Test 2: side as number
  console.log('\n--- Test 2: side as number ---');
  const body2 = body.replace('"side":"BUY"', '"side":0');
  try {
    const resp = await axios.post('https://clob.polymarket.com/order', body2, { headers });
    console.log('SUCCESS:', resp.data);
  } catch (err: any) {
    console.log('FAILED:', err.response?.data || err.message);
  }

  // Test 3: Add version field
  console.log('\n--- Test 3: With version field ---');
  const parsed = JSON.parse(body);
  parsed.order.version = '1';
  const body3 = JSON.stringify(parsed);
  try {
    const resp = await axios.post('https://clob.polymarket.com/order', body3, { headers });
    console.log('SUCCESS:', resp.data);
  } catch (err: any) {
    console.log('FAILED:', err.response?.data || err.message);
  }

  // Test 4: Without feeRateBps (let server determine)
  console.log('\n--- Test 4: Without feeRateBps ---');
  const parsed4 = JSON.parse(body);
  delete parsed4.order.feeRateBps;
  const body4 = JSON.stringify(parsed4);
  try {
    const resp = await axios.post('https://clob.polymarket.com/order', body4, { headers });
    console.log('SUCCESS:', resp.data);
  } catch (err: any) {
    console.log('FAILED:', err.response?.data || err.message);
  }
}

main();
