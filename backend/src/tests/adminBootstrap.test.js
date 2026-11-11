import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { Sequelize } from 'sequelize';
import { describe, it, expect, vi } from 'vitest';
import { defineAdminIdentity } from '../models/adminIdentity.js';
import { defineAuthAudit } from '../models/authAudit.js';
import { bootstrapAdminUser } from '../services/adminBootstrap.js';
import { runBootstrapCli } from '../cli/bootstrapAdmin.js';

function createTestSequelize() {
  const sequelize = new Sequelize('lr_test_bootstrap_unit', 'unused', '', {
    dialect: 'mysql',
    logging: false
  });
  defineAdminIdentity(sequelize);
  defineAuthAudit(sequelize);
  return sequelize;
}

describe('Admin bootstrap unit service and CLI', () => {
  describe('bootstrapAdminUser', () => {
    it('throws error when sequelize is missing', async () => {
      await expect(bootstrapAdminUser({
        email: 'admin@example.test',
        password: 'ValidPassword123!'
      })).rejects.toThrow('Sequelize instance is required for bootstrap');
    });

    it('rejects invalid email before hitting database', async () => {
      const sequelize = createTestSequelize();
      const spyTxn = vi.spyOn(sequelize, 'transaction');

      await expect(bootstrapAdminUser({
        sequelize,
        email: 'invalid-email',
        password: 'ValidPassword123!'
      })).rejects.toThrow(/invalid email/i);

      expect(spyTxn).not.toHaveBeenCalled();
    });

    it('rejects password shorter than 8 characters before hitting database', async () => {
      const sequelize = createTestSequelize();
      const spyTxn = vi.spyOn(sequelize, 'transaction');

      await expect(bootstrapAdminUser({
        sequelize,
        email: 'admin@example.test',
        password: 'short'
      })).rejects.toThrow(/at least 8 characters/i);

      expect(spyTxn).not.toHaveBeenCalled();
    });

    it('creates user and audit log in transaction when user does not exist', async () => {
      const sequelize = createTestSequelize();
      const userId = randomUUID();

      const spyFind = vi.spyOn(sequelize.models.User, 'findOne').mockResolvedValue(null);
      const spyCreateUser = vi.spyOn(sequelize.models.User, 'create').mockResolvedValue({
        id: userId,
        email: 'admin@example.test',
        role: 'SUPER_ADMIN'
      });
      const spyCreateAudit = vi.spyOn(sequelize.models.AuditLog, 'create').mockResolvedValue({});
      vi.spyOn(sequelize, 'transaction').mockImplementation(async (cb) => cb(null));

      const result = await bootstrapAdminUser({
        sequelize,
        email: 'Admin@Example.Test',
        password: 'SuperAdminPassword123!',
        requestId: '11111111-2222-4333-8444-555555555555'
      });

      expect(result).toMatchObject({
        email: 'admin@example.test',
        role: 'SUPER_ADMIN'
      });
      expect(spyFind).toHaveBeenCalledWith({
        where: { email: 'admin@example.test' },
        transaction: null
      });
      expect(spyCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'admin@example.test',
          role: 'SUPER_ADMIN',
          isActive: true
        }),
        { transaction: null }
      );
      expect(spyCreateAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'USER',
          action: 'ADMIN_BOOTSTRAP',
          requestId: '11111111-2222-4333-8444-555555555555'
        }),
        { transaction: null }
      );
    });

    it('rejects with duplicate error if user already exists', async () => {
      const sequelize = createTestSequelize();

      vi.spyOn(sequelize.models.User, 'findOne').mockResolvedValue({
        id: randomUUID(),
        email: 'admin@example.test'
      });
      const spyCreateUser = vi.spyOn(sequelize.models.User, 'create');
      vi.spyOn(sequelize, 'transaction').mockImplementation(async (cb) => cb(null));

      await expect(bootstrapAdminUser({
        sequelize,
        email: 'admin@example.test',
        password: 'SuperAdminPassword123!'
      })).rejects.toThrow(/already exists/i);

      expect(spyCreateUser).not.toHaveBeenCalled();
    });
  });

  describe('runBootstrapCli', () => {
    it('rejects command-line credentials passed via argv', async () => {
      await expect(runBootstrapCli({
        argv: ['node', 'cli.js', '--password=123']
      })).rejects.toThrow(/Passing credentials via command-line arguments is strictly prohibited/i);
    });

    it('rejects empty password input', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      input.write('admin@example.test\n\n\n');

      await expect(runBootstrapCli({
        input,
        output,
        argv: ['node', 'cli.js']
      })).rejects.toThrow(/Password cannot be empty/i);
    });

    it('rejects password confirmation mismatch', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      input.write('admin@example.test\nPassword123!\nMismatchPassword123!\n');

      await expect(runBootstrapCli({
        input,
        output,
        argv: ['node', 'cli.js']
      })).rejects.toThrow(/Password confirmation does not match/i);
    });

    it('executes bootstrap successfully with provided sequelize', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      let outputBuffer = '';
      output.on('data', (d) => { outputBuffer += d.toString(); });

      input.write('admin@example.test\nValidPassword123!\nValidPassword123!\n');

      const sequelize = createTestSequelize();
      const userId = randomUUID();

      vi.spyOn(sequelize.models.User, 'findOne').mockResolvedValue(null);
      vi.spyOn(sequelize.models.User, 'create').mockResolvedValue({
        id: userId,
        email: 'admin@example.test',
        role: 'SUPER_ADMIN'
      });
      vi.spyOn(sequelize.models.AuditLog, 'create').mockResolvedValue({});
      vi.spyOn(sequelize, 'transaction').mockImplementation(async (cb) => cb(null));
      const spyClose = vi.spyOn(sequelize, 'close');

      const result = await runBootstrapCli({
        input,
        output,
        sequelize,
        argv: ['node', 'cli.js']
      });

      expect(result.email).toBe('admin@example.test');
      expect(outputBuffer).toContain('[SUCCESS]');
      expect(outputBuffer).not.toContain('ValidPassword123!');
      expect(spyClose).not.toHaveBeenCalled(); // Not owned, so not closed
    });

    it('creates and closes owned sequelize instance if not provided', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      input.write('admin@example.test\nValidPassword123!\nValidPassword123!\n');

      const sequelize = createTestSequelize();
      const userId = randomUUID();

      vi.spyOn(sequelize.models.User, 'findOne').mockResolvedValue(null);
      vi.spyOn(sequelize.models.User, 'create').mockResolvedValue({
        id: userId,
        email: 'admin@example.test',
        role: 'SUPER_ADMIN'
      });
      vi.spyOn(sequelize.models.AuditLog, 'create').mockResolvedValue({});
      vi.spyOn(sequelize, 'transaction').mockImplementation(async (cb) => cb(null));
      const spyClose = vi.spyOn(sequelize, 'close').mockResolvedValue();

      const dbModule = await import('../config/database.js');
      const spyDb = vi.spyOn(dbModule, 'createSequelizeInstance').mockReturnValue(sequelize);

      const result = await runBootstrapCli({
        input,
        output,
        argv: ['node', 'cli.js']
      });

      expect(result.email).toBe('admin@example.test');
      expect(spyClose).toHaveBeenCalled();
      spyDb.mockRestore();
    });
  });
});
