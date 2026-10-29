import crypto from 'node:crypto';
import { importOrder } from './integration.js';
const artisans = [
  { externalId: 'SIM-SELLER-01', name: 'Amihan Craft Studio', email: 'amihan@example.test', craft: 'Handwoven homeware' },
  { externalId: 'SIM-SELLER-02', name: 'Luntian Artisan Collective', email: 'luntian@example.test', craft: 'Natural fiber crafts' },
  { externalId: 'SIM-SELLER-03', name: 'Habi & Heritage', email: 'habi@example.test', craft: 'Handmade accessories' },
  { externalId: 'SIM-SELLER-04', name: 'Baybay Workshop', email: 'baybay@example.test', craft: 'Wood and bamboo' },
];
const products = ['Handwoven market tote', 'Natural fiber table runner', 'Artisan woven basket', 'Bamboo serving tray', 'Handcrafted home accent', 'Woven everyday pouch'];
const customers = ['Ana Reyes', 'Miguel Santos', 'Sofia Cruz', 'Paolo Garcia', 'Isabel Flores', 'Gabriel Mendoza', 'Elena Ramos', 'Rafael Torres'];
export function simulatorPayload(index = Math.floor(Math.random() * 100000)) {
  const name = customers[index % customers.length];
  return { externalId: `SIM-ORD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, product: products[index % products.length], quantity: 1 + index % 3, amountCents: [125000, 85000, 240000, 175000, 320000, 65000][index % 6], currency: 'PHP', customer: { externalId: `SIM-CUSTOMER-${index % customers.length}`, name, email: `${name.toLowerCase().replace(' ', '.')}@example.test`, address: 'Demo address · Philippines' }, seller: { ...artisans[index % artisans.length] } };
}
export const createSimulatorOrder = (actor, index) => importOrder(simulatorPayload(index), 'SIMULATOR', actor);
