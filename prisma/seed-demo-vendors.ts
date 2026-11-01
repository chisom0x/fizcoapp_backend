/**
 * 20 demo vendor accounts with priced inventory, for trying out automatic vendor offers.
 *
 *   npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' prisma/seed-demo-vendors.ts [--dry-run | --remove]
 *
 * Re-running resets the demo accounts' inventory and plans; --remove deletes the accounts and
 * everything they own (chats, messages, interests). --dry-run prints the plan without a database.
 *
 * 15 vendors are Premium, 5 are Free. 14 Premium and 3 Free vendors stock an iPhone 13, so a
 * request for "iPhone 13" sends offers from the 10 cheapest Premium vendors, and the other
 * matching vendors only get the "new request matching your inventory" notification.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { extractPrice } from '../src/modules/inventory/price';

// All demo accounts share this password; sign in with any demo email below
const DEMO_PASSWORD = 'FizcoDemo#2026';
const emailFor = (n: number) => `demo.vendor${String(n).padStart(2, '0')}@fizco.test`;
const phoneFor = (n: number) => `+234700000${String(100 + n).padStart(4, '0')}`;

const VENDORS: Array<{ business: string; plan: 'Premium' | 'Free'; stock: ProductKey[] }> = [
  { business: 'Ikeja Gadget Hub', plan: 'Premium', stock: ['iphone13', 'iphone14pro', 'airpodspro2', 'ps5'] },
  { business: 'Computer Village Deals', plan: 'Premium', stock: ['iphone13', 'macbookairm2', 'galaxys23ultra'] },
  { business: 'Lekki Phones', plan: 'Premium', stock: ['iphone13', 'iphone14pro', 'airpodspro2'] },
  { business: 'Abuja Tech Store', plan: 'Premium', stock: ['iphone13', 'ps5', 'macbookairm2'] },
  { business: 'Yaba Device Mart', plan: 'Premium', stock: ['iphone13', 'galaxys23ultra', 'pixel7pro'] },
  { business: 'Surulere Mobile', plan: 'Premium', stock: ['iphone13', 'tecnocamon20', 'airpodspro2'] },
  { business: 'VI Electronics', plan: 'Premium', stock: ['iphone13', 'macbookairm2', 'ps5'] },
  { business: 'Ajah iStore', plan: 'Premium', stock: ['iphone13', 'iphone14pro', 'macbookairm2'] },
  { business: 'Port Harcourt Gadgets', plan: 'Premium', stock: ['iphone13', 'galaxys23ultra', 'tecnocamon20'] },
  { business: 'Ibadan Phone Plaza', plan: 'Premium', stock: ['iphone13', 'pixel7pro', 'airpodspro2'] },
  { business: 'Kano Tech World', plan: 'Premium', stock: ['iphone13', 'ps5', 'galaxys23ultra'] },
  { business: 'Enugu Smart Devices', plan: 'Premium', stock: ['iphone13', 'iphone14pro', 'tecnocamon20'] },
  { business: 'Benin Gadget Zone', plan: 'Premium', stock: ['iphone13', 'airpodspro2', 'pixel7pro'] },
  { business: 'Ogba Phones & More', plan: 'Premium', stock: ['iphone13', 'galaxys23ultra', 'ps5'] },
  { business: 'Festac Electronics', plan: 'Premium', stock: ['macbookairm2', 'ps5', 'airpodspro2'] },
  { business: 'Gbagada Gadgets', plan: 'Free', stock: ['iphone13', 'ps5', 'tecnocamon20'] },
  { business: 'Ikorodu Phones', plan: 'Free', stock: ['iphone13', 'galaxys23ultra'] },
  { business: 'Magodo Tech', plan: 'Free', stock: ['iphone13', 'macbookairm2', 'airpodspro2'] },
  { business: 'Oshodi Device Hub', plan: 'Free', stock: ['tecnocamon20', 'pixel7pro', 'iphone14pro'] },
  { business: 'Maryland Mobile', plan: 'Free', stock: ['galaxys23ultra', 'ps5', 'iphone14pro'] },
];

type ProductKey = keyof typeof PRODUCTS;
const PRODUCTS = {
  iphone13: {
    title: 'iPhone 13', brand: 'Apple', model: 'iPhone 13', base: 430_000,
    imageUrls: ['https://images.moneycontrol.com/static-mcnews/2021/10/Apple-iPhone-13-4-770x433.jpg?impolicy=website&width=770&height=431'],
    specs: ['128GB, Midnight, UK used, 89% battery health', '128GB, Blue, clean UK used', '256GB, Starlight, brand new sealed', '128GB, Pink, open box'],
  },
  iphone14pro: {
    title: 'iPhone 14 Pro', brand: 'Apple', model: 'iPhone 14 Pro', base: 780_000,
    specs: ['256GB, Deep Purple, UK used, 92% battery health', '128GB, Space Black, brand new sealed', '256GB, Gold, clean US used'],
  },
  macbookairm2: {
    title: 'MacBook Air M2', brand: 'Apple', model: 'MacBook Air M2', base: 1_050_000,
    specs: ['8GB RAM / 256GB SSD, Midnight, brand new', '16GB RAM / 512GB SSD, Silver, open box', '8GB RAM / 512GB SSD, Starlight, UK used'],
  },
  airpodspro2: {
    title: 'AirPods Pro 2', brand: 'Apple', model: 'AirPods Pro 2', base: 165_000,
    specs: ['USB-C case, brand new sealed', 'Lightning case, clean UK used', 'USB-C case, open box with receipt'],
  },
  galaxys23ultra: {
    title: 'Samsung Galaxy S23 Ultra', brand: 'Samsung', model: 'Galaxy S23 Ultra', base: 720_000,
    specs: ['256GB, Phantom Black, UK used', '512GB, Green, brand new sealed', '256GB, Cream, clean US used, with S Pen'],
  },
  ps5: {
    title: 'PlayStation 5', brand: 'Sony', model: 'PlayStation 5', base: 620_000,
    specs: ['Slim disc edition, brand new sealed, 1 controller', 'Digital edition, UK used, 2 controllers', 'Disc edition, open box, with FIFA 24'],
  },
  pixel7pro: {
    title: 'Google Pixel 7 Pro', brand: 'Google', model: 'Pixel 7 Pro', base: 390_000,
    specs: ['128GB, Obsidian, UK used', '256GB, Hazel, brand new sealed', '128GB, Snow, clean US used'],
  },
  tecnocamon20: {
    title: 'Tecno Camon 20', brand: 'Tecno', model: 'Camon 20', base: 185_000,
    specs: ['256GB / 8GB RAM, Serenity Blue, brand new', '256GB / 8GB RAM, Predawn Black, brand new sealed'],
  },
};

// Every price is written the way vendors actually type it
const PRICE_STYLES: Array<(p: number) => string> = [
  (p) => `₦${p.toLocaleString('en-NG')}`,
  (p) => `${p / 1000}k`,
  (p) => `N${p.toLocaleString('en-NG')}`,
  (p) => `price: ${p}`,
  (p) => `${p} naira`,
];

function listingsFor(vendorIndex: number) {
  return VENDORS[vendorIndex].stock.map((key, j) => {
    const product = PRODUCTS[key];
    // Deterministic spread of up to ±12% around the market price, rounded to ₦5,000
    const spread = (((vendorIndex * 7 + j * 3) % 25) - 12) / 100;
    const price = Math.round((product.base * (1 + spread)) / 5000) * 5000;
    const spec = product.specs[(vendorIndex + j) % product.specs.length];
    const rawInput = `${product.title}, ${spec}, ${PRICE_STYLES[(vendorIndex + j) % PRICE_STYLES.length](price)}`;
    if (extractPrice(rawInput) !== price) {
      throw new Error(`Seed listing "${rawInput}" doesn't read back as ${price}`);
    }
    return {
      title: product.title,
      description: spec,
      rawInput,
      imageUrls: 'imageUrls' in product ? product.imageUrls : [],
      price,
      brand: product.brand,
      model: product.model,
    };
  });
}

async function seed(prisma: PrismaClient) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const periodEnd = new Date();
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);

  for (const [i, vendor] of VENDORS.entries()) {
    const email = emailFor(i + 1);
    const isPremium = vendor.plan === 'Premium';
    const profile = {
      fullName: `${vendor.business} (Demo)`,
      businessName: vendor.business,
      subscriptionPlan: vendor.plan,
      isVerified: isPremium,
      verificationStatus: isPremium ? ('VERIFIED' as const) : ('UNVERIFIED' as const),
    };
    const user = await prisma.user.upsert({
      where: { email },
      create: { ...profile, email, phoneNumber: phoneFor(i + 1), passwordHash },
      update: profile,
    });

    // Premium accounts carry an active subscription like a paying user's, so the billing screens agree
    if (isPremium) {
      const subscription = {
        plan: 'yearly',
        status: 'active',
        amount: 0,
        interval: 'year',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      };
      await prisma.subscription.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...subscription },
        update: subscription,
      });
    } else {
      await prisma.subscription.deleteMany({ where: { userId: user.id } });
    }

    await prisma.inventoryItem.deleteMany({ where: { userId: user.id } });
    await prisma.inventoryItem.createMany({
      data: listingsFor(i).map((item) => ({ ...item, userId: user.id })),
    });
    console.log(`${email}  ${vendor.plan.padEnd(7)}  ${vendor.business}`);
  }
}

async function main() {
  const mode = process.argv[2];

  if (mode === '--dry-run') {
    VENDORS.forEach((vendor, i) => {
      console.log(`${emailFor(i + 1)}  ${vendor.plan}  ${vendor.business}`);
      for (const item of listingsFor(i)) console.log(`    ${item.rawInput}`);
    });
    return;
  }

  const prisma = new PrismaClient();
  try {
    if (mode === '--remove') {
      const { count } = await prisma.user.deleteMany({
        where: { email: { in: VENDORS.map((_, i) => emailFor(i + 1)) } },
      });
      console.log(`Removed ${count} demo account(s)`);
      return;
    }
    await seed(prisma);
    console.log(`\nSeeded ${VENDORS.length} demo vendors. Password: see DEMO_PASSWORD in this script.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
