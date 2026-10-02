import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../config/db';
import User from '../models/User';

export const seedUsers = async () => {
  console.log('[Seed] Seeding initial Admin and CA users...');

  // Hash default passwords
  const salt = await bcrypt.genSalt(10);
  const adminPasswordHash = await bcrypt.hash('admin123', salt);
  const caPasswordHash = await bcrypt.hash('ca123', salt);

  const users = [
    {
      name: 'NAVKA Administrator',
      email: 'admin@navka.com',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
    },
    {
      name: 'NAVKA Chartered Accountant',
      email: 'ca@navka.com',
      passwordHash: caPasswordHash,
      role: 'CA',
    },
  ];

  for (const userData of users) {
    const existing = await User.findOne({ email: userData.email });
    if (!existing) {
      await User.create(userData);
      console.log(`[Seed] Created user: ${userData.email} (${userData.role})`);
    } else {
      // Update password hash and role to guarantee credentials match
      existing.name = userData.name;
      existing.passwordHash = userData.passwordHash;
      existing.role = userData.role as any;
      await existing.save();
      console.log(`[Seed] Updated existing user: ${userData.email} (${userData.role})`);
    }
  }

  console.log('[Seed] User seeding complete.');
};

// If run directly
if (require.main === module) {
  // Demo users have public passwords (admin123 / ca123); use `npm run create-user` in production.
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force-production')) {
    console.error('[Seed] Refusing to create demo users with default passwords when NODE_ENV=production.');
    console.error('[Seed] Use: NEW_USER_PASSWORD=... npm run create-user -- --email you@company.com --name "Name" --role ADMIN');
    process.exit(1);
  }
  (async () => {
    try {
      await connectDB();
      await seedUsers();
      await disconnectDB();
      process.exit(0);
    } catch (err: any) {
      console.error('[Seed] Error during seeding:', err);
      process.exit(1);
    }
  })();
}
