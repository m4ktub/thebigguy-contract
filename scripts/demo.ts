import { Ecc, fromHex, initWasm, type PushOp, type Script, shaRmd160, toHex } from 'ecash-lib';
import { encode, isValidCashAddress } from 'ecashaddrjs';
import { createTx } from '../src/tx';

//
// demo contract
//

const contract = {
  // the minium fee (the effective fee will be between 2000 and 2999)
  fee: 2000,

  // the party's addresses and the share of each
  parties: [
    { address: "ecash:qq28cqs6dx23qh4qucnk9v3l2jt4yr242cxqqnw9kc", share: 900 },
    { address: "ecash:qq830d643lw865u0x7mpc4yzsrvt9peccggju7td2v", share: 100 }
  ]
};

//
// validate request
//

// validate that all addresses are valid
const addressesValid = contract.parties.every(p => isValidCashAddress(p.address, "ecash"));
if (!addressesValid) {
  throw new Error("All addresses must be valid mainnet ecash addresses");
}

// validate that shares add to 1000
const shareTotal = contract.parties.reduce((v, p) => v + p.share, 0);
if (shareTotal != 1000) {
  throw new Error("Shares must add to 1000");
}

//
// initialize ECC
//

initWasm();
const ecc = new Ecc();

//
// use some private key
//

const prvKey = fromHex("57607b06ad855ecf808440130a2b466c1ce5fca269dff8a92b69697216460d6e");

//
// create spending transaction
//

const utxo = {
  txid: '0000000000000000000000000000000000000000000000000000000000000001',
  outIdx: 0,
  value: 36378418
};

const signedTx = createTx(ecc, prvKey, utxo, contract.fee, contract.parties);

//
// print details
//
// The transaction will have a spend script which is 13 pushes
// - serialized prevouts
// - serialized outputs
// - signature
// - preimage for the input split into 9 parts (last two elements joined)
// - script, as required for P2SH
//
const redeemScript = signedTx.inputs[0].script as Script
const opsIter = redeemScript.ops();

const prevouts = opsIter.next() as PushOp;
const outputs = opsIter.next() as PushOp;
const sig = opsIter.next() as PushOp;
const preimage1 = opsIter.next() as PushOp;
const preimage2 = opsIter.next() as PushOp;
const preimage3 = opsIter.next() as PushOp;
const preimage4 = opsIter.next() as PushOp;
const preimage5 = opsIter.next() as PushOp;
const preimage6 = opsIter.next() as PushOp;
const preimage7 = opsIter.next() as PushOp;
const preimage8 = opsIter.next() as PushOp;
const preimage9 = opsIter.next() as PushOp;
const script = opsIter.next() as PushOp;

console.log("      tx:", signedTx.serSize(), toHex(signedTx.ser()));
console.log();
console.log("prevouts:", prevouts.data.length, toHex(prevouts.data));
console.log(" outputs:", outputs.data.length, toHex(outputs.data));
console.log("     sig:", sig.data.length, toHex(sig.data));
console.log("preimage:", preimage1.data.length, toHex(preimage1.data));
console.log("         ", preimage2.data.length, toHex(preimage2.data));
console.log("         ", preimage3.data.length, toHex(preimage3.data));
console.log("         ", preimage4.data.length, toHex(preimage4.data));
console.log("         ", preimage5.data.length, toHex(preimage5.data));
console.log("         ", preimage6.data.length, toHex(preimage6.data));
console.log("         ", preimage7.data.length, toHex(preimage7.data));
console.log("         ", preimage8.data.length, toHex(preimage8.data));
console.log("         ", preimage9.data.length, toHex(preimage9.data));
console.log();
console.log(" address:", encode("ecash", "P2SH", shaRmd160(script.data)))
console.log("  script:", script.data.length, toHex(script.data));
