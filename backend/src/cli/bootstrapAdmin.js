import readline from 'node:readline';
import { Writable } from 'node:stream';
import { createSequelizeInstance } from '../config/database.js';
import { bootstrapAdminUser } from '../services/adminBootstrap.js';

class MutedWritable extends Writable {
  constructor(destination) {
    super();
    this.destination = destination;
    this.muted = false;
  }

  _write(chunk, encoding, callback) {
    if (!this.muted) {
      this.destination.write(chunk, encoding);
    }
    callback();
  }
}

/**
 * Runs the interactive admin bootstrap CLI.
 * Enforces interactive prompt input and explicitly prohibits credentials in argv.
 *
 * @param {object} [options]
 * @param {NodeJS.ReadableStream} [options.input]
 * @param {NodeJS.WritableStream} [options.output]
 * @param {import('sequelize').Sequelize} [options.sequelize]
 * @param {string[]} [options.argv]
 * @returns {Promise<{ id: string, email: string, role: string }>}
 */
export async function runBootstrapCli(options = {}) {
  const argv = options.argv || process.argv;
  if (argv.slice(2).some((arg) => /password|secret|credential|email/i.test(arg))) {
    throw new Error('Passing credentials via command-line arguments is strictly prohibited');
  }

  const rawOutput = options.output || process.stdout;
  const mutedStream = new MutedWritable(rawOutput);
  const input = options.input || process.stdin;

  const rl = readline.createInterface({
    input,
    output: mutedStream,
    terminal: Boolean(input.isTTY)
  });
  const lineIterator = rl[Symbol.asyncIterator]();

  let ownedSequelize = false;
  let sequelize = options.sequelize;

  try {
    rawOutput.write('Enter Super Admin email: ');
    const emailResult = await lineIterator.next();
    const email = (emailResult.value || '').trim();

    rawOutput.write('Enter Super Admin password: ');
    mutedStream.muted = true;
    const passwordResult = await lineIterator.next();
    mutedStream.muted = false;
    rawOutput.write('\n');
    const password = passwordResult.value || '';

    rawOutput.write('Confirm password: ');
    mutedStream.muted = true;
    const confirmResult = await lineIterator.next();
    mutedStream.muted = false;
    rawOutput.write('\n');
    const confirmPassword = confirmResult.value || '';

    if (!password) {
      throw new Error('Password cannot be empty');
    }

    if (password !== confirmPassword) {
      throw new Error('Password confirmation does not match');
    }

    if (!sequelize) {
      sequelize = createSequelizeInstance();
      ownedSequelize = true;
    }

    const result = await bootstrapAdminUser({
      sequelize,
      email,
      password
    });

    rawOutput.write(`[SUCCESS] Super Admin account created: ${result.email} (${result.id})\n`);
    return result;
  } finally {
    rl.close();
    if (ownedSequelize && sequelize) {
      await sequelize.close();
    }
  }
}

/* istanbul ignore next -- @preserve CLI entrypoint: executed only when called directly via terminal */
if (process.argv[1] && process.argv[1].endsWith('bootstrapAdmin.js')) {
  runBootstrapCli()
    .then(() => process.exit(0))
    .catch((err) => {
      process.stderr.write(`[ERROR] ${err.message}\n`);
      process.exit(1);
    });
}
