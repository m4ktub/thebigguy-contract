import {
  WriterBytes,
  WriterLength,
  writeOutPoint,
  writeTxOutput,
  type TxInput,
  type TxOutput,
  type Writer
} from 'ecash-lib';

function serializeValues<T>(data: T[], writer: (v: T, w: Writer) => void) {
  const lengthWriter = new WriterLength();
  data.forEach(value => writer(value, lengthWriter));
  const bytesWriter = new WriterBytes(lengthWriter.length);
  data.forEach(value => writer(value, bytesWriter));
  return bytesWriter.data;
}

export function serializePrevouts(inputs: TxInput[]) {
  return serializeValues(inputs.map(i => i.prevOut), writeOutPoint);
}

export function serializeOutputs(outputs: TxOutput[]) {
  return serializeValues(outputs, writeTxOutput);
}
