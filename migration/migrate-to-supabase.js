/**
 * First Mile Capital — Airtable → Supabase Migration
 *
 * Run with: node migrate-to-supabase.js
 *
 * Prerequisites:
 *   1. Run supabase-migration.sql in Supabase SQL Editor first
 *   2. Fill in your keys below
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || 'YOUR_AIRTABLE_TOKEN';
const AIRTABLE_BASE = process.env.AIRTABLE_BASE || 'YOUR_AIRTABLE_BASE';

const SUPABASE_URL = process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'YOUR_SUPABASE_KEY';

// Airtable table IDs
const BANKING_TABLE = 'tbl9ahPA1hA2hZrv0';
const INVESTMENTS_TABLE = 'tblzZn4NMXUYRZBqt';
const LIABILITIES_TABLE = 'tblh9ZKlCwyreJ8tM';

// Airtable field IDs → human names
const BANKING_FIELDS = {
  fldlJucnQS8E5dFYG: 'description',
  fldgQFXI2kPiBQOdT: 'date',
  fld4aW3FyVbUmgFVf: 'amount',
  fldTMmHSCfpwHqP3J: 'ledger_balance',
  fldngEmDXwYGhijcY: 'transaction_type',
  fld4vsI6lQ4zgYA43: 'credit_debit',
  fldNG9VQSGRB3tdBI: 'account_name',
  fldQx16vpxLlf0X7O: 'account_number'
};

const INV_FIELDS = {
  fldX5ys676ayoxNYc: 'name',
  fldq3aDBIuBTwmFrr: 'membership_class',
  fldU6w5LV9vnwBStm: 'ownership_pct',
  fldQwyDR70uO6gJUR: 'committed',
  fldJSQQcIZAoNqSk6: 'contributed',
  fldtO65Vvx5qG001G: 'distributed',
  fldVsxc6dj0X7Z7OS: 'unreturned',
  fldviDb8s6v42qhza: 'net_equity',
  fld0EfM7mI7qdfNIf: 'valuation',
  fld5SZIIZQ8Rwf2Ha: 'status'
};

const LIAB_FIELDS = {
  fldvvtM6ou0ZADJie: 'lender',
  fldCi9osyG9TUL600: 'related_deal',
  fldM2nEv5uDF5KgCU: 'principal',
  fldPeNMUOK590jdU6: 'currency',
  fldxjjIHSsPbzToQZ: 'usd_equivalent',
  fld6ZRgiKHCf7dzGx: 'maturity_date',
  fld98KXnfxZiK2mg3: 'status',
  fldckrJ6NdV2mgllf: 'notes'
};

// ── Fetch all records from an Airtable table ──
async function fetchAirtable(tableId) {
  let records = [];
  let offset = null;
  do {
    let url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${tableId}?pageSize=100`;
    if (offset) url += `&offset=${offset}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });
    if (!resp.ok) throw new Error(`Airtable ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    records = records.concat(data.records);
    offset = data.offset || null;
    process.stdout.write(`\r  Fetched ${records.length} records...`);
  } while (offset);
  console.log(`\r  Fetched ${records.length} records total.`);
  return records;
}

// ── Map Airtable record to Supabase row ──
function mapBankingRecord(r) {
  const f = r.fields;
  const get = (fieldId) => {
    const val = f[fieldId] || f[BANKING_FIELDS[fieldId]];
    if (val && typeof val === 'object' && val.name) return val.name;
    return val || null;
  };
  return {
    airtable_id: r.id,
    description: get('fldlJucnQS8E5dFYG') || f['Description'] || null,
    date: get('fldgQFXI2kPiBQOdT') || f['Date'] || null,
    amount: get('fld4aW3FyVbUmgFVf') || f['Amount'] || null,
    ledger_balance: get('fldTMmHSCfpwHqP3J') || f['Ledger Balance'] || null,
    transaction_type: get('fldngEmDXwYGhijcY') || f['Transaction Type'] || null,
    credit_debit: get('fld4vsI6lQ4zgYA43') || f['Credit/Debit'] || null,
    account_name: (() => { const v = get('fldNG9VQSGRB3tdBI') || f['Account Name']; return (v && typeof v === 'object') ? v.name : v || null; })(),
    account_number: (() => { const v = get('fldQx16vpxLlf0X7O') || f['Account Number']; return (v && typeof v === 'object') ? v.name : String(v || ''); })()
  };
}

function mapInvestmentRecord(r) {
  const f = r.fields;
  const get = (fieldId, fallback) => {
    const val = f[fieldId] || f[fallback];
    if (val && typeof val === 'object' && val.name) return val.name;
    return val ?? null;
  };
  return {
    airtable_id: r.id,
    name: get('fldX5ys676ayoxNYc', 'Investment'),
    membership_class: get('fldq3aDBIuBTwmFrr', 'Membership Class'),
    ownership_pct: get('fldU6w5LV9vnwBStm', 'Ownership %') || 0,
    committed: get('fldQwyDR70uO6gJUR', 'Committed') || 0,
    contributed: get('fldJSQQcIZAoNqSk6', 'Contributed') || 0,
    distributed: get('fldtO65Vvx5qG001G', 'Distributed') || 0,
    unreturned: get('fldVsxc6dj0X7Z7OS', 'Unreturned Capital') || 0,
    net_equity: get('fldviDb8s6v42qhza', 'Net Equity') || 0,
    valuation: get('fld0EfM7mI7qdfNIf', 'Valuation') || null,
    status: get('fld5SZIIZQ8Rwf2Ha', 'Status') || 'Active'
  };
}

function mapLiabilityRecord(r) {
  const f = r.fields;
  const get = (fieldId, ...fallbacks) => {
    let val = f[fieldId];
    if (val === undefined) {
      for (const fb of fallbacks) {
        if (f[fb] !== undefined) { val = f[fb]; break; }
      }
    }
    if (val && typeof val === 'object' && val.name) return val.name;
    return val ?? null;
  };
  return {
    airtable_id: r.id,
    lender: get('fldvvtM6ou0ZADJie', 'Lender / Description', 'Lender/Description'),
    related_deal: get('fldCi9osyG9TUL600', 'Related Deal'),
    principal: get('fldM2nEv5uDF5KgCU', 'Principal Amount') || 0,
    currency: get('fldPeNMUOK590jdU6', 'Currency') || 'USD',
    usd_equivalent: get('fldxjjIHSsPbzToQZ', 'USD Equivalent') || null,
    maturity_date: get('fld6ZRgiKHCf7dzGx', 'Maturity Date') || null,
    status: get('fld98KXnfxZiK2mg3', 'Status') || 'Active',
    notes: get('fldckrJ6NdV2mgllf', 'Notes') || null
  };
}

// ── Upsert rows into Supabase (batch of 500) ──
async function upsertSupabase(table, rows) {
  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(batch)
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Supabase ${table} insert error ${resp.status}: ${err}`);
    }
    inserted += batch.length;
    process.stdout.write(`\r  Inserted ${inserted}/${rows.length}...`);
  }
  console.log(`\r  Inserted ${inserted} rows into ${table}.`);
}

// ── Main ──
async function main() {
  console.log('=== First Mile Capital: Airtable → Supabase Migration ===\n');

  // 1. Banking Transactions
  console.log('1/3 Banking Transactions');
  console.log('  Fetching from Airtable...');
  const bankingRaw = await fetchAirtable(BANKING_TABLE);
  const bankingRows = bankingRaw.map(mapBankingRecord);
  console.log('  Writing to Supabase...');
  await upsertSupabase('banking_transactions', bankingRows);

  // 2. Investments
  console.log('\n2/3 Investments');
  console.log('  Fetching from Airtable...');
  const invRaw = await fetchAirtable(INVESTMENTS_TABLE);
  const invRows = invRaw.map(mapInvestmentRecord);
  console.log('  Writing to Supabase...');
  await upsertSupabase('investments', invRows);

  // 3. Liabilities
  console.log('\n3/3 Liabilities');
  console.log('  Fetching from Airtable...');
  const liabRaw = await fetchAirtable(LIABILITIES_TABLE);
  const liabRows = liabRaw.map(mapLiabilityRecord);
  console.log('  Writing to Supabase...');
  await upsertSupabase('liabilities', liabRows);

  console.log('\n✅ Migration complete!');
  console.log(`   ${bankingRows.length} transactions`);
  console.log(`   ${invRows.length} investments`);
  console.log(`   ${liabRows.length} liabilities`);
}

main().catch(e => { console.error('\n❌ Error:', e.message); process.exit(1); });
