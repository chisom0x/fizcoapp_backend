/**
 * Fills one existing account's inventory with 50 priced gadgets (phones, MacBooks and other
 * laptops, consoles, tablets, watches, audio) that carry real product photos from Wikimedia Commons.
 *
 *   npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node","resolvePackageJsonExports":false}' \
 *     prisma/seed-user-inventory.ts <email> [--remove]
 *
 * Re-running replaces only these seeded items (matched by their raw input), so the account's own
 * listings are left alone; --remove deletes the seeded items.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { extractPrice } from '../src/modules/inventory/price';

const ITEMS: unknown = JSON.parse(readFileSync(join(__dirname, 'seed-user-inventory.items.json'), 'utf8'));

type SeedItem = {
  title: string;
  brand: string;
  model: string;
  storage: string | null;
  condition: string;
  color: string;
  price: number;
  others: string | null;
  imageUrl: string;
};

function listings() {
  return (ITEMS as SeedItem[]).map((item) => {
    const description = [item.storage, item.color, item.condition, item.others].filter(Boolean).join(', ');
    // Written the way vendors type a listing, and checked to read back as the stored price
    const rawInput = `${item.title}, ${description}, ₦${item.price.toLocaleString('en-NG')}`;
    if (extractPrice(rawInput) !== item.price) {
      throw new Error(`Seed listing "${rawInput}" doesn't read back as ${item.price}`);
    }
    return {
      title: item.title,
      description,
      rawInput,
      imageUrls: [item.imageUrl],
      price: item.price,
      brand: item.brand,
      model: item.model,
      storage: item.storage,
      condition: item.condition,
      color: item.color,
      others: item.others,
    };
  });
}

async function main() {
  const [email, mode] = process.argv.slice(2);
  if (!email) throw new Error('Usage: seed-user-inventory.ts <email> [--remove]');

  const items = listings();
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new Error(`No user with email ${email}`);

    const seeded = { userId: user.id, rawInput: { in: items.map((item) => item.rawInput) } };
    await prisma.$transaction(async (tx) => {
      const { count: removed } = await tx.inventoryItem.deleteMany({ where: seeded });
      if (mode === '--remove') {
        console.log(`Removed ${removed} seeded item(s) from ${user.email}`);
        return;
      }
      await tx.inventoryItem.createMany({ data: items.map((item) => ({ ...item, userId: user.id })) });
      console.log(`Seeded ${items.length} items for ${user.email} (replaced ${removed})`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
