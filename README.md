# The Big Guy Contract

Create P2SH addresses that ensure a proportional distribution of coins based on pre-agreed recipients and shares. Knowledge of the private key, used to sign the payment transaction, does not allow any special power, meaning that recipients can be sure tha funds will never be distributed in a different way.

For example, if 100.00 XEC are received, a fee of 12.00 XEC is deducted, and then 90% (72.00 XEC) is transferred to one address and 10% (8.00 XEC) to another. The missing 8.00 XEC are explained by the use of integer math and the use of $1/1000$ units to allow shares from 0.1% to 99.9%.

## Building

The library can be built through the typical:

- `npm run build`

This will clear all files, make sure any code changes follow the standard conventions, and recompile source files. Each of those steps can be executed separately to the same effect:

- `npm run clean`
- `npm run lint`
- `npm run compile`

## Testing

Unit tests are only run automatically before publishing but they should also be run before commits with code changes. The standard target of `npm run test` will run two kinds of tests:

 * `test:src`: unit tests that are standalone and can be run at any time;
 * `test:rpc`: a script that connects to a local `bitcoind`, in`regtest` mode, through `RPC`;

Each of those individual targets can be run separately, which can be useful if a local node is not running. Otherwise, before launching the tests, you need to run:

```
$> bitcoind -regtest -rpcuser=rpcuser -rpcpassword=rpcpass
```

## Usage

The library requires the use of the eCash Library, for the cryptographic primitives, and a Bitcoin private key to manage transaction signatures. To generate a nwe contract script we also needs to provide a minimum fee and the involved parties, each party with an address and its share of the input. A _per mille_ share is used, that is, all shares must add up to 1000 allowing for shares to represent value from 0.1% to 99.9% of the input value.

The following example creates the contract strict for two parties, in a 90%/10% distribution, and prints it's address to the console. Note that changing either the private key, the minimum fee, or the details of any party will print a different address.

```typescript
const ecc = new xeclib.Ecc();
const prvKey = fromHex("...");

const fee = 2000; // SAT
const parties = [
  { address: "ecash:qq28cqs6dx23qh4qucnk9v3l2jt4yr242cxqqnw9kc", share: 900 },
  { address: "ecash:qq830d643lw865u0x7mpc4yzsrvt9peccggju7td2v", share: 1000 },
];

const contract = createScript(ecc, prvKey, fee, parties);
const hash = xeclib.shaRmd160(contract.data);
console.log("contract: ", xecaddr.encode("ecash", "P2SH", hash));
```

Given a contract script and its details, it's possible to simulate the distribution with `createOutputs()`, that is, obtain the only output configuration that will be considered valid for a given input value. The are three main cases for the outputs:

  * If the value is too big to be distributed, then the outputs will be a 50%/50% split back to the contract address
  * If the value is too small to be distributed, then a single empty `OP_RETURN` is included
  * Otherwise, an output will be added for each party that receives more than 5.46 XEC.

```typescript
const value: number = ...;
const outputs = createOutputs(value, fee, contract, parties);

console.log("distributing:", value)
outputs.forEach(output => {
  const hexScript = xeclib.toHex(output.script.bytecode);
  if (hexScript === "6a") { 
    console.log("only fees");
  } else {
    console.log(output.value, xecaddr.encodeOutputScript(hexScript));
  }
});
```

The library can also generate the spending transaction with `createTx()`. It combines the previous examples to produce a transaction that is ready to be broadcast. The script is built internally to ensure that the same parameters are used for the script and outputs, making the transaction valid.

```typescript
const utxo = { txid: "...", outIdx: ..., value };
const tx = createTx(ecc, prvKey, utxo, fee, parties);
console.log("tx:", xeclib.toHex(tx.ser()));
```

## Limitations

  * The number of parties is currently limited to either 2 or 3. More parties
    would create a _preimage_ with more than 520 bytes making it impossible to
    push to the stack.
  * The fee needs to be chosen externally because it will be part of the
    script. The goal is to ensure that at least some SATs are reserved for
    network fees and discount that value form the distribution. A minimum of 1
    SAT/byte is assumed and `createTx()` will fail if the provided fee is
    lower. If the input value is smaller, in SAT, than the transaction size in
    bytes then creating the transaction will succeed but it may not be accepted
    by the node when broadcast. In principle, more fees can be provided through
    additional inputs but that is currently not supported. 
  * The values are calculated through integer division. This means that up to
    999 additional SAT, from the input value, may added to the fees, instead of
    being distributed.
  * Since output values need to be above dust levels (5.46 XEC), small input 
    or share values will also lead to additional feeds because that value
    corresponding to the output share cannot be distributed. For a share of 1
    (0.1%) and a fee of 20.00 XEC, any value smaller than 5480.00 XEC will not
    be distributed.
