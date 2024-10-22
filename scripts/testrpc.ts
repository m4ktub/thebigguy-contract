import { Ecc, fromHex, initWasm, Script, shaRmd160, toHex } from 'ecash-lib';
import * as xecaddr from 'ecashaddrjs';
import { createScript, type Party, quotient } from '../src/script';
import { createTx, type Utxo } from '../src/tx';

//
// gather environment
//
// by default it's assumed that bitcoind is launched with:
// > bitcoind -regtest -rpcuser=rpcuser -rpcpassword=rpcpass
//

const rpcPort = Number(process.env.RPC_PORT || 18443);
const rpcUser = process.env.RPC_USER || "rpcuser";
const rpcPass = process.env.RPC_USER || "rpcpass";

//
// constants
//

const PRV_KEY = fromHex("4725906e7aa590338495dcae20aa37174acd1a657687cbedcc2ebe031664d27a");

const SEND_OVER_FLOW_VALUE = 41_234_567_89;
const SEND_FULL_DIST_VALUE = 1_234_567_89;
const SEND_SEMI_DIST_VALUE = 30_00;
const SEND_OP_RETURN_VALUE = 29_99;
const CONTRACT_FEE = 20_00;
const WALLET_FEES = 20_00;

const WALLET_NAME = "tbg";
const WALLET_MIN_VALUE =
  SEND_OVER_FLOW_VALUE +
  SEND_FULL_DIST_VALUE +
  SEND_SEMI_DIST_VALUE +
  SEND_OP_RETURN_VALUE +
  WALLET_FEES

//
// utils
//

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const auth = btoa(`${rpcUser}:${rpcPass}`);
  const id = `${method}.${Date.now()}.${Math.random()}`;

  // perform request
  const res = await fetch(`http://localhost:${rpcPort}`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`
    },
    body: JSON.stringify({ id, method, params })
  });

  // check authentication error
  if (res.status == 401) {
    throw new Error(`Authentication failed with ${rpcUser}:${rpcPass}`);
  }

  // check error response
  const data = await res.json();
  if (data.error) {
    throw new Error(JSON.stringify(data.error));
  }

  return data.result as T;
}

function xec(amount: number): number {
  return amount / 100;
}

//
// create or load wallet
//

type WalletNames = string[];

interface WalletDir {
  wallets: Array<{ name: string }>
}

interface Wallet {
  name: string
}

async function loadWallet() {
  // check loaded wallets
  const names = await rpc<WalletNames>("listwallets", []);
  if (names.includes(WALLET_NAME)) {
    console.log(`Wallet ${WALLET_NAME} already loaded. Reusing...`);
    return WALLET_NAME;
  }

  // check wallet dir
  const dir = await rpc<WalletDir>("listwalletdir", []);
  const exists = dir.wallets.map(w => w.name).includes(WALLET_NAME);
  if (exists) {
    // load existing wallet
    console.log(`Wallet ${WALLET_NAME} exists. Loading...`);
    await rpc<Wallet>("loadwallet", [WALLET_NAME]);
  } else {
    // creating new wallet
    console.log(`Wallet ${WALLET_NAME} is missing. Creating wallet...`);
    await rpc<Wallet>("createwallet", [WALLET_NAME]);
  }

  // return wallet name
  return WALLET_NAME;
}

//
// ensure the wallet has funds
//

interface WalletInfo {
  walletname: string;
  balance: number;
  txcount: number;
}

type Txs = string[];

async function fundWallet() {
  // get wallet info
  let info = await rpc<WalletInfo>("getwalletinfo", []);

  // check wallet balance
  if (info.balance >= xec(WALLET_MIN_VALUE)) {
    // return current info
    console.log(`Wallet has sufficient balance: ${info.balance} XEC`);
    return info;
  }
  // mine blocks into wallet
  console.log(`Wallet has insufficient balance: ${info.balance} XEC`);
  console.log(`Generating new coins to wallet...`);
  const address = await rpc<string>("getnewaddress", []);
  await rpc<Txs>("generatetoaddress", [101, address]);

  // get updated wallet info, after blocks
  info = await rpc<WalletInfo>("getwalletinfo", []);

  // check possibility of now having enough rewards for test
  if (info.balance < xec(WALLET_MIN_VALUE)) {
    throw new Error("Could not generate enough coins. Try restarting bitcoind " +
      "with a clean regtest directory.")
  }

  return info;
}

//
// create contract
//

interface Contract {
  ecc: Ecc;
  fee: number;
  parties: Array<Party>,
  script: Script,
  address: string
}

async function createContract(): Promise<Contract> {
  // initialize XEC WASM primitives
  await initWasm();
  const ecc = new Ecc();

  // get party addresses
  console.log("Getting addresses for parties...")
  const party1 = await rpc<string>("getnewaddress", []);
  const party2 = await rpc<string>("getnewaddress", []);
  console.log("  ", party1);
  console.log("  ", party2);

  // define contract parameters
  const fee = CONTRACT_FEE;
  const parties = [
    { address: party1, share: 900 },
    { address: party2, share: 100 }
  ];

  // get contract address
  const script = createScript(ecc, PRV_KEY, fee, parties);
  const hash = shaRmd160(script.bytecode);
  const address = xecaddr.encode("ecregtest", "P2SH", hash);

  // print and return details
  console.log(`Created contract at address ${address}`);
  console.log(`   #1: ${parties[0].address}\t${parties[0].share}`);
  console.log(`   #2: ${parties[1].address}\t${parties[1].share}`);
  console.log(`  fee: ${xec(fee).toFixed(2)} XEC`);

  return { ecc, fee, parties, script, address };
};

//
// send coins to contract address
//

interface TxOut {
  value: number;
}

async function sendAndGetUtxo(address: string, value: number): Promise<Utxo> {
  // send payment, value must be in XEC units
  const xecValue = xec(value);
  const txid = await rpc<string>("sendtoaddress", [address, xecValue]);

  // the node randomizes position of change output, get first output
  const out = await rpc<TxOut>("gettxout", [txid, 0]);

  // return utxo details
  return {
    txid: txid,
    outIdx: out.value === xecValue ? 0 : 1,
    value: value
  };
}

interface TestState {
  contract: Contract,
  utxo: {
    overflow: Utxo,
    fullDist: Utxo,
    semiDist: Utxo,
    opReturn: Utxo
  },
  transactions: string[]
}

async function fundContract(contract: Contract): Promise<TestState> {
  // send funds of different of kinds
  console.log(`Sending multipe coins to ${contract.address}...`);
  const utxo1 = await sendAndGetUtxo(contract.address, SEND_OVER_FLOW_VALUE);
  const utxo2 = await sendAndGetUtxo(contract.address, SEND_FULL_DIST_VALUE);
  const utxo3 = await sendAndGetUtxo(contract.address, SEND_SEMI_DIST_VALUE);
  const utxo4 = await sendAndGetUtxo(contract.address, SEND_OP_RETURN_VALUE);

  // print details
  console.log("  sent:", utxo1.txid, xec(utxo1.value).toFixed(2), "XEC");
  console.log("  sent:", utxo2.txid, xec(utxo2.value).toFixed(2), "XEC");
  console.log("  sent:", utxo3.txid, xec(utxo3.value).toFixed(2), "XEC");
  console.log("  sent:", utxo4.txid, xec(utxo4.value).toFixed(2), "XEC");

  // return funding state
  return {
    contract,
    utxo: {
      overflow: utxo1,
      fullDist: utxo2,
      semiDist: utxo3,
      opReturn: utxo4
    },
    transactions: []
  };
}

//
// split big value sent to address
//

async function spend(state: TestState, utxo: Utxo) {
  // get contract detalis
  const { ecc, fee, parties } = state.contract;

  // create spend transaction
  const tx = createTx(ecc, PRV_KEY, utxo, fee, parties);
  const txHex = toHex(tx.ser());

  // broadcast tx
  const txid = await rpc<string>("sendrawtransaction", [txHex]);

  // update state with txid
  state.transactions.push(txid);

  // return txid
  return txid;
}

async function spendBigValue(state: TestState) {
  console.log(`Spending coin with ${xec(SEND_OVER_FLOW_VALUE).toFixed(2)} XEC...`);
  console.log("  sent: " + await spend(state, state.utxo.overflow));
}

//
// distributing split coin sent to address
//

async function spendBigValueSplit(state: TestState) {
  console.log("Creating distribution transaction for outputs of split...");

  // create utxos with expected values
  const splitValue = SEND_OVER_FLOW_VALUE - CONTRACT_FEE;
  const splitValueHalf = quotient(splitValue, 2);

  const splitUtxo0 = {
    txid: state.transactions[0],
    outIdx: 0,
    value: splitValue - splitValueHalf
  };

  const splitUtxo1 = {
    txid: state.transactions[0],
    outIdx: 1,
    value: splitValueHalf
  };

  // create and broadcast spend of first utxo
  console.log("  sent: " + await spend(state, splitUtxo0));

  // create and broadcast spend of secondutxo
  console.log("  sent: " + await spend(state, splitUtxo1));
}

//
// distributing specific coin sent to address
//

async function spendFullDistCoin(state: TestState) {
  console.log(`Spending coin with ${xec(SEND_FULL_DIST_VALUE).toFixed(2)} XEC...`);
  console.log("  sent: " + await spend(state, state.utxo.fullDist));
}

//
// semi distributing specific coin sent to address
//

async function spendSemiDistCoin(state: TestState) {
  console.log(`Spending coin with ${xec(SEND_SEMI_DIST_VALUE).toFixed(2)} XEC...`);
  console.log("  sent: " + await spend(state, state.utxo.semiDist));
}

//
// spending value to low to generate any share
//


async function spendOpReturnCoin(state: TestState) {
  console.log(`Spending coin with ${xec(SEND_OP_RETURN_VALUE).toFixed(2)} XEC...`);
  console.log("  sent: " + await spend(state, state.utxo.opReturn));
}

//
// dump final details
//

async function printDetails(state: TestState) {
  // extract details
  const { contract, utxo, transactions } = state;

  // display printable info
  console.log("All transactions created without errors.");
  console.log();
  console.log("Details: ", {
    address: contract.address,
    parties: contract.parties,
    fee: contract.fee,
    utxo,
    transactions
  });
}

//
// main function
//

async function run() {
  await loadWallet();
  await fundWallet();
  const contract = await createContract();
  const state = await fundContract(contract);
  await spendBigValue(state);
  await spendBigValueSplit(state);
  await spendFullDistCoin(state);
  await spendSemiDistCoin(state);
  await spendOpReturnCoin(state);
  await printDetails(state);
}

run();
