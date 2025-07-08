import { PrismaClient } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // create sample wallets
  const wallet1 = await prisma.wallet.create({
    data: {
      userId: 'user-1',
      balance: new Decimal(1000),
    },
  });

  const wallet2 = await prisma.wallet.create({
    data: {
      userId: 'user-2',
      balance: new Decimal(500),
    },
  });

  console.log('Created wallets:', { wallet1, wallet2 });

  // create sample transactions
  await prisma.transaction.create({
    data: {
      transactionId: uuidv4(),
      walletId: wallet1.id,
      amount: new Decimal(1000),
      type: 'DEPOSIT',
      status: 'COMPLETED',
      description: 'Initial deposit',
    },
  });

  await prisma.transaction.create({
    data: {
      transactionId: uuidv4(),
      walletId: wallet2.id,
      amount: new Decimal(500),
      type: 'DEPOSIT',
      status: 'COMPLETED',
      description: 'Initial deposit',
    },
  });

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });