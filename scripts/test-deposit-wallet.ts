import 'dotenv/config';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { ClobClient, OrderType, Side } from '@polymarket/clob-client-v2';

async function main() {
  const pk = process.env.POLYMARKET_PRIVATE_KEY!;
  const account = privateKeyToAccount(pk as `0x${string}`);
  const funderAddress = '0xA00eed21f51b2f01E7be6b06e871143BA4B87B09';
  
  console.log('EOA:', account.address);
  console.log('Funder (deposit wallet):', funderAddress);

  const signer = createWalletClient({ account, chain: polygon, transport: http() });

  // Derive API key
  const bootstrap = new ClobClient({ host: 'https://clob.polymarket.com', chain: 137, signer });
  const creds = await bootstrap.createOrDeriveApiKey();

  // signatureType: 0 (EOA) with deposit wallet as funder
  console.log('\n--- signatureType=0 + deposit wallet funder ---');
  const client = new ClobClient({
    host: 'https://clob.polymarket.com',
    chain: 137,
    signer,
    creds,
    signatureType: 0,
    funderAddress,
  });

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
}

main();
