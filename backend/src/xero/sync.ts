import { prisma } from '../db/client.js';
import { getXeroClientForTenant } from './client.js';

/**
 * Core sync pipeline. Pulls:
 *  1. Key reports (P&L, Balance Sheet, Aged AR/AP, Bank Summary, Trial Balance)
 *  2. Incremental transactional data (Invoices, Contacts, Bank Transactions)
 *     using the modifiedSince filter so we only fetch deltas.
 *
 * Writes everything to the local cache. Dashboard reads from the cache.
 * Returns the SyncLog row.
 */
export async function runSync(tenantId: string, trigger: 'manual' | 'scheduled') {
  const log = await prisma.syncLog.create({
    data: { tenantId, trigger, status: 'running' },
  });

  let itemsSynced = 0;
  try {
    const { client, xeroTenantId } = await getXeroClientForTenant(tenantId);

    // --- 1. Contacts - full fetch (paginated). Pagination is cheap for Demo sizes. ---
    const contactsResp = await client.accountingApi.getContacts(
      xeroTenantId, undefined, undefined, undefined, undefined, 1, undefined, undefined, undefined, 500,
    );
    const contacts = contactsResp.body.contacts ?? [];
    console.log(`[sync] fetched ${contacts.length} contacts`);
    for (const c of contacts) {
      if (!c.contactID) continue;
      await prisma.xeroContact.upsert({
        where: { id: c.contactID },
        create: {
          id: c.contactID,
          tenantId,
          name: c.name ?? 'Unknown',
          isCustomer: !!c.isCustomer,
          isSupplier: !!c.isSupplier,
          email: c.emailAddress ?? null,
          updatedDateUtc: c.updatedDateUTC ? new Date(c.updatedDateUTC) : new Date(),
        },
        update: {
          name: c.name ?? 'Unknown',
          isCustomer: !!c.isCustomer,
          isSupplier: !!c.isSupplier,
          email: c.emailAddress ?? null,
          updatedDateUtc: c.updatedDateUTC ? new Date(c.updatedDateUTC) : new Date(),
          syncedAt: new Date(),
        },
      });
      itemsSynced++;
    }

    // --- 2. Invoices - full fetch (no modifiedSince filter) ---
    const invoicesResp = await client.accountingApi.getInvoices(xeroTenantId);
    const invoices = invoicesResp.body.invoices ?? [];
    console.log(`[sync] fetched ${invoices.length} invoices`);
    for (const inv of invoices) {
      if (!inv.invoiceID) continue;
      await prisma.xeroInvoice.upsert({
        where: { id: inv.invoiceID },
        create: {
          id: inv.invoiceID,
          tenantId,
          contactId: inv.contact?.contactID ?? null,
          contactName: inv.contact?.name ?? null,
          invoiceNumber: inv.invoiceNumber ?? null,
          type: String(inv.type ?? 'ACCREC'),
          status: String(inv.status ?? 'DRAFT'),
          date: inv.date ? new Date(inv.date) : new Date(),
          dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
          subTotal: Number(inv.subTotal ?? 0),
          totalTax: Number(inv.totalTax ?? 0),
          total: Number(inv.total ?? 0),
          amountDue: Number(inv.amountDue ?? 0),
          amountPaid: Number(inv.amountPaid ?? 0),
          fullyPaidOnDate: (inv as any).fullyPaidOnDate ? new Date((inv as any).fullyPaidOnDate) : null,
          currency: String(inv.currencyCode ?? 'USD'),
          updatedDateUtc: inv.updatedDateUTC ? new Date(inv.updatedDateUTC) : new Date(),
        },
        update: {
          contactId: inv.contact?.contactID ?? null,
          contactName: inv.contact?.name ?? null,
          invoiceNumber: inv.invoiceNumber ?? null,
          type: String(inv.type ?? 'ACCREC'),
          status: String(inv.status ?? 'DRAFT'),
          date: inv.date ? new Date(inv.date) : new Date(),
          dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
          subTotal: Number(inv.subTotal ?? 0),
          totalTax: Number(inv.totalTax ?? 0),
          total: Number(inv.total ?? 0),
          amountDue: Number(inv.amountDue ?? 0),
          amountPaid: Number(inv.amountPaid ?? 0),
          fullyPaidOnDate: (inv as any).fullyPaidOnDate ? new Date((inv as any).fullyPaidOnDate) : null,
          currency: String(inv.currencyCode ?? 'USD'),
          updatedDateUtc: inv.updatedDateUTC ? new Date(inv.updatedDateUTC) : new Date(),
          syncedAt: new Date(),
        },
      });
      itemsSynced++;
    }

    // --- 3. Bank Transactions (incremental) ---
    try {
      const bankResp = await client.accountingApi.getBankTransactions(xeroTenantId);
      const txns = bankResp.body.bankTransactions ?? [];
      console.log(`[sync] fetched ${txns.length} bank transactions`);
      for (const t of txns) {
        if (!t.bankTransactionID) continue;
        await prisma.xeroBankTransaction.upsert({
          where: { id: t.bankTransactionID },
          create: {
            id: t.bankTransactionID,
            tenantId,
            type: String(t.type ?? 'RECEIVE'),
            status: String(t.status ?? 'AUTHORISED'),
            date: t.date ? new Date(t.date) : new Date(),
            total: Number(t.total ?? 0),
            bankAccountId: t.bankAccount?.accountID ?? null,
            bankAccountName: t.bankAccount?.name ?? null,
            reference: t.reference ?? null,
            updatedDateUtc: t.updatedDateUTC ? new Date(t.updatedDateUTC) : new Date(),
          },
          update: {
            type: String(t.type ?? 'RECEIVE'),
            status: String(t.status ?? 'AUTHORISED'),
            date: t.date ? new Date(t.date) : new Date(),
            total: Number(t.total ?? 0),
            bankAccountId: t.bankAccount?.accountID ?? null,
            bankAccountName: t.bankAccount?.name ?? null,
            reference: t.reference ?? null,
            updatedDateUtc: t.updatedDateUTC ? new Date(t.updatedDateUTC) : new Date(),
            syncedAt: new Date(),
          },
        });
        itemsSynced++;
      }
    } catch (e: any) {
      const body = e?.response?.body ?? e?.body ?? e?.response?.data;
      console.warn(
        `[sync] bank transactions failed (non-fatal): status=${e?.response?.statusCode ?? e?.statusCode ?? '?'} msg=${e?.message ?? 'undefined'} body=${typeof body === 'object' ? JSON.stringify(body) : body}`,
      );
    }

    // --- 4. Reports (always pulled fresh, stored as JSON snapshots) ---
    // Xero's P&L endpoint rejects any window strictly greater than 365 days
    // ("fromDate and toDate parameters must be within 365 days of each other")
    // and a literal "one year ago" crosses 366 days when the window spans a
    // Feb 29. Step back 364 days to stay safely inside the limit.
    const today = new Date();
    const yearAgo = new Date(today.getTime() - 364 * 86_400_000);
    // Aged Receivables/Payables by-contact reports require a contactId; we compute
    // aging locally from the Invoices table instead, so they're omitted here.
    const reportCalls: Array<[string, () => Promise<any>]> = [
      ['ProfitAndLoss', () => client.accountingApi.getReportProfitAndLoss(xeroTenantId, yearAgo.toISOString().slice(0, 10), today.toISOString().slice(0, 10))],
      ['BalanceSheet', () => client.accountingApi.getReportBalanceSheet(xeroTenantId, today.toISOString().slice(0, 10))],
      ['BankSummary', () => client.accountingApi.getReportBankSummary(xeroTenantId)],
      ['TrialBalance', () => client.accountingApi.getReportTrialBalance(xeroTenantId)],
    ];
    for (const [type, fn] of reportCalls) {
      try {
        const resp = await fn();
        await prisma.xeroReportSnapshot.create({
          data: {
            tenantId,
            reportType: type,
            periodEnd: today,
            payload: JSON.stringify(resp.body ?? resp),
          },
        });
        itemsSynced++;
      } catch (e: any) {
        console.warn(`[sync] report ${type} failed (non-fatal). raw error keys:`, Object.keys(e || {}));
        try {
          console.warn(`[sync] report ${type} error JSON:`, JSON.stringify(e, Object.getOwnPropertyNames(e || {})));
        } catch {
          console.warn(`[sync] report ${type} error toString:`, String(e));
        }
      }
    }

    // --- Finalize ---
    const finishedAt = new Date();
    const updated = await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: 'success', finishedAt, itemsSynced },
    });
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { lastSyncedAt: finishedAt },
    });
    return updated;
  } catch (e: any) {
    console.error('[sync] failed:', e);
    return prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: 'error',
        finishedAt: new Date(),
        itemsSynced,
        errorMsg: e?.message ?? 'Unknown error',
      },
    });
  }
}
