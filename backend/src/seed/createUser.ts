import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../config/db';
import User from '../models/User';

/**
 * Creates or updates one user without touching any other data.
 * The password is read from the NEW_USER_PASSWORD environment variable so it
 * does not end up in shell history or process listings.
 *
 *   NEW_USER_PASSWORD='...' npm run create-user -- --email owner@company.com --name "Owner" --role ADMIN
 */
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const main = async () => {
  const email = (arg('email') || '').toLowerCase().trim();
  const name = (arg('name') || '').trim();
  const role = (arg('role') || 'CA').toUpperCase();
  const password = process.env.NEW_USER_PASSWORD || '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('--email is required and must be valid');
  if (!name) throw new Error('--name is required');
  if (role !== 'ADMIN' && role !== 'CA') throw new Error('--role must be ADMIN or CA');
  if (password.length < 10) throw new Error('Set NEW_USER_PASSWORD to at least 10 characters');

  await connectDB();
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await User.findOne({ email });
  if (existing) {
    existing.name = name;
    existing.role = role;
    existing.passwordHash = passwordHash;
    await existing.save();
    console.log(`[User] Updated ${email} (${role})`);
  } else {
    await User.create({ name, email, role, passwordHash });
    console.log(`[User] Created ${email} (${role})`);
  }
  await disconnectDB();
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[User] ${err.message}`);
    process.exit(1);
  });
