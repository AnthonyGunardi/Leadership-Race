import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getEnv } from '../../config/environment.js';
import { defineAdminIdentity } from '../../models/adminIdentity.js';
import { defineAuthAudit } from '../../models/authAudit.js';
import { setupIsolatedTestDatabase } from '../helpers/testDatabase.js';
import { bootstrapAdminUser } from '../../services/adminBootstrap.js';
import { runBootstrapCli } from '../../cli/bootstrapAdmin.js';

const require = createRequire(import.meta.url);
const runFile = promisify(execFile);
const migrationDirectory = fileURLToPath(new URL('../../../migrations/', import.meta.url));

describe('Admin bootstrap service and atomicity on isolated MySQL', () => {
  let testDb;
  let identityModels;
  let auditModels;

  beforeAll(async () => {
    testDb = await setupIsolatedTestDatabase();
    const env = getEnv();
    await runFile(process.execPath, [
      require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate', '--env', 'test',
      '--config', fileURLToPath(new URL('../../../sequelize.config.cjs', import.meta.url)),
      '--migrations-path', migrationDirectory
    ], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DB_NAME: testDb.schemaName,
        DB_HOST: env.DB_HOST,
        DB_PORT: String(env.DB_PORT),
        DB_USER: env.DB_USER,
        DB_PASSWORD: env.DB_PASSWORD
      }
    });

    identityModels = defineAdminIdentity(testDb.sequelize);
    auditModels = defineAuthAudit(testDb.sequelize);
  });

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('creates a Super Admin user and matching audit log atomically', async () => {
    const email = `bootstrap_${Date.now()}@example.test`;
    const password = 'SuperSecretAdminPassword123!';
    const requestId = randomUUID();

    const result = await bootstrapAdminUser({
      sequelize: testDb.sequelize,
      email,
      password,
      requestId
    });

    expect(result).toMatchObject({
      email: email.toLowerCase(),
      role: 'SUPER_ADMIN'
    });
    expect(result.id).toMatch(/^[a-f0-9-]{36}$/);

    const persistedUser = await identityModels.User.findByPk(result.id);
    expect(persistedUser).not.toBeNull();
    expect(persistedUser.email).toBe(email.toLowerCase());
    expect(persistedUser.role).toBe('SUPER_ADMIN');
    expect(persistedUser.isActive).toBe(true);
    expect(persistedUser.passwordHash).toMatch(/^\$2[aby]\$12\$/);

    const auditEntry = await auditModels.AuditLog.findOne({
      where: { actorUserId: result.id, action: 'ADMIN_BOOTSTRAP' }
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry.requestId).toBe(requestId);
    expect(auditEntry.afterJson).toEqual({
      email: email.toLowerCase(),
      role: 'SUPER_ADMIN'
    });
    // Verify plaintext password and hash are NOT stored in audit log
    expect(JSON.stringify(auditEntry.toJSON())).not.toContain(password);
    expect(JSON.stringify(auditEntry.toJSON())).not.toContain(persistedUser.passwordHash);
  });

  it('rejects duplicate email and makes no partial writes', async () => {
    const email = `duplicate_${Date.now()}@example.test`;
    const password = 'FirstValidPassword123!';

    await bootstrapAdminUser({
      sequelize: testDb.sequelize,
      email,
      password
    });

    const auditCountBefore = await auditModels.AuditLog.count();

    await expect(bootstrapAdminUser({
      sequelize: testDb.sequelize,
      email: email.toUpperCase(), // Case insensitive check
      password: 'SecondPassword456!'
    })).rejects.toThrow(/already exists/i);

    const auditCountAfter = await auditModels.AuditLog.count();
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it('rejects invalid password and makes no writes', async () => {
    const email = `invalid_pwd_${Date.now()}@example.test`;

    await expect(bootstrapAdminUser({
      sequelize: testDb.sequelize,
      email,
      password: 'short'
    })).rejects.toThrow(/at least 8 characters/i);

    const user = await identityModels.User.findOne({ where: { email } });
    expect(user).toBeNull();
  });

  describe('runBootstrapCli', () => {
    it('successfully prompts, creates admin, and suppresses password in stdout', async () => {
      const email = `cli_success_${Date.now()}@example.test`;
      const password = 'CliPassword2026!';
      const input = new PassThrough();
      let outputText = '';
      const output = new PassThrough();
      output.on('data', (chunk) => {
        outputText += chunk.toString();
      });

      // Write inputs into stdin
      input.write(`${email}\n`);
      input.write(`${password}\n`);
      input.write(`${password}\n`);

      const result = await runBootstrapCli({
        input,
        output,
        sequelize: testDb.sequelize,
        argv: ['node', 'bootstrapAdmin.js']
      });

      expect(result.email).toBe(email);
      expect(result.role).toBe('SUPER_ADMIN');
      expect(outputText).toContain('[SUCCESS] Super Admin account created:');
      // Proves password was NOT echoed in outputText
      expect(outputText).not.toContain(password);
    });

    it('rejects passwords that do not match on confirmation', async () => {
      const email = `cli_mismatch_${Date.now()}@example.test`;
      const input = new PassThrough();
      const output = new PassThrough();

      input.write(`${email}\n`);
      input.write('Password123!\n');
      input.write('DifferentPassword123!\n');

      await expect(runBootstrapCli({
        input,
        output,
        sequelize: testDb.sequelize,
        argv: ['node', 'bootstrapAdmin.js']
      })).rejects.toThrow(/confirmation does not match/i);
    });

    it('rejects execution when credentials are provided in argv', async () => {
      await expect(runBootstrapCli({
        argv: ['node', 'bootstrapAdmin.js', '--password', 'Secret123!']
      })).rejects.toThrow(/Passing credentials via command-line arguments is strictly prohibited/i);
    });

    it('rejects empty password input', async () => {
      const email = `cli_empty_${Date.now()}@example.test`;
      const input = new PassThrough();
      const output = new PassThrough();

      input.write(`${email}\n`);
      input.write('\n');
      input.write('\n');

      await expect(runBootstrapCli({
        input,
        output,
        sequelize: testDb.sequelize,
        argv: ['node', 'bootstrapAdmin.js']
      })).rejects.toThrow(/Password cannot be empty/i);
    });
  });
});
