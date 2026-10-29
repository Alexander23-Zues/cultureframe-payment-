-- CreateTable
CREATE TABLE `admin_users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL DEFAULT 'CultureFrame Administrator',
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'SUPER_ADMIN',
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT true,
    `failedLogins` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `resetTokenHash` VARCHAR(191) NULL,
    `resetExpiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `admin_users_email_key`(`email`),
    UNIQUE INDEX `admin_users_resetTokenHash_key`(`resetTokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `data` LONGTEXT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `adminId` VARCHAR(191) NULL,

    INDEX `admin_sessions_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cultureframe_customers` (
    `id` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL DEFAULT '',
    `address` VARCHAR(2000) NOT NULL DEFAULT '',
    `source` VARCHAR(191) NOT NULL DEFAULT 'ADMIN_IMPORT',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `cultureframe_customers_externalId_key`(`externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cultureframe_sellers` (
    `id` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `craft` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NOT NULL DEFAULT 'Mansalay, Oriental Mindoro',
    `source` VARCHAR(191) NOT NULL DEFAULT 'ADMIN_IMPORT',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `cultureframe_sellers_externalId_key`(`externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cultureframe_orders` (
    `id` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `product` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `amountCents` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'PHP',
    `source` VARCHAR(191) NOT NULL DEFAULT 'ADMIN_IMPORT',
    `paymentStatus` VARCHAR(191) NOT NULL DEFAULT 'UNPAID',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `cultureframe_orders_externalId_key`(`externalId`),
    INDEX `cultureframe_orders_customerId_idx`(`customerId`),
    INDEX `cultureframe_orders_sellerId_idx`(`sellerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_methods` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'MANUAL',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `methodId` VARCHAR(191) NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `refundedCents` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `provider` VARCHAR(191) NOT NULL DEFAULT 'MANUAL',
    `providerReference` VARCHAR(191) NULL,
    `evidence` VARCHAR(2000) NOT NULL DEFAULT '',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `commissionBps` INTEGER NOT NULL DEFAULT 500,
    `feeCents` INTEGER NOT NULL DEFAULT 0,
    `verifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `payment_transactions_reference_key`(`reference`),
    UNIQUE INDEX `payment_transactions_providerReference_key`(`providerReference`),
    UNIQUE INDEX `payment_transactions_idempotencyKey_key`(`idempotencyKey`),
    INDEX `payment_transactions_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `payment_transactions_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `note` VARCHAR(2000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_events` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refund_requests` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `reason` VARCHAR(2000) NOT NULL,
    `decisionReason` VARCHAR(2000) NOT NULL DEFAULT '',
    `status` VARCHAR(191) NOT NULL DEFAULT 'REQUESTED',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `refund_requests_reference_key`(`reference`),
    UNIQUE INDEX `refund_requests_idempotencyKey_key`(`idempotencyKey`),
    INDEX `refund_requests_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refund_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `refundId` VARCHAR(191) NOT NULL,
    `providerReference` VARCHAR(191) NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refund_transactions_providerReference_key`(`providerReference`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receipts` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `receipts_number_key`(`number`),
    UNIQUE INDEX `receipts_paymentId_key`(`paymentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seller_earnings` (
    `id` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `grossCents` INTEGER NOT NULL,
    `commissionCents` INTEGER NOT NULL,
    `feeCents` INTEGER NOT NULL,
    `refundCents` INTEGER NOT NULL DEFAULT 0,
    `netCents` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `seller_earnings_paymentId_key`(`paymentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seller_payouts` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'REQUESTED',
    `destination` VARCHAR(2000) NOT NULL,
    `note` VARCHAR(2000) NOT NULL DEFAULT '',
    `providerReference` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `seller_payouts_reference_key`(`reference`),
    UNIQUE INDEX `seller_payouts_providerReference_key`(`providerReference`),
    UNIQUE INDEX `seller_payouts_idempotencyKey_key`(`idempotencyKey`),
    INDEX `seller_payouts_sellerId_status_idx`(`sellerId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `financial_ledger_entries` (
    `id` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NULL,
    `payoutId` VARCHAR(191) NULL,
    `kind` VARCHAR(191) NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `description` VARCHAR(2000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `financial_ledger_entries_reference_key`(`reference`),
    INDEX `financial_ledger_entries_sellerId_createdAt_idx`(`sellerId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `adminId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `details` LONGTEXT NOT NULL,
    `ip` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_sync_logs` (
    `id` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `operation` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NULL,
    `payload` LONGTEXT NOT NULL,
    `error` VARCHAR(2000) NOT NULL DEFAULT '',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextRetryAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `integration_sync_logs_status_nextRetryAt_idx`(`status`, `nextRetryAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_events` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `payload` LONGTEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_settings` (
    `key` VARCHAR(191) NOT NULL,
    `value` LONGTEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `admin_sessions` ADD CONSTRAINT `admin_sessions_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cultureframe_orders` ADD CONSTRAINT `cultureframe_orders_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `cultureframe_customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cultureframe_orders` ADD CONSTRAINT `cultureframe_orders_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `cultureframe_sellers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_transactions` ADD CONSTRAINT `payment_transactions_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `cultureframe_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_transactions` ADD CONSTRAINT `payment_transactions_methodId_fkey` FOREIGN KEY (`methodId`) REFERENCES `payment_methods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_attempts` ADD CONSTRAINT `payment_attempts_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payment_transactions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_events` ADD CONSTRAINT `payment_events_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payment_transactions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund_requests` ADD CONSTRAINT `refund_requests_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payment_transactions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund_transactions` ADD CONSTRAINT `refund_transactions_refundId_fkey` FOREIGN KEY (`refundId`) REFERENCES `refund_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payment_transactions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seller_earnings` ADD CONSTRAINT `seller_earnings_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `cultureframe_sellers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seller_earnings` ADD CONSTRAINT `seller_earnings_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payment_transactions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seller_payouts` ADD CONSTRAINT `seller_payouts_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `cultureframe_sellers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `financial_ledger_entries` ADD CONSTRAINT `financial_ledger_entries_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `cultureframe_sellers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `financial_ledger_entries` ADD CONSTRAINT `financial_ledger_entries_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payment_transactions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `financial_ledger_entries` ADD CONSTRAINT `financial_ledger_entries_payoutId_fkey` FOREIGN KEY (`payoutId`) REFERENCES `seller_payouts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
