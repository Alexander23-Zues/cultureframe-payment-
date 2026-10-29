import { PrismaClient } from '@prisma/client';
export const db = new PrismaClient();
export async function atomic(work) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 15000 }); }
    catch (error) {
      if (!['P2034', 'P1008', 'P2028'].includes(error.code) || attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}
