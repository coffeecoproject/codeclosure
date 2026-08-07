import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';

if (process.argv.length !== 3) {
  throw new TypeError('Expected exactly one Candidate root argument');
}

const candidateRoot = resolve(process.argv[2]);
const modulePath = resolve(candidateRoot, 'src/payment.js');
const relativeModulePath = relative(candidateRoot, modulePath);
if (
  !isAbsolute(candidateRoot) ||
  relativeModulePath === '..' ||
  relativeModulePath.startsWith(`..${sep}`) ||
  isAbsolute(relativeModulePath)
) {
  throw new TypeError('Protected check target escapes the Candidate root');
}

const { PaymentProcessor } = await import(
  `${pathToFileURL(modulePath).href}?codeclosure_protected_check=1`
);
assert.equal(typeof PaymentProcessor, 'function');

const processor = new PaymentProcessor();
const first = processor.processCallback({ orderId: 'protected-order-1', amount: 66 });
const duplicate = processor.processCallback({ orderId: 'protected-order-1', amount: 66 });
assert.equal(first.status, 'charged');
assert.equal(duplicate.status, 'duplicate_ignored');
assert.deepEqual(
  processor.getCharges().map(({ orderId, amount }) => ({ orderId, amount })),
  [{ orderId: 'protected-order-1', amount: 66 }],
);

const independent = new PaymentProcessor();
independent.processCallback({ orderId: 'protected-order-2', amount: 20 });
independent.processCallback({ orderId: 'protected-order-3', amount: 30 });
assert.deepEqual(
  independent.getCharges().map(({ orderId, amount }) => ({ orderId, amount })),
  [
    { orderId: 'protected-order-2', amount: 20 },
    { orderId: 'protected-order-3', amount: 30 },
  ],
);
