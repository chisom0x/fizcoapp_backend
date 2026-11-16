/**
 * Creates the first admin-panel account. Admins can't sign up, so this is how one is made.
 *
 *   npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node","resolvePackageJsonExports":false}' prisma/seed-admin.ts [email] [password] [name]
 *
 * Defaults to admin@fizco.com / password123. An existing admin is left untouched, so re-running
 * never resets a password someone has since changed. Change the default password after signing in.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

async function main() {
  const [email = 'admin@fizco.com', password = 'password123', fullName = 'Fizco Admin'] =
    process.argv.slice(2);
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.admin.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      console.log(`Admin ${existing.email} already exists; left unchanged.`);
      return;
    }
    const admin = await prisma.admin.create({
      data: {
        email: email.toLowerCase(),
        fullName,
        passwordHash: await bcrypt.hash(password, 12),
      },
      select: { email: true },
    });
    console.log(`Created admin ${admin.email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
