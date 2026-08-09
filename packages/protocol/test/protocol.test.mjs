import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCbor, normalizeUsername } from "../dist/index.js";

test("normalizes and validates handles", () => assert.equal(normalizeUsername("Alice_1"), "alice_1"));
test("canonical map order is stable", () => assert.deepEqual(canonicalCbor({ b: 1, a: 2 }), canonicalCbor({ a: 2, b: 1 })));

test("canonical integers preserve millisecond timestamps", () => {
  assert.deepEqual(
    [...canonicalCbor(1_700_000_000_000)],
    [0x1b, 0x00, 0x00, 0x01, 0x8b, 0xcf, 0xe5, 0x68, 0x00]
  );
  assert.notDeepEqual(canonicalCbor(1_700_000_000_000), canonicalCbor(3_485_757_952));
});

test("canonical map keys use encoded UTF-8 byte ordering", () => {
  assert.deepEqual(
    [...canonicalCbor({ "é": 1, z: 2 })],
    [0xa2, 0x61, 0x7a, 0x02, 0x62, 0xc3, 0xa9, 0x01]
  );
});
