import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'scrypt';
const COST = 32_768;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_MEMORY = 64 * 1024 * 1024;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function deriveKey(
  password: string,
  salt: Uint8Array,
  cost: number,
  blockSize: number,
  parallelization: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: cost, r: blockSize, p: parallelization, maxmem: MAX_MEMORY },
      (error, derivedKey) => {
        if (error !== null) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`);
  }
}

export interface PasswordHashOptions {
  readonly salt?: Uint8Array;
}

export async function hashPassword(
  password: string,
  options: PasswordHashOptions = {},
): Promise<string> {
  assertPassword(password);
  const salt = options.salt ?? randomBytes(SALT_LENGTH);
  if (salt.byteLength !== SALT_LENGTH) {
    throw new Error(`Password salt must be exactly ${SALT_LENGTH} bytes`);
  }
  const derivedKey = await deriveKey(password, salt, COST, BLOCK_SIZE, PARALLELIZATION);

  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    Buffer.from(salt).toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  const [algorithm, rawCost, rawBlockSize, rawParallelization, rawSalt, rawHash, ...rest] =
    encodedHash.split('$');

  if (
    algorithm !== ALGORITHM ||
    rawCost === undefined ||
    rawBlockSize === undefined ||
    rawParallelization === undefined ||
    rawSalt === undefined ||
    rawHash === undefined ||
    rest.length > 0
  ) {
    return false;
  }

  const cost = Number(rawCost);
  const blockSize = Number(rawBlockSize);
  const parallelization = Number(rawParallelization);
  if (cost !== COST || blockSize !== BLOCK_SIZE || parallelization !== PARALLELIZATION) {
    return false;
  }

  try {
    if (
      rawSalt.length !== 22 ||
      rawHash.length !== 43 ||
      !BASE64URL_PATTERN.test(rawSalt) ||
      !BASE64URL_PATTERN.test(rawHash)
    ) {
      return false;
    }
    const salt = Buffer.from(rawSalt, 'base64url');
    const expected = Buffer.from(rawHash, 'base64url');
    if (salt.byteLength !== SALT_LENGTH || expected.byteLength !== KEY_LENGTH) return false;
    const actual = await deriveKey(password, salt, cost, blockSize, parallelization);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
