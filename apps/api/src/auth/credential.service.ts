import { Injectable } from '@nestjs/common';
import { hashPassword, verifyPassword } from '@eldercare/authz/server';

const DUMMY_PASSWORD = 'Local-Dummy-Password-Only';
const DUMMY_SALT = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');

@Injectable()
export class CredentialService {
  private readonly dummyHash = hashPassword(DUMMY_PASSWORD, { salt: DUMMY_SALT });

  normalizeLoginName(value: string): string {
    return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  }

  async verify(password: string, encodedHash: string | undefined): Promise<boolean> {
    const hash = encodedHash ?? (await this.dummyHash);
    const valid = await verifyPassword(password, hash);
    return encodedHash === undefined ? false : valid;
  }
}
