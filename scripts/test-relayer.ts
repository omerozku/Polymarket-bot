import 'dotenv/config';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { ClobClient, OrderType, Side } from '@polymarket/clob-client-v2';

async function main() {
  const pk = process.env.POLYMARKET_PRIVATE_KEY!;
  const relayerKey = process.env.RELAYER_API_KEY!;
  const relayerAddress = process.env.RELAYER_API_KEY_ADDRESS!;
  
  console.log('EOA:', privateKeyToAccount(pk as `0x${string}`).address);
  console.log('Relayer Key:', relayerKey);
  console.log('Relayer Address:', relayerAddress);

  const account = privateKeyToAccount(pk as `0x${string}`);
  const signer = createWalletClient({ account, chain: polygon, transport: http() });

  // Try with relayer config
  const client = new ClobClient({
    host: 'https://clob.polymarket.com',
    chain: 137,
    signer,
    signatureType: 0,
    funderAddress: relayerAddress,
    builderConfig: {
      api_key: relayerKey,
      secret: '',
      passphrase: '',
    },
  });

  console.log('\n--- Trying order with relayer builder config ---');
  try {
    const result = await client.createAndPostOrder(
      {
        tokenID: '38352310116372992123977928911192323127299152605857098751973676720018570396554',
        side: Side.BUY,
        price: 0.01,
        size: 5,
      },
      { tickSize: '0.001', negRisk: true },
      OrderType.GTC,
    );
    console.log('SUCCESS:', JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.log('Error:', err.message);
    if (err.response) console.log('Response:', JSON.stringify(err.response.data));
  }

  // Also try: derive creds first, then use relayer
  console.log('\n--- Try 2: derive creds, then post ---');
  const bootstrap = new ClobClient({
    host: 'https://clob.polymarket.com',
    chain: 137,
    signer,
  });
  const creds = await bootstrap.createOrDeriveApiKey();
  console.log('Creds key:', creds.key);
  
  const client2 = new ClobClient({
    host: 'https://clob.polymarket.com',
    chain: 137,
    signer,
    creds,
    signatureType: 0,
    funderAddress: relayerAddress,
  });

  try {
    const result = await client2.createAndPostOrder(
      {
        tokenID: '38352310116372992123977928911192323127299152605857098751973676720018570396554',
        side: Side.BUY,
        price: 0.01,
        size: 5,
      },
      { tickSize: '0.001', negRisk: true },
      OrderType.GTC,
    );
    console.log('SUCCESS:', JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.log('Error:', err.message);
    if (err.response) console.log('Response:', JSON.stringify(err.response.data));
  }
}

main();
